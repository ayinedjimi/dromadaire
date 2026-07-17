//go:build windows || darwin

package server

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/ollama/ollama/app/logrotate"
	"github.com/ollama/ollama/app/store"
)

const restartDelay = time.Second

// Server is a managed ollama server process
type Server struct {
	store     *store.Store
	bin       string // resolved path to `ollama`
	log       io.WriteCloser
	dev       bool   // true if running with the dev flag
	port      string // Dromadaire: dynamically allocated port for the internal server
	restartCh chan struct{}

	// Dromadaire: separate, opt-in ollama server bound to the standard port
	// (11434) so third-party Ollama-compatible apps can reuse the same
	// models. Fully independent from the internal server above.
	externalMu  sync.Mutex
	externalCmd *exec.Cmd
}

// ExternalServerPort is the standard Ollama port third-party apps expect.
const ExternalServerPort = "11434"

// ExternalServerRunning reports whether the external-access server is active.
func (s *Server) ExternalServerRunning() bool {
	s.externalMu.Lock()
	defer s.externalMu.Unlock()
	return s.externalCmd != nil && s.externalCmd.ProcessState == nil
}

// StartExternalServer launches a separate `ollama serve` process bound to
// the standard port (11434) so other Ollama-compatible apps can connect
// using the shared model files, independent of the app's own internal server.
func (s *Server) StartExternalServer() error {
	s.externalMu.Lock()
	defer s.externalMu.Unlock()

	if s.externalCmd != nil && s.externalCmd.ProcessState == nil {
		return nil // already running
	}

	cmd := commandContext(context.Background(), s.bin, "serve")
	env := os.Environ()
	env = append(env, "OLLAMA_HOST=127.0.0.1:"+ExternalServerPort)
	cmd.Env = env

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to start external ollama server: %w", err)
	}
	s.externalCmd = cmd
	go cmd.Wait() // reap the process without blocking

	slog.Info("Dromadaire: external ollama server started", "port", ExternalServerPort)
	return nil
}

// StopExternalServer terminates the external-access server, if running.
func (s *Server) StopExternalServer() error {
	s.externalMu.Lock()
	defer s.externalMu.Unlock()

	if s.externalCmd == nil || s.externalCmd.Process == nil {
		return nil
	}
	err := stop(s.externalCmd.Process)
	s.externalCmd = nil
	slog.Info("Dromadaire: external ollama server stopped")
	return err
}

type InferenceCompute struct {
	Library string
	Variant string
	Compute string
	Driver  string
	Name    string
	VRAM    string
}

type InferenceInfo struct {
	Computes             []InferenceCompute
	DefaultContextLength int
}

func New(s *store.Store, devMode bool) *Server {
	p := resolvePath("ollama")
	return &Server{store: s, bin: p, dev: devMode, restartCh: make(chan struct{}, 1)}
}

func (s *Server) RestartCh() chan struct{} {
	return s.restartCh
}

func resolvePath(name string) string {
	// look in the app bundle first
	if exe, _ := os.Executable(); exe != "" {
		var dir string
		if runtime.GOOS == "windows" {
			dir = filepath.Dir(exe)
		} else {
			dir = filepath.Join(filepath.Dir(exe), "..", "Resources")
		}
		if _, err := os.Stat(filepath.Join(dir, name)); err == nil {
			return filepath.Join(dir, name)
		}
	}

	// check the development dist path
	for _, path := range []string{
		filepath.Join("dist", runtime.GOOS, name),
		filepath.Join("dist", runtime.GOOS+"-"+runtime.GOARCH, name),
	} {
		if _, err := os.Stat(path); err == nil {
			return path
		}
	}

	// fallback to system path
	if p, _ := exec.LookPath(name); p != "" {
		return p
	}

	return name
}

func ollamaServeArgs(args []string) bool {
	if len(args) < 2 {
		return false
	}

	switch strings.Trim(filepath.Base(args[0]), `"`) {
	case "ollama", "ollama.exe":
	default:
		return false
	}

	for _, rawArg := range args[1:] {
		arg := strings.Trim(rawArg, `"`)
		if strings.HasPrefix(arg, "-") {
			continue
		}

		return arg == "serve" || arg == "start"
	}

	return false
}

