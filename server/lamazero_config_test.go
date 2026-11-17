package server

import (
	"errors"
	"testing"

	"github.com/ollama/ollama/lamazero"
)

func TestIsAutoEngine(t *testing.T) {
	cases := []struct {
		env  string
		want bool
	}{
		{"", true},
		{"auto", true},
		{"Auto", true},
		{"official", false},
		{"turbo", false},
	}
	for _, c := range cases {
		t.Run(c.env, func(t *testing.T) {
			t.Setenv("DROMADAIRE_LAMAZERO_ENGINE", c.env)
			if got := isAutoEngine(); got != c.want {
				t.Fatalf("isAutoEngine()=%v, attendu %v (env=%q)", got, c.want, c.env)
			}
		})
	}
}

func TestLamazeroSessionFallback(t *testing.T) {
	// Reset global state before and after the test.
	resetState := func() {
		lamazeroState.mu.Lock()
		lamazeroState.sess = nil
		lamazeroState.path = ""
		lamazeroState.reqLo = lamazero.LoadOptions{}
		lamazeroState.effectiveLo = lamazero.LoadOptions{}
		lamazeroState.mu.Unlock()
	}
	resetState()
	t.Cleanup(resetState)

	errTurbo := errors.New("turbo: architecture unsupported")
	loadCount := 0

	oldLoad := lamazeroLoadFunc
	lamazeroLoadFunc = func(path string, lo lamazero.LoadOptions) (*lamazero.Session, error) {
		loadCount++
		if lo.Engine == lamazero.EngineTurbo {
			return nil, errTurbo
		}
		return &lamazero.Session{}, nil
	}
	t.Cleanup(func() { lamazeroLoadFunc = oldLoad })

	t.Setenv("DROMADAIRE_LAMAZERO_ENGINE", "auto")
	t.Setenv("DROMADAIRE_LAMAZERO_KV", "turbo3")

	lo := lamazero.DefaultLoadOptions()
	applyKVCacheSetting(&lo) // should select turbo + turbo3

	lamazeroState.mu.Lock()

	// First call: turbo fails, falls back to official (2 loads).
	sess, err := lamazeroSession("model.gguf", lo)
	if err != nil {
		lamazeroState.mu.Unlock()
		t.Fatalf("first call failed: %v", err)
	}
	if sess == nil {
		lamazeroState.mu.Unlock()
		t.Fatal("session is nil")
	}
	if loadCount != 2 {
		lamazeroState.mu.Unlock()
		t.Fatalf("expected 2 loads on first call, got %d", loadCount)
	}
	if lamazeroState.effectiveLo.Engine != lamazero.EngineOfficial {
		lamazeroState.mu.Unlock()
		t.Fatalf("effective engine should be official, got %q", lamazeroState.effectiveLo.Engine)
	}

	// Second call with same requested options: should reuse (no additional loads).
	sess2, err := lamazeroSession("model.gguf", lo)
	lamazeroState.mu.Unlock()
	if err != nil {
		t.Fatalf("second call failed: %v", err)
	}
	if sess2 != sess {
		t.Fatal("second call should reuse the same session")
	}
	if loadCount != 2 {
		t.Fatalf("expected still 2 loads after reuse, got %d", loadCount)
	}
}

func TestLamazeroSessionNoFallbackExplicitTurbo(t *testing.T) {
	resetState := func() {
		lamazeroState.mu.Lock()
		lamazeroState.sess = nil
		lamazeroState.path = ""
		lamazeroState.reqLo = lamazero.LoadOptions{}
		lamazeroState.effectiveLo = lamazero.LoadOptions{}
		lamazeroState.mu.Unlock()
	}
	resetState()
	t.Cleanup(resetState)

	errTurbo := errors.New("turbo: architecture unsupported")

	oldLoad := lamazeroLoadFunc
	lamazeroLoadFunc = func(path string, lo lamazero.LoadOptions) (*lamazero.Session, error) {
		if lo.Engine == lamazero.EngineTurbo {
			return nil, errTurbo
		}
		return &lamazero.Session{}, nil
	}
	t.Cleanup(func() { lamazeroLoadFunc = oldLoad })

	// Explicit turbo: no fallback.
	t.Setenv("DROMADAIRE_LAMAZERO_ENGINE", "turbo")

	lo := lamazero.DefaultLoadOptions()
	lo.Engine = lamazero.EngineTurbo

	lamazeroState.mu.Lock()
	_, err := lamazeroSession("model.gguf", lo)
	lamazeroState.mu.Unlock()

	if err == nil {
		t.Fatal("expected error with explicit turbo, got nil")
	}
}

func TestApplyKVCacheSetting(t *testing.T) {
	cases := []struct {
		name, engine, kv string
		wantEngine       string
		wantKV           int
	}{
		{"defaut", "", "", lamazero.EngineOfficial, -1},
		{"auto f16", "auto", "f16", lamazero.EngineOfficial, -1},
		{"auto turbo3", "auto", "turbo3", lamazero.EngineTurbo, lamazero.KVTypeTurbo3},
		{"auto turbo4", "auto", "turbo4", lamazero.EngineTurbo, lamazero.KVTypeTurbo4},
		{"official turbo3 -> f16", "official", "turbo3", lamazero.EngineOfficial, -1},
		{"turbo f16", "turbo", "f16", lamazero.EngineTurbo, -1},
		{"turbo sans kv", "turbo", "", lamazero.EngineTurbo, -1},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			t.Setenv("DROMADAIRE_LAMAZERO_ENGINE", c.engine)
			t.Setenv("DROMADAIRE_LAMAZERO_KV", c.kv)
			lo := lamazero.DefaultLoadOptions()
			applyKVCacheSetting(&lo)
			if lo.Engine != c.wantEngine || lo.KVTypeK != c.wantKV || lo.KVTypeV != c.wantKV {
				t.Fatalf("engine=%q kv=%d/%d, attendu engine=%q kv=%d", lo.Engine, lo.KVTypeK, lo.KVTypeV, c.wantEngine, c.wantKV)
			}
		})
	}
}
