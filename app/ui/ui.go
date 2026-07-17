//go:build windows || darwin

// package ui implements a chat interface for Dromadaire (Ollama fork)
package ui

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math"
	"net/http"
	"net/http/httputil"
	"os"
	"path/filepath"
	"runtime"
	"runtime/debug"
	"slices"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
	"github.com/ollama/ollama/api"
	"github.com/ollama/ollama/app/server"
	"github.com/ollama/ollama/app/store"
	"github.com/ollama/ollama/app/tools"
	"github.com/ollama/ollama/app/types/not"
	"github.com/ollama/ollama/app/ui/responses"
	"github.com/ollama/ollama/app/updater"
	"github.com/ollama/ollama/app/version"
	ollamaAuth "github.com/ollama/ollama/auth"
	"github.com/ollama/ollama/envconfig"
	"github.com/ollama/ollama/manifest"
	"github.com/ollama/ollama/types/model"
	_ "github.com/tkrajina/typescriptify-golang-structs/typescriptify"
	"golang.org/x/crypto/bcrypt"
)

//go:generate tscriptify -package=github.com/ollama/ollama/app/ui/responses -target=./app/codegen/gotypes.gen.ts responses/types.go
//go:generate npm --prefix ./app run build

var CORS = envconfig.Bool("OLLAMA_CORS")

// ragWorkerSem limits concurrent RAG processRAGDocument goroutines to avoid OOM
var ragWorkerSem = make(chan struct{}, 3)

const (
	maxRAGFilenameLen    = 255
	ragUploadMaxSizeCPU  = 2 << 20  // 2 MB
	ragUploadMaxSizeGPU  = 50 << 20 // 50 MB
	ragMultipartFormMax  = 50 << 20 // 50 MB (buffer to disk)
)

// sanitizeRAGFilename strips path components and keeps only safe characters
func sanitizeRAGFilename(name string) string {
	base := filepath.Base(name)
	if base == "" || base == "." {
		return "document"
	}
	var b strings.Builder
	for _, r := range base {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '.' || r == '-' || r == '_' || r == ' ' {
			b.WriteRune(r)
		}
	}
	s := b.String()
	if s == "" {
		return "document"
	}
	if len(s) > maxRAGFilenameLen {
		s = s[:maxRAGFilenameLen]
	}
	return strings.TrimSpace(s)
}

// OllamaDotCom returns the URL for ollama.com, allowing override via environment variable
var OllamaDotCom = func() string {
	if url := os.Getenv("OLLAMA_DOT_COM_URL"); url != "" {
		return url
	}
	return "https://ollama.com"
}()

type statusRecorder struct {
	http.ResponseWriter
	code int
}

func (r *statusRecorder) Written() bool {
	return r.code != 0
}

func (r *statusRecorder) WriteHeader(code int) {
	r.code = code
	r.ResponseWriter.WriteHeader(code)
}

func (r *statusRecorder) Status() int {
	if r.code == 0 {
		return http.StatusOK
	}
	return r.code
}

func (r *statusRecorder) Flush() {
	if flusher, ok := r.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}

// Event is a string that represents the type of event being sent to the client.
type Event string

const (
	EventChat       Event = "chat"
	EventComplete   Event = "complete"
	EventLoading    Event = "loading"
	EventToolResult Event = "tool_result"
	EventThinking   Event = "thinking"
	EventToolCall   Event = "tool_call"
	EventDownload   Event = "download"
)

type Server struct {
	Logger       *slog.Logger
	Restart      func()
	Token        string
	Store        *store.Store
	ToolRegistry *tools.Registry
	Tools        bool
	WebSearch    bool
	Agent        bool
	WorkingDir   string

	Dev bool

	// Updater for checking and downloading updates (upstream v0.31.2)
	Updater             *updater.Updater
	UpdateAvailableFunc func()

	// Dromadaire: PortableMode indicates the app runs from a portable USB directory
	PortableMode bool

	// Dromadaire: OllamaServer reference for restart signaling
	OllamaServer *server.Server

	// Dromadaire: Agent loop pending bash tool approvals keyed by chat ID
	pendingApprovals   map[string]*tools.Bash
	pendingApprovalsMu sync.Mutex

	// Dromadaire: LOT 42 — server start time for uptime metric
	startedAt time.Time
}

func (s *Server) log() *slog.Logger {
	if s.Logger == nil {
		return slog.Default()
	}
	return s.Logger
}

// ollamaProxy creates a reverse proxy handler to the Ollama server
func (s *Server) ollamaProxy() http.Handler {
	var (
		proxy   http.Handler
		proxyMu sync.Mutex
	)

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		proxyMu.Lock()
		p := proxy
		proxyMu.Unlock()

		if p != nil {
			p.ServeHTTP(w, r)
			return
		}

		var err error
		for i := range 2 {
			if i > 0 {
				s.log().Warn("dromadaire server not ready, retrying", "attempt", i+1)
				time.Sleep(1 * time.Second)
			}
			err = WaitForServer(r.Context(), 10*time.Second)
			if err == nil {
				break
			}
		}
		if err != nil {
			s.log().Error("dromadaire server not ready after retries", "error", err)
			http.Error(w, "Dromadaire server is not ready", http.StatusServiceUnavailable)
			return
		}

		proxyMu.Lock()
		if proxy == nil {
			target := envconfig.ConnectableHost()
			s.log().Info("configuring ollama proxy", "target", target.String())

			newProxy := httputil.NewSingleHostReverseProxy(target)

			originalDirector := newProxy.Director
			newProxy.Director = func(req *http.Request) {
				originalDirector(req)
				req.Host = target.Host
				s.log().Debug("proxying request", "method", req.Method, "path", req.URL.Path, "target", target.Host)
			}

			newProxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
				s.log().Error("proxy error", "error", err, "path", r.URL.Path, "target", target.String())
				http.Error(w, "proxy error: "+err.Error(), http.StatusBadGateway)
			}

			proxy = newProxy
		}
		p = proxy
		proxyMu.Unlock()

		p.ServeHTTP(w, r)
	})
}

type errHandlerFunc func(http.ResponseWriter, *http.Request) error

func (s *Server) Handler() http.Handler {
	// Dromadaire LOT 42: record server start time for uptime metric
	s.startedAt = time.Now()

	// Dromadaire LOT 9C: auto-delete old conversations at startup
	go func() {
		if s.Store == nil {
			return
		}
		settings, err := s.Store.Settings()
		if err != nil {
			s.log().Error("auto-delete: failed to read settings", "error", err)
			return
		}
		if settings.AutoDeleteDays > 0 {
			deleted, err := s.Store.DeleteChatsOlderThan(settings.AutoDeleteDays)
			if err != nil {
				s.log().Error("auto-delete: failed to delete old chats", "error", err)
			} else if deleted > 0 {
				s.log().Info("auto-delete: cleaned up old conversations", "deleted", deleted, "olderThanDays", settings.AutoDeleteDays)
			}
		}
	}()

	handle := func(f errHandlerFunc) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if CORS() {
				w.Header().Set("Access-Control-Allow-Origin", "*")
				w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
				w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With")

				if r.Method == "OPTIONS" {
					w.WriteHeader(http.StatusOK)
					return
				}
			}

			if !s.Dev {
				cookie, err := r.Cookie("token")
				if err != nil {
					w.WriteHeader(http.StatusForbidden)
					json.NewEncoder(w).Encode(map[string]string{"error": "Token is required"})
					return
				}

				if cookie.Value != s.Token {
					w.WriteHeader(http.StatusForbidden)
					json.NewEncoder(w).Encode(map[string]string{"error": "Token is required"})
					return
				}
			}

			sw := &statusRecorder{ResponseWriter: w}

			log := s.log()
			level := slog.LevelInfo
			start := time.Now()
			requestID := fmt.Sprintf("%d", time.Now().UnixNano())

			defer func() {
				p := recover()
				if p != nil {
					log = log.With("panic", p, "request_id", requestID)
					level = slog.LevelError

					if !sw.Written() {
						s.handleError(sw, fmt.Errorf("internal server error"))
					}
				}

				log.Log(r.Context(), level, "site.serveHTTP",
					"http.method", r.Method,
					"http.path", r.URL.Path,
					"http.pattern", r.Pattern,
					"http.status", sw.Status(),
					"http.d", time.Since(start),
					"request_id", requestID,
					"version", version.Version,
				)

				if p != nil {
					panic(p)
				}
			}()

			w.Header().Set("X-Frame-Options", "DENY")
			w.Header().Set("X-Content-Type-Options", "nosniff")
			w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' http://127.0.0.1:* https://127.0.0.1:* http://localhost:* https://localhost:*; frame-ancestors 'none'; base-uri 'self'")
			w.Header().Set("X-Version", version.Version)
			w.Header().Set("X-Request-ID", requestID)

			ctx := r.Context()
			if err := f(sw, r); err != nil {
				if ctx.Err() != nil {
					return
				}
				level = slog.LevelError
				log = log.With("error", err)
				s.handleError(sw, err)
			}
		})
	}

	mux := http.NewServeMux()

	mux.Handle("OPTIONS /", handle(func(w http.ResponseWriter, r *http.Request) error {
		return nil
	}))

	// ---- Core chat routes ----
	mux.Handle("GET /api/v1/chats", handle(s.listChats))
	mux.Handle("GET /api/v1/chat/{id}", handle(s.getChat))
	mux.Handle("POST /api/v1/chat/{id}", handle(s.chat))
	mux.Handle("DELETE /api/v1/chat/{id}", handle(s.deleteChat))
	mux.Handle("POST /api/v1/create-chat", handle(s.createChat))
	mux.Handle("PUT /api/v1/chat/{id}/rename", handle(s.renameChat))

	// Dromadaire: chat branching (LOT 43)
	mux.Handle("POST /api/v1/chat/{id}/branch", handle(s.branchChat))

	// Dromadaire: pin/folder/truncate
	mux.Handle("PUT /api/v1/chat/{id}/pin", handle(s.pinChat))
	mux.Handle("PUT /api/v1/chat/{id}/folder", handle(s.setChatFolder))
	mux.Handle("DELETE /api/v1/chat/{id}/messages", handle(s.truncateMessages))

	// Dromadaire: conversation search
	mux.Handle("GET /api/v1/search", handle(s.searchChats))

	// ---- Settings & compute ----
	mux.Handle("GET /api/v1/inference-compute", handle(s.getInferenceCompute))
	mux.Handle("POST /api/v1/model/upstream", handle(s.modelUpstream))
	mux.Handle("GET /api/v1/settings", handle(s.getSettings))
	mux.Handle("POST /api/v1/settings", handle(s.settings))
	mux.Handle("GET /api/v1/cloud", handle(s.getCloudSetting))
	mux.Handle("POST /api/v1/cloud", handle(s.cloudSetting))
	mux.Handle("GET /api/v1/encryption-key", handle(s.getEncryptionKey))

	// Dromadaire: advanced performance endpoints
	mux.Handle("GET /api/v1/hardware-info", handle(s.getHardwareInfo))
	mux.Handle("GET /api/v1/system-resources", handle(s.getSystemResources))
	mux.Handle("POST /api/v1/autoconfig", handle(s.autoconfig))
	mux.Handle("POST /api/v1/restart-server", handle(s.restartServer))

	// Dromadaire: writing style analysis
	mux.Handle("POST /api/v1/analyze-style", handle(s.analyzeStyle))

	// Dromadaire: system diagnostics
	mux.Handle("GET /api/v1/diagnostics", handle(s.getDiagnostics))

	// Dromadaire: LOT 42 — runtime monitoring metrics
	mux.Handle("GET /api/v1/system/metrics", handle(s.getSystemMetrics))

	// Dromadaire: performance benchmark
	mux.Handle("POST /api/v1/benchmark", handle(s.benchmark))

	// Dromadaire: agent loop — tool approval
	mux.Handle("POST /api/v1/chat/{id}/tool-approve", handle(s.toolApprove))

	// Dromadaire: RAG endpoints
	mux.Handle("GET /api/v1/rag/documents", handle(s.ragListDocuments))
	mux.Handle("POST /api/v1/rag/documents", handle(s.ragUploadDocument))
	mux.Handle("DELETE /api/v1/rag/documents/{id}", handle(s.ragDeleteDocument))
	mux.Handle("POST /api/v1/rag/search", handle(s.ragSearch))
	mux.Handle("GET /api/v1/rag/documents/{id}/chunks", handle(s.ragDocumentChunks))

	// Dromadaire: test/automation endpoint (dev mode only)
	if s.Dev {
		mux.Handle("GET /api/v1/test/state", handle(s.testState))
	}

	// Dromadaire: password protection endpoints
	mux.Handle("GET /api/v1/auth/status", handle(s.authStatus))
	mux.Handle("POST /api/v1/auth/set-password", handle(s.setPassword))
	mux.Handle("POST /api/v1/auth/verify-password", handle(s.verifyPassword))
	mux.Handle("POST /api/v1/auth/remove-password", handle(s.removePassword))

	// ---- Ollama proxy endpoints ----
	ollamaProxy := s.ollamaProxy()
	mux.Handle("GET /api/tags", ollamaProxy)
	mux.Handle("GET /api/ps", ollamaProxy)
	mux.Handle("POST /api/show", ollamaProxy)
	mux.Handle("POST /api/generate", ollamaProxy)
	mux.Handle("DELETE /api/delete", ollamaProxy)
	mux.Handle("POST /api/pull", ollamaProxy)
	mux.Handle("GET /api/version", ollamaProxy)
	mux.Handle("GET /api/status", ollamaProxy)
	mux.Handle("HEAD /api/version", ollamaProxy)
	mux.Handle("POST /api/me", ollamaProxy)
	mux.Handle("POST /api/signout", ollamaProxy)
	mux.Handle("GET /api/experimental/model-recommendations", ollamaProxy)

	// React app - catch all non-API routes
	mux.Handle("GET /", s.appHandler())
	mux.Handle("PUT /", s.appHandler())
	mux.Handle("POST /", s.appHandler())
	mux.Handle("PATCH /", s.appHandler())
	mux.Handle("DELETE /", s.appHandler())

	return mux
}

func (s *Server) handleError(w http.ResponseWriter, e error) {
	if CORS() {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With")
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusInternalServerError)
	json.NewEncoder(w).Encode(map[string]string{"error": e.Error()})
}

// userAgentTransport adds the User-Agent header to all requests
type userAgentTransport struct {
	base http.RoundTripper
}

func (t *userAgentTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	r := req.Clone(req.Context())
	r.Header.Set("User-Agent", userAgent())
	return t.base.RoundTrip(r)
}

func (s *Server) httpClient() *http.Client {
	return userAgentHTTPClient(10 * time.Second)
}

func (s *Server) inferenceClient() *api.Client {
	return api.NewClient(envconfig.Host(), userAgentHTTPClient(0))
}

func userAgentHTTPClient(timeout time.Duration) *http.Client {
	return &http.Client{
		Timeout: timeout,
		Transport: &userAgentTransport{
			base: http.DefaultTransport,
		},
	}
}

// doSelfSigned sends a self-signed request to the ollama.com API
func (s *Server) doSelfSigned(ctx context.Context, method, path string) (*http.Response, error) {
	timestamp := strconv.FormatInt(time.Now().Unix(), 10)
	signString := fmt.Sprintf("%s,%s?ts=%s", method, path, timestamp)
	signature, err := ollamaAuth.Sign(ctx, []byte(signString))
	if err != nil {
		return nil, fmt.Errorf("failed to sign request: %w", err)
	}

	endpoint := fmt.Sprintf("%s%s?ts=%s", OllamaDotCom, path, timestamp)
	req, err := http.NewRequestWithContext(ctx, method, endpoint, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", signature))

	return s.httpClient().Do(req)
}

// UserData fetches user data — Dromadaire: cloud API is disabled
func (s *Server) UserData(ctx context.Context) (*api.UserResponse, error) {
	return &api.UserResponse{}, nil
}

// WaitForServer waits for the Dromadaire server to be ready
func WaitForServer(ctx context.Context, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		c, err := api.ClientFromEnvironment()
		if err != nil {
			return err
		}
		if _, err := c.Version(ctx); err == nil {
			slog.Debug("ollama server is ready")
			return nil
		}
		time.Sleep(10 * time.Millisecond)
	}
	return errors.New("timeout waiting for Dromadaire server to be ready")
}

func (s *Server) createChat(w http.ResponseWriter, r *http.Request) error {
	if err := WaitForServer(r.Context(), 10*time.Second); err != nil {
		return err
	}

	id, err := uuid.NewV7()
	if err != nil {
		return fmt.Errorf("failed to generate chat ID: %w", err)
	}

	json.NewEncoder(w).Encode(map[string]string{"id": id.String()})
	return nil
}

