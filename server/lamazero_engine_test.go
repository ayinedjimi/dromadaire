//go:build windows

package server

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/ollama/ollama/llm"
)

// TestLamazeroRunnerCompletion runs the CPU adapter end to end. It is skipped
// unless LAMAZERO_DLL and LAMAZERO_MODEL are set.
func TestLamazeroRunnerCompletion(t *testing.T) {
	model := os.Getenv("LAMAZERO_MODEL")
	if os.Getenv("LAMAZERO_DLL") == "" || model == "" {
		t.Skip("LAMAZERO_DLL / LAMAZERO_MODEL non definis")
	}

	r := &lamazeroRunner{path: model}
	r.opts.NumCtx = 512
	r.opts.NumThread = 4
	r.opts.NumPredict = 32

	prompt := "<|im_start|>user\nDis bonjour en un mot.<|im_end|>\n<|im_start|>assistant\n"
	var text strings.Builder
	var done bool
	err := r.Completion(context.Background(), llm.CompletionRequest{Prompt: prompt}, func(resp llm.CompletionResponse) {
		text.WriteString(resp.Content)
		if resp.Done {
			done = true
		}
	})
	if err != nil {
		t.Fatalf("completion: %v", err)
	}
	if !done {
		t.Fatalf("pas de message de fin")
	}
	if strings.TrimSpace(text.String()) == "" {
		t.Fatalf("sortie vide")
	}
	t.Logf("sortie : %q", text.String())
}
