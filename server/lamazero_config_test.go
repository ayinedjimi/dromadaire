package server

import (
	"testing"

	"github.com/ollama/ollama/lamazero"
)

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