func (s *Server) listChats(w http.ResponseWriter, r *http.Request) error {
	chats, _ := s.Store.Chats()

	chatInfos := make([]responses.ChatInfo, len(chats))
	for i, chat := range chats {
		chatInfos[i] = chatInfoFromChat(chat)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(responses.ChatsResponse{ChatInfos: chatInfos})
	return nil
}

// checkModelUpstream makes a HEAD request to the Ollama registry
func (s *Server) checkModelUpstream(ctx context.Context, modelName string, timeout time.Duration) (string, int64, error) {
	checkCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	parts := strings.Split(modelName, ":")
	name := parts[0]
	if name == "" {
		return "", 0, fmt.Errorf("invalid model name: %q", modelName)
	}
	tag := "latest"
	if len(parts) > 1 {
		tag = parts[1]
	}

	if !strings.Contains(name, "/") {
		name = "library/" + name
	}

	url := OllamaDotCom + "/v2/" + name + "/manifests/" + tag
	req, err := http.NewRequestWithContext(checkCtx, "HEAD", url, nil)
	if err != nil {
		return "", 0, err
	}

	httpClient := s.httpClient()
	httpClient.Timeout = timeout

	resp, err := httpClient.Do(req)
	if err != nil {
		return "", 0, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", 0, fmt.Errorf("registry returned status %d", resp.StatusCode)
	}

	digest := resp.Header.Get("ollama-content-digest")
	if digest == "" {
		return "", 0, fmt.Errorf("no digest header found")
	}

	var pushTime int64
	if pushTimeStr := resp.Header.Get("ollama-push-time"); pushTimeStr != "" {
		if pt, err := strconv.ParseInt(pushTimeStr, 10, 64); err == nil {
			pushTime = pt
		}
	}

	return digest, pushTime, nil
}

func isNetworkError(errStr string) bool {
	networkErrorPatterns := []string{
		"connection refused",
		"no such host",
		"timeout",
		"network is unreachable",
		"connection reset",
		"connection timed out",
		"temporary failure",
		"dial tcp",
		"i/o timeout",
		"context deadline exceeded",
		"broken pipe",
	}

	for _, pattern := range networkErrorPatterns {
		if strings.Contains(errStr, pattern) {
			return true
		}
	}
	return false
}

var ErrNetworkOffline = errors.New("network is offline")

func (s *Server) getError(err error) responses.ErrorEvent {
	var sErr api.AuthorizationError
	if errors.As(err, &sErr) && sErr.StatusCode == http.StatusUnauthorized {
		return responses.ErrorEvent{
			EventName: "error",
			Error:     "Could not verify you are signed in. Please sign in and try again.",
			Code:      "cloud_unauthorized",
		}
	}

	errStr := err.Error()

	switch {
	case strings.Contains(errStr, "402"):
		return responses.ErrorEvent{
			EventName: "error",
			Error:     "You've reached your usage limit, please upgrade to continue",
			Code:      "usage_limit_upgrade",
		}
	case strings.HasPrefix(errStr, "pull model manifest") && isNetworkError(errStr):
		return responses.ErrorEvent{
			EventName: "error",
			Error:     "Unable to download model. Please check your internet connection to download the model for offline use.",
			Code:      "offline_download_error",
		}
	case errors.Is(err, ErrNetworkOffline) || strings.Contains(errStr, "operation timed out"):
		return responses.ErrorEvent{
			EventName: "error",
			Error:     "Connection lost",
			Code:      "turbo_connection_lost",
		}
	}
	return responses.ErrorEvent{
		EventName: "error",
		Error:     err.Error(),
	}
}

func userMessageText(messages []store.Message) string {
	var b strings.Builder
	for _, message := range messages {
		if message.Role != "user" {
			continue
		}
		b.WriteString(message.Content)
		b.WriteByte('\n')
	}
	return b.String()
}

func (s *Server) browserState(chat *store.Chat) (*responses.BrowserStateData, bool) {
	if len(chat.BrowserState) > 0 {
		var st responses.BrowserStateData
		if err := json.Unmarshal(chat.BrowserState, &st); err == nil {
			return &st, true
		}
	}
	return nil, false
}

func reconstructBrowserState(messages []store.Message, defaultViewTokens int) *responses.BrowserStateData {
	for i := len(messages) - 1; i >= 0; i-- {
		msg := messages[i]
		if msg.ToolResult == nil {
			continue
		}
		var st responses.BrowserStateData
		if err := json.Unmarshal(*msg.ToolResult, &st); err == nil {
			if len(st.PageStack) > 0 || len(st.URLToPage) > 0 {
				if st.ViewTokens == 0 {
					st.ViewTokens = defaultViewTokens
				}
				return &st
			}
		}
	}
	return nil
}

func (s *Server) chat(w http.ResponseWriter, r *http.Request) error {
	w.Header().Set("Content-Type", "text/jsonl")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Transfer-Encoding", "chunked")

	flusher, ok := w.(http.Flusher)
	if !ok {
		return errors.New("streaming not supported")
	}

	if r.Method != "POST" {
		return not.Found
	}

	cid := r.PathValue("id")
	if cid == "" {
		http.Error(w, "missing chat id", http.StatusBadRequest)
		return nil
	}
	createdChat := false
	incognito := r.URL.Query().Get("incognito") == "true"

	if cid == "new" {
		u, err := uuid.NewV7()
		if err != nil {
			return fmt.Errorf("failed to generate new chat id: %w", err)
		}
		cid = u.String()
		createdChat = true
	}

	var req responses.ChatRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 10<<20)).Decode(&req); err != nil {
		fmt.Fprintf(os.Stderr, "error unmarshalling body: %v\n", err)
		return fmt.Errorf("invalid request body: %w", err)
	}

	if req.Model == "" {
		return fmt.Errorf("empty model")
	}

	if req.Prompt == "" && !req.ForceUpdate {
		return fmt.Errorf("empty message")
	}

	// Dromadaire LOT 9B: incognito mode — skip DB writes
	storeSetChat := func(c store.Chat) error {
		if incognito {
			return nil
		}
		return s.Store.SetChat(c)
	}
	storeAppendMessage := func(chatID string, msg store.Message) error {
		if incognito {
			return nil
		}
		return s.Store.AppendMessage(chatID, msg)
	}
	storeUpdateLastMessage := func(chatID string, msg store.Message) error {
		if incognito {
			return nil
		}
		return s.Store.UpdateLastMessage(chatID, msg)
	}

	// Streaming-optimized DB write — cache message ID to avoid SELECT MAX per token
	var cachedLastMsgID int64
	var lastDBFlush time.Time
	const dbFlushInterval = 150 * time.Millisecond
	storeStreamingUpdate := func(chatID string, msg store.Message) error {
		if incognito {
			return nil
		}
		if cachedLastMsgID == 0 {
			id, err := s.Store.GetLastMessageID(chatID)
			if err != nil {
				slog.Warn("GetLastMessageID failed, using slow path", "chatID", chatID, "err", err)
				return storeUpdateLastMessage(chatID, msg)
			}
			cachedLastMsgID = id
		}
		now := time.Now()
		if now.Sub(lastDBFlush) < dbFlushInterval {
			return nil
		}
		lastDBFlush = now
		return s.Store.UpdateLastMessageContentByID(cachedLastMsgID, msg.Content, msg.Thinking, msg.ThinkingTimeStart, msg.ThinkingTimeEnd)
	}
	storeStreamingFlush := func(chatID string, msg store.Message) error {
		if incognito {
			return nil
		}
		if cachedLastMsgID == 0 {
			return storeUpdateLastMessage(chatID, msg)
		}
		return s.Store.UpdateLastMessageContentByID(cachedLastMsgID, msg.Content, msg.Thinking, msg.ThinkingTimeStart, msg.ThinkingTimeEnd)
	}

	if createdChat {
		json.NewEncoder(w).Encode(responses.ChatEvent{
			EventName: "chat_created",
			ChatID:    &cid,
		})
		flusher.Flush()
	}

	idx := -1
	if req.Index != nil {
		idx = *req.Index
	}

	chat, err := s.Store.ChatWithOptions(cid, true)
	if err != nil {
		if !errors.Is(err, not.Found) {
			return err
		}
		chat = store.NewChat(cid)
	}

	if !req.ForceUpdate {
		var messageOptions *store.MessageOptions
		if len(req.Attachments) > 0 {
			storeAttachments := make([]store.File, 0, len(req.Attachments))

			for _, att := range req.Attachments {
				if att.Data == "" {
					if idx >= 0 && idx < len(chat.Messages) {
						originalMessage := chat.Messages[idx]
						for _, originalFile := range originalMessage.Attachments {
							if originalFile.Filename == att.Filename {
								storeAttachments = append(storeAttachments, originalFile)
								break
							}
						}
					}
				} else {
					data, err := base64.StdEncoding.DecodeString(att.Data)
					if err != nil {
						s.log().Error("failed to decode attachment data", "error", err, "filename", att.Filename)
						continue
					}

					storeAttachments = append(storeAttachments, store.File{
						Filename: att.Filename,
						Data:     data,
					})
				}
			}

			messageOptions = &store.MessageOptions{
				Attachments: storeAttachments,
			}
		}
		userMsg := store.NewMessage("user", req.Prompt, messageOptions)

		if idx >= 0 && idx < len(chat.Messages) {
			chat.Messages = chat.Messages[:idx]
			chat.Messages = append(chat.Messages, userMsg)
		} else {
			chat.Messages = append(chat.Messages, userMsg)
		}

		if err := storeSetChat(*chat); err != nil {
			return err
		}
	}

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	_, cancelLoading := context.WithCancel(ctx)
	loading := false

	c := s.inferenceClient()

	_, err = c.Show(ctx, &api.ShowRequest{Model: req.Model})
	if err != nil || req.ForceUpdate {
		chat.Messages = append(chat.Messages, store.NewMessage("assistant", "", &store.MessageOptions{Model: req.Model}))
		if err := storeSetChat(*chat); err != nil {
			cancelLoading()
			return err
		}

		// Dromadaire LOT 9E: block model download in airplane mode
		airplaneSettings, _ := s.Store.Settings()
		if airplaneSettings.AirplaneMode {
			cancelLoading()
			errorEvent := responses.ErrorEvent{
				EventName: "error",
				Error:     "Mode avion actif",
				Code:      "airplane_blocked",
				Details:   fmt.Sprintf("Le modele %s doit etre telecharge. Desactivez le mode avion pour continuer.", req.Model),
			}
			json.NewEncoder(w).Encode(errorEvent)
			flusher.Flush()
			return nil
		}

		var largestDigest string
		var largestTotal int64

		err = c.Pull(ctx, &api.PullRequest{Model: req.Model}, func(progress api.ProgressResponse) error {
			if progress.Digest != "" && progress.Total > largestTotal {
				largestDigest = progress.Digest
				largestTotal = progress.Total
			}

			if progress.Digest != "" && progress.Digest == largestDigest {
				progressEvent := responses.DownloadEvent{
					EventName: string(EventDownload),
					Total:     progress.Total,
					Completed: progress.Completed,
					Done:      false,
				}

				if err := json.NewEncoder(w).Encode(progressEvent); err != nil {
					return err
				}
				flusher.Flush()
			}
			return nil
		})
		if err != nil {
			s.log().Error("model download error", "error", err, "model", req.Model)
			errorEvent := s.getError(err)
			json.NewEncoder(w).Encode(errorEvent)
			flusher.Flush()
			cancelLoading()
			return fmt.Errorf("failed to download model: %w", err)
		}

		if err := json.NewEncoder(w).Encode(responses.DownloadEvent{
			EventName: string(EventDownload),
			Completed: largestTotal,
			Total:     largestTotal,
			Done:      true,
		}); err != nil {
			cancelLoading()
			return err
		}
		flusher.Flush()

		if req.ForceUpdate {
			json.NewEncoder(w).Encode(responses.ChatEvent{EventName: "done"})
			flusher.Flush()
			cancelLoading()
			return nil
		}
	}

	loading = true
	defer cancelLoading()

	// RAG sources collected during buildChatRequest
	var ragSources []store.RAGSource

	details, err := c.Show(ctx, &api.ShowRequest{Model: req.Model})

	if err != nil || details == nil {
		errorEvent := s.getError(err)
		json.NewEncoder(w).Encode(errorEvent)
		flusher.Flush()
		s.log().Error("failed to show model details", "error", err, "model", req.Model)
		return nil
	}
	think := slices.Contains(details.Capabilities, model.CapabilityThinking)

	var thinkValue any

	if req.Think != nil {
		thinkValue = req.Think
	} else {
		thinkValue = think
	}

	hasAttachments := false
	if len(chat.Messages) > 0 {
		lastMsg := chat.Messages[len(chat.Messages)-1]
		if lastMsg.Role == "user" && len(lastMsg.Attachments) > 0 {
			hasAttachments = true
		}
	}

	registry := tools.NewRegistry()
	var browser *tools.Browser
	var bashTool *tools.Bash
	ctx = tools.WithAllowedDirectURLs(ctx, userMessageText(chat.Messages))

	if !hasAttachments {
		WebSearchEnabled := req.WebSearch != nil && *req.WebSearch
		hasToolsCapability := slices.Contains(details.Capabilities, model.CapabilityTools)

		if WebSearchEnabled && hasToolsCapability {
			if supportsBrowserTools(req.Model) {
				browserState, ok := s.browserState(chat)
				if !ok {
					browserState = reconstructBrowserState(chat.Messages, tools.DefaultViewTokens)
				}
				browser = tools.NewBrowser(browserState)
				registry.Register(tools.NewBrowserSearch(browser))
				registry.Register(tools.NewBrowserOpen(browser))
				registry.Register(tools.NewBrowserFind(browser))
			} else if supportsWebSearchTools(req.Model) {
				registry.Register(&tools.WebSearch{})
				registry.Register(&tools.WebFetch{})
			}
		}

		// Dromadaire: Agent loop — register bash tool
		settings, _ := s.Store.Settings()
		if settings.Agent {
			bashTool = tools.NewBash(s.WorkingDir)
			registry.Register(bashTool)

			s.pendingApprovalsMu.Lock()
			if s.pendingApprovals == nil {
				s.pendingApprovals = make(map[string]*tools.Bash)
			}
			s.pendingApprovals[chat.ID] = bashTool
			s.pendingApprovalsMu.Unlock()
			defer func() {
				s.pendingApprovalsMu.Lock()
				delete(s.pendingApprovals, chat.ID)
				s.pendingApprovalsMu.Unlock()
			}()
		}
	}

	var thinkingTimeStart *time.Time = nil
	var thinkingTimeEnd *time.Time = nil
	var pendingAssistantToolCalls []store.ToolCall
	var finalMetrics api.Metrics

	// Markdown stripper for human mode
	var mdStripper *MarkdownStripper

	passNum := 1

	for {
		var toolsExecuted bool

		availableTools := registry.AvailableTools()

		reqChat := chat
		if len(pendingAssistantToolCalls) > 0 {
			if len(chat.Messages) == 0 || chat.Messages[len(chat.Messages)-1].Role != "assistant" {
				temp := *chat
				synth := store.NewMessage("assistant", "", &store.MessageOptions{Model: req.Model, ToolCalls: pendingAssistantToolCalls})
				insertIdx := len(temp.Messages) - 1
				for insertIdx >= 0 && temp.Messages[insertIdx].Role == "tool" {
					insertIdx--
				}
				if insertIdx < 0 {
					temp.Messages = append([]store.Message{synth}, temp.Messages...)
				} else {
					tmp := make([]store.Message, 0, len(temp.Messages)+1)
					tmp = append(tmp, temp.Messages[:insertIdx+1]...)
					tmp = append(tmp, synth)
					tmp = append(tmp, temp.Messages[insertIdx+1:]...)
					temp.Messages = tmp
				}

				reqChat = &temp
			}
		}
		chatReq, chatRAGSources, err := s.buildChatRequest(reqChat, req.Model, thinkValue, availableTools, &req)
		if err != nil {
			return err
		}
		ragSources = chatRAGSources

		// LOT 41: Context Overflow Policy check
		overflowSettings, _ := s.Store.Settings()
		switch overflowSettings.ContextOverflowPolicy {
		case "stop_and_warn":
			ctxLimit := overflowSettings.ContextLength
			if ctxLimit <= 0 {
				ctxLimit = 4096
			}
			totalTokens := 0
			for _, m := range chatReq.Messages {
				totalTokens += len(m.Content) / 4
				if m.Thinking != "" {
					totalTokens += len(m.Thinking) / 4
				}
			}
			if totalTokens > ctxLimit {
				errorEvent := responses.ErrorEvent{
					EventName: "error",
					Error:     fmt.Sprintf("Contexte depasse : ~%d tokens estimes pour une limite de %d. Reduisez la conversation ou augmentez la taille du contexte.", totalTokens, ctxLimit),
					Code:      "context_overflow",
				}
				json.NewEncoder(w).Encode(errorEvent)
				flusher.Flush()
				return nil
			}
		case "summarize":
			ctxLimit := overflowSettings.ContextLength
			if ctxLimit <= 0 {
				ctxLimit = 4096
			}
			totalTok := 0
			for _, m := range chatReq.Messages {
				totalTok += len(m.Content) / 4
				if m.Thinking != "" {
					totalTok += len(m.Thinking) / 4
				}
			}
			if totalTok > ctxLimit && len(chatReq.Messages) > 4 {
				msgStart := 0
				var systemMsgs []api.Message
				for msgStart < len(chatReq.Messages) && chatReq.Messages[msgStart].Role == "system" {
					systemMsgs = append(systemMsgs, chatReq.Messages[msgStart])
					msgStart++
				}

				keepCount := 4
				if keepCount > len(chatReq.Messages)-msgStart {
					keepCount = len(chatReq.Messages) - msgStart
				}
				recentStart := len(chatReq.Messages) - keepCount
				if recentStart <= msgStart {
					break
				}

				oldMessages := chatReq.Messages[msgStart:recentStart]
				recentMessages := chatReq.Messages[recentStart:]

				var convBuf strings.Builder
				for _, m := range oldMessages {
					if m.Role == "tool" || m.Content == "" {
						continue
					}
					role := m.Role
					if role == "assistant" {
						role = "Assistant"
					} else if role == "user" {
						role = "Utilisateur"
					}
					content := m.Content
					if len(content) > 2000 {
						content = content[:2000] + "..."
					}
					fmt.Fprintf(&convBuf, "%s: %s\n\n", role, content)
				}

				if convBuf.Len() == 0 {
					break
				}

				slog.Info("LOT 41: summarizing old messages", "count", len(oldMessages), "tokensBefore", totalTok)

				json.NewEncoder(w).Encode(responses.ChatEvent{EventName: "loading"})
				flusher.Flush()

				sumCtx, sumCancel := context.WithTimeout(ctx, 30*time.Second)
				noStream := false
				var sumBuf strings.Builder
				sumErr := c.Chat(sumCtx, &api.ChatRequest{
					Model: chatReq.Model,
					Messages: []api.Message{
						{
							Role:    "user",
							Content: "Resume cette conversation en 3-5 phrases. Garde les faits cles, decisions et informations importantes. Reponds uniquement avec le resume.\n\n" + convBuf.String(),
						},
					},
					Stream: &noStream,
					Options: map[string]any{
						"temperature": 0.2,
						"num_predict": 300,
						"num_ctx":     2048,
						"use_mmap":    false,
					},
				}, func(res api.ChatResponse) error {
					sumBuf.WriteString(res.Message.Content)
					return nil
				})
				sumCancel()

				if sumErr != nil {
					slog.Warn("LOT 41: summarize failed, continuing without", "error", sumErr)
					break
				}

				summary := strings.TrimSpace(sumBuf.String())
				if summary == "" {
					slog.Warn("LOT 41: summarize returned empty")
					break
				}

				var newMsgs []api.Message
				newMsgs = append(newMsgs, systemMsgs...)
				newMsgs = append(newMsgs, api.Message{
					Role:    "system",
					Content: "[Resume de la conversation precedente]\n" + summary,
				})
				newMsgs = append(newMsgs, recentMessages...)
				chatReq.Messages = newMsgs

				newTok := 0
				for _, m := range chatReq.Messages {
					newTok += len(m.Content) / 4
				}
				slog.Info("LOT 41: context summarized", "oldMsgs", len(oldMessages), "before", totalTok, "after", newTok)
			}
		}

		// Send loading event before model load (can take seconds on CPU)
		json.NewEncoder(w).Encode(responses.ChatEvent{EventName: "loading"})
		flusher.Flush()

		// Create markdown stripper for human mode
		if chatSettings, settingsErr := s.Store.Settings(); settingsErr == nil && chatSettings.ResponseMode == "human" {
			mdStripper = NewMarkdownStripper()
		}

		finalMetrics = api.Metrics{}
		err = c.Chat(ctx, chatReq, func(res api.ChatResponse) error {
			if loading {
				cancelLoading()
				loading = false
			}

			if res.Done && res.EvalCount > 0 {
				finalMetrics = res.Metrics
			}

			if res.Message.Thinking != "" && (thinkingTimeStart == nil || thinkingTimeEnd != nil) {
				now := time.Now()
				thinkingTimeStart = &now
				thinkingTimeEnd = nil
			}

			if res.Message.Content == "" && res.Message.Thinking == "" && len(res.Message.ToolCalls) == 0 {
				return nil
			}

			event := EventChat
			if thinkingTimeStart != nil && res.Message.Content == "" && len(res.Message.ToolCalls) == 0 {
				event = EventThinking
			}

			if len(res.Message.ToolCalls) > 0 {
				event = EventToolCall
			}

			if event == EventToolCall && thinkingTimeStart != nil && thinkingTimeEnd == nil {
				now := time.Now()
				thinkingTimeEnd = &now
			}

			if event == EventChat && thinkingTimeStart != nil && thinkingTimeEnd == nil && res.Message.Content != "" {
				now := time.Now()
				thinkingTimeEnd = &now
			}

			// Strip markdown from chat content in human mode
			if mdStripper != nil && event == EventChat && res.Message.Content != "" {
				stripped := mdStripper.Process(res.Message.Content)
				if stripped == "" {
					return nil
				}
				res.Message.Content = stripped
			}

			json.NewEncoder(w).Encode(chatEventFromApiChatResponse(res, thinkingTimeStart, thinkingTimeEnd))
			flusher.Flush()

			switch event {
			case EventToolCall:
				if thinkingTimeEnd != nil {
					if len(chat.Messages) > 0 && chat.Messages[len(chat.Messages)-1].Role == "assistant" {
						lastMsg := &chat.Messages[len(chat.Messages)-1]
						lastMsg.ThinkingTimeEnd = thinkingTimeEnd
						lastMsg.UpdatedAt = time.Now()
						storeUpdateLastMessage(chat.ID, *lastMsg)
					}
					thinkingTimeStart = nil
					thinkingTimeEnd = nil
				}

				if len(res.Message.ToolCalls) > 0 {
					if len(chat.Messages) > 0 && chat.Messages[len(chat.Messages)-1].Role == "assistant" {
						toolCalls := make([]store.ToolCall, len(res.Message.ToolCalls))
						for i, tc := range res.Message.ToolCalls {
							argsJSON, marshalErr := json.Marshal(tc.Function.Arguments)
							if marshalErr != nil {
								s.log().Warn("marshal tool args", "error", marshalErr)
								argsJSON = []byte("{}")
							}
							toolCalls[i] = store.ToolCall{
								Type: "function",
								Function: store.ToolFunction{
									Name:      tc.Function.Name,
									Arguments: string(argsJSON),
								},
							}
						}
						lastMsg := &chat.Messages[len(chat.Messages)-1]
						lastMsg.ToolCalls = toolCalls
						if err := storeUpdateLastMessage(chat.ID, *lastMsg); err != nil {
							return err
						}
					} else {
						onlyStandalone := true
						for _, tc := range res.Message.ToolCalls {
							if !(tc.Function.Name == "web_search" || tc.Function.Name == "web_fetch") {
								onlyStandalone = false
								break
							}
						}
						if onlyStandalone {
							toolCalls := make([]store.ToolCall, len(res.Message.ToolCalls))
							for i, tc := range res.Message.ToolCalls {
								argsJSON, marshalErr := json.Marshal(tc.Function.Arguments)
								if marshalErr != nil {
									s.log().Warn("marshal tool args", "error", marshalErr)
									argsJSON = []byte("{}")
								}
								toolCalls[i] = store.ToolCall{
									Type: "function",
									Function: store.ToolFunction{
										Name:      tc.Function.Name,
										Arguments: string(argsJSON),
									},
								}
							}

							synth := store.NewMessage("assistant", "", &store.MessageOptions{Model: req.Model, ToolCalls: toolCalls})
							chat.Messages = append(chat.Messages, synth)
							if err := storeAppendMessage(chat.ID, synth); err != nil {
								return err
							}

							pendingAssistantToolCalls = nil
						}
					}
				}

				for _, toolCall := range res.Message.ToolCalls {
					toolsExecuted = true

					// Agent: For bash tool, relay approval request as SSE
					if toolCall.Function.Name == "bash" && bashTool != nil {
						go func(tcName string) {
							select {
							case cmdStr := <-bashTool.ApprovalCh:
								name := tcName
								json.NewEncoder(w).Encode(responses.ChatEvent{
									EventName: "tool_approval",
									Content:   &cmdStr,
									ToolName:  &name,
								})
								flusher.Flush()
							case <-ctx.Done():
							}
						}(toolCall.Function.Name)
					}

					result, content, err := registry.Execute(ctx, toolCall.Function.Name, toolCall.Function.Arguments.ToMap())
					if err != nil {
						errContent := fmt.Sprintf("Error: %v", err)
						toolErrMsg := store.NewMessage("tool", errContent, nil)
						toolErrMsg.ToolName = toolCall.Function.Name
						chat.Messages = append(chat.Messages, toolErrMsg)
						if err := storeAppendMessage(chat.ID, toolErrMsg); err != nil {
							return err
						}

						toolResult := true
						json.NewEncoder(w).Encode(responses.ChatEvent{
							EventName: "tool",
							Content:   &errContent,
							ToolName:  &toolCall.Function.Name,
						})
						flusher.Flush()

						json.NewEncoder(w).Encode(responses.ChatEvent{
							EventName:      "tool_result",
							Content:        &errContent,
							ToolName:       &toolCall.Function.Name,
							ToolResult:     &toolResult,
							ToolResultData: nil,
						})
						flusher.Flush()
						continue
					}

					var tr json.RawMessage
					if strings.HasPrefix(toolCall.Function.Name, "browser.search") {
						// standalone web_search — no browser state update needed
					} else if strings.HasPrefix(toolCall.Function.Name, "browser") {
						stateBytes, err := json.Marshal(browser.State())
						if err != nil {
							return fmt.Errorf("failed to marshal browser state: %w", err)
						}
						if err := s.Store.UpdateChatBrowserState(chat.ID, json.RawMessage(stateBytes)); err != nil {
							return fmt.Errorf("failed to persist browser state to chat: %w", err)
						}
					} else {
						var err error
						tr, err = json.Marshal(result)
						if err != nil {
							return fmt.Errorf("failed to marshal tool result: %w", err)
						}
					}
					modelContent := content
					if toolCall.Function.Name == "web_fetch" && modelContent == "" {
						if str, ok := result.(string); ok {
							modelContent = str
						}
					}
					if modelContent == "" && len(tr) > 0 {
						s.log().Debug("tool message empty, sending json result")
						modelContent = string(tr)
					}
					toolMsg := store.NewMessage("tool", modelContent, &store.MessageOptions{
						ToolResult: &tr,
					})
					toolMsg.ToolName = toolCall.Function.Name
					chat.Messages = append(chat.Messages, toolMsg)

					storeAppendMessage(chat.ID, toolMsg)

					toolResult := true
					json.NewEncoder(w).Encode(responses.ChatEvent{
						EventName: "tool",
						Content:   &content,
						ToolName:  &toolCall.Function.Name,
					})
					flusher.Flush()

					var toolState any = nil
					if browser != nil {
						toolState = browser.State()
					}

					json.NewEncoder(w).Encode(responses.ChatEvent{
						EventName:      "tool_result",
						Content:        &content,
						ToolName:       &toolCall.Function.Name,
						ToolResult:     &toolResult,
						ToolResultData: result,
						ToolState:      toolState,
					})
					flusher.Flush()
				}

			case EventChat:
				if len(chat.Messages) == 0 || chat.Messages[len(chat.Messages)-1].Role != "assistant" {
					newMsg := store.NewMessage("assistant", "", &store.MessageOptions{Model: req.Model})
					chat.Messages = append(chat.Messages, newMsg)
					if err := storeAppendMessage(chat.ID, newMsg); err != nil {
						return err
					}
					cachedLastMsgID = 0
					if len(pendingAssistantToolCalls) > 0 {
						lastMsg := &chat.Messages[len(chat.Messages)-1]
						lastMsg.ToolCalls = pendingAssistantToolCalls

						pendingAssistantToolCalls = nil
						if err := storeUpdateLastMessage(chat.ID, *lastMsg); err != nil {
							return err
						}
					}
				}

				lastMsg := &chat.Messages[len(chat.Messages)-1]
				lastMsg.Content += res.Message.Content
				lastMsg.UpdatedAt = time.Now()
				if thinkingTimeStart != nil {
					lastMsg.ThinkingTimeStart = thinkingTimeStart
				}
				if thinkingTimeEnd != nil {
					lastMsg.ThinkingTimeEnd = thinkingTimeEnd
				}
				if err := storeStreamingUpdate(chat.ID, *lastMsg); err != nil {
					return err
				}
			case EventThinking:
				if len(chat.Messages) == 0 || chat.Messages[len(chat.Messages)-1].Role != "assistant" {
					newMsg := store.NewMessage("assistant", "", &store.MessageOptions{
						Model:    req.Model,
						Thinking: res.Message.Thinking,
					})
					chat.Messages = append(chat.Messages, newMsg)
					if err := storeAppendMessage(chat.ID, newMsg); err != nil {
						return err
					}
					cachedLastMsgID = 0
					if len(pendingAssistantToolCalls) > 0 {
						lastMsg := &chat.Messages[len(chat.Messages)-1]
						lastMsg.ToolCalls = pendingAssistantToolCalls

						pendingAssistantToolCalls = nil
						if err := storeUpdateLastMessage(chat.ID, *lastMsg); err != nil {
							return err
						}
					}
				} else {
					lastMsg := &chat.Messages[len(chat.Messages)-1]
					lastMsg.Thinking += res.Message.Thinking
					lastMsg.UpdatedAt = time.Now()
					if thinkingTimeStart != nil {
						lastMsg.ThinkingTimeStart = thinkingTimeStart
					}
					if thinkingTimeEnd != nil {
						lastMsg.ThinkingTimeEnd = thinkingTimeEnd
					}

					if err := storeStreamingUpdate(chat.ID, *lastMsg); err != nil {
						return err
					}
				}
			}
			return nil
		})
		if err != nil {
			s.log().Error("chat stream error", "error", err)
			errorEvent := s.getError(err)
			json.NewEncoder(w).Encode(errorEvent)
			flusher.Flush()
			return nil
		}

		if !toolsExecuted {
			break
		}

		passNum++
	}

	// Flush markdown stripper buffer
	if mdStripper != nil {
		if flushed := mdStripper.Flush(); flushed != "" {
			if len(chat.Messages) > 0 && chat.Messages[len(chat.Messages)-1].Role == "assistant" {
				lastMsg := &chat.Messages[len(chat.Messages)-1]
				lastMsg.Content += flushed
				flushedContent := flushed
				json.NewEncoder(w).Encode(responses.ChatEvent{
					EventName: "chat",
					Content:   &flushedContent,
				})
				flusher.Flush()
			}
		}
	}

	// Final flush — write any buffered streaming content to DB
	if len(chat.Messages) > 0 && chat.Messages[len(chat.Messages)-1].Role == "assistant" {
		lastMsg := &chat.Messages[len(chat.Messages)-1]
		storeStreamingFlush(chat.ID, *lastMsg)
	}
	cachedLastMsgID = 0

	if thinkingTimeStart != nil && thinkingTimeEnd == nil {
		now := time.Now()
		thinkingTimeEnd = &now
		if len(chat.Messages) > 0 && chat.Messages[len(chat.Messages)-1].Role == "assistant" {
			lastMsg := &chat.Messages[len(chat.Messages)-1]
			lastMsg.ThinkingTimeEnd = thinkingTimeEnd
			lastMsg.UpdatedAt = time.Now()
			storeUpdateLastMessage(chat.ID, *lastMsg)
		}
	}

	// Send rag_sources event before done
	if len(ragSources) > 0 {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"eventName":  "rag_sources",
			"ragSources": ragSources,
		})
		flusher.Flush()

		if len(chat.Messages) > 0 {
			lastIdx := len(chat.Messages) - 1
			if chat.Messages[lastIdx].Role == "assistant" {
				sourcesJSON, _ := json.Marshal(ragSources)
				s.Store.UpdateMessageRAGSources(chat.ID, lastIdx, string(sourcesJSON))
			}
		}
	}

	doneEvent := responses.ChatEvent{EventName: "done"}
	if finalMetrics.EvalCount > 0 {
		evalCount := finalMetrics.EvalCount
		doneEvent.EvalCount = &evalCount
		evalMs := float64(finalMetrics.EvalDuration) / float64(time.Millisecond)
		doneEvent.EvalDurationMs = &evalMs
		if finalMetrics.PromptEvalCount > 0 {
			promptCount := finalMetrics.PromptEvalCount
			doneEvent.PromptEvalCount = &promptCount
			promptMs := float64(finalMetrics.PromptEvalDuration) / float64(time.Millisecond)
			doneEvent.PromptEvalDurationMs = &promptMs
		}
		if finalMetrics.EvalDuration > 0 {
			tps := float64(finalMetrics.EvalCount) / finalMetrics.EvalDuration.Seconds()
			doneEvent.TokensPerSecond = &tps
		}
	}
	json.NewEncoder(w).Encode(doneEvent)
	flusher.Flush()

	// LOT 39a: Auto-title via LLM after first exchange (2 messages: 1 user + 1 assistant)
	if !incognito && len(chat.Messages) == 2 &&
		chat.Messages[0].Role == "user" && chat.Messages[1].Role == "assistant" &&
		(chat.Title == "" || chat.Title == "Nouvelle Conversation") {
		if titleSettings, err := s.Store.Settings(); err == nil && titleSettings.AutoTitleEnabled {
			chatID := chat.ID
			modelName := req.Model
			userContent := chat.Messages[0].Content
			assistantContent := chat.Messages[1].Content
			go s.generateAutoTitle(chatID, modelName, userContent, assistantContent)
		}
	}

	if len(chat.Messages) > 0 {
		chat.Messages[len(chat.Messages)-1].Stream = false
	}
	return storeSetChat(*chat)
}

