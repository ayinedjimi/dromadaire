package server

import (
	"strings"
	"testing"

	"github.com/ollama/ollama/llm"
)

// collect runs the holdback over pieces and returns the emitted text and
// whether a stop sequence was hit.
func collect(stops []string, pieces []string) (string, bool) {
	var out strings.Builder
	h := newStopHoldback(stops, func(r llm.CompletionResponse) { out.WriteString(r.Content) })
	for _, p := range pieces {
		if !h.push(p) {
			break
		}
	}
	h.flush()
	return out.String(), h.hit
}

func TestStopHoldbackWithoutStops(t *testing.T) {
	got, hit := collect(nil, []string{"Bon", "jour", " !"})
	if got != "Bonjour !" || hit {
		t.Fatalf("got %q hit=%v", got, hit)
	}
}

func TestStopHoldbackStopAcrossPieces(t *testing.T) {
	// The stop sequence "</s>" is split across three pieces.
	got, hit := collect([]string{"</s>"}, []string{"Oui", " c'est", " fait<", "/", "s>", " apres"})
	if got != "Oui c'est fait" || !hit {
		t.Fatalf("got %q hit=%v", got, hit)
	}
}

func TestStopHoldbackKeepsUTF8Intact(t *testing.T) {
	// "é" is two bytes; the token boundary falls in the middle of it.
	pieces := []string{"caf", "\xc3", "\xa9 au lait", " STOP"}
	got, hit := collect([]string{"STOP"}, pieces)
	if got != "café au lait " || !hit {
		t.Fatalf("got %q hit=%v", got, hit)
	}
}
