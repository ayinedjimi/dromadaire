package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
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
var lamazeroState struct {
	mu   sync.Mutex
	path string
	lo   lamazero.LoadOptions
	sess *lamazero.Session
	idle *time.Timer
}

// lamazeroSession returns a session for path/lo, reloading when either
// changes. The caller must hold lamazeroState.mu.
func lamazeroSession(path string, lo lamazero.LoadOptions) (*lamazero.Session, error) {
	st := &lamazeroState
	if st.sess != nil && st.path == path && st.lo == lo {
		return st.sess, nil
	}
	if st.sess != nil {
		st.sess.Close()
		st.sess = nil
	}
	sess, err := lamazero.Load(path, lo)
	if err != nil {
		return nil, err
	}
	st.sess, st.path, st.lo = sess, path, lo
	return sess, nil
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
//	unset / "f16" : official engine, F16 cache (default)
//	"turbo3"      : TurboQuant engine, compressed 3-bit cache
//	"turbo4"      : TurboQuant engine, compressed 4-bit cache
func applyKVCacheSetting(lo *lamazero.LoadOptions) {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("DROMADAIRE_LAMAZERO_KV"))) {
	case "turbo3":
		lo.Engine, lo.KVTypeK, lo.KVTypeV = lamazero.EngineTurbo, lamazero.KVTypeTurbo3, lamazero.KVTypeTurbo3
	case "turbo4":
		lo.Engine, lo.KVTypeK, lo.KVTypeV = lamazero.EngineTurbo, lamazero.KVTypeTurbo4, lamazero.KVTypeTurbo4
	}
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