// generateAutoTitle calls the LLM to generate a short title for a new conversation.
// It runs in a goroutine and must not panic; errors are logged silently.
func (s *Server) generateAutoTitle(chatID, modelName, userContent, assistantContent string) {
	defer func() {
		if r := recover(); r != nil {
			slog.Error("auto-title panic recovered", "chatID", chatID, "panic", r)
		}
	}()

	// Truncate assistant response to first ~50 words
	assistantSnippet := assistantContent
	words := strings.Fields(assistantContent)
	if len(words) > 50 {
		assistantSnippet = strings.Join(words[:50], " ") + "..."
	}

	prompt := fmt.Sprintf(
		"Donne un titre court (3-6 mots max) pour cette conversation. "+
			"Reponds UNIQUEMENT avec le titre, sans guillemets ni ponctuation finale.\n\n"+
			"Utilisateur: %s\nAssistant: %s",
		userContent, assistantSnippet,
	)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	c := s.inferenceClient()
	noStream := false
	keepAlive := &api.Duration{Duration: 0} // unload after title generation

	var titleResp strings.Builder
	err := c.Chat(ctx, &api.ChatRequest{
		Model: modelName,
		Messages: []api.Message{
			{Role: "user", Content: prompt},
		},
		Stream:    &noStream,
		KeepAlive: keepAlive,
		Options: map[string]any{
			"use_mmap": false,
			"num_ctx":  512,
		},
	}, func(res api.ChatResponse) error {
		titleResp.WriteString(res.Message.Content)
		return nil
	})
	if err != nil {
		slog.Error("auto-title LLM call failed", "chatID", chatID, "error", err)
		return
	}

	title := strings.TrimSpace(titleResp.String())
	// Remove surrounding quotes if the model added them
	title = strings.Trim(title, "\"'`")
	// Remove trailing punctuation
	title = strings.TrimRight(title, ".!?;:")
	title = strings.TrimSpace(title)

	if title == "" {
		slog.Warn("auto-title returned empty title", "chatID", chatID)
		return
	}
	// Cap length
	if len([]rune(title)) > 100 {
		title = string([]rune(title)[:100])
	}

	chat, err := s.Store.ChatWithOptions(chatID, false)
	if err != nil {
		slog.Error("auto-title: failed to load chat", "chatID", chatID, "error", err)
		return
	}
	chat.Title = title
	if err := s.Store.SetChat(*chat); err != nil {
		slog.Error("auto-title: failed to save title", "chatID", chatID, "error", err)
		return
	}

	slog.Info("auto-title set", "chatID", chatID, "title", title)
}

