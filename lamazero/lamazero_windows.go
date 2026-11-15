//go:build windows

// Package lamazero is an optional inference engine backed by lamazero.dll
// (llama.cpp absorbed statically, API v3). The DLL is loaded at runtime with
// LoadLibrary, so the application starts normally when it is absent, and the
// existing GPU engine is not affected.
package lamazero

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"syscall"
	"time"
	"unicode/utf8"
	"unsafe"
)

// ErrUnavailable is returned when lamazero.dll cannot be found or loaded.
var ErrUnavailable = errors.New("lamazero: moteur CPU indisponible")

const dllName = "lamazero.dll"

// Status codes mirrored from lamazero.h.
const (
	statusOK         = 0
	statusInvalidArg = -1
	statusOOM        = -2
	statusLoadFailed = -3
	statusTokenize   = -4
	statusDecode     = -5
	statusAborted    = -6
	statusTimeout    = -7
	statusBusy       = -8
	statusInternal   = -9
)

var statusText = map[int]string{
	statusInvalidArg: "argument invalide ou contexte depasse",
	statusOOM:        "memoire insuffisante",
	statusLoadFailed: "echec du chargement du modele",
	statusTokenize:   "echec de la tokenisation",
	statusDecode:     "echec de la generation",
	statusAborted:    "generation interrompue",
	statusTimeout:    "delai depasse",
	statusBusy:       "moteur occupe",
	statusInternal:   "erreur interne",
}

// StatusError converts a negative lamazero status into a Go error.
func StatusError(op string, status int) error {
	text, ok := statusText[status]
	if !ok {
		text = fmt.Sprintf("code %d", status)
	}
	return fmt.Errorf("lamazero %s: %s", op, text)
}

// LoadOptions are the parameters used when loading a model. Zero or negative
// values keep the llama.cpp / lamazero default (see DefaultLoadOptions).
type LoadOptions struct {
	NumCtx     int  // 0 = model default
	NumThreads int  // 0 = auto
	NumBatch   int  // 0 = auto
	FlashAttn  int  // -1 auto, 0 off, 1 on
	KVTypeK    int  // ggml_type of the K cache, -1 = F16
	KVTypeV    int  // ggml_type of the V cache, -1 = F16
	UseMmap    int  // -1 default, 0 off, 1 on
	UseMlock   bool // keep the model resident in RAM
}

// DefaultLoadOptions returns the lamazero defaults.
func DefaultLoadOptions() LoadOptions {
	return LoadOptions{FlashAttn: -1, KVTypeK: -1, KVTypeV: -1, UseMmap: -1}
}

// SamplingOptions control token selection. Zero values are not "defaults":
// use DefaultSamplingOptions and override fields.
type SamplingOptions struct {
	Temperature      float32 // <= 0 : greedy
	TopK             int     // 0 disables
	TopP             float32 // 1 disables
	MinP             float32 // 0 disables
	RepeatPenalty    float32 // 1 disables
	RepeatLastN      int     // 0 disables
	PresencePenalty  float32
	FrequencyPenalty float32
	Seed             uint32 // 0xFFFFFFFF = random
	Grammar          string // GBNF, empty = none
}

// DefaultSamplingOptions matches the sampling of lamazero_quick_load.
func DefaultSamplingOptions() SamplingOptions {
	return SamplingOptions{
		Temperature:   0.7,
		TopK:          40,
		TopP:          0.95,
		RepeatPenalty: 1.15,
		RepeatLastN:   256,
		Seed:          0xFFFFFFFF,
	}
}

// C layouts (must match lamazero.h field by field).
type cLoadParams struct {
	NCtx, NThreads, NBatch, FlashAttn   int32
	KVTypeK, KVTypeV, UseMmap, UseMlock int32
}

type cSamplingParams struct {
	Temperature      float32
	TopK             int32
	TopP             float32
	MinP             float32
	RepeatPenalty    float32
	RepeatLastN      int32
	PresencePenalty  float32
	FrequencyPenalty float32
	Seed             uint32
	Grammar          *byte
}

type engine struct {
	dll             *syscall.DLL
	version         *syscall.Proc
	defaultLoad     *syscall.Proc
	defaultSampling *syscall.Proc
	loadEx          *syscall.Proc
	setSampling     *syscall.Proc
	clearCache      *syscall.Proc
	nCtx            *syscall.Proc
	quickFree       *syscall.Proc
	chatStreamEx    *syscall.Proc
	callback        uintptr
}

var (
	engineOnce sync.Once
	eng        *engine
	engineErr  error
)

