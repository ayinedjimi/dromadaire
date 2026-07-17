//go:build windows || darwin

package tools

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestWebSearchName(t *testing.T) {
	ws := &WebSearch{}
	if name := ws.Name(); name != "web_search" {
		t.Errorf("expected Name() = %q, got %q", "web_search", name)
	}
}

func TestWebSearchSchemaValid(t *testing.T) {
	ws := &WebSearch{}
	schema := ws.Schema()
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

	// Check "query" is in required
	req, ok := schema["required"].([]any)
	if !ok {
		t.Fatal("Schema() missing 'required' array")
	}
	found := false
	for _, r := range req {
		if r == "query" {
			found = true
			break
		}
	}
	if !found {
		t.Error("Schema() required array does not contain 'query'")
	}
}

func TestWebSearchExecuteNoQuery(t *testing.T) {
	ws := &WebSearch{}
	_, _, err := ws.Execute(context.Background(), map[string]any{})
	if err == nil {
		t.Fatal("expected error when query is missing, got nil")
	}
	if !strings.Contains(err.Error(), "query") {
		t.Errorf("error should mention 'query', got: %v", err)
	}
}

func TestWebSearchExecuteEmptyQuery(t *testing.T) {
	ws := &WebSearch{}
	_, _, err := ws.Execute(context.Background(), map[string]any{"query": "   "})
	if err == nil {
		t.Fatal("expected error for empty/whitespace query, got nil")
	}
}

func TestWebSearchExecuteDisabled(t *testing.T) {
	ws := &WebSearch{}
	_, _, err := ws.Execute(context.Background(), map[string]any{"query": "test search"})
	if err == nil {
		t.Fatal("expected error for disabled web search, got nil")
	}
	if !strings.Contains(err.Error(), "disabled in Dromadaire") {
		t.Errorf("error should mention 'disabled in Dromadaire', got: %v", err)
	}
}