func (s *Server) getChat(w http.ResponseWriter, r *http.Request) error {
	cid := r.PathValue("id")

	if cid == "" {
		return fmt.Errorf("chat ID is required")
	}

	chat, err := s.Store.Chat(cid)
	if err != nil {
		data := responses.ChatResponse{
			Chat: store.Chat{},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(data)
		return nil //nolint:nilerr
	}

	if chat != nil && len(chat.Messages) > 0 {
		for i := range chat.Messages {
			if chat.Messages[i].Role == "tool" && chat.Messages[i].ToolName == "" && chat.Messages[i].ToolResult != nil {
				for j := i - 1; j >= 0; j-- {
					if chat.Messages[j].Role == "assistant" && len(chat.Messages[j].ToolCalls) > 0 {
						last := chat.Messages[j].ToolCalls[len(chat.Messages[j].ToolCalls)-1]
						if last.Function.Name != "" {
							chat.Messages[i].ToolName = last.Function.Name
						}
						break
					}
				}
			}
		}
	}

	browserState, ok := s.browserState(chat)
	if !ok {
		browserState = reconstructBrowserState(chat.Messages, tools.DefaultViewTokens)
	}
	if browserState != nil {
		for _, page := range browserState.URLToPage {
			page.Lines = nil
			page.Text = ""
		}

		if cleanedState, err := json.Marshal(browserState); err == nil {
			chat.BrowserState = json.RawMessage(cleanedState)
		}
	}
	data := responses.ChatResponse{
		Chat: *chat,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(data)
	return nil
}

func (s *Server) renameChat(w http.ResponseWriter, r *http.Request) error {
	cid := r.PathValue("id")
	if cid == "" {
		return fmt.Errorf("chat ID is required")
	}

	var req struct {
		Title string `json:"title"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 10<<20)).Decode(&req); err != nil {
		return fmt.Errorf("invalid request body: %w", err)
	}

	chat, err := s.Store.ChatWithOptions(cid, false)
	if err != nil {
		return fmt.Errorf("chat not found: %w", err)
	}

	title := req.Title
	if len(title) > 512 {
		title = string([]rune(title)[:512])
	}
	chat.Title = title
	if err := s.Store.SetChat(*chat); err != nil {
		return fmt.Errorf("failed to update chat: %w", err)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(chatInfoFromChat(*chat))
	return nil
}

// branchChat creates a new chat by copying messages [0..messageIndex] from an existing chat (LOT 43)
func (s *Server) branchChat(w http.ResponseWriter, r *http.Request) error {
	cid := r.PathValue("id")
	if cid == "" {
		return fmt.Errorf("chat ID is required")
	}

	var req responses.BranchRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&req); err != nil {
		return fmt.Errorf("invalid request body: %w", err)
	}

	// Load source chat with full message data (including attachments)
	sourceChat, err := s.Store.Chat(cid)
	if err != nil {
		return fmt.Errorf("source chat not found: %w", err)
	}

	if req.MessageIndex < 0 || req.MessageIndex >= len(sourceChat.Messages) {
		return fmt.Errorf("messageIndex %d out of range (chat has %d messages)", req.MessageIndex, len(sourceChat.Messages))
	}

	// Generate new chat ID
	newID, err := uuid.NewV7()
	if err != nil {
		return fmt.Errorf("failed to generate chat ID: %w", err)
	}

	// Copy messages from 0 to messageIndex (inclusive)
	branchedMessages := make([]store.Message, req.MessageIndex+1)
	copy(branchedMessages, sourceChat.Messages[:req.MessageIndex+1])

	// Build branch title
	title := sourceChat.Title
	if title == "" {
		title = "Sans titre"
	}
	title = title + " (branche)"

	newChat := store.Chat{
		ID:        newID.String(),
		Messages:  branchedMessages,
		Title:     title,
		CreatedAt: time.Now(),
	}

	if err := s.Store.SetChat(newChat); err != nil {
		return fmt.Errorf("failed to save branched chat: %w", err)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(responses.BranchResponse{ChatID: newID.String()})
	return nil
}

func (s *Server) deleteChat(w http.ResponseWriter, r *http.Request) error {
	cid := r.PathValue("id")
	if cid == "" {
		return fmt.Errorf("chat ID is required")
	}

	_, err := s.Store.ChatWithOptions(cid, false)
	if err != nil {
		if errors.Is(err, not.Found) {
			w.WriteHeader(http.StatusNotFound)
			return fmt.Errorf("chat not found")
		}
		return fmt.Errorf("failed to get chat: %w", err)
	}

	if err := s.Store.DeleteChat(cid); err != nil {
		return fmt.Errorf("failed to delete chat: %w", err)
	}

	w.WriteHeader(http.StatusOK)
	return nil
}

func (s *Server) truncateMessages(w http.ResponseWriter, r *http.Request) error {
	cid := r.PathValue("id")
	if cid == "" {
		return fmt.Errorf("chat ID is required")
	}

	var body struct {
		FromIndex int `json:"fromIndex"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<10)).Decode(&body); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return nil
	}
	if body.FromIndex < 0 {
		http.Error(w, "fromIndex must be >= 0", http.StatusBadRequest)
		return nil
	}

	chat, err := s.Store.ChatWithOptions(cid, true)
	if err != nil {
		if errors.Is(err, not.Found) {
			http.Error(w, "chat not found", http.StatusNotFound)
			return nil
		}
		return fmt.Errorf("failed to get chat: %w", err)
	}

	if body.FromIndex >= len(chat.Messages) {
		http.Error(w, "fromIndex out of range", http.StatusBadRequest)
		return nil
	}

	chat.Messages = chat.Messages[:body.FromIndex]
	if err := s.Store.SetChat(*chat); err != nil {
		return fmt.Errorf("failed to save truncated chat: %w", err)
	}

	w.WriteHeader(http.StatusOK)
	return nil
}

// searchChats handles GET /api/v1/search?q=...
func (s *Server) searchChats(w http.ResponseWriter, r *http.Request) error {
	settings, err := s.Store.Settings()
	if err != nil {
		return fmt.Errorf("failed to load settings: %w", err)
	}
	if !settings.SearchEnabled {
		http.Error(w, `{"error":"search is disabled"}`, http.StatusForbidden)
		return nil
	}

	query := r.URL.Query().Get("q")
	if query == "" {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(responses.SearchResponse{Results: []store.SearchResult{}})
		return nil
	}

	results, err := s.Store.SearchChats(query)
	if err != nil {
		return fmt.Errorf("search chats: %w", err)
	}
	if results == nil {
		results = []store.SearchResult{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(responses.SearchResponse{Results: results})
	return nil
}

func chatEventFromApiChatResponse(res api.ChatResponse, thinkingTimeStart *time.Time, thinkingTimeEnd *time.Time) responses.ChatEvent {
	if len(res.Message.ToolCalls) > 0 {
		storeToolCalls := make([]store.ToolCall, len(res.Message.ToolCalls))
		for i, tc := range res.Message.ToolCalls {
			argsJSON, marshalErr := json.Marshal(tc.Function.Arguments)
			if marshalErr != nil {
				argsJSON = []byte("{}")
			}
			storeToolCalls[i] = store.ToolCall{
				Type: "function",
				Function: store.ToolFunction{
					Name:      tc.Function.Name,
					Arguments: string(argsJSON),
				},
			}
		}

		var content *string
		if res.Message.Content != "" {
			content = &res.Message.Content
		}
		var thinking *string
		if res.Message.Thinking != "" {
			thinking = &res.Message.Thinking
		}

		return responses.ChatEvent{
			EventName:         "assistant_with_tools",
			Content:           content,
			Thinking:          thinking,
			ToolCalls:         storeToolCalls,
			ThinkingTimeStart: thinkingTimeStart,
			ThinkingTimeEnd:   thinkingTimeEnd,
		}
	}

	var content *string
	if res.Message.Content != "" {
		content = &res.Message.Content
	}
	var thinking *string
	if res.Message.Thinking != "" {
		thinking = &res.Message.Thinking
	}

	return responses.ChatEvent{
		EventName:         "chat",
		Content:           content,
		Thinking:          thinking,
		ThinkingTimeStart: thinkingTimeStart,
		ThinkingTimeEnd:   thinkingTimeEnd,
	}
}

func chatInfoFromChat(chat store.Chat) responses.ChatInfo {
	userExcerpt := ""
	var updatedAt time.Time
	tokenEstimate := 0

	for _, msg := range chat.Messages {
		if msg.Role == "user" && userExcerpt == "" {
			userExcerpt = msg.Content
		}
		if msg.UpdatedAt.After(updatedAt) {
			updatedAt = msg.UpdatedAt
		}
		tokenEstimate += (len(msg.Content) + 3) / 4
	}

	return responses.ChatInfo{
		ID:            chat.ID,
		Title:         chat.Title,
		UserExcerpt:   userExcerpt,
		CreatedAt:     chat.CreatedAt,
		UpdatedAt:     updatedAt,
		Pinned:        chat.Pinned,
		Folder:        chat.Folder,
		MessageCount:  len(chat.Messages),
		TokenEstimate: tokenEstimate,
	}
}

// pin/unpin a chat
func (s *Server) pinChat(w http.ResponseWriter, r *http.Request) error {
	cid := r.PathValue("id")
	if cid == "" {
		return fmt.Errorf("chat ID is required")
	}

	var req struct {
		Pinned bool `json:"pinned"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 10<<20)).Decode(&req); err != nil {
		return fmt.Errorf("invalid request body: %w", err)
	}

	if err := s.Store.PinChat(cid, req.Pinned); err != nil {
		return fmt.Errorf("failed to pin chat: %w", err)
	}

	w.WriteHeader(http.StatusOK)
	return nil
}

// set chat folder
func (s *Server) setChatFolder(w http.ResponseWriter, r *http.Request) error {
	cid := r.PathValue("id")
	if cid == "" {
		return fmt.Errorf("chat ID is required")
	}

	var req struct {
		Folder string `json:"folder"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 10<<20)).Decode(&req); err != nil {
		return fmt.Errorf("invalid request body: %w", err)
	}

	folder := req.Folder
	if len(folder) > 512 {
		folder = string([]rune(folder)[:512])
	}
	if err := s.Store.SetChatFolder(cid, folder); err != nil {
		return fmt.Errorf("failed to set chat folder: %w", err)
	}

	w.WriteHeader(http.StatusOK)
	return nil
}

func (s *Server) getSettings(w http.ResponseWriter, r *http.Request) error {
	settings, err := s.Store.Settings()
	if err != nil {
		return fmt.Errorf("failed to load settings: %w", err)
	}

	if settings.Models == "" {
		settings.Models = envconfig.Models()
	}

	if settings.ContextLength == 0 {
		settings.ContextLength = 2048
	}

	settings.Agent = s.Agent
	settings.Tools = s.Tools
	settings.WorkingDir = s.WorkingDir

	settings.PortableMode = s.PortableMode

	w.Header().Set("Content-Type", "application/json")
	return json.NewEncoder(w).Encode(responses.SettingsResponse{
		Settings: settings,
	})
}

func (s *Server) settings(w http.ResponseWriter, r *http.Request) error {
	old, err := s.Store.Settings()
	if err != nil {
		return fmt.Errorf("failed to load settings: %w", err)
	}

	var settings store.Settings
	if err := json.NewDecoder(io.LimitReader(r.Body, 10<<20)).Decode(&settings); err != nil {
		return fmt.Errorf("invalid request body: %w", err)
	}

	// Handle encryption toggle before saving settings
	if old.EncryptionEnabled != settings.EncryptionEnabled {
		if err := s.Store.SetEncryptionEnabled(settings.EncryptionEnabled); err != nil {
			return fmt.Errorf("failed to toggle encryption: %w", err)
		}
	}

	if err := s.Store.SetSettings(settings); err != nil {
		return fmt.Errorf("failed to save settings: %w", err)
	}

	// Handle auto-update toggle changes (upstream v0.31.2)
	if old.AutoUpdateEnabled != settings.AutoUpdateEnabled {
		if !settings.AutoUpdateEnabled {
			if s.Updater != nil {
				s.Updater.CancelOngoingDownload()
			}
		} else {
			if (updater.IsUpdatePending() || updater.UpdateDownloaded) && s.UpdateAvailableFunc != nil {
				s.UpdateAvailableFunc()
			} else if s.Updater != nil {
				s.Updater.TriggerImmediateCheck()
			}
		}
	}

	if old.ContextLength != settings.ContextLength ||
		old.Models != settings.Models ||
		old.Expose != settings.Expose {
		s.Restart()
	}

	w.Header().Set("Content-Type", "application/json")
	return json.NewEncoder(w).Encode(responses.SettingsResponse{
		Settings: settings,
	})
}

// getEncryptionKey returns the encryption key in base64 for backup
func (s *Server) getEncryptionKey(w http.ResponseWriter, r *http.Request) error {
	settings, err := s.Store.Settings()
	if err != nil {
		return fmt.Errorf("failed to load settings: %w", err)
	}

	if !settings.EncryptionEnabled {
		http.Error(w, "encryption not enabled", http.StatusNotFound)
		return nil
	}

	key, err := store.LoadKey(s.Store.KeyPath())
	if err != nil {
		return fmt.Errorf("failed to load encryption key: %w", err)
	}

	w.Header().Set("Content-Type", "application/json")
	return json.NewEncoder(w).Encode(map[string]string{
		"key":  base64.StdEncoding.EncodeToString(key),
		"path": s.Store.KeyPath(),
	})
}

func (s *Server) cloudSetting(w http.ResponseWriter, r *http.Request) error {
	var req struct {
		Enabled bool `json:"enabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		return fmt.Errorf("invalid request body: %w", err)
	}

	if err := s.Store.SetCloudEnabled(req.Enabled); err != nil {
		return fmt.Errorf("failed to persist cloud setting: %w", err)
	}

	s.Restart()

	return s.writeCloudStatus(w)
}

func (s *Server) getCloudSetting(w http.ResponseWriter, r *http.Request) error {
	return s.writeCloudStatus(w)
}

func (s *Server) writeCloudStatus(w http.ResponseWriter) error {
	disabled, source, err := s.Store.CloudStatus()
	if err != nil {
		return fmt.Errorf("failed to load cloud status: %w", err)
	}

	w.Header().Set("Content-Type", "application/json")
	return json.NewEncoder(w).Encode(map[string]any{
		"disabled": disabled,
		"source":   source,
	})
}

func (s *Server) getInferenceCompute(w http.ResponseWriter, r *http.Request) error {
	ctx, cancel := context.WithTimeout(r.Context(), 500*time.Millisecond)
	defer cancel()
	info, err := server.GetInferenceInfo(ctx)
	if err != nil {
		s.log().Error("failed to get inference info", "error", err)
		return fmt.Errorf("failed to get inference info: %w", err)
	}

	inferenceComputes := make([]responses.InferenceCompute, len(info.Computes))
	for i, ic := range info.Computes {
		inferenceComputes[i] = responses.InferenceCompute{
			Library: ic.Library,
			Variant: ic.Variant,
			Compute: ic.Compute,
			Driver:  ic.Driver,
			Name:    ic.Name,
			VRAM:    ic.VRAM,
		}
	}

	response := responses.InferenceComputeResponse{
		InferenceComputes:    inferenceComputes,
		DefaultContextLength: info.DefaultContextLength,
	}

	w.Header().Set("Content-Type", "application/json")
	return json.NewEncoder(w).Encode(response)
}

func (s *Server) modelUpstream(w http.ResponseWriter, r *http.Request) error {
	if r.Method != "POST" {
		return fmt.Errorf("method not allowed")
	}

	var req struct {
		Model string `json:"model"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 10<<20)).Decode(&req); err != nil {
		return fmt.Errorf("invalid request body: %w", err)
	}

	if req.Model == "" {
		return fmt.Errorf("model is required")
	}

	digest, pushTime, err := s.checkModelUpstream(r.Context(), req.Model, 5*time.Second)
	if err != nil {
		s.log().Warn("failed to check upstream digest", "error", err, "model", req.Model)
		response := responses.ModelUpstreamResponse{
			Error: err.Error(),
		}
		w.Header().Set("Content-Type", "application/json")
		return json.NewEncoder(w).Encode(response)
	}

	n := model.ParseName(req.Model)
	stale := true
	if m, err := manifest.ParseNamedManifest(n); err == nil {
		if m.Digest() == digest {
			stale = false
		} else if pushTime > 0 && m.FileInfo().ModTime().Unix() >= pushTime {
			stale = false
		}
	}

	response := responses.ModelUpstreamResponse{
		Stale: stale,
	}

	w.Header().Set("Content-Type", "application/json")
	return json.NewEncoder(w).Encode(response)
}