// findFreePort asks the OS for an available TCP port.
func findFreePort() (string, error) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return "", fmt.Errorf("failed to find free port: %w", err)
	}
	port := strconv.Itoa(l.Addr().(*net.TCPAddr).Port)
	l.Close()
	return port, nil
}

// cleanup checks the pid file for a running ollama process
// and shuts it down gracefully if it is running
func cleanup() error {
	data, err := os.ReadFile(pidFile)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	defer os.Remove(pidFile)

	pid, err := strconv.Atoi(strings.TrimSpace(string(data)))
	if err != nil {
		return err
	}

	proc, err := os.FindProcess(pid)
	if err != nil {
		return nil
	}

	ok, err := terminated(pid)
	if err != nil {
		slog.Debug("cleanup: error checking if terminated", "pid", pid, "err", err)
	}
	if ok {
		return nil
	}

	slog.Info("detected previous ollama process, cleaning up", "pid", pid)
	return stop(proc)
}

// stop waits for a process with the provided pid to exit by polling
// `terminated(pid)`. If the process has not exited within 5 seconds, it logs a
// warning and kills the process.
func stop(proc *os.Process) error {
	if proc == nil {
		return nil
	}

	if err := terminate(proc); err != nil {
		slog.Warn("graceful terminate failed, killing", "err", err)
		return proc.Kill()
	}

	deadline := time.NewTimer(5 * time.Second)
	defer deadline.Stop()

	for {
		select {
		case <-deadline.C:
			slog.Warn("timeout waiting for graceful shutdown; killing", "pid", proc.Pid)
			return proc.Kill()
		default:
			ok, err := terminated(proc.Pid)
			if err != nil {
				slog.Error("error checking if ollama process is terminated", "err", err)
				return err
			}
			if ok {
				return nil
			}
			time.Sleep(10 * time.Millisecond)
		}
	}
}

func (s *Server) Run(ctx context.Context) error {
	port, err := findFreePort()
	if err != nil {
		return err
	}
	s.port = port
	slog.Info("Dromadaire: internal ollama server will use port", "port", s.port)

	l, err := openRotatingLog()
	if err != nil {
		return err
	}
	s.log = l
	defer s.log.Close()

	if err := cleanup(); err != nil {
		slog.Warn("failed to cleanup previous ollama process", "err", err)
	}

	reaped := false
	for ctx.Err() == nil {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(restartDelay):
		}

		InvalidateInferenceCache()

		cmd, err := s.cmd(ctx)
		if err != nil {
			return err
		}

		if err := cmd.Start(); err != nil {
			return err
		}

		err = os.WriteFile(pidFile, []byte(strconv.Itoa(cmd.Process.Pid)), 0o644)
		if err != nil {
			slog.Warn("failed to write pid file", "file", pidFile, "err", err)
		}

		waitCh := make(chan error, 1)
		go func() { waitCh <- cmd.Wait() }()

		select {
		case <-ctx.Done():
			slog.Info("Dromadaire: context cancelled, stopping server")
			stop(cmd.Process)
			<-waitCh
			return ctx.Err()
		case <-s.restartCh:
			slog.Info("Dromadaire: restart requested, stopping current server")
			stop(cmd.Process)
			<-waitCh
			continue
		case err = <-waitCh:
		}

		if err != nil && !errors.Is(err, context.Canceled) {
			var exitErr *exec.ExitError
			if errors.As(err, &exitErr) && exitErr.ExitCode() == 1 && !s.dev && !reaped {
				reaped = true
				if err := reapServers(); err != nil {
					slog.Warn("failed to stop existing ollama server", "err", err)
				} else {
					slog.Debug("conflicting server stopped, waiting for port to be released")
					continue
				}
			}
			slog.Error("ollama exited", "err", err)
		}
	}
	return ctx.Err()
}

