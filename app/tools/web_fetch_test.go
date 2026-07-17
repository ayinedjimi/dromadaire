//go:build windows || darwin

package tools

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestWebFetchName(t *testing.T) {
	wf := &WebFetch{}
	if name := wf.Name(); name != "web_fetch" {
		t.Errorf("expected Name() = %q, got %q", "web_fetch", name)
	}
}

func TestWebFetchSchemaValid(t *testing.T) {
	wf := &WebFetch{}
	schema := wf.Schema()
	if schema == nil {
		t.Fatal("Schema() returned nil")
	}

	// Verify it round-trips as valid JSON
	data, err := json.Marshal(schema)
	if err != nil {
		t.Fatalf("Schema() produced non-marshalable map: %v", err)
	}

	var parsed map[string]any
	if err := json.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("Schema() JSON is not valid: %v", err)
	}

	// Check "url" is in required
	req, ok := schema["required"].([]any)
	if !ok {
		t.Fatal("Schema() missing 'required' array")
	}
	found := false
	for _, r := range req {
		if r == "url" {
			found = true
			break
		}
	}
	if !found {
		t.Error("Schema() required array does not contain 'url'")
	}
}

func TestWebFetchExecuteNoURL(t *testing.T) {
	wf := &WebFetch{}
	_, _, err := wf.Execute(context.Background(), map[string]any{})
	if err == nil {
		t.Fatal("expected error when url is missing, got nil")
	}
	if !strings.Contains(err.Error(), "url") {
		t.Errorf("error should mention 'url', got: %v", err)
	}
}

func TestWebFetchExecuteEmptyURL(t *testing.T) {
	wf := &WebFetch{}
	_, _, err := wf.Execute(context.Background(), map[string]any{"url": "   "})
	if err == nil {
		t.Fatal("expected error for empty/whitespace url, got nil")
	}
}

func TestWebFetchExecuteDisabled(t *testing.T) {
	wf := &WebFetch{}
	_, _, err := wf.Execute(context.Background(), map[string]any{"url": "https://example.com"})
	if err == nil {
		t.Fatal("expected error for disabled web fetch, got nil")
	}
	if !strings.Contains(err.Error(), "disabled in Dromadaire") {
		t.Errorf("error should mention 'disabled in Dromadaire', got: %v", err)
	}
}