func userAgent() string {
	buildinfo, _ := debug.ReadBuildInfo()

	version := buildinfo.Main.Version
	if version == "(devel)" {
		version = "v0.0.0"
	}

	return fmt.Sprintf("dromadaire/%s (%s %s) app/%s Go/%s",
		version,
		runtime.GOARCH,
		runtime.GOOS,
		version,
		runtime.Version(),
	)
}

func convertToOllamaTool(toolSchema map[string]any) api.Tool {
	tool := api.Tool{
		Type: "function",
		Function: api.ToolFunction{
			Name:        getStringFromMap(toolSchema, "name", ""),
			Description: getStringFromMap(toolSchema, "description", ""),
		},
	}

	tool.Function.Parameters.Type = "object"
	tool.Function.Parameters.Required = []string{}
	tool.Function.Parameters.Properties = api.NewToolPropertiesMap()

	if schemaProps, ok := toolSchema["schema"].(map[string]any); ok {
		tool.Function.Parameters.Type = getStringFromMap(schemaProps, "type", "object")

		if props, ok := schemaProps["properties"].(map[string]any); ok {
			tool.Function.Parameters.Properties = api.NewToolPropertiesMap()

			for propName, propDef := range props {
				if propMap, ok := propDef.(map[string]any); ok {
					prop := api.ToolProperty{
						Type:        api.PropertyType{getStringFromMap(propMap, "type", "string")},
						Description: getStringFromMap(propMap, "description", ""),
					}
					tool.Function.Parameters.Properties.Set(propName, prop)
				}
			}
		}

		if required, ok := schemaProps["required"].([]string); ok {
			tool.Function.Parameters.Required = required
		} else if requiredAny, ok := schemaProps["required"].([]any); ok {
			required := make([]string, len(requiredAny))
			for i, r := range requiredAny {
				if s, ok := r.(string); ok {
					required[i] = s
				}
			}
			tool.Function.Parameters.Required = required
		}
	}

	return tool
}

func getStringFromMap(m map[string]any, key, defaultValue string) string {
	if val, ok := m[key].(string); ok {
		return val
	}
	return defaultValue
}

func isImageAttachment(filename string) bool {
	ext := strings.ToLower(filename)
	return strings.HasSuffix(ext, ".png") || strings.HasSuffix(ext, ".jpg") || strings.HasSuffix(ext, ".jpeg") || strings.HasSuffix(ext, ".webp")
}

func ptr[T any](v T) *T { return &v }

func supportsBrowserTools(model string) bool {
	return strings.HasPrefix(strings.ToLower(model), "gpt-oss")
}

func supportsWebSearchTools(model string) bool {
	model = strings.ToLower(model)
	prefixes := []string{"qwen3", "deepseek-v3"}
	for _, p := range prefixes {
		if strings.HasPrefix(model, p) {
			return true
		}
	}
	return false
}

// buildChatRequest converts store.Chat to api.ChatRequest
func (s *Server) buildChatRequest(chat *store.Chat, modelName string, think any, availableTools []map[string]any, frontendReq *responses.ChatRequest) (*api.ChatRequest, []store.RAGSource, error) {
	var msgs []api.Message

	// Custom system prompt (empty = default)
	settings, _ := s.Store.Settings()
	systemPrompt := settings.SystemPrompt
	if systemPrompt == "" {
		systemPrompt = "LANGUE: Tu DOIS répondre en français. Toutes tes réponses sont en français. Si l'utilisateur écrit en français, réponds en français. Si l'utilisateur écrit en anglais, réponds quand même en français sauf s'il demande explicitement une autre langue. You MUST answer in French.\n\nTu es un assistant intelligent et utile."
	}

	// Response mode instruction prefix
	modeInstructions := map[string]string{
		"concise":   "Réponds de manière concise: phrases courtes, listes à puces, pas de bavardage.",
		"detailed":  "Donne une réponse détaillée et structurée avec exemples et explications.",
		"code":      "Réponds uniquement avec du code commenté. Minimise les explications textuelles.",
		"pedagogic": "Explique comme à un débutant, étape par étape, avec des analogies simples.",
		"human": `REGLE ABSOLUE N°1: JAMAIS de markdown. ZERO astérisques (*), ZERO dièses (#), ZERO tirets de liste (-). Si tu mets un seul ** ou ## dans ta réponse, tu as ÉCHOUÉ.

MISSION: Ton texte doit être IMPOSSIBLE à distinguer d'un texte écrit par un humain. Les détecteurs IA analysent la "perplexité" et la "burstiness" (variation de longueur des phrases). Tu dois avoir une HAUTE perplexité et une HAUTE burstiness.

=== FORMATAGE: ZERO MARKDOWN ===
Écris en texte brut uniquement. INTERDIT: ** (gras), * (italique), ## (titres), - (listes), 1. (listes numérotées), | (tableaux). Un humain qui tape un mail ou un message n'utilise pas de markdown.

=== STRUCTURE ANTI-IA ===
1. BURSTINESS ÉLEVÉE: Alterne des phrases très courtes (3-6 mots) avec des phrases moyennes (10-18 mots). Très rarement une phrase longue (20+ mots).
2. Pas de structure symétrique entre paragraphes.
3. Ne commence JAMAIS par une reformulation de la question. Entre directement dans le vif.
4. Pas de conclusion, pas de résumé, pas de "en espérant que cela vous aide".
5. Pas d'introduction type "C'est une excellente question" ou "Bien sûr, je vais..."

=== NATURALITÉ CONVERSATIONNELLE ===
1. Ton: comme si tu écrivais un message à un collègue que tu connais bien.
2. Contractions naturelles quand le ton est détendu: "c'est", "y'a", "j'pense"
3. Opinions personnelles directes: "je trouve que" plutôt que "il semblerait que"
4. Ne sois pas exhaustif. Un humain oublie des choses, fait des raccourcis.`,
		"ui-ux": `Tu es un designer UI/UX d'élite. Tu crées des interfaces EXCEPTIONNELLEMENT belles et modernes — dark-first, élégantes, niveau Stripe/Linear/Vercel.

=== STACK TECHNIQUE (LOCAL — JAMAIS de CDN) ===
TOUJOURS inclure dans <head> :
<link href="/libs/fonts.css" rel="stylesheet">

TOUJOURS inclure ces scripts AVANT </body> :
<script src="/libs/lucide.min.js"></script>
<script src="/libs/gsap.min.js"></script>
<script src="/libs/ScrollTrigger.min.js"></script>
<script src="/libs/typed.umd.js"></script>
<script src="/libs/vanilla-tilt.min.js"></script>

IMPORTANT: Utilise UNIQUEMENT des chemins locaux /libs/... — JAMAIS de CDN.
PAS de Tailwind — CSS vanilla avec custom properties pour un contrôle total.`,
		"image": `Tu es un artiste visuel numérique. Tu DOIS générer une IMAGE sous forme de code SVG ou HTML.

=== RÈGLE ABSOLUE ===
Ta réponse DOIT contenir un bloc de code SVG (` + "`" + "`" + "`" + `svg) ou HTML (` + "`" + "`" + "`" + `html). C'est OBLIGATOIRE. L'image sera affichée dans un panneau de prévisualisation.

=== FORMAT PRÉFÉRÉ: SVG ===
Privilégie SVG car c'est vectoriel, léger et beau à toute taille. Utilise:
- Des formes géométriques (rect, circle, ellipse, polygon, path)
- Des dégradés (linearGradient, radialGradient) pour la profondeur
- Des filtres SVG (feGaussianBlur, feDropShadow) pour les effets
- Des animations SMIL (<animate>, <animateTransform>) quand approprié
- Une viewBox adaptée (ex: "0 0 800 600")
- Des couleurs riches et harmonieuses

=== FORMAT ALTERNATIF: HTML CANVAS ===
Pour les scènes complexes (particules, textures, 3D isométrique), utilise HTML avec <canvas> et JavaScript.

=== STYLE ===
- Crée des images BELLES et DÉTAILLÉES, pas des formes basiques
- Ajoute des ombres, de la lumière, de la profondeur
- Utilise des palettes de couleurs professionnelles
- Pour les paysages: ciel dégradé, reflets, atmosphère
- Pour les personnages: formes stylisées, proportions harmonieuses
- Pour les icônes/logos: géométrie précise, espacement cohérent

=== TEXTE D'ACCOMPAGNEMENT ===
Avant le bloc de code, écris UNE phrase décrivant brièvement ce que tu as créé. Pas plus.`,
	}
	if instruction, ok := modeInstructions[settings.ResponseMode]; ok {
		// Human sub-mode and personal style rules
		if settings.ResponseMode == "human" {
			humanSubModeInstructions := map[string]string{
				"email":    "\n\n=== SOUS-MODE EMAIL ===\nCommence directement par le sujet. Salutation courte. Corps: 3-5 lignes max.",
				"sms":      "\n\n=== SOUS-MODE SMS ===\nUltra court: 1-3 phrases. Abréviations OK.",
				"forum":    "\n\n=== SOUS-MODE FORUM ===\nTutoiement. Paragraphes courts.",
				"academic": "\n\n=== SOUS-MODE ACADEMIQUE ===\nVouvoiement. Phrases longues et complexes.",
			}
			if sub, ok := humanSubModeInstructions[settings.HumanSubMode]; ok {
				instruction += sub
			}
			if settings.WritingStyleRules != "" {
				instruction += "\n\n=== STYLE PERSONNEL DE L'UTILISATEUR ===\nApplique ces regles d'ecriture:\n" + settings.WritingStyleRules
			}
		}
		// UI/UX sub-modes
		if settings.ResponseMode == "ui-ux" {
			uiUxSubModeInstructions := map[string]string{
				"landing":   "\n\n=== SOUS-MODE LANDING PAGE ===\nStructure: NAV fixed glass, HERO min-height 100vh, FEATURES grid 3 cols, TESTIMONIALS, PRICING, FAQ accordion, CTA FINAL, FOOTER.",
				"dashboard": "\n\n=== SOUS-MODE DASHBOARD ===\nLayout: SIDEBAR 260px fixed + MAIN margin-left 260px, STATS ROW 4 cards, CHARTS, TABLE avec pagination.",
				"app":       "\n\n=== SOUS-MODE APPLICATION ===\nDesign SaaS moderne dark-first. Formulaires, modals, toasts, tables, empty states, skeleton loading.",
				"portfolio": "\n\n=== SOUS-MODE PORTFOLIO ===\nDesign créatif dark élégant. HERO minimaliste, PROJETS grid 2 cols, PROCESSUS, À PROPOS, CONTACT.",
			}
			if sub, ok := uiUxSubModeInstructions[settings.HumanSubMode]; ok {
				instruction += sub
			}
		}
		systemPrompt = instruction + "\n\n" + systemPrompt
	}

	// Inject RAG context if enabled
	ragContext, ragSources := s.buildRAGContext(chat)
	if ragContext != "" {
		systemPrompt += "\n\n" + ragContext
	}

	msgs = append(msgs, api.Message{
		Role:    "system",
		Content: systemPrompt,
	})

	for _, m := range chat.Messages {
		if m.Content == "" && m.Thinking == "" && len(m.ToolCalls) == 0 && len(m.Attachments) == 0 {
			continue
		}

		apiMsg := api.Message{Role: m.Role, Thinking: m.Thinking}

		sb := strings.Builder{}
		sb.WriteString(m.Content)

		var images []api.ImageData
		if m.Role == "user" && len(m.Attachments) > 0 {
			for _, a := range m.Attachments {
				if isImageAttachment(a.Filename) {
					images = append(images, api.ImageData(a.Data))
				} else {
					content := convertBytesToText(a.Data, a.Filename)
					sb.WriteString(fmt.Sprintf("\n--- File: %s ---\n%s\n--- End of %s ---",
						a.Filename, content, a.Filename))
				}
			}
		}

		apiMsg.Content = sb.String()
		apiMsg.Images = images

		switch m.Role {
		case "assistant":
			if len(m.ToolCalls) > 0 {
				var toolCalls []api.ToolCall
				for _, tc := range m.ToolCalls {
					var args api.ToolCallFunctionArguments
					if err := json.Unmarshal([]byte(tc.Function.Arguments), &args); err != nil {
						s.log().Error("failed to parse tool call arguments", "error", err, "function_name", tc.Function.Name, "arguments", tc.Function.Arguments)
						continue
					}

					toolCalls = append(toolCalls, api.ToolCall{
						Function: api.ToolCallFunction{
							Name:      tc.Function.Name,
							Arguments: args,
						},
					})
				}
				apiMsg.ToolCalls = toolCalls
			}
		case "tool":
			apiMsg.Role = "tool"
			apiMsg.Content = m.Content
			apiMsg.ToolName = m.ToolName
		case "user", "system":
			// handled normally
		default:
			s.log().Debug("unknown message role", "role", m.Role)
		}

		msgs = append(msgs, apiMsg)
	}

	var thinkValue *api.ThinkValue
	if think != nil {
		if boolValue, ok := think.(bool); ok {
			if boolValue {
				thinkValue = &api.ThinkValue{Value: boolValue}
			}
		} else if stringValue, ok := think.(string); ok {
			if stringValue != "" && stringValue != "none" {
				thinkValue = &api.ThinkValue{Value: stringValue}
			}
		}
	}

	// Performance-critical Options configuration
	chatSettings, _ := s.Store.Settings()
	options := map[string]any{
		"use_mmap": false,
	}
	if chatSettings.ContextLength > 0 {
		options["num_ctx"] = chatSettings.ContextLength
	}
	if chatSettings.NumThread > 0 {
		options["num_thread"] = chatSettings.NumThread
	}
	if chatSettings.NumBatch > 0 {
		options["num_batch"] = chatSettings.NumBatch
	}
	if chatSettings.UseMlock {
		options["use_mlock"] = true
	}
	if chatSettings.RopeFrequencyBase > 0 {
		options["rope_frequency_base"] = chatSettings.RopeFrequencyBase
	}
	if chatSettings.RopeFrequencyScale > 0 {
		options["rope_frequency_scale"] = chatSettings.RopeFrequencyScale
	}
	if frontendReq != nil {
		if frontendReq.Temperature != nil {
			options["temperature"] = *frontendReq.Temperature
		}
		if frontendReq.TopP != nil {
			options["top_p"] = *frontendReq.TopP
		}
		if frontendReq.NumPredict != nil {
			options["num_predict"] = *frontendReq.NumPredict
		}
		if frontendReq.TopK != nil {
			options["top_k"] = *frontendReq.TopK
		}
		if frontendReq.MinP != nil {
			options["min_p"] = *frontendReq.MinP
		}
		if frontendReq.TypicalP != nil && *frontendReq.TypicalP < 1.0 {
			options["typical_p"] = *frontendReq.TypicalP
		}
		if frontendReq.RepeatPenalty != nil {
			options["repeat_penalty"] = *frontendReq.RepeatPenalty
		}
		if frontendReq.RepeatLastN != nil && *frontendReq.RepeatLastN > 0 {
			options["repeat_last_n"] = *frontendReq.RepeatLastN
		}
		if frontendReq.FrequencyPenalty != nil {
			options["frequency_penalty"] = *frontendReq.FrequencyPenalty
		}
		if frontendReq.PresencePenalty != nil {
			options["presence_penalty"] = *frontendReq.PresencePenalty
		}
		if frontendReq.Seed != nil {
			options["seed"] = *frontendReq.Seed
		}
		if frontendReq.FlashAttn != nil && *frontendReq.FlashAttn {
			options["flash_attn"] = true
		}
		if frontendReq.CacheTypeK != nil && *frontendReq.CacheTypeK != "" {
			options["cache_type_k"] = *frontendReq.CacheTypeK
		}
		if frontendReq.CacheTypeV != nil && *frontendReq.CacheTypeV != "" {
			options["cache_type_v"] = *frontendReq.CacheTypeV
		}
		if len(frontendReq.Stop) > 0 {
			options["stop"] = frontendReq.Stop
		}
		if frontendReq.NumGPU != nil {
			options["num_gpu"] = *frontendReq.NumGPU
		}
		if frontendReq.NumCtx != nil && *frontendReq.NumCtx > 0 {
			options["num_ctx"] = *frontendReq.NumCtx
		}
		if frontendReq.NumThread != nil && *frontendReq.NumThread > 0 {
			options["num_thread"] = *frontendReq.NumThread
		}
		if frontendReq.NumBatch != nil && *frontendReq.NumBatch > 0 {
			options["num_batch"] = *frontendReq.NumBatch
		}
		if frontendReq.UseMlock != nil && *frontendReq.UseMlock {
			options["use_mlock"] = true
		}
		if frontendReq.RopeFrequencyBase != nil && *frontendReq.RopeFrequencyBase > 0 {
			options["rope_frequency_base"] = *frontendReq.RopeFrequencyBase
		}
		if frontendReq.RopeFrequencyScale != nil && *frontendReq.RopeFrequencyScale > 0 {
			options["rope_frequency_scale"] = *frontendReq.RopeFrequencyScale
		}
		if len(frontendReq.LogitBias) > 0 {
			biasMap := make(map[int]float64, len(frontendReq.LogitBias))
			for tokenStr, bias := range frontendReq.LogitBias {
				var tokenID int
				if _, err := fmt.Sscanf(tokenStr, "%d", &tokenID); err == nil {
					biasMap[tokenID] = bias
				}
			}
			if len(biasMap) > 0 {
				options["logit_bias"] = biasMap
			}
		}
	}

	req := &api.ChatRequest{
		Model:    modelName,
		Messages: msgs,
		Stream:   ptr(true),
		Think:    thinkValue,
		Shift:    ptr(true),
		Options:  options,
	}

	// LOT 40: Structured Output — pass format to Ollama
	if frontendReq != nil && frontendReq.Format != nil {
		switch v := frontendReq.Format.(type) {
		case string:
			if v != "" {
				raw, _ := json.Marshal(v)
				req.Format = raw
			}
		default:
			// JSON Schema object
			raw, err := json.Marshal(v)
			if err == nil {
				req.Format = raw
			}
		}
	}

	if len(availableTools) > 0 {
		tools := make(api.Tools, len(availableTools))
		for i, toolSchema := range availableTools {
			tools[i] = convertToOllamaTool(toolSchema)
		}
		req.Tools = tools
	}

	return req, ragSources, nil
}