// dllPath returns the DLL location: LAMAZERO_DLL if set, otherwise
// lib\lamazero\lamazero.dll next to the executable.
func dllPath() string {
	if p := os.Getenv("LAMAZERO_DLL"); p != "" {
		return p
	}
	exe, err := os.Executable()
	if err != nil {
		return dllName
	}
	return filepath.Join(filepath.Dir(exe), "lib", "lamazero", dllName)
}

func loadEngine() {
	path := dllPath()
	dll, err := syscall.LoadDLL(path)
	if err != nil {
		engineErr = fmt.Errorf("%w: %v", ErrUnavailable, err)
		return
	}
	e := &engine{dll: dll}
	var procErr error
	proc := func(name string) *syscall.Proc {
		if procErr != nil {
			return nil
		}
		var p *syscall.Proc
		p, procErr = dll.FindProc(name)
		return p
	}
	e.version = proc("lamazero_version")
	e.defaultLoad = proc("lamazero_default_load_params")
	e.defaultSampling = proc("lamazero_default_sampling_params")
	e.loadEx = proc("lamazero_load_ex")
	e.setSampling = proc("lamazero_set_sampling")
	e.clearCache = proc("lamazero_clear_cache")
	e.nCtx = proc("lamazero_n_ctx")
	e.quickFree = proc("lamazero_quick_free")
	e.chatStreamEx = proc("lamazero_chat_stream_ex")
	if procErr != nil {
		engineErr = fmt.Errorf("%w: symbole manquant dans %s (API v3 requise): %v", ErrUnavailable, path, procErr)
		return
	}
	e.callback = syscall.NewCallback(tokenDispatch)
	eng = e
}

func getEngine() (*engine, error) {
	engineOnce.Do(loadEngine)
	return eng, engineErr
}

// Version returns the lamazero build string.
func Version() (string, error) {
	e, err := getEngine()
	if err != nil {
		return "", err
	}
	r, _, _ := e.version.Call()
	return cString(r), nil
}

// ---- token callback dispatch -------------------------------------------------
// The C callback has no closure: handlers are registered in a table and the
// integer id is passed as user_data.

var (
	handlersMu sync.Mutex
	handlers   = map[uintptr]func(string) bool{}
	nextID     uintptr
)

func tokenDispatch(piece, tokenIdx, userData uintptr) uintptr {
	handlersMu.Lock()
	fn := handlers[userData]
	handlersMu.Unlock()
	if fn == nil {
		return 1 // unknown handler: abort rather than run unsupervised
	}
	if !fn(cString(piece)) {
		return 1
	}
	return 0
}

func registerHandler(fn func(string) bool) uintptr {
	handlersMu.Lock()
	defer handlersMu.Unlock()
	nextID++
	handlers[nextID] = fn
	return nextID
}

func unregisterHandler(id uintptr) {
	handlersMu.Lock()
	defer handlersMu.Unlock()
	delete(handlers, id)
}

// cString reads a NUL-terminated byte string from C memory.
func cString(p uintptr) string {
	if p == 0 {
		return ""
	}
	var buf []byte
	for i := uintptr(0); ; i++ {
		c := *(*byte)(unsafe.Pointer(p + i)) //nolint:govet // read of DLL-owned C memory
		if c == 0 {
			break
		}
		buf = append(buf, c)
	}
	return string(buf)
}

// completeUTF8Prefix returns the length of the longest prefix of b that does
// not end in the middle of a UTF-8 sequence. Tokens can split multi-byte
// characters, so the rest is kept until the next piece completes it.
func completeUTF8Prefix(b []byte) int {
	i := 0
	for i < len(b) {
		if !utf8.FullRune(b[i:]) {
			break
		}
		_, size := utf8.DecodeRune(b[i:])
		i += size
	}
	return i
}

// ---- session -----------------------------------------------------------------

// Session is a loaded model with its context. Calls on one Session are serialized.
type Session struct {
	mu     sync.Mutex
	handle uintptr
	closed bool
}

// Stats describes one generation.
type Stats struct {
	Generated    int           // tokens generated
	PromptReused int           // prompt tokens already in the KV cache (not recomputed)
	Elapsed      time.Duration // total duration
}

// Load opens a GGUF model with explicit options.
func Load(modelPath string, lo LoadOptions) (*Session, error) {
	e, err := getEngine()
	if err != nil {
		return nil, err
	}
	cpath, err := syscall.BytePtrFromString(modelPath)
	if err != nil {
		return nil, err
	}
	p := cLoadParams{
		NCtx:      int32(lo.NumCtx),
		NThreads:  int32(lo.NumThreads),
		NBatch:    int32(lo.NumBatch),
		FlashAttn: int32(lo.FlashAttn),
		KVTypeK:   int32(lo.KVTypeK),
		KVTypeV:   int32(lo.KVTypeV),
		UseMmap:   int32(lo.UseMmap),
	}
	if lo.UseMlock {
		p.UseMlock = 1
	}
	var status int32
	h, _, _ := e.loadEx.Call(
		uintptr(unsafe.Pointer(cpath)),
		uintptr(unsafe.Pointer(&p)),
		uintptr(unsafe.Pointer(&status)),
	)
	runtime.KeepAlive(cpath)
	runtime.KeepAlive(&p)
	if h == 0 {
		if status == 0 {
			status = statusLoadFailed
		}
		return nil, StatusError("load", int(status))
	}
	return &Session{handle: h}, nil
}

