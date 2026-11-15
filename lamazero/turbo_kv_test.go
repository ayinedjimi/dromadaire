//go:build windows

package lamazero

import (
	"os"
	"strconv"
	"testing"
	"time"
)

// TestKVTypes generates with a given KV cache type. LAMAZERO_KV_TYPE is a
// ggml_type id: unset = F16 on the official engine; 44 (turbo3) or 47 (turbo4)
// select the TurboQuant engine (LAMAZERO_DLL_TURBO).
func TestKVTypes(t *testing.T) {
	model := testModel(t)
	lo := DefaultLoadOptions()
	lo.NumCtx = 1024
	lo.NumThreads = 4
	if v := os.Getenv("LAMAZERO_KV_TYPE"); v != "" {
		kv, _ := strconv.Atoi(v)
		lo.KVTypeK, lo.KVTypeV = kv, kv
		lo.Engine = EngineTurbo
	}
	s, err := Load(model, lo)
	if err != nil {
		t.Fatalf("load (moteur %s, kv %d) : %v", lo.Engine, lo.KVTypeK, err)
	}
	defer s.Close()
	so := DefaultSamplingOptions()
	so.Temperature = 0
	if err := s.SetSampling(so); err != nil {
		t.Fatal(err)
	}
	prompt := "<|im_start|>user\nExplique en une phrase ce qu'est un cache KV.<|im_end|>\n<|im_start|>assistant\n"
	text, st, err := s.Chat(prompt, 40, 120*time.Second)
	if err != nil {
		t.Fatalf("chat: %v", err)
	}
	t.Logf("moteur=%s kv=%d : %d tokens en %v : %q", s.Engine(), lo.KVTypeK, st.Generated, st.Elapsed, text)
}