// ========== RAG ==========

func (s *Server) buildRAGContext(chat *store.Chat) (string, []store.RAGSource) {
	settings, err := s.Store.Settings()
	if err != nil || !settings.RAGEnabled {
		return "", nil
	}

	var query string
	for i := len(chat.Messages) - 1; i >= 0; i-- {
		if chat.Messages[i].Role == "user" && chat.Messages[i].Content != "" {
			query = chat.Messages[i].Content
			break
		}
	}
	if query == "" {
		return "", nil
	}

	embeddingModel := s.selectEmbeddingModel()

	docs, err := s.Store.RAGDocuments()
	if err != nil || len(docs) == 0 {
		return "", nil
	}

	// Adaptive strategy: full inject if all docs fit within 70% of remaining context
	contextLength := settings.ContextLength
	if contextLength <= 0 {
		contextLength = 4096
	}
	usedTokens := 0
	for _, m := range chat.Messages {
		usedTokens += len(m.Content) / 4
	}
	remainingContext := contextLength - usedTokens
	if remainingContext < 0 {
		remainingContext = 0
	}

	type docChunks struct {
		doc    store.RAGDocument
		chunks []store.RAGChunk
	}
	var readyDocs []docChunks
	totalDocTokens := 0
	for _, d := range docs {
		if d.Status != "ready" {
			continue
		}
		chunks, cErr := s.Store.RAGChunksByDocument(d.ID)
		if cErr != nil || len(chunks) == 0 {
			continue
		}
		docTokens := 0
		for _, ch := range chunks {
			docTokens += len(ch.Content) / 4
		}
		totalDocTokens += docTokens
		readyDocs = append(readyDocs, docChunks{doc: d, chunks: chunks})
	}

	if len(readyDocs) > 0 && totalDocTokens < int(float64(remainingContext)*0.7) {
		slog.Info("RAG: using full inject strategy", "totalDocTokens", totalDocTokens, "remainingContext", remainingContext, "docs", len(readyDocs))
		var sb strings.Builder
		sb.WriteString("--- Contexte documentaire (base de connaissances) ---\n")
		sb.WriteString("Documents injectés intégralement (petite base).\n\n")
		var sources []store.RAGSource
		for i, dc := range readyDocs {
			sb.WriteString(fmt.Sprintf("[Document %d - %s]\n", i+1, dc.doc.Filename))
			for _, ch := range dc.chunks {
				sb.WriteString(ch.Content)
				sb.WriteString("\n")
			}
			sb.WriteString("\n")
			excerpt := ""
			if len(dc.chunks) > 0 {
				excerpt = dc.chunks[0].Content
			}
			if len(excerpt) > 100 {
				excerpt = excerpt[:100] + "..."
			}
			sources = append(sources, store.RAGSource{
				Index:        i + 1,
				DocumentID:   dc.doc.ID,
				DocumentName: dc.doc.Filename,
				ChunkIndex:   0,
				Excerpt:      excerpt,
				Score:        1.0,
			})
		}
		sb.WriteString("--- Fin du contexte documentaire ---")
		return sb.String(), sources
	}
	slog.Info("RAG: using retrieval strategy", "totalDocTokens", totalDocTokens, "remainingContext", remainingContext)

	c, err := api.ClientFromEnvironment()
	if err != nil {
		s.log().Warn("RAG: cannot create client", "error", err)
		return "", nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	truncate := true
	resp, err := c.Embed(ctx, &api.EmbedRequest{
		Model:    embeddingModel,
		Input:    query,
		Truncate: &truncate,
	})
	if err != nil {
		s.log().Warn("RAG: embed query failed", "error", err)
		return "", nil
	}

	if len(resp.Embeddings) == 0 || len(resp.Embeddings[0]) == 0 {
		return "", nil
	}

	queryEmb := resp.Embeddings[0]

	topK := settings.RAGRetrievalLimit
	if topK <= 0 {
		topK = 5
	}

	results, err := s.Store.SearchRAGChunks(queryEmb, topK)
	if err != nil || len(results) == 0 {
		return "", nil
	}

	allZero := true
	for _, r := range results {
		if r.Score > 0 {
			allZero = false
			break
		}
	}
	if allZero {
		s.log().Warn("RAG: all search scores are 0 — embedding dimensions may be incompatible",
			"queryDim", len(queryEmb), "model", embeddingModel)
		return "", nil
	}

	affinityThreshold := settings.RAGAffinityThreshold
	if affinityThreshold <= 0 {
		affinityThreshold = 0.3
	}
	threshold32 := float32(affinityThreshold)

	filtered := results[:0]
	for _, r := range results {
		if r.Score >= threshold32 {
			filtered = append(filtered, r)
		}
	}
	if len(filtered) == 0 {
		s.log().Info("RAG: no chunks above affinity threshold", "threshold", affinityThreshold, "candidates", len(results))
		return "", nil
	}
	results = filtered

	citationsEnabled := settings.RAGCitationsEnabled

	var sb strings.Builder
	sb.WriteString("--- Contexte documentaire (base de connaissances) ---\n")
	if citationsEnabled {
		sb.WriteString("Utilise les extraits suivants pour répondre. Cite les sources en utilisant [1], [2], etc.\n\n")
	} else {
		sb.WriteString("Utilise les extraits suivants pour répondre. Cite la source quand c'est pertinent.\n\n")
	}

	var sources []store.RAGSource
	for i, r := range results {
		sb.WriteString(fmt.Sprintf("[Source %d - Document: %s]\n%s\n\n", i+1, r.DocumentName, r.Content))

		excerpt := r.Content
		if len(excerpt) > 100 {
			excerpt = excerpt[:100] + "..."
		}
		sources = append(sources, store.RAGSource{
			Index:        i + 1,
			DocumentID:   r.DocumentID,
			DocumentName: r.DocumentName,
			ChunkIndex:   r.ChunkIndex,
			Excerpt:      excerpt,
			Score:        r.Score,
		})
	}
	sb.WriteString("--- Fin du contexte documentaire ---")
	return sb.String(), sources
}

// ========== RAG endpoints ==========

func (s *Server) ragListDocuments(w http.ResponseWriter, r *http.Request) error {
	docs, err := s.Store.RAGDocuments()
	if err != nil {
		return fmt.Errorf("list rag documents: %w", err)
	}
	if docs == nil {
		docs = []store.RAGDocument{}
	}
	w.Header().Set("Content-Type", "application/json")
	return json.NewEncoder(w).Encode(docs)
}

func (s *Server) ragUploadDocument(w http.ResponseWriter, r *http.Request) error {
	if r.Method != "POST" {
		return not.Found
	}

	gpuCtx, gpuCancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer gpuCancel()
	isGPU := false
	if info, gpuErr := server.GetInferenceInfo(gpuCtx); gpuErr == nil {
		for _, ic := range info.Computes {
			if ic.Library != "cpu" && ic.Library != "" && ic.VRAM != "" {
				isGPU = true
				break
			}
		}
	}
	maxSize := int64(ragUploadMaxSizeCPU)
	if isGPU {
		maxSize = ragUploadMaxSizeGPU
	}

	if err := r.ParseMultipartForm(ragMultipartFormMax); err != nil {
		return fmt.Errorf("parse multipart: %w", err)
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		return fmt.Errorf("get file from form: %w", err)
	}
	defer file.Close()

	if header.Size > maxSize {
		mode := "CPU"
		if isGPU {
			mode = "GPU"
		}
		http.Error(w, fmt.Sprintf("Fichier trop volumineux pour le mode %s (limite : %d Mo)", mode, maxSize>>20), http.StatusRequestEntityTooLarge)
		return nil
	}

	limited := io.LimitReader(file, maxSize+1)
	data, err := io.ReadAll(limited)
	if err != nil {
		return fmt.Errorf("read file data: %w", err)
	}
	if int64(len(data)) > maxSize {
		mode := "CPU"
		if isGPU {
			mode = "GPU"
		}
		http.Error(w, fmt.Sprintf("Fichier trop volumineux pour le mode %s (limite : %d Mo)", mode, maxSize>>20), http.StatusRequestEntityTooLarge)
		return nil
	}

	h := sha256.Sum256(data)
	contentHash := hex.EncodeToString(h[:])

	existing, err := s.Store.RAGDocumentByHash(contentHash)
	if err != nil {
		return fmt.Errorf("check duplicate RAG document: %w", err)
	}
	if existing != nil {
		w.Header().Set("Content-Type", "application/json")
		return json.NewEncoder(w).Encode(existing)
	}

	embeddingModel := s.selectEmbeddingModel(isGPU)

	docID, err := uuid.NewV7()
	if err != nil {
		return fmt.Errorf("generate document ID: %w", err)
	}
	doc := store.RAGDocument{
		ID:             docID.String(),
		Filename:       sanitizeRAGFilename(header.Filename),
		FileSize:       int64(len(data)),
		ContentHash:    contentHash,
		Status:         "pending",
		EmbeddingModel: embeddingModel,
	}

	if err := s.Store.InsertRAGDocument(doc); err != nil {
		return fmt.Errorf("insert rag document: %w", err)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(doc)

	go func() {
		ragWorkerSem <- struct{}{}
		defer func() { <-ragWorkerSem }()
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
		defer cancel()
		s.processRAGDocument(ctx, doc.ID, data, doc.Filename, embeddingModel)
	}()

	return nil
}

func (s *Server) selectEmbeddingModel(isGPU ...bool) string {
	settings, err := s.Store.Settings()
	if err == nil && settings.EmbeddingModel != "" {
		return settings.EmbeddingModel
	}

	gpuDetected := false
	if len(isGPU) > 0 {
		gpuDetected = isGPU[0]
	} else {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		info, gpuErr := server.GetInferenceInfo(ctx)
		if gpuErr == nil {
			for _, ic := range info.Computes {
				if ic.Library != "cpu" && ic.Library != "" && ic.VRAM != "" {
					gpuDetected = true
					break
				}
			}
		}
	}

	if gpuDetected {
		return "snowflake-arctic-embed:110m"
	}
	return "snowflake-arctic-embed:33m"
}

func (s *Server) processRAGDocument(ctx context.Context, docID string, data []byte, filename, embeddingModel string) {
	defer func() {
		if r := recover(); r != nil {
			s.log().Error("RAG processDocument panic", "docID", docID, "panic", r)
			s.Store.UpdateRAGDocumentStatus(docID, "error", fmt.Sprintf("panic: %v", r), 0)
		}
	}()

	s.Store.UpdateRAGDocumentStatus(docID, "processing", "", 0)
	s.Store.UpdateRAGDocumentProgress(docID, 0, 0)

	text := convertBytesToText(data, filename)
	if strings.HasPrefix(text, "[PDF file") || strings.HasPrefix(text, "[Binary file") {
		s.Store.UpdateRAGDocumentStatus(docID, "error", "Impossible d'extraire le texte du fichier", 0)
		return
	}

	chunks := ChunkText(text, 256, 30)
	if len(chunks) == 0 {
		s.Store.UpdateRAGDocumentStatus(docID, "error", "Aucun contenu textuel trouvé", 0)
		return
	}

	c, err := api.ClientFromEnvironment()
	if err != nil {
		s.Store.UpdateRAGDocumentStatus(docID, "error", fmt.Sprintf("Client Dromadaire: %v", err), 0)
		return
	}

	if ctx.Err() != nil {
		s.Store.UpdateRAGDocumentStatus(docID, "error", "Traitement annulé (timeout)", 0)
		return
	}

	embedStart := time.Now()
	s.log().Info("RAG embedding", "docID", docID, "filename", filename, "chunks", len(chunks), "model", embeddingModel)

	// Unload all loaded models to free memory
	if ps, psErr := c.ListRunning(ctx); psErr == nil && len(ps.Models) > 0 {
		for _, m := range ps.Models {
			s.log().Info("RAG: unloading model before embed", "model", m.Name)
			keepAlive := &api.Duration{Duration: 0}
			_ = c.Generate(ctx, &api.GenerateRequest{
				Model:     m.Name,
				KeepAlive: keepAlive,
			}, func(r api.GenerateResponse) error { return nil })
		}
		time.Sleep(2 * time.Second)
	}

	chunkTexts := make([]string, len(chunks))
	for i, ct := range chunks {
		chunkTexts[i] = strings.Map(func(r rune) rune {
			if r == 0 || (r < 32 && r != '\n' && r != '\r' && r != '\t') {
				return ' '
			}
			return r
		}, ct)
	}

	truncate := true

	ensureModel := func() error {
		testResp, testErr := c.Embed(ctx, &api.EmbedRequest{
			Model:    embeddingModel,
			Input:    "test",
			Truncate: &truncate,
		})
		_ = testResp
		if testErr != nil && strings.Contains(testErr.Error(), "not found") {
			embSettings, _ := s.Store.Settings()
			if embSettings.AirplaneMode {
				return fmt.Errorf("mode avion actif: le modele %s doit etre telecharge", embeddingModel)
			}
			s.log().Info("pulling embedding model", "model", embeddingModel)
			pullErr := c.Pull(ctx, &api.PullRequest{Model: embeddingModel}, func(p api.ProgressResponse) error {
				return nil
			})
			if pullErr != nil {
				return fmt.Errorf("téléchargement du modèle %s: %v", embeddingModel, pullErr)
			}
		} else if testErr != nil {
			return testErr
		}
		return nil
	}

	if err := ensureModel(); err != nil {
		s.Store.UpdateRAGDocumentStatus(docID, "error", err.Error(), 0)
		return
	}

	s.Store.UpdateRAGDocumentProgress(docID, 0, len(chunkTexts))

	allEmbeddings := make([][]float32, len(chunkTexts))
	skipped := 0

	for i, ct := range chunkTexts {
		if ctx.Err() != nil {
			s.log().Warn("RAG embedding cancelled by context", "docID", docID, "chunk", i, "total", len(chunkTexts))
			s.Store.UpdateRAGDocumentStatus(docID, "error", "Traitement annulé (timeout)", 0)
			return
		}
		resp, err := c.Embed(ctx, &api.EmbedRequest{
			Model:    embeddingModel,
			Input:    ct,
			Truncate: &truncate,
		})
		if err != nil {
			s.log().Warn("RAG embed chunk skipped", "chunk", i, "chars", len(ct), "error", err)
			skipped++
			continue
		}
		if len(resp.Embeddings) == 0 {
			s.log().Warn("RAG embed chunk empty, skipped", "chunk", i)
			skipped++
			continue
		}
		allEmbeddings[i] = resp.Embeddings[0]
		s.Store.UpdateRAGDocumentProgress(docID, i+1-skipped, len(chunkTexts)-skipped)
		if (i+1)%10 == 0 || i == len(chunkTexts)-1 {
			s.log().Info("RAG embedding progress", "chunk", i+1, "total", len(chunkTexts), "skipped", skipped)
		}
	}

	if skipped > 0 {
		s.log().Warn("RAG embedding completed with skipped chunks", "skipped", skipped, "total", len(chunkTexts))
	}

	var ragChunks []store.RAGChunk
	for i, chunkText := range chunks {
		if allEmbeddings[i] == nil {
			continue
		}
		ragChunks = append(ragChunks, store.RAGChunk{
			DocumentID:   docID,
			ChunkIndex:   i,
			Content:      chunkText,
			Embedding:    allEmbeddings[i],
			EmbeddingDim: len(allEmbeddings[i]),
			TokenCount:   len(strings.Fields(chunkText)),
		})
	}

	if len(ragChunks) == 0 {
		s.Store.UpdateRAGDocumentStatus(docID, "error", "Aucun chunk n'a pu être embeddé", 0)
		return
	}

	if err := s.Store.InsertRAGChunks(ragChunks); err != nil {
		s.Store.UpdateRAGDocumentStatus(docID, "error", fmt.Sprintf("Stockage: %v", err), 0)
		return
	}

	s.Store.UpdateRAGDocumentStatus(docID, "ready", "", len(ragChunks))
	s.log().Info("RAG document processed", "id", docID, "filename", filename, "chunks", len(ragChunks), "duration", time.Since(embedStart))

	unloadCtx, unloadCancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer unloadCancel()
	unloadKeepAlive := &api.Duration{Duration: 0}
	if _, err := c.Embed(unloadCtx, &api.EmbedRequest{
		Model:     embeddingModel,
		Input:     "",
		KeepAlive: unloadKeepAlive,
	}); err != nil {
		s.log().Warn("failed to unload embedding model", "model", embeddingModel, "error", err)
	} else {
		s.log().Info("embedding model unloaded", "model", embeddingModel)
	}
}

func (s *Server) ragDocumentChunks(w http.ResponseWriter, r *http.Request) error {
	settings, err := s.Store.Settings()
	if err != nil {
		return fmt.Errorf("failed to load settings: %w", err)
	}
	if !settings.RAGPreviewEnabled {
		http.Error(w, `{"error":"preview is disabled"}`, http.StatusForbidden)
		return nil
	}

	docID := r.PathValue("id")
	if docID == "" {
		return fmt.Errorf("document ID is required")
	}

	chunks, err := s.Store.RAGChunksByDocument(docID)
	if err != nil {
		return fmt.Errorf("get chunks: %w", err)
	}
	if chunks == nil {
		chunks = []store.RAGChunk{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(chunks)
	return nil
}

func (s *Server) ragDeleteDocument(w http.ResponseWriter, r *http.Request) error {
	if r.Method != "DELETE" {
		return not.Found
	}
	id := r.PathValue("id")
	if id == "" {
		return fmt.Errorf("missing document id")
	}
	if err := s.Store.DeleteRAGDocument(id); err != nil {
		return fmt.Errorf("delete rag document: %w", err)
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (s *Server) ragSearch(w http.ResponseWriter, r *http.Request) error {
	if r.Method != "POST" {
		return not.Found
	}

	var req struct {
		Query string `json:"query"`
		TopK  int    `json:"top_k"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 10<<20)).Decode(&req); err != nil {
		return fmt.Errorf("invalid request body: %w", err)
	}
	if req.Query == "" {
		return fmt.Errorf("empty query")
	}
	if req.TopK <= 0 {
		req.TopK = 5
	}

	embeddingModel := s.selectEmbeddingModel()

	c, err := api.ClientFromEnvironment()
	if err != nil {
		return fmt.Errorf("dromadaire client: %w", err)
	}

	truncate := true
	resp, err := c.Embed(r.Context(), &api.EmbedRequest{
		Model:    embeddingModel,
		Input:    req.Query,
		Truncate: &truncate,
	})
	if err != nil {
		return fmt.Errorf("embed query: %w", err)
	}

	if len(resp.Embeddings) == 0 || len(resp.Embeddings[0]) == 0 {
		return fmt.Errorf("empty query embedding")
	}

	queryEmb := resp.Embeddings[0]

	results, err := s.Store.SearchRAGChunks(queryEmb, req.TopK)
	if err != nil {
		return fmt.Errorf("search rag: %w", err)
	}

	w.Header().Set("Content-Type", "application/json")
	return json.NewEncoder(w).Encode(results)
}

// ========== Authentication handlers ==========

func (s *Server) authStatus(w http.ResponseWriter, r *http.Request) error {
	settings, err := s.Store.Settings()
	if err != nil {
		return fmt.Errorf("load settings: %w", err)
	}
	w.Header().Set("Content-Type", "application/json")
	return json.NewEncoder(w).Encode(map[string]bool{
		"passwordEnabled":   settings.PasswordEnabled,
		"autoDeleteEnabled": settings.AutoDeleteOnFailure,
	})
}

func (s *Server) setPassword(w http.ResponseWriter, r *http.Request) error {
	var req struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 10<<20)).Decode(&req); err != nil {
		return fmt.Errorf("invalid request body: %w", err)
	}
	if len(req.Password) < 4 {
		http.Error(w, `{"error":"password must be at least 4 characters"}`, http.StatusBadRequest)
		return nil
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), 13)
	if err != nil {
		return fmt.Errorf("hash password: %w", err)
	}

	settings, err := s.Store.Settings()
	if err != nil {
		return fmt.Errorf("load settings: %w", err)
	}
	settings.PasswordEnabled = true
	settings.PasswordHash = string(hash)
	if err := s.Store.SetSettings(settings); err != nil {
		return fmt.Errorf("save settings: %w", err)
	}

	if err := s.Store.ResetFailedAttempts(); err != nil {
		slog.Error("ResetFailedAttempts failed after password set", "error", err)
	}

	w.Header().Set("Content-Type", "application/json")
	return json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}

func (s *Server) verifyPassword(w http.ResponseWriter, r *http.Request) error {
	var req struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&req); err != nil {
		return fmt.Errorf("invalid request body: %w", err)
	}

	settings, err := s.Store.Settings()
	if err != nil {
		return fmt.Errorf("load settings: %w", err)
	}

	if !settings.PasswordEnabled {
		w.Header().Set("Content-Type", "application/json")
		return json.NewEncoder(w).Encode(map[string]interface{}{
			"authenticated": true,
			"wiped":         false,
		})
	}

	err = bcrypt.CompareHashAndPassword([]byte(settings.PasswordHash), []byte(req.Password))
	if err != nil {
		count, incErr := s.Store.IncrementFailedAttempts()
		if incErr != nil {
			slog.Error("IncrementFailedAttempts failed", "error", incErr)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusInternalServerError)
			return json.NewEncoder(w).Encode(map[string]interface{}{
				"authenticated": false,
				"wiped":         false,
				"attemptsLeft":  nil,
				"error":         "Could not update attempt count. Please try again.",
			})
		}

		if count >= 3 && settings.AutoDeleteOnFailure {
			s.log().Warn("3 failed password attempts with auto-delete enabled — wiping data")
			if err := s.Store.DeleteEncryptionKey(); err != nil {
				slog.Error("auto-wipe: DeleteEncryptionKey failed, aborting wipe", "error", err)
				return fmt.Errorf("auto-wipe DeleteEncryptionKey: %w", err)
			}
			if err := s.Store.ResetFailedAttempts(); err != nil {
				slog.Error("auto-wipe: ResetFailedAttempts failed, aborting wipe", "error", err)
				return fmt.Errorf("auto-wipe ResetFailedAttempts: %w", err)
			}
			if err := s.Store.DeleteAllChats(); err != nil {
				slog.Error("auto-wipe: DeleteAllChats failed", "error", err)
				return fmt.Errorf("auto-wipe DeleteAllChats: %w", err)
			}

			w.Header().Set("Content-Type", "application/json")
			return json.NewEncoder(w).Encode(map[string]interface{}{
				"authenticated": false,
				"wiped":         true,
				"attemptsLeft":  0,
			})
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		return json.NewEncoder(w).Encode(map[string]interface{}{
			"authenticated": false,
			"wiped":         false,
			"attemptsLeft":  3 - count,
		})
	}

	if err := s.Store.ResetFailedAttempts(); err != nil {
		slog.Error("ResetFailedAttempts failed after successful login", "error", err)
	}

	w.Header().Set("Content-Type", "application/json")
	return json.NewEncoder(w).Encode(map[string]interface{}{
		"authenticated": true,
		"wiped":         false,
	})
}

func (s *Server) removePassword(w http.ResponseWriter, r *http.Request) error {
	var req struct {
		CurrentPassword string `json:"current_password"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 10<<20)).Decode(&req); err != nil {
		return fmt.Errorf("invalid request body: %w", err)
	}

	settings, err := s.Store.Settings()
	if err != nil {
		return fmt.Errorf("load settings: %w", err)
	}

	if !settings.PasswordEnabled {
		w.Header().Set("Content-Type", "application/json")
		return json.NewEncoder(w).Encode(map[string]bool{"ok": true})
	}

	if err := bcrypt.CompareHashAndPassword([]byte(settings.PasswordHash), []byte(req.CurrentPassword)); err != nil {
		http.Error(w, `{"error":"incorrect password"}`, http.StatusUnauthorized)
		return nil
	}

	settings.PasswordEnabled = false
	settings.PasswordHash = ""
	settings.AutoDeleteOnFailure = false
	if err := s.Store.SetSettings(settings); err != nil {
		return fmt.Errorf("save settings: %w", err)
	}

	_ = s.Store.ResetFailedAttempts()

	w.Header().Set("Content-Type", "application/json")
	return json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}

// ========== Advanced Performance ==========

func (s *Server) getHardwareInfo(w http.ResponseWriter, r *http.Request) error {
	cores := runtime.NumCPU()
	ramGB := server.GetTotalRAMGB()

	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	info, _ := server.GetInferenceInfo(ctx)

	isGPU := false
	gpuName := ""
	vram := ""
	library := "cpu"
	if info != nil {
		for _, ic := range info.Computes {
			if ic.Library != "cpu" && ic.Library != "" {
				isGPU = true
				gpuName = ic.Name
				vram = ic.VRAM
				library = ic.Library
				break
			}
		}
	}

	systemGPU := server.GetSystemGPUName()

	w.Header().Set("Content-Type", "application/json")
	return json.NewEncoder(w).Encode(map[string]any{
		"cpuCores":   cores,
		"totalRAMGB": ramGB,
		"isGPU":      isGPU,
		"gpuName":    gpuName,
		"vram":       vram,
		"library":    library,
		"systemGPU":  systemGPU,
	})
}

func (s *Server) getSystemResources(w http.ResponseWriter, r *http.Request) error {
	mem := server.GetSystemMemory()

	w.Header().Set("Content-Type", "application/json")
	return json.NewEncoder(w).Encode(mem)
}

// getSystemMetrics returns runtime metrics for the LOT 42 monitoring widget
func (s *Server) getSystemMetrics(w http.ResponseWriter, r *http.Request) error {
	var memStats runtime.MemStats
	runtime.ReadMemStats(&memStats)

	heapAllocMB := int(memStats.HeapAlloc / (1024 * 1024))
	sysMB := int(memStats.Sys / (1024 * 1024))
	totalRAMGB := server.GetTotalRAMGB()
	totalRAMMB := int(totalRAMGB * 1024)
	var memPercent float64
	if totalRAMMB > 0 {
		memPercent = math.Round(float64(sysMB)/float64(totalRAMMB)*10000) / 100
	}

	uptime := int64(time.Since(s.startedAt).Seconds())

	metrics := responses.SystemMetrics{
		MemoryUsedMB:  sysMB,
		MemoryTotalMB: totalRAMMB,
		MemoryPercent: memPercent,
		Goroutines:    runtime.NumGoroutine(),
		UptimeSeconds: uptime,
		HeapAllocMB:   heapAllocMB,
	}

	w.Header().Set("Content-Type", "application/json")
	return json.NewEncoder(w).Encode(metrics)
}

func (s *Server) autoconfig(w http.ResponseWriter, r *http.Request) error {
	cores := runtime.NumCPU()
	ramGB := server.GetTotalRAMGB()

	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	info, _ := server.GetInferenceInfo(ctx)

	isGPU := false
	gpuName := ""
	vram := ""
	library := "cpu"
	var vramGB float64
	if info != nil {
		for _, ic := range info.Computes {
			if ic.Library != "cpu" && ic.Library != "" {
				isGPU = true
				gpuName = ic.Name
				vram = ic.VRAM
				library = ic.Library
				fmt.Sscanf(ic.VRAM, "%f", &vramGB)
				break
			}
		}
	}

	numThread := max(1, cores-2)
	if cores <= 2 {
		numThread = cores
	}

	keepAlive := "2m"
	maxModels := 1
	kvCache := "q8_0"
	numBatch := 256
	ctxLength := 2048

	if isGPU {
		kvCache = "f16"
		numBatch = 512
		if vramGB < 8 {
			ctxLength = 4096
			keepAlive = "5m"
		} else if vramGB <= 16 {
			ctxLength = 8192
			keepAlive = "5m"
		} else {
			ctxLength = 16384
			keepAlive = "10m"
			maxModels = 2
		}
	} else {
		if ramGB > 64 {
			keepAlive = "10m"
			maxModels = 3
			numBatch = 512
			ctxLength = 8192
		} else if ramGB > 32 {
			keepAlive = "5m"
			maxModels = 2
			numBatch = 512
			ctxLength = 4096
		}
	}

	settings, err := s.Store.Settings()
	if err != nil {
		return err
	}
	if settings.NumThread == 0 {
		settings.NumThread = numThread
	}
	if settings.KeepAlive == "" {
		settings.KeepAlive = keepAlive
	}
	if settings.MaxLoadedModels == 0 {
		settings.MaxLoadedModels = maxModels
	}
	if settings.KVCacheType == "" {
		settings.KVCacheType = kvCache
	}
	if settings.NumBatch == 0 {
		settings.NumBatch = numBatch
	}
	if settings.ContextLength == 0 {
		settings.ContextLength = ctxLength
	}

	if err := s.Store.SetSettings(settings); err != nil {
		return err
	}

	w.Header().Set("Content-Type", "application/json")
	return json.NewEncoder(w).Encode(map[string]any{
		"hardware": map[string]any{
			"cpuCores":   cores,
			"totalRAMGB": ramGB,
			"isGPU":      isGPU,
			"gpuName":    gpuName,
			"vram":       vram,
			"library":    library,
		},
		"applied": map[string]any{
			"NumThread":       numThread,
			"KeepAlive":       keepAlive,
			"MaxLoadedModels": maxModels,
			"KVCacheType":     kvCache,
			"NumBatch":        numBatch,
			"ContextLength":   ctxLength,
		},
	})
}

func (s *Server) restartServer(w http.ResponseWriter, r *http.Request) error {
	if s.OllamaServer != nil {
		select {
		case s.OllamaServer.RestartCh() <- struct{}{}:
			slog.Info("Dromadaire: restart signal sent to ollama server")
		default:
			slog.Info("Dromadaire: restart already pending")
		}
	} else {
		slog.Warn("Dromadaire: OllamaServer not available, using Restart callback")
		if s.Restart != nil {
			s.Restart()
		}
	}
	w.Header().Set("Content-Type", "application/json")
	return json.NewEncoder(w).Encode(map[string]string{"status": "restarting"})
}

// analyzeStyle extracts personal writing style rules using a small model
func (s *Server) analyzeStyle(w http.ResponseWriter, r *http.Request) error {
	var req struct {
		Samples string `json:"samples"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 10<<20)).Decode(&req); err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return nil
	}
	if strings.TrimSpace(req.Samples) == "" {
		http.Error(w, "samples text is required", http.StatusBadRequest)
		return nil
	}

	if len(req.Samples) > 10000 {
		runes := []rune(req.Samples)
		if len(runes) > 10000 {
			req.Samples = string(runes[:10000])
		}
	}

	settings, err := s.Store.Settings()
	if err != nil {
		return fmt.Errorf("get settings: %w", err)
	}

	analysisModel := settings.StyleAnalysisModel
	if analysisModel == "" {
		analysisModel = "gemma3:4b"
	}

	c, err := api.ClientFromEnvironment()
	if err != nil {
		return fmt.Errorf("create client: %w", err)
	}

	ctx, cancel := context.WithTimeout(r.Context(), 180*time.Second)
	defer cancel()

	// Unload current chat model to free RAM
	if ps, psErr := c.ListRunning(ctx); psErr == nil && len(ps.Models) > 0 {
		for _, m := range ps.Models {
			s.log().Info("style-analysis: unloading model", "model", m.Name)
			keepAlive := &api.Duration{Duration: 0}
			_ = c.Generate(ctx, &api.GenerateRequest{
				Model:     m.Name,
				KeepAlive: keepAlive,
			}, func(r api.GenerateResponse) error { return nil })
		}
		time.Sleep(2 * time.Second)
	}

	analysisPrompt := fmt.Sprintf(`Expert en stylometrie. Analyse EXCLUSIVEMENT la FORME du texte, JAMAIS le sujet ni le contenu.

TEXTE:
---
%s
---

FORMAT DE SORTIE: une regle par ligne, instruction directe pour imiter le style.`, req.Samples)

	noStream := false
	keepAlive := &api.Duration{Duration: 60 * time.Second}
	options := map[string]any{
		"use_mmap": false,
		"num_ctx":  4096,
	}

	var result strings.Builder
	err = c.Generate(ctx, &api.GenerateRequest{
		Model:     analysisModel,
		Prompt:    analysisPrompt,
		Stream:    &noStream,
		KeepAlive: keepAlive,
		Options:   options,
	}, func(resp api.GenerateResponse) error {
		result.WriteString(resp.Response)
		return nil
	})

	if err != nil {
		http.Error(w, fmt.Sprintf("style analysis failed: %v", err), http.StatusInternalServerError)
		return nil
	}

	unloadKeepAlive := &api.Duration{Duration: 0}
	_ = c.Generate(ctx, &api.GenerateRequest{
		Model:     analysisModel,
		KeepAlive: unloadKeepAlive,
	}, func(r api.GenerateResponse) error { return nil })

	w.Header().Set("Content-Type", "application/json")
	return json.NewEncoder(w).Encode(map[string]string{
		"rules": result.String(),
	})
}

func (s *Server) getDiagnostics(w http.ResponseWriter, r *http.Request) error {
	cores := runtime.NumCPU()
	ramGB := server.GetTotalRAMGB()

	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	info, _ := server.GetInferenceInfo(ctx)

	gpuList := []map[string]string{}
	if info != nil {
		for _, ic := range info.Computes {
			gpuList = append(gpuList, map[string]string{
				"library": ic.Library,
				"variant": ic.Variant,
				"compute": ic.Compute,
				"driver":  ic.Driver,
				"name":    ic.Name,
				"vram":    ic.VRAM,
			})
		}
	}

	settings, _ := s.Store.Settings()

	ollamaEnv := map[string]string{}
	for _, env := range os.Environ() {
		if strings.HasPrefix(env, "OLLAMA_") {
			parts := strings.SplitN(env, "=", 2)
			if len(parts) == 2 {
				ollamaEnv[parts[0]] = parts[1]
			}
		}
	}

	serverPort := ""
	if s.OllamaServer != nil {
		serverPort = s.OllamaServer.GetPort()
	}

	logs := server.GetLastLogLines(100)

	buildInfo := map[string]string{}
	if bi, ok := debug.ReadBuildInfo(); ok {
		buildInfo["go_version"] = bi.GoVersion
		for _, setting := range bi.Settings {
			if setting.Key == "GOARCH" || setting.Key == "GOOS" {
				buildInfo[setting.Key] = setting.Value
			}
		}
	}

	result := map[string]any{
		"app_version":    version.Version,
		"schema_version": 25,
		"portable_mode":  s.PortableMode,
		"os":             runtime.GOOS,
		"arch":           runtime.GOARCH,
		"cpu_cores":      cores,
		"total_ram_gb":   fmt.Sprintf("%.1f", ramGB),
		"gpu_devices":    gpuList,
		"build_info":     buildInfo,
		"server_port":    serverPort,
		"ollama_env":     ollamaEnv,
		"performance": map[string]any{
			"num_thread":           settings.NumThread,
			"keep_alive":           settings.KeepAlive,
			"max_loaded_models":    settings.MaxLoadedModels,
			"kv_cache_type":        settings.KVCacheType,
			"num_batch":            settings.NumBatch,
			"context_length":       settings.ContextLength,
			"use_mlock":            settings.UseMlock,
			"rope_frequency_base":  settings.RopeFrequencyBase,
			"rope_frequency_scale": settings.RopeFrequencyScale,
		},
		"features": map[string]any{
			"rag_enabled":       settings.RAGEnabled,
			"embedding_model":   settings.EmbeddingModel,
			"citations_enabled": settings.RAGCitationsEnabled,
			"preview_enabled":   settings.RAGPreviewEnabled,
			"artifacts_enabled": settings.ArtifactsEnabled,
			"search_enabled":    settings.SearchEnabled,
			"encryption":        settings.EncryptionEnabled,
			"airplane_mode":     settings.AirplaneMode,
			"vulkan_enabled":    settings.VulkanEnabled,
			"theme":             settings.Theme,
		},
		"logs": logs,
	}

	w.Header().Set("Content-Type", "application/json")
	return json.NewEncoder(w).Encode(result)
}

// toolApprove handles POST /api/v1/chat/{id}/tool-approve
func (s *Server) toolApprove(w http.ResponseWriter, r *http.Request) error {
	chatID := r.PathValue("id")
	if chatID == "" {
		http.Error(w, "missing chat ID", http.StatusBadRequest)
		return nil
	}

	var req struct {
		Approved bool `json:"approved"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 10<<20)).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return nil
	}

	s.pendingApprovalsMu.Lock()
	bashTool, ok := s.pendingApprovals[chatID]
	s.pendingApprovalsMu.Unlock()

	if !ok || bashTool == nil {
		http.Error(w, "no pending approval for this chat", http.StatusNotFound)
		return nil
	}

	select {
	case bashTool.PendingResult <- tools.ToolApprovalResult{Approved: req.Approved}:
		slog.Info("Dromadaire: tool approval sent", "chat", chatID, "approved", req.Approved)
	default:
		slog.Warn("Dromadaire: no pending approval to send to", "chat", chatID)
	}

	w.Header().Set("Content-Type", "application/json")
	return json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

// ========== Performance Benchmark (Windows WEI style) ==========

type benchScorePoint struct {
	value float64
	score float64
}

func interpolateBenchScore(value float64, points []benchScorePoint) float64 {
	if len(points) == 0 {
		return 1.0
	}
	if value <= points[0].value {
		return points[0].score
	}
	last := points[len(points)-1]
	if value >= last.value {
		return last.score
	}
	for i := 1; i < len(points); i++ {
		if value <= points[i].value {
			t := (value - points[i-1].value) / (points[i].value - points[i-1].value)
			s := points[i-1].score + t*(points[i].score-points[i-1].score)
			return math.Round(s*10) / 10
		}
	}
	return last.score
}

func computeOverallBenchScore(scores ...float64) float64 {
	minScore := 9.9
	hasAny := false
	for _, s := range scores {
		if s >= 1.0 {
			hasAny = true
			if s < minScore {
				minScore = s
			}
		}
	}
	if !hasAny {
		return -1
	}
	return math.Round(minScore*10) / 10
}

func benchmarkCPU() (score float64, detail string, durationMs float64) {
	start := time.Now()
	numWorkers := runtime.NumCPU()
	duration := 2 * time.Second
	var totalHashes atomic.Int64

	var wg sync.WaitGroup
	for i := 0; i < numWorkers; i++ {
		wg.Add(1)
		go func(seed int) {
			defer wg.Done()
			data := make([]byte, 64)
			for j := range data {
				data[j] = byte(seed*7 + j)
			}
			var count int64
			deadline := time.Now().Add(duration)
			for time.Now().Before(deadline) {
				h := sha256.Sum256(data)
				copy(data[:32], h[:])
				count++
			}
			totalHashes.Add(count)
		}(i)
	}
	wg.Wait()

	elapsed := time.Since(start)
	hashesPerSec := float64(totalHashes.Load()) / elapsed.Seconds()

	score = interpolateBenchScore(hashesPerSec, []benchScorePoint{
		{200_000, 1.0}, {800_000, 3.0}, {2_000_000, 5.0},
		{8_000_000, 7.0}, {16_000_000, 9.9},
	})

	if hashesPerSec >= 1_000_000 {
		detail = fmt.Sprintf("%.1fM hash/s (%d coeurs)", hashesPerSec/1_000_000, numWorkers)
	} else {
		detail = fmt.Sprintf("%.0fK hash/s (%d coeurs)", hashesPerSec/1_000, numWorkers)
	}
	return score, detail, float64(elapsed.Milliseconds())
}

func benchmarkMemory() (score float64, detail string, durationMs float64) {
	start := time.Now()
	ramGB := server.GetTotalRAMGB()

	bufSize := 128 * 1024 * 1024
	if ramGB < 4 {
		bufSize = 32 * 1024 * 1024
	}

	src := make([]byte, bufSize)
	dst := make([]byte, bufSize)
	for i := range src {
		src[i] = byte(i & 0xFF)
	}

	duration := 2 * time.Second
	deadline := time.Now().Add(duration)
	var totalBytes int64
	for time.Now().Before(deadline) {
		copy(dst, src)
		totalBytes += int64(bufSize)
	}

	elapsed := time.Since(start)
	bandwidthGBs := float64(totalBytes) / elapsed.Seconds() / (1024 * 1024 * 1024)

	rawScore := interpolateBenchScore(bandwidthGBs, []benchScorePoint{
		{3, 1.0}, {8, 3.5}, {15, 5.5}, {30, 7.5}, {60, 9.9},
	})

	capacityBonus := interpolateBenchScore(ramGB, []benchScorePoint{
		{4, 0}, {8, 0.3}, {16, 0.5}, {32, 0.8}, {64, 1.0},
	})
	score = math.Min(9.9, rawScore+capacityBonus)
	score = math.Round(score*10) / 10

	detail = fmt.Sprintf("%.1f Go/s, %.0f Go RAM", bandwidthGBs, ramGB)
	return score, detail, float64(elapsed.Milliseconds())
}

func (s *Server) benchmarkInference(ctx context.Context) (score float64, detail string, durationMs float64) {
	start := time.Now()

	c, err := api.ClientFromEnvironment()
	if err != nil {
		return -1, "Client indisponible", float64(time.Since(start).Milliseconds())
	}

	listCtx, listCancel := context.WithTimeout(ctx, 5*time.Second)
	defer listCancel()
	lr, err := c.List(listCtx)
	if err != nil || len(lr.Models) == 0 {
		return -1, "Aucun modele installe", float64(time.Since(start).Milliseconds())
	}

	modelName := ""
	for _, m := range lr.Models {
		isBert := false
		for _, f := range m.Details.Families {
			if strings.Contains(strings.ToLower(f), "bert") {
				isBert = true
				break
			}
		}
		if !isBert {
			modelName = m.Name
			break
		}
	}
	if modelName == "" {
		return -1, "Aucun modele de chat", float64(time.Since(start).Milliseconds())
	}

	genCtx, genCancel := context.WithTimeout(ctx, 60*time.Second)
	defer genCancel()

	chatSettings, _ := s.Store.Settings()
	genOptions := map[string]any{
		"use_mmap": false,
	}
	if chatSettings.NumThread > 0 {
		genOptions["num_thread"] = chatSettings.NumThread
	}
	if chatSettings.NumBatch > 0 {
		genOptions["num_batch"] = chatSettings.NumBatch
	}
	if chatSettings.UseMlock {
		genOptions["use_mlock"] = true
	}

	noStream := false
	var finalResp api.GenerateResponse
	err = c.Generate(genCtx, &api.GenerateRequest{
		Model:   modelName,
		Prompt:  "List 10 random colors:",
		Stream:  &noStream,
		Options: genOptions,
	}, func(resp api.GenerateResponse) error {
		finalResp = resp
		return nil
	})

	if err != nil {
		return -1, fmt.Sprintf("Erreur: %v", err), float64(time.Since(start).Milliseconds())
	}

	var tokPerSec float64
	if finalResp.EvalDuration > 0 && finalResp.EvalCount > 0 {
		tokPerSec = float64(finalResp.EvalCount) / finalResp.EvalDuration.Seconds()
	}

	if tokPerSec <= 0 {
		return -1, "Mesure echouee", float64(time.Since(start).Milliseconds())
	}

	score = interpolateBenchScore(tokPerSec, []benchScorePoint{
		{0.5, 1.0}, {5, 3.5}, {10, 5.0}, {30, 7.0}, {80, 9.0}, {120, 9.9},
	})

	shortModel := modelName
	if idx := strings.LastIndex(modelName, ":"); idx > 0 {
		shortModel = modelName[:idx]
	}
	detail = fmt.Sprintf("%.1f tok/s (%s)", tokPerSec, shortModel)
	return score, detail, float64(time.Since(start).Milliseconds())
}

func (s *Server) benchmarkGPU(ctx context.Context) (score float64, detail string, durationMs float64) {
	start := time.Now()

	gpuCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	info, _ := server.GetInferenceInfo(gpuCtx)

	if info != nil {
		for _, ic := range info.Computes {
			if ic.Library != "cpu" && ic.Library != "" {
				var vramGB float64
				fmt.Sscanf(ic.VRAM, "%f", &vramGB)

				score = interpolateBenchScore(vramGB, []benchScorePoint{
					{2, 3.0}, {4, 4.5}, {8, 6.0}, {12, 7.0}, {24, 8.5}, {48, 9.9},
				})

				detail = fmt.Sprintf("%s (%s, %s)", ic.Name, strings.ToUpper(ic.Library), ic.VRAM)
				return score, detail, float64(time.Since(start).Milliseconds())
			}
		}
	}

	return -1, "CPU uniquement", float64(time.Since(start).Milliseconds())
}

func (s *Server) benchmark(w http.ResponseWriter, r *http.Request) error {
	w.Header().Set("Content-Type", "text/jsonl")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Transfer-Encoding", "chunked")

	flusher, ok := w.(http.Flusher)
	if !ok {
		return errors.New("streaming not supported")
	}

	ctx := r.Context()
	totalStart := time.Now()

	emit := func(v any) {
		json.NewEncoder(w).Encode(v)
		flusher.Flush()
	}

	emit(map[string]string{"event": "progress", "phase": "cpu", "message": "Test processeur en cours..."})
	cpuScore, cpuDetail, cpuDur := benchmarkCPU()
	emit(map[string]any{"event": "result", "phase": "cpu", "score": cpuScore, "detail": cpuDetail, "duration_ms": cpuDur})

	emit(map[string]string{"event": "progress", "phase": "memory", "message": "Test memoire en cours..."})
	memScore, memDetail, memDur := benchmarkMemory()
	emit(map[string]any{"event": "result", "phase": "memory", "score": memScore, "detail": memDetail, "duration_ms": memDur})

	emit(map[string]string{"event": "progress", "phase": "inference", "message": "Test inference IA en cours..."})
	inferScore, inferDetail, inferDur := s.benchmarkInference(ctx)
	emit(map[string]any{"event": "result", "phase": "inference", "score": inferScore, "detail": inferDetail, "duration_ms": inferDur})

	emit(map[string]string{"event": "progress", "phase": "gpu", "message": "Detection GPU..."})
	gpuScore, gpuDetail, gpuDur := s.benchmarkGPU(ctx)
	emit(map[string]any{"event": "result", "phase": "gpu", "score": gpuScore, "detail": gpuDetail, "duration_ms": gpuDur})

	overall := computeOverallBenchScore(cpuScore, memScore, inferScore, gpuScore)
	emit(map[string]any{
		"event":             "complete",
		"overall_score":     overall,
		"cpu_score":         cpuScore,
		"memory_score":      memScore,
		"infer_score":       inferScore,
		"gpu_score":         gpuScore,
		"cpu_detail":        cpuDetail,
		"memory_detail":     memDetail,
		"infer_detail":      inferDetail,
		"gpu_detail":        gpuDetail,
		"total_duration_ms": float64(time.Since(totalStart).Milliseconds()),
	})

	return nil
}

func (s *Server) testState(w http.ResponseWriter, r *http.Request) error {
	settings, err := s.Store.Settings()
	if err != nil {
		return fmt.Errorf("get settings: %w", err)
	}

	chats, err := s.Store.Chats()
	if err != nil {
		return fmt.Errorf("list chats: %w", err)
	}

	type chatSummary struct {
		ID     string `json:"id"`
		Title  string `json:"title"`
		Pinned bool   `json:"pinned"`
		Folder string `json:"folder"`
	}
	var chatList []chatSummary
	for _, c := range chats {
		chatList = append(chatList, chatSummary{
			ID:     c.ID,
			Title:  c.Title,
			Pinned: c.Pinned,
			Folder: c.Folder,
		})
	}

	state := map[string]any{
		"version":       "v7",
		"dev_mode":      s.Dev,
		"portable_mode": s.PortableMode,
		"settings":      settings,
		"chats":         chatList,
		"chat_count":    len(chats),
	}

	w.Header().Set("Content-Type", "application/json")
	return json.NewEncoder(w).Encode(state)
}
