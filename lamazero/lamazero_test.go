//go:build windows

package lamazero

import (
	"os"
	"strings"
	"testing"
	"time"
)

func testModel(t *testing.T) string {
	t.Helper()
	model := os.Getenv("LAMAZERO_MODEL")
	if os.Getenv("LAMAZERO_DLL") == "" || model == "" {
		t.Skip("LAMAZERO_DLL / LAMAZERO_MODEL non definis")
	}
	return model
}

// TestSmokeChat runs one real generation with explicit options.
func TestSmokeChat(t *testing.T) {
	model := testModel(t)

	v, err := Version("")
	if err != nil {
		t.Fatalf("version: %v", err)
	}
	t.Logf("version: %s", v)

	lo := DefaultLoadOptions()
	lo.NumCtx = 512
	lo.NumThreads = 4
	s, err := Load(model, lo)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	defer s.Close()

	so := DefaultSamplingOptions()
	so.Temperature = 0 // glouton : sortie reproductible
	if err := s.SetSampling(so); err != nil {
		t.Fatalf("sampling: %v", err)
	}

	prompt := "<|im_start|>system\nTu es un assistant concis.<|im_end|>\n" +
		"<|im_start|>user\nDis bonjour en un mot.<|im_end|>\n" +
		"<|im_start|>assistant\n"

	text, stats, err := s.Chat(prompt, 32, 60*time.Second)
	if err != nil {
		t.Fatalf("chat: %v", err)
	}
	t.Logf("%d tokens en %v : %q", stats.Generated, stats.Elapsed, text)
	if stats.Generated == 0 || strings.TrimSpace(text) == "" {
		t.Fatalf("aucune sortie generee")
	}
}

// TestPrefixReuse checks that a second turn reuses the KV cache of the first.
func TestPrefixReuse(t *testing.T) {
	model := testModel(t)

	lo := DefaultLoadOptions()
	lo.NumCtx = 1024
	lo.NumThreads = 4
	s, err := Load(model, lo)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	defer s.Close()

	so := DefaultSamplingOptions()
	so.Temperature = 0
	if err := s.SetSampling(so); err != nil {
		t.Fatalf("sampling: %v", err)
	}

	turn1 := "<|im_start|>user\nDis bonjour.<|im_end|>\n<|im_start|>assistant\n"
	out1, st1, err := s.Chat(turn1, 16, 60*time.Second)
	if err != nil {
		t.Fatalf("tour 1: %v", err)
	}
	turn2 := turn1 + out1 + "<|im_end|>\n<|im_start|>user\nMerci.<|im_end|>\n<|im_start|>assistant\n"
	_, st2, err := s.Chat(turn2, 16, 60*time.Second)
	if err != nil {
		t.Fatalf("tour 2: %v", err)
	}
	t.Logf("tour 1 : reutilises=%d ; tour 2 : reutilises=%d", st1.PromptReused, st2.PromptReused)
	if st1.PromptReused != 0 {
		t.Errorf("tour 1 ne devrait rien reutiliser, reutilises=%d", st1.PromptReused)
	}
	if st2.PromptReused == 0 {
		t.Errorf("tour 2 devrait reutiliser le prefixe du tour 1")
	}
}