func (s *Server) cmd(ctx context.Context) (*exec.Cmd, error) {
	settings, err := s.store.Settings()
	if err != nil {
		return nil, err
	}

	cloudDisabled, err := s.store.CloudDisabled()
	if err != nil {
		return nil, err
	}

	cmd := commandContext(ctx, s.bin, "serve")
	cmd.Stdout, cmd.Stderr = s.log, s.log

	env := map[string]string{}
	for _, kv := range os.Environ() {
		s := strings.SplitN(kv, "=", 2)
		if len(s) != 2 {
			continue
		}
		env[s[0]] = s[1]
	}

	if settings.Expose {
		env["OLLAMA_HOST"] = "0.0.0.0:" + s.port
	} else {
		env["OLLAMA_HOST"] = "127.0.0.1:" + s.port
	}
	os.Setenv("OLLAMA_HOST", env["OLLAMA_HOST"])

	if settings.Browser {
		env["OLLAMA_ORIGINS"] = "*"
	}
	if settings.Models != "" {
		if _, err := os.Stat(settings.Models); err == nil {
			env["OLLAMA_MODELS"] = settings.Models
		} else {
			slog.Warn("models path not accessible, using default", "path", settings.Models, "err", err)
		}
	}
	if settings.ContextLength > 0 {
		env["OLLAMA_CONTEXT_LENGTH"] = strconv.Itoa(settings.ContextLength)
	}
	if cloudDisabled {
		env["OLLAMA_NO_CLOUD"] = "1"
	} else {
		env["OLLAMA_NO_CLOUD"] = "0"
	}

	if settings.NumThread > 0 {
		env["OLLAMA_NUM_THREAD"] = strconv.Itoa(settings.NumThread)
	} else if _, ok := env["OLLAMA_NUM_THREAD"]; !ok {
		env["OLLAMA_NUM_THREAD"] = strconv.Itoa(max(1, runtime.NumCPU()-1))
	}

	if settings.KeepAlive != "" {
		env["OLLAMA_KEEP_ALIVE"] = settings.KeepAlive
	} else if _, ok := env["OLLAMA_KEEP_ALIVE"]; !ok {
		env["OLLAMA_KEEP_ALIVE"] = "2m"
	}

	if settings.MaxLoadedModels > 0 {
		env["OLLAMA_MAX_LOADED_MODELS"] = strconv.Itoa(settings.MaxLoadedModels)
	} else if ramGB := GetTotalRAMGB(); ramGB > 0 && ramGB <= 16 {
		if _, ok := env["OLLAMA_MAX_LOADED_MODELS"]; !ok {
			slog.Info("Dromadaire: limiting to 1 loaded model", "total_ram_gb", fmt.Sprintf("%.1f", ramGB))
			env["OLLAMA_MAX_LOADED_MODELS"] = "1"
		}
	}

	if settings.NumBatch > 0 {
		env["OLLAMA_NUM_BATCH"] = strconv.Itoa(settings.NumBatch)
	} else if _, ok := env["OLLAMA_NUM_BATCH"]; !ok {
		env["OLLAMA_NUM_BATCH"] = "256"
	}

	if settings.KVCacheType != "" {
		env["OLLAMA_KV_CACHE_TYPE"] = settings.KVCacheType
	} else if _, ok := env["OLLAMA_KV_CACHE_TYPE"]; !ok {
		env["OLLAMA_KV_CACHE_TYPE"] = "q8_0"
	}

	if _, ok := env["OLLAMA_MAX_QUEUE"]; !ok {
		env["OLLAMA_MAX_QUEUE"] = "16"
	}

	if _, ok := env["OLLAMA_FLASH_ATTENTION"]; !ok {
		env["OLLAMA_FLASH_ATTENTION"] = "true"
	}

	if settings.VulkanEnabled {
		env["OLLAMA_VULKAN"] = "1"
		env["OLLAMA_IGPU_ENABLE"] = "1"
		slog.Info("Dromadaire: Vulkan GPU backend enabled via settings (iGPU allowed)")
	}

	if settings.NumParallel > 0 {
		env["OLLAMA_NUM_PARALLEL"] = strconv.Itoa(settings.NumParallel)
	}

	env["OLLAMA_UPDATE_CHECK"] = "false"

	{
		ramGB := GetTotalRAMGB()
		ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
		computes, _ := GetInferenceComputer(ctx)
		cancel()

		hasGPU := false
		gpuVRAM := ""
		for _, ic := range computes {
			if ic.Library != "cpu" && ic.Library != "" {
				hasGPU = true
				gpuVRAM = ic.VRAM
				break
			}
		}

		var maxCtx int
		if hasGPU {
			vramGB := parseVRAMGB(gpuVRAM)
			switch {
			case vramGB >= 24:
				maxCtx = 16384
			case vramGB >= 16:
				maxCtx = 8192
			case vramGB >= 8:
				maxCtx = 4096
			default:
				maxCtx = 2048
			}
		} else {
			switch {
			case ramGB > 64:
				maxCtx = 8192
			case ramGB > 32:
				maxCtx = 4096
			case ramGB > 16:
				maxCtx = 2048
			default:
				maxCtx = 2048
			}
		}

		if ctxStr, ok := env["OLLAMA_CONTEXT_LENGTH"]; ok {
			if ctx, err := strconv.Atoi(ctxStr); err == nil && ctx > maxCtx {
				slog.Info("Dromadaire: capping context length for hardware",
					"requested", ctx, "capped", maxCtx,
					"ram_gb", fmt.Sprintf("%.1f", ramGB),
					"has_gpu", hasGPU, "vram", gpuVRAM)
				env["OLLAMA_CONTEXT_LENGTH"] = strconv.Itoa(maxCtx)
			}
		} else {
			env["OLLAMA_CONTEXT_LENGTH"] = strconv.Itoa(maxCtx)
		}

		slog.Info("Dromadaire: context length configured",
			"max_ctx", maxCtx, "has_gpu", hasGPU, "vram", gpuVRAM,
			"ram_gb", fmt.Sprintf("%.1f", ramGB))
	}

	cmd.Env = []string{}
	for k, v := range env {
		cmd.Env = append(cmd.Env, k+"="+v)
	}

	cmd.Cancel = func() error {
		if cmd.Process == nil {
			return nil
		}
		return stop(cmd.Process)
	}

	return cmd, nil
}