// SetSampling replaces the sampler used by subsequent generations.
func (s *Session) SetSampling(so SamplingOptions) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return errors.New("lamazero: session fermee")
	}
	e, err := getEngine()
	if err != nil {
		return err
	}
	var grammar *byte
	var gbytes []byte
	if so.Grammar != "" {
		gbytes = append([]byte(so.Grammar), 0)
		grammar = &gbytes[0]
	}
	p := cSamplingParams{
		Temperature:      so.Temperature,
		TopK:             int32(so.TopK),
		TopP:             so.TopP,
		MinP:             so.MinP,
		RepeatPenalty:    so.RepeatPenalty,
		RepeatLastN:      int32(so.RepeatLastN),
		PresencePenalty:  so.PresencePenalty,
		FrequencyPenalty: so.FrequencyPenalty,
		Seed:             so.Seed,
		Grammar:          grammar,
	}
	r, _, _ := e.setSampling.Call(s.handle, uintptr(unsafe.Pointer(&p)))
	runtime.KeepAlive(gbytes)
	runtime.KeepAlive(&p)
	if status := int(int32(r)); status < 0 {
		return StatusError("sampling", status)
	}
	return nil
}

// ClearCache empties the KV cache: the next prompt is computed from scratch.
func (s *Session) ClearCache() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return
	}
	e, _ := getEngine()
	e.clearCache.Call(s.handle)
}

// ContextLength returns the context size of the loaded model.
func (s *Session) ContextLength() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return 0
	}
	e, _ := getEngine()
	r, _, _ := e.nCtx.Call(s.handle)
	return int(int32(r))
}

// Close releases the model. It is safe to call more than once.
func (s *Session) Close() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return
	}
	e, _ := getEngine()
	e.quickFree.Call(s.handle)
	s.closed = true
}

// ChatStream generates a completion for a fully formatted prompt. Prefixes of
// the prompt already in the KV cache are reused. onPiece receives complete
// UTF-8 text; returning false aborts generation.
func (s *Session) ChatStream(prompt string, maxNewTokens int, timeout time.Duration, onPiece func(string) bool) (Stats, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return Stats{}, errors.New("lamazero: session fermee")
	}
	e, err := getEngine()
	if err != nil {
		return Stats{}, err
	}
	cprompt, err := syscall.BytePtrFromString(prompt)
	if err != nil {
		return Stats{}, err
	}

	var pending []byte
	aborted := false
	handler := func(piece string) bool {
		pending = append(pending, piece...)
		cut := completeUTF8Prefix(pending)
		if cut == 0 {
			return true
		}
		out := string(pending[:cut])
		pending = pending[cut:]
		if onPiece != nil && !onPiece(out) {
			aborted = true
			return false
		}
		return true
	}

	id := registerHandler(handler)
	defer unregisterHandler(id)

	var nGen, reused int32
	var elapsed float64
	r, _, _ := e.chatStreamEx.Call(
		s.handle,
		uintptr(unsafe.Pointer(cprompt)),
		uintptr(maxNewTokens),
		uintptr(int(timeout/time.Millisecond)),
		e.callback,
		id,
		uintptr(unsafe.Pointer(&nGen)),
		uintptr(unsafe.Pointer(&reused)),
		uintptr(unsafe.Pointer(&elapsed)),
	)
	runtime.KeepAlive(cprompt)

	// Flush bytes that were waiting for the end of a character.
	if len(pending) > 0 && onPiece != nil && !aborted {
		onPiece(string(pending))
	}

	stats := Stats{
		Generated:    int(nGen),
		PromptReused: int(reused),
		Elapsed:      time.Duration(elapsed * float64(time.Millisecond)),
	}
	if status := int(int32(r)); status < 0 {
		return stats, StatusError("chat", status)
	}
	return stats, nil
}

// Chat returns the full generated text.
func (s *Session) Chat(prompt string, maxNewTokens int, timeout time.Duration) (string, Stats, error) {
	var out []byte
	stats, err := s.ChatStream(prompt, maxNewTokens, timeout, func(piece string) bool {
		out = append(out, piece...)
		return true
	})
	return string(out), stats, err
}
