package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/ollama/ollama/api"
	"github.com/ollama/ollama/lamazero"
	"github.com/ollama/ollama/llm"
	"github.com/ollama/ollama/ml"
	"github.com/ollama/ollama/types/model"
)

// lamazeroNamespace marks models served by the CPU engine lamazero.
// Example: `ollama cp qwen2.5:0.5b lamazero/qwen2.5:0.5b` creates such a model
// without copying the weights (the GGUF blob is shared).
const lamazeroNamespace = "lamazero"

// lamazeroIdleUnload is how long a loaded lamazero model stays in memory
// after its last request.
const lamazeroIdleUnload = 5 * time.Minute

// lamazeroJSONGrammar constrains the output to a JSON object (format "json").
const lamazeroJSONGrammar = `root ::= object
value ::= object | array | string | number | ("true" | "false" | "null") ws
object ::= "{" ws ( string ":" ws value ("," ws string ":" ws value)* )? "}" ws
array ::= "[" ws ( value ("," ws value)* )? "]" ws
string ::= "\"" ( [^"\\\x7F\x00-\x1F] | "\\" (["\\/bfnrt] | "u" [0-9a-fA-F] [0-9a-fA-F] [0-9a-fA-F] [0-9a-fA-F]) )* "\"" ws
number ::= ("-"? ([0-9] | [1-9] [0-9]*)) ("." [0-9]+)? ([eE] [-+]? [0-9]+)? ws
ws ::= [ \t\n]*`

var errLamazeroUnsupported = errors.New("lamazero: operation non prise en charge par le moteur CPU")

func isLamazeroName(n model.Name) bool {
	return strings.EqualFold(n.Namespace, lamazeroNamespace)
}

// lamazeroState keeps one loaded model. Requests are serialized because a
// session runs one generation at a time.
//
// reqLo stores the options as requested by the caller. effectiveLo stores
// the options actually used (which may differ after a turbo->official fallback).
// Reuse is decided by comparing reqLo so that a repeated request with the same
// caller options does not trigger a redundant reload.
var lamazeroState struct {
	mu          sync.Mutex
	path        string
	reqLo       lamazero.LoadOptions
	effectiveLo lamazero.LoadOptions
	sess        *lamazero.Session
	idle        *time.Timer
}

// lamazeroLoadFunc is the function used to load a model. Tests replace it
// with a fake to simulate engine failures without real DLLs.
var lamazeroLoadFunc = lamazero.Load

// lamazeroSession returns a session for path/lo, reloading when either
// changes. The caller must hold lamazeroState.mu.
//
// When the engine setting is "auto" and the selected engine fails to load
// (e.g. TurboQuant does not support the model's architecture), the function
// falls back to the official engine with an F16 KV cache. An explicit
// "turbo" setting does not fall back - the error is returned as-is.
//
// Reuse is decided by comparing the requested options (reqLo), not the
// effective ones, so that a turbo->official fallback does not trigger a
// reload on the next identical request.
func lamazeroSession(path string, lo lamazero.LoadOptions) (*lamazero.Session, error) {
	st := &lamazeroState
	if st.sess != nil && st.path == path && st.reqLo == lo {
		return st.sess, nil
	}
	if st.sess != nil {
		st.sess.Close()
		st.sess = nil
	}
	effective := lo
	sess, err := lamazeroLoadFunc(path, effective)
	if err != nil && effective.Engine == lamazero.EngineTurbo && isAutoEngine() {
		slog.Warn("lamazero: turbo engine failed, falling back to official with F16 cache",
			"path", path, "error", err)
		effective.Engine = lamazero.EngineOfficial
		effective.KVTypeK = -1
		effective.KVTypeV = -1
		sess, err = lamazeroLoadFunc(path, effective)
	}
	if err != nil {
		return nil, err
	}
	st.sess = sess
	st.path = path
	st.reqLo = lo
	st.effectiveLo = effective
	return sess, nil
}

// isAutoEngine returns true when the engine setting is "auto" or unset
// (meaning the system chose the engine automatically, so a fallback is acceptable).
func isAutoEngine() bool {
	engine := strings.ToLower(strings.TrimSpace(os.Getenv("DROMADAIRE_LAMAZERO_ENGINE")))
	return engine == "" || engine == "auto"
}

// lamazeroTouchIdle (re)arms the idle unload timer. Caller holds the mutex.
func lamazeroTouchIdle() {
	st := &lamazeroState
	if st.idle == nil {
		st.idle = time.AfterFunc(lamazeroIdleUnload, lamazeroUnload)
		return
	}
	st.idle.Reset(lamazeroIdleUnload)
}

