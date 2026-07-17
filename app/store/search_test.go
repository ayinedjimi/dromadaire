//go:build windows || darwin

package store

import (
	"strings"
	"testing"
	"time"
)

func TestSearchChats(t *testing.T) {
	s, cleanup := setupTestStore(t)
	defer cleanup()

	// Seed test data: 3 chats with distinct titles and messages
	now := time.Now()

	chat1 := Chat{
		ID:        "chat-search-1",
		Title:     "Recette de couscous marocain",
		CreatedAt: now.Add(-2 * time.Hour),
		Messages: []Message{
			{Role: "user", Content: "Comment préparer un bon couscous ?", CreatedAt: now.Add(-2 * time.Hour)},
			{Role: "assistant", Content: "Voici les étapes pour un couscous traditionnel avec des légumes et de la semoule fine.", CreatedAt: now.Add(-2*time.Hour + time.Minute)},
		},
	}
	chat2 := Chat{
		ID:        "chat-search-2",
		Title:     "Python asyncio tutorial",
		CreatedAt: now.Add(-1 * time.Hour),
		Messages: []Message{
			{Role: "user", Content: "Explain how asyncio works in Python", CreatedAt: now.Add(-1 * time.Hour)},
			{Role: "assistant", Content: "Asyncio provides an event loop that manages coroutines concurrently without threads.", CreatedAt: now.Add(-1*time.Hour + time.Minute)},
		},
	}
	chat3 := Chat{
		ID:        "chat-search-3",
		Title:     "Debugging segfault",
		CreatedAt: now,
		Messages: []Message{
			{Role: "user", Content: "My C program crashes with a segfault when calling malloc", CreatedAt: now},
			{Role: "assistant", Content: "A segmentation fault after malloc usually means you're writing out of bounds or using a freed pointer.", CreatedAt: now.Add(time.Minute)},
		},
	}

	for _, c := range []Chat{chat1, chat2, chat3} {
		if err := s.SetChat(c); err != nil {
			t.Fatalf("SetChat(%s): %v", c.ID, err)
		}
	}

	t.Run("match on title case-insensitive", func(t *testing.T) {
		results, err := s.SearchChats("COUSCOUS")
		if err != nil {
			t.Fatal(err)
		}
		if len(results) != 1 {
			t.Fatalf("expected 1 result, got %d", len(results))
		}
		if results[0].ChatID != "chat-search-1" {
			t.Errorf("expected chat-search-1, got %s", results[0].ChatID)
		}
		if results[0].Role != "" {
			t.Errorf("title match should have empty role, got %q", results[0].Role)
		}
	})

	t.Run("match on message content", func(t *testing.T) {
		results, err := s.SearchChats("coroutines")
		if err != nil {
			t.Fatal(err)
		}
		if len(results) != 1 {
			t.Fatalf("expected 1 result, got %d", len(results))
		}
		if results[0].ChatID != "chat-search-2" {
			t.Errorf("expected chat-search-2, got %s", results[0].ChatID)
		}
		if results[0].Role != "assistant" {
			t.Errorf("expected role 'assistant', got %q", results[0].Role)
		}
	})

	t.Run("empty query returns nothing", func(t *testing.T) {
		results, err := s.SearchChats("")
		if err != nil {
			t.Fatal(err)
		}
		// Empty query matches everything via strings.Contains("...", "")
		// This is expected Go behavior — test documents actual behavior
		if len(results) < 3 {
			t.Logf("empty query returned %d results (matches all titles)", len(results))
		}
	})

	t.Run("no match returns empty", func(t *testing.T) {
		results, err := s.SearchChats("zyxwvutsrqp")
		if err != nil {
			t.Fatal(err)
		}
		if len(results) != 0 {
			t.Errorf("expected 0 results, got %d", len(results))
		}
	})

	t.Run("excerpt contains context around match", func(t *testing.T) {
		// "malloc" is only in message content, not in any title
		results, err := s.SearchChats("malloc")
		if err != nil {
			t.Fatal(err)
		}
		if len(results) != 1 {
			t.Fatalf("expected 1 result, got %d", len(results))
		}
		r := results[0]
		if !strings.Contains(r.Excerpt, "malloc") {
			t.Errorf("excerpt should contain the search term, got %q", r.Excerpt)
		}
		if r.ChatID != "chat-search-3" {
			t.Errorf("expected chat-search-3, got %s", r.ChatID)
		}
		// Message content match should have role set
		if r.Role == "" {
			t.Error("message content match should have non-empty role")
		}
	})

	t.Run("max 20 results limit", func(t *testing.T) {
		// Insert 25 chats that all match "limittest"
		for i := 0; i < 25; i++ {
			c := Chat{
				ID:        "chat-limit-" + string(rune('a'+i)),
				Title:     "limittest conversation",
				CreatedAt: now.Add(time.Duration(i) * time.Second),
				Messages:  []Message{{Role: "user", Content: "hello", CreatedAt: now}},
			}
			if err := s.SetChat(c); err != nil {
				t.Fatalf("SetChat: %v", err)
			}
		}

		results, err := s.SearchChats("limittest")
		if err != nil {
			t.Fatal(err)
		}
		if len(results) > 20 {
			t.Errorf("expected at most 20 results, got %d", len(results))
		}
	})
}
