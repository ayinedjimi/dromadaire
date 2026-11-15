//go:build !windows

// Package lamazero: on non-Windows systems the engines are unavailable and
// every call returns ErrUnavailable. The API matches lamazero_windows.go.
package lamazero

import (
	"errors"
	"time"
)

// ErrUnavailable is returned when the lamazero engine cannot be used.
var ErrUnavailable = errors.New("lamazero: moteur CPU indisponible (Windows uniquement)")

// Engine names (see lamazero_windows.go).
const (
	EngineOfficial = "official"
	EngineTurbo    = "turbo"
)

// KV cache type ids of the TurboQuant fork (ggml_type values).
const (
	KVTypeTurbo3 = 44
	KVTypeTurbo4 = 47
)

// LoadOptions mirrors lamazero_windows.go.
type LoadOptions struct {
	Engine     string
	NumCtx     int
	NumThreads int
	NumBatch   int
	FlashAttn  int
	KVTypeK    int
	KVTypeV    int
	UseMmap    int
	UseMlock   bool
}

// DefaultLoadOptions returns the lamazero defaults.
func DefaultLoadOptions() LoadOptions {
	return LoadOptions{Engine: EngineOfficial, FlashAttn: -1, KVTypeK: -1, KVTypeV: -1, UseMmap: -1}
}

// SamplingOptions mirrors lamazero_windows.go.
type SamplingOptions struct {
	Temperature      float32
	TopK             int
	TopP             float32
	MinP             float32
	RepeatPenalty    float32
	RepeatLastN      int
	PresencePenalty  float32
	FrequencyPenalty float32
	Seed             uint32
	Grammar          string
}

// DefaultSamplingOptions returns the lamazero defaults.
func DefaultSamplingOptions() SamplingOptions {
	return SamplingOptions{Temperature: 0.7, TopK: 40, TopP: 0.95, RepeatPenalty: 1.15, RepeatLastN: 256, Seed: 0xFFFFFFFF}
}

// Stats mirrors lamazero_windows.go.
type Stats struct {
	Generated    int
	PromptReused int
	Elapsed      time.Duration
}

// Version reports that the engine is not available on this platform.
func Version(name string) (string, error) { return "", ErrUnavailable }

// Session is a placeholder on platforms without lamazero.
type Session struct{}

// Load always fails on this platform.
func Load(modelPath string, lo LoadOptions) (*Session, error) { return nil, ErrUnavailable }

// Engine returns an empty name.
func (s *Session) Engine() string { return "" }

// SetSampling always fails on this platform.
func (s *Session) SetSampling(so SamplingOptions) error { return ErrUnavailable }

// ClearCache is a no-op.
func (s *Session) ClearCache() {}

// ContextLength returns 0.
func (s *Session) ContextLength() int { return 0 }

// Close is a no-op.
func (s *Session) Close() {}

// ChatStream always fails on this platform.
func (s *Session) ChatStream(prompt string, maxNewTokens int, timeout time.Duration, onPiece func(string) bool) (Stats, error) {
	return Stats{}, ErrUnavailable
}

// Chat always fails on this platform.
func (s *Session) Chat(prompt string, maxNewTokens int, timeout time.Duration) (string, Stats, error) {
	return "", Stats{}, ErrUnavailable
}