// lamazeroUnload frees the loaded model.
func lamazeroUnload() {
	lamazeroState.mu.Lock()
	defer lamazeroState.mu.Unlock()
	if lamazeroState.sess != nil {
		lamazeroState.sess.Close()
		lamazeroState.sess = nil
		lamazeroState.path = ""
		lamazeroState.reqLo = lamazero.LoadOptions{}
		lamazeroState.effectiveLo = lamazero.LoadOptions{}
	}
}

// lamazeroRunner adapts the lamazero engine to llm.LlamaServer, so the chat
// handler uses the same rendering and streaming path as GPU models.
type lamazeroRunner struct {
	path string
	opts api.Options
}

var _ llm.LlamaServer = (*lamazeroRunner)(nil)

func (l *lamazeroRunner) ModelPath() string { return l.path }

func (l *lamazeroRunner) Load(ctx context.Context, systemInfo ml.SystemInfo, gpus []ml.DeviceInfo, requireFull bool) ([]ml.DeviceID, error) {
	return nil, nil
}

func (l *lamazeroRunner) Ping(ctx context.Context) error { return nil }

func (l *lamazeroRunner) WaitUntilRunning(ctx context.Context) error { return nil }

// loadOptionsFor maps Dromadaire options to lamazero load parameters.
func loadOptionsFor(o api.Options) lamazero.LoadOptions {
	lo := lamazero.DefaultLoadOptions()
	lo.NumCtx = o.NumCtx
	lo.NumThreads = o.NumThread
	lo.NumBatch = o.NumBatch
	applyKVCacheSetting(&lo)
	return lo
}

// applyKVCacheSetting selects the KV cache type from DROMADAIRE_LAMAZERO_KV:
//
//	DROMADAIRE_LAMAZERO_ENGINE : "auto" (default), "official" or "turbo"
//	DROMADAIRE_LAMAZERO_KV     : "f16" (default), "turbo3" or "turbo4"
//
// "auto" picks the TurboQuant engine when a compressed cache is requested and
// the official engine otherwise. "official" cannot use the TurboQuant cache
// types, so the cache falls back to F16 in that case.
func applyKVCacheSetting(lo *lamazero.LoadOptions) {
	kv := strings.ToLower(strings.TrimSpace(os.Getenv("DROMADAIRE_LAMAZERO_KV")))
	engine := strings.ToLower(strings.TrimSpace(os.Getenv("DROMADAIRE_LAMAZERO_ENGINE")))

	var kvType int
	switch kv {
	case "turbo3":
		kvType = lamazero.KVTypeTurbo3
	case "turbo4":
		kvType = lamazero.KVTypeTurbo4
	default:
		kvType = -1 // F16
	}

	switch engine {
	case "official":
		lo.Engine = lamazero.EngineOfficial
		if kvType >= 0 {
			kvType = -1
		}
	case "turbo":
		lo.Engine = lamazero.EngineTurbo
	default: // auto
		if kvType >= 0 {
			lo.Engine = lamazero.EngineTurbo
		} else {
			lo.Engine = lamazero.EngineOfficial
		}
	}
	lo.KVTypeK, lo.KVTypeV = kvType, kvType
}

// samplingFor maps Dromadaire options to lamazero sampling parameters.
func samplingFor(o api.Options, format json.RawMessage) lamazero.SamplingOptions {
	so := lamazero.DefaultSamplingOptions()
	so.Temperature = o.Temperature
	so.TopK = o.TopK
	so.TopP = o.TopP
	so.MinP = o.MinP
	so.RepeatPenalty = o.RepeatPenalty
	so.RepeatLastN = o.RepeatLastN
	so.PresencePenalty = o.PresencePenalty
	so.FrequencyPenalty = o.FrequencyPenalty
	if o.Seed > 0 {
		so.Seed = uint32(o.Seed)
	}
	if string(format) == `"json"` {
		so.Grammar = lamazeroJSONGrammar
	}
	return so
}

// stopHoldback emits text while keeping back the tail that could still be the
// beginning of a stop sequence. It never splits a UTF-8 character.
type stopHoldback struct {
	stops []string
	held  string
	max   int
	fn    func(llm.CompletionResponse)
	hit   bool
}

func newStopHoldback(stops []string, fn func(llm.CompletionResponse)) *stopHoldback {
	h := &stopHoldback{fn: fn}
	for _, s := range stops {
		if s == "" {
			continue
		}
		h.stops = append(h.stops, s)
		if len(s) > h.max {
			h.max = len(s)
		}
	}
	return h
}

func (h *stopHoldback) emit(text string) {
	if text != "" {
		h.fn(llm.CompletionResponse{Content: text})
	}
}