func openRotatingLog() (io.WriteCloser, error) {
	dir := filepath.Dir(serverLogPath)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("create log directory: %w", err)
	}

	logrotate.Rotate(serverLogPath)
	f, err := os.OpenFile(serverLogPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return nil, fmt.Errorf("open log file: %w", err)
	}
	return f, nil
}

// GetInferenceInfo retrieves inference compute information from the server log (upstream API).
func GetInferenceInfo(ctx context.Context) (*InferenceInfo, error) {
	info := &InferenceInfo{}
	computeMarker := regexp.MustCompile(`inference compute.*library=`)
	defaultCtxMarker := regexp.MustCompile(`vram-based default context`)
	defaultCtxRegex := regexp.MustCompile(`default_num_ctx=(\d+)`)

	q := `inference compute.*%s=["]([^"]*)["]`
	nq := `inference compute.*%s=(\S+)\s`
	type regex struct {
		q  *regexp.Regexp
		nq *regexp.Regexp
	}
	regexes := map[string]regex{
		"library": {
			q:  regexp.MustCompile(fmt.Sprintf(q, "library")),
			nq: regexp.MustCompile(fmt.Sprintf(nq, "library")),
		},
		"variant": {
			q:  regexp.MustCompile(fmt.Sprintf(q, "variant")),
			nq: regexp.MustCompile(fmt.Sprintf(nq, "variant")),
		},
		"compute": {
			q:  regexp.MustCompile(fmt.Sprintf(q, "compute")),
			nq: regexp.MustCompile(fmt.Sprintf(nq, "compute")),
		},
		"driver": {
			q:  regexp.MustCompile(fmt.Sprintf(q, "driver")),
			nq: regexp.MustCompile(fmt.Sprintf(nq, "driver")),
		},
		"name": {
			q:  regexp.MustCompile(fmt.Sprintf(q, "name")),
			nq: regexp.MustCompile(fmt.Sprintf(nq, "name")),
		},
		"total": {
			q:  regexp.MustCompile(fmt.Sprintf(q, "total")),
			nq: regexp.MustCompile(fmt.Sprintf(nq, "total")),
		},
	}
	get := func(field, line string) string {
		regex, ok := regexes[field]
		if !ok {
			slog.Warn("missing field", "field", field)
			return ""
		}
		match := regex.q.FindStringSubmatch(line)

		if len(match) > 1 {
			return match[1]
		}
		match = regex.nq.FindStringSubmatch(line)
		if len(match) > 1 {
			return match[1]
		}
		return ""
	}
	for {
		select {
		case <-ctx.Done():
			return nil, fmt.Errorf("timeout scanning server log for inference compute details")
		default:
		}
		file, err := os.Open(serverLogPath)
		if err != nil {
			slog.Debug("failed to open server log", "log", serverLogPath, "error", err)
			time.Sleep(time.Second)
			continue
		}
		defer file.Close()
		scanner := bufio.NewScanner(file)
		for scanner.Scan() {
			line := scanner.Text()
			if computeMarker.MatchString(line) {
				ic := InferenceCompute{
					Library: get("library", line),
					Variant: get("variant", line),
					Compute: get("compute", line),
					Driver:  get("driver", line),
					Name:    get("name", line),
					VRAM:    get("total", line),
				}

				slog.Info("Matched", "inference compute", ic)
				info.Computes = append(info.Computes, ic)
				continue
			}
			if defaultCtxMarker.MatchString(line) {
				match := defaultCtxRegex.FindStringSubmatch(line)
				if len(match) > 1 {
					numCtx, err := strconv.Atoi(match[1])
					if err == nil {
						info.DefaultContextLength = numCtx
						slog.Info("Matched default context length", "default_num_ctx", numCtx)
					}
				}
				return info, nil
			}
			if len(info.Computes) > 0 {
				return info, nil
			}
		}
		time.Sleep(100 * time.Millisecond)
	}
}

// ========== Inference Compute Cache (Dromadaire) ==========

var (
	inferenceCache     []InferenceCompute
	inferenceCacheTime time.Time
	inferenceCacheMu   sync.RWMutex
	inferenceScanMu    sync.Mutex
)

const inferenceCacheTTL = 30 * time.Second

func InvalidateInferenceCache() {
	inferenceCacheMu.Lock()
	inferenceCache = nil
	inferenceCacheTime = time.Time{}
	inferenceCacheMu.Unlock()
}

func GetInferenceComputer(ctx context.Context) ([]InferenceCompute, error) {
	inferenceCacheMu.RLock()
	if inferenceCache != nil && time.Since(inferenceCacheTime) < inferenceCacheTTL {
		result := inferenceCache
		inferenceCacheMu.RUnlock()
		return result, nil
	}
	inferenceCacheMu.RUnlock()

	inferenceScanMu.Lock()
	defer inferenceScanMu.Unlock()

	inferenceCacheMu.RLock()
	if inferenceCache != nil && time.Since(inferenceCacheTime) < inferenceCacheTTL {
		result := inferenceCache
		inferenceCacheMu.RUnlock()
		return result, nil
	}
	inferenceCacheMu.RUnlock()

	result, err := scanInferenceCompute(ctx)
	if err != nil {
		return nil, err
	}

	inferenceCacheMu.Lock()
	inferenceCache = result
	inferenceCacheTime = time.Now()
	inferenceCacheMu.Unlock()

	return result, nil
}