// push returns false when a stop sequence was found (generation must stop).
func (h *stopHoldback) push(piece string) bool {
	h.held += piece
	idx := -1
	for _, s := range h.stops {
		if i := strings.Index(h.held, s); i >= 0 && (idx < 0 || i < idx) {
			idx = i
		}
	}
	if idx >= 0 {
		h.emit(h.held[:idx])
		h.held = ""
		h.hit = true
		return false
	}
	if h.max == 0 {
		// Pas de séquence d'arrêt : rien à retenir.
		h.emit(h.held)
		h.held = ""
		return true
	}
	safe := len(h.held) - (h.max - 1)
	for safe > 0 && safe < len(h.held) && !utf8.RuneStart(h.held[safe]) {
		safe--
	}
	if safe > 0 {
		h.emit(h.held[:safe])
		h.held = h.held[safe:]
	}
	return true
}

// flush emits what is still held, when no stop sequence was hit.
func (h *stopHoldback) flush() {
	if !h.hit {
		h.emit(h.held)
	}
	h.held = ""
}

// Completion generates text from an already formatted prompt on the CPU.
func (l *lamazeroRunner) Completion(ctx context.Context, req llm.CompletionRequest, fn func(llm.CompletionResponse)) error {
	if len(req.Media) > 0 {
		return errors.New("lamazero: les images ne sont pas prises en charge")
	}

	lamazeroState.mu.Lock()
	defer lamazeroState.mu.Unlock()
	defer lamazeroTouchIdle()

	sess, err := lamazeroSession(l.path, loadOptionsFor(l.opts))
	if err != nil {
		return err
	}
	if err := sess.SetSampling(samplingFor(l.opts, req.Format)); err != nil {
		return err
	}

	maxTokens := l.opts.NumPredict
	if maxTokens <= 0 {
		maxTokens = 512
	}

	holdback := newStopHoldback(l.opts.Stop, fn)
	stats, err := sess.ChatStream(req.Prompt, maxTokens, 0, func(piece string) bool {
		if ctx.Err() != nil {
			return false
		}
		return holdback.push(piece)
	})
	if holdback.hit {
		err = nil // arrêt volontaire sur séquence d'arrêt
	}
	if ctxErr := ctx.Err(); ctxErr != nil && err != nil {
		return ctxErr
	}
	if err != nil {
		return fmt.Errorf("%w", err)
	}
	holdback.flush()

	fn(llm.CompletionResponse{
		Done:         true,
		DoneReason:   llm.DoneReasonStop,
		EvalCount:    stats.Generated,
		EvalDuration: stats.Elapsed,
	})
	return nil
}

func (l *lamazeroRunner) Chat(ctx context.Context, req llm.ChatRequest, fn func(llm.ChatResponse)) error {
	return errLamazeroUnsupported
}

func (l *lamazeroRunner) ApplyChatTemplate(ctx context.Context, req llm.ChatRequest) (string, error) {
	return "", errLamazeroUnsupported
}

func (l *lamazeroRunner) Embedding(ctx context.Context, input string) ([]float32, int, error) {
	return nil, 0, errLamazeroUnsupported
}

func (l *lamazeroRunner) Tokenize(ctx context.Context, content string) ([]int, error) {
	return nil, errLamazeroUnsupported
}

func (l *lamazeroRunner) Detokenize(ctx context.Context, tokens []int) (string, error) {
	return "", errLamazeroUnsupported
}

func (l *lamazeroRunner) Close() error { return nil }

func (l *lamazeroRunner) MemorySize() (total, vram uint64) { return 0, 0 }

func (l *lamazeroRunner) VRAMByGPU(id ml.DeviceID) uint64 { return 0 }

func (l *lamazeroRunner) Pid() int { return -1 }

func (l *lamazeroRunner) GetPort() int { return 0 }

func (l *lamazeroRunner) GetDeviceInfos(ctx context.Context) []ml.DeviceInfo { return nil }

func (l *lamazeroRunner) HasExited() bool { return false }

func (l *lamazeroRunner) ContextLength() int { return l.opts.NumCtx }

// lamazeroRunnerFor builds the CPU runner for a lamazero/ model. It does not
// touch the GPU scheduler.
func (s *Server) lamazeroRunnerFor(name model.Name, m *Model, requestOpts map[string]any) (llm.LlamaServer, *api.Options, error) {
	if m == nil || m.ModelPath == "" || !m.isGGUF() {
		return nil, nil, fmt.Errorf("lamazero: le modele %s n'est pas un GGUF local", name.String())
	}
	opts, err := s.modelOptions(m, requestOpts)
	if err != nil {
		return nil, nil, err
	}
	return &lamazeroRunner{path: m.ModelPath, opts: opts}, &opts, nil
}