func scanInferenceCompute(ctx context.Context) ([]InferenceCompute, error) {
	inference := []InferenceCompute{}
	marker := regexp.MustCompile(`inference compute.*library=`)
	q := `inference compute.*%s=["]([^"]*)["]`
	nq := `inference compute.*%s=(\S+)\s`
	type regex struct {
		q  *regexp.Regexp
		nq *regexp.Regexp
	}
	regexes := map[string]regex{
		"library": {
			q:  regexp.MustCompile(fmt.Sprintf(q, "library")),
			nq: regexp.MustCompile(fmt.Sprintf(nq, "library")),
		},
		"variant": {
			q:  regexp.MustCompile(fmt.Sprintf(q, "variant")),
			nq: regexp.MustCompile(fmt.Sprintf(nq, "variant")),
		},
		"compute": {
			q:  regexp.MustCompile(fmt.Sprintf(q, "compute")),
			nq: regexp.MustCompile(fmt.Sprintf(nq, "compute")),
		},
		"driver": {
			q:  regexp.MustCompile(fmt.Sprintf(q, "driver")),
			nq: regexp.MustCompile(fmt.Sprintf(nq, "driver")),
		},
		"name": {
			q:  regexp.MustCompile(fmt.Sprintf(q, "name")),
			nq: regexp.MustCompile(fmt.Sprintf(nq, "name")),
		},
		"total": {
			q:  regexp.MustCompile(fmt.Sprintf(q, "total")),
			nq: regexp.MustCompile(fmt.Sprintf(nq, "total")),
		},
	}
	get := func(field, line string) string {
		regex, ok := regexes[field]
		if !ok {
			slog.Warn("missing field", "field", field)
			return ""
		}
		match := regex.q.FindStringSubmatch(line)

		if len(match) > 1 {
			return match[1]
		}
		match = regex.nq.FindStringSubmatch(line)
		if len(match) > 1 {
			return match[1]
		}
		return ""
	}
	for {
		select {
		case <-ctx.Done():
			return nil, fmt.Errorf("timeout scanning server log for inference compute details")
		default:
		}
		file, err := os.Open(serverLogPath)
		if err != nil {
			slog.Debug("failed to open server log", "log", serverLogPath, "error", err)
			time.Sleep(time.Second)
			continue
		}

		scanner := bufio.NewScanner(file)
		var found bool
		for scanner.Scan() {
			line := scanner.Text()
			match := marker.FindStringSubmatch(line)
			if len(match) > 0 {
				ic := InferenceCompute{
					Library: get("library", line),
					Variant: get("variant", line),
					Compute: get("compute", line),
					Driver:  get("driver", line),
					Name:    get("name", line),
					VRAM:    get("total", line),
				}

				slog.Info("Matched", "inference compute", ic)
				inference = append(inference, ic)
			} else {
				if len(inference) > 0 {
					found = true
					break
				}
			}
		}
		file.Close()

		if found {
			return inference, nil
		}
		time.Sleep(100 * time.Millisecond)
	}
}

func parseVRAMGB(vram string) float64 {
	vram = strings.TrimSpace(strings.ToLower(vram))
	if vram == "" {
		return 0
	}
	for _, suffix := range []string{" gb", " gib"} {
		if strings.HasSuffix(vram, suffix) {
			numStr := strings.TrimSpace(strings.TrimSuffix(vram, suffix))
			if v, err := strconv.ParseFloat(numStr, 64); err == nil {
				return v
			}
		}
	}
	for _, suffix := range []string{" mb", " mib"} {
		if strings.HasSuffix(vram, suffix) {
			numStr := strings.TrimSpace(strings.TrimSuffix(vram, suffix))
			if v, err := strconv.ParseFloat(numStr, 64); err == nil {
				return v / 1024
			}
		}
	}
	if v, err := strconv.ParseFloat(vram, 64); err == nil {
		return v
	}
	return 0
}

func GetServerLogPath() string {
	return serverLogPath
}

func GetLastLogLines(n int) []string {
	file, err := os.Open(serverLogPath)
	if err != nil {
		return []string{fmt.Sprintf("[erreur lecture log: %v]", err)}
	}
	defer file.Close()

	const maxRead = 1 << 20
	fi, err := file.Stat()
	if err != nil {
		return []string{fmt.Sprintf("[erreur stat log: %v]", err)}
	}
	if fi.Size() > maxRead {
		if _, err := file.Seek(fi.Size()-maxRead, io.SeekStart); err != nil {
			return []string{fmt.Sprintf("[erreur seek log: %v]", err)}
		}
	}

	var lines []string
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		lines = append(lines, scanner.Text())
	}

	if fi.Size() > maxRead && len(lines) > 0 {
		lines = lines[1:]
	}

	if len(lines) > n {
		lines = lines[len(lines)-n:]
	}
	return lines
}

func (s *Server) GetPort() string {
	return s.port
}
