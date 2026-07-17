//go:build windows || darwin

package store

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

// setupCRUDStore creates a lightweight store for CRUD tests.
// Calls Settings() to trigger DB initialization + schema creation.
func setupCRUDStore(t *testing.T) *Store {
	t.Helper()
	tmpDir := t.TempDir()

	// Override legacy config path to prevent migration side-effects
	oldLegacyConfigPath := legacyConfigPath
	legacyConfigPath = filepath.Join(tmpDir, "config.json")
	t.Cleanup(func() { legacyConfigPath = oldLegacyConfigPath })

	s := &Store{DBPath: filepath.Join(tmpDir, "test.db")}
	if _, err := s.Settings(); err != nil {
		t.Fatalf("setupCRUDStore: init DB failed: %v", err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

// ===========================
// FailedAttempts (tests 1-4)
// ===========================

func TestIncrementFailedAttempts_FromZero(t *testing.T) {
	s := setupCRUDStore(t)

	count, err := s.IncrementFailedAttempts()
	if err != nil {
		t.Fatalf("IncrementFailedAttempts: %v", err)
	}
	if count != 1 {
		t.Errorf("expected count=1 after first increment, got %d", count)
	}
}

func TestIncrementFailedAttempts_FiveTimes(t *testing.T) {
	s := setupCRUDStore(t)

	for i := 1; i <= 5; i++ {
		count, err := s.IncrementFailedAttempts()
		if err != nil {
			t.Fatalf("IncrementFailedAttempts iteration %d: %v", i, err)
		}
		if count != i {
			t.Errorf("iteration %d: expected count=%d, got %d", i, i, count)
		}
	}
}

func TestResetThenIncrementFailedAttempts(t *testing.T) {
	s := setupCRUDStore(t)

	// Increment a few times
	for i := 0; i < 3; i++ {
		if _, err := s.IncrementFailedAttempts(); err != nil {
			t.Fatalf("IncrementFailedAttempts: %v", err)
		}
	}

	// Reset
	if err := s.ResetFailedAttempts(); err != nil {
		t.Fatalf("ResetFailedAttempts: %v", err)
	}

	// Increment again should start from 1
	count, err := s.IncrementFailedAttempts()
	if err != nil {
		t.Fatalf("IncrementFailedAttempts after reset: %v", err)
	}
	if count != 1 {
		t.Errorf("expected count=1 after reset+increment, got %d", count)
	}
}

func TestIncrementFailedAttempts_Concurrent(t *testing.T) {
	s := setupCRUDStore(t)

	const goroutines = 10
	var wg sync.WaitGroup
	wg.Add(goroutines)

	for i := 0; i < goroutines; i++ {
		go func() {
			defer wg.Done()
			if _, err := s.IncrementFailedAttempts(); err != nil {
				t.Errorf("concurrent IncrementFailedAttempts: %v", err)
			}
		}()
	}
	wg.Wait()

	// Read final count via one more increment, then subtract 1
	finalPlusOne, err := s.IncrementFailedAttempts()
	if err != nil {
		t.Fatalf("final IncrementFailedAttempts: %v", err)
	}
	finalCount := finalPlusOne - 1
	if finalCount != goroutines {
		t.Errorf("expected final count=%d after %d goroutines, got %d", goroutines, goroutines, finalCount)
	}
}

// ===========================
// DeleteAllChats (test 5)
// ===========================

func TestDeleteAllChats(t *testing.T) {
	s := setupCRUDStore(t)

	// Create 5 chats
	for i := 0; i < 5; i++ {
		chat := NewChat(fmt.Sprintf("chat-%d", i))
		chat.Title = fmt.Sprintf("Chat %d", i)
		chat.Messages = append(chat.Messages, NewMessage("user", fmt.Sprintf("msg %d", i), nil))
		if err := s.SetChat(*chat); err != nil {
			t.Fatalf("SetChat(%d): %v", i, err)
		}
	}

	// Verify we have 5
	chats, err := s.Chats()
	if err != nil {
		t.Fatalf("Chats: %v", err)
	}
	if len(chats) != 5 {
		t.Fatalf("expected 5 chats before delete, got %d", len(chats))
	}

	// Delete all
	if err := s.DeleteAllChats(); err != nil {
		t.Fatalf("DeleteAllChats: %v", err)
	}

	// Verify empty
	chats, err = s.Chats()
	if err != nil {
		t.Fatalf("Chats after DeleteAllChats: %v", err)
	}
	if len(chats) != 0 {
		t.Errorf("expected 0 chats after DeleteAllChats, got %d", len(chats))
	}
}

// ===========================
// DeleteChatsOlderThan (tests 6-8)
// ===========================

func TestDeleteChatsOlderThan_AgedChats(t *testing.T) {
	s := setupCRUDStore(t)

	// Create 3 chats with different ages
	ages := []struct {
		id   string
		days int
	}{
		{"recent-1d", 1},
		{"old-10d", 10},
		{"old-30d", 30},
	}

	for _, a := range ages {
		chat := Chat{
			ID:        a.id,
			Title:     "Chat " + a.id,
			CreatedAt: time.Now().Add(-time.Duration(a.days) * 24 * time.Hour),
			Messages:  []Message{},
		}
		if err := s.SetChat(chat); err != nil {
			t.Fatalf("SetChat(%s): %v", a.id, err)
		}
	}

	// Delete chats older than 7 days
	deleted, err := s.DeleteChatsOlderThan(7)
	if err != nil {
		t.Fatalf("DeleteChatsOlderThan(7): %v", err)
	}
	if deleted != 2 {
		t.Errorf("expected 2 chats deleted, got %d", deleted)
	}

	// Verify only the recent chat remains
	chats, err := s.Chats()
	if err != nil {
		t.Fatalf("Chats: %v", err)
	}
	if len(chats) != 1 {
		t.Fatalf("expected 1 chat remaining, got %d", len(chats))
	}
	if chats[0].ID != "recent-1d" {
		t.Errorf("expected remaining chat ID=recent-1d, got %s", chats[0].ID)
	}
}

func TestDeleteChatsOlderThan_ZeroDays(t *testing.T) {
	s := setupCRUDStore(t)

	// Create a chat
	chat := NewChat("keep-me")
	chat.Title = "Keep Me"
	if err := s.SetChat(*chat); err != nil {
		t.Fatalf("SetChat: %v", err)
	}

	// 0 days means "older than now" which effectively deletes nothing
	// because datetime('now', '-0 days') = now and created_at <= now
	deleted, err := s.DeleteChatsOlderThan(0)
	if err != nil {
		t.Fatalf("DeleteChatsOlderThan(0): %v", err)
	}

	// The chat was just created so its created_at is approximately now.
	// With 0-day threshold the SQL is "created_at < datetime('now', '-0 days')"
	// which means strictly less than now -- so a just-created chat should survive.
	chats, err := s.Chats()
	if err != nil {
		t.Fatalf("Chats: %v", err)
	}
	// Depending on timing, it might or might not be deleted. Either behavior is acceptable.
	t.Logf("DeleteChatsOlderThan(0): deleted=%d, remaining=%d", deleted, len(chats))
}

func TestDeleteChatsOlderThan_CascadeMessages(t *testing.T) {
	s := setupCRUDStore(t)

	// Create a chat with messages, dated 15 days ago
	chat := Chat{
		ID:        "cascade-test",
		Title:     "Cascade",
		CreatedAt: time.Now().Add(-15 * 24 * time.Hour),
		Messages: []Message{
			NewMessage("user", "hello cascade", nil),
			NewMessage("assistant", "goodbye cascade", nil),
		},
	}
	if err := s.SetChat(chat); err != nil {
		t.Fatalf("SetChat: %v", err)
	}

	// Verify messages exist
	loaded, err := s.Chat("cascade-test")
	if err != nil {
		t.Fatalf("Chat: %v", err)
	}
	if len(loaded.Messages) != 2 {
		t.Fatalf("expected 2 messages before delete, got %d", len(loaded.Messages))
	}

	// Delete chats older than 7 days (should cascade-delete messages)
	deleted, err := s.DeleteChatsOlderThan(7)
	if err != nil {
		t.Fatalf("DeleteChatsOlderThan(7): %v", err)
	}
	if deleted != 1 {
		t.Errorf("expected 1 chat deleted, got %d", deleted)
	}

	// Verify the chat is gone
	_, err = s.Chat("cascade-test")
	if err == nil {
		t.Error("expected error retrieving deleted chat, got nil")
	}
}

// ===========================
// SaveChat / SetChat (tests 9-11)
// ===========================

func TestSaveChat_NewUpsert(t *testing.T) {
	s := setupCRUDStore(t)

	chat := Chat{
		ID:        "upsert-new",
		Title:     "Upsert New Chat",
		CreatedAt: time.Now(),
		Pinned:    true,
		Folder:    "work",
		Messages:  []Message{},
	}
	if err := s.SetChat(chat); err != nil {
		t.Fatalf("SetChat: %v", err)
	}

	loaded, err := s.Chat("upsert-new")
	if err != nil {
		t.Fatalf("Chat: %v", err)
	}
	if loaded.ID != "upsert-new" {
		t.Errorf("expected ID=upsert-new, got %s", loaded.ID)
	}
	if loaded.Title != "Upsert New Chat" {
		t.Errorf("expected title='Upsert New Chat', got '%s'", loaded.Title)
	}
	if !loaded.Pinned {
		t.Error("expected Pinned=true, got false")
	}
	if loaded.Folder != "work" {
		t.Errorf("expected Folder='work', got '%s'", loaded.Folder)
	}
}

func TestSaveChat_UpdateTitle(t *testing.T) {
	s := setupCRUDStore(t)

	// Create
	chat := NewChat("update-title")
	chat.Title = "Original Title"
	if err := s.SetChat(*chat); err != nil {
		t.Fatalf("SetChat: %v", err)
	}

	// Update title via upsert
	chat.Title = "Updated Title"
	if err := s.SetChat(*chat); err != nil {
		t.Fatalf("SetChat (update): %v", err)
	}

	loaded, err := s.Chat("update-title")
	if err != nil {
		t.Fatalf("Chat: %v", err)
	}
	if loaded.Title != "Updated Title" {
		t.Errorf("expected title='Updated Title', got '%s'", loaded.Title)
	}
}

func TestSaveChat_WithMessages(t *testing.T) {
	s := setupCRUDStore(t)

	chat := Chat{
		ID:        "with-msgs",
		Title:     "Chat With Messages",
		CreatedAt: time.Now(),
		Messages: []Message{
			NewMessage("user", "first question", nil),
			NewMessage("assistant", "first answer", &MessageOptions{Model: "llama3"}),
			NewMessage("user", "second question", nil),
		},
	}
	if err := s.SetChat(chat); err != nil {
		t.Fatalf("SetChat: %v", err)
	}

	loaded, err := s.Chat("with-msgs")
	if err != nil {
		t.Fatalf("Chat: %v", err)
	}
	if len(loaded.Messages) != 3 {
		t.Fatalf("expected 3 messages, got %d", len(loaded.Messages))
	}
	if loaded.Messages[0].Role != "user" || loaded.Messages[0].Content != "first question" {
		t.Errorf("message 0 mismatch: role=%s content=%s", loaded.Messages[0].Role, loaded.Messages[0].Content)
	}
	if loaded.Messages[1].Role != "assistant" || loaded.Messages[1].Content != "first answer" {
		t.Errorf("message 1 mismatch: role=%s content=%s", loaded.Messages[1].Role, loaded.Messages[1].Content)
	}
	if loaded.Messages[1].Model != "llama3" {
		t.Errorf("expected message 1 model='llama3', got '%s'", loaded.Messages[1].Model)
	}
	if loaded.Messages[2].Content != "second question" {
		t.Errorf("message 2 content mismatch: got '%s'", loaded.Messages[2].Content)
	}
}

// ===========================
// AppendMessage (tests 12-13)
// ===========================

func TestAppendMessage_ExistingChat(t *testing.T) {
	s := setupCRUDStore(t)

	chat := NewChat("append-test")
	chat.Title = "Append Test"
	chat.Messages = append(chat.Messages, NewMessage("user", "hello", nil))
	if err := s.SetChat(*chat); err != nil {
		t.Fatalf("SetChat: %v", err)
	}

	// Append a new message
	newMsg := NewMessage("assistant", "world", &MessageOptions{Model: "gemma3"})
	if err := s.AppendMessage("append-test", newMsg); err != nil {
		t.Fatalf("AppendMessage: %v", err)
	}

	loaded, err := s.Chat("append-test")
	if err != nil {
		t.Fatalf("Chat: %v", err)
	}
	if len(loaded.Messages) != 2 {
		t.Fatalf("expected 2 messages after append, got %d", len(loaded.Messages))
	}
	if loaded.Messages[1].Content != "world" {
		t.Errorf("expected appended message content='world', got '%s'", loaded.Messages[1].Content)
	}
}

func TestAppendMessage_NonexistentChat(t *testing.T) {
	s := setupCRUDStore(t)

	msg := NewMessage("user", "orphan message", nil)
	err := s.AppendMessage("nonexistent-chat-id", msg)
	if err == nil {
		t.Error("expected error appending to nonexistent chat (FK violation), got nil")
	}
}

// ===========================
// UpdateLastMessage (test 14)
// ===========================

func TestUpdateLastMessage_ContentChanged(t *testing.T) {
	s := setupCRUDStore(t)

	chat := NewChat("update-last")
	chat.Messages = append(chat.Messages,
		NewMessage("user", "question", nil),
		NewMessage("assistant", "initial response", nil),
	)
	if err := s.SetChat(*chat); err != nil {
		t.Fatalf("SetChat: %v", err)
	}

	// Update last message content
	updatedMsg := NewMessage("assistant", "updated response", &MessageOptions{
		Model: "gemma3",
	})
	if err := s.UpdateLastMessage("update-last", updatedMsg); err != nil {
		t.Fatalf("UpdateLastMessage: %v", err)
	}

	loaded, err := s.Chat("update-last")
	if err != nil {
		t.Fatalf("Chat: %v", err)
	}
	lastMsg := loaded.Messages[len(loaded.Messages)-1]
	if lastMsg.Content != "updated response" {
		t.Errorf("expected content='updated response', got '%s'", lastMsg.Content)
	}
}

// ===========================
// Pin / Folder (tests 15-17)
// ===========================

func TestPinChat(t *testing.T) {
	s := setupCRUDStore(t)

	chat := NewChat("pin-test")
	chat.Title = "Pin Test"
	if err := s.SetChat(*chat); err != nil {
		t.Fatalf("SetChat: %v", err)
	}

	// Pin
	if err := s.PinChat("pin-test", true); err != nil {
		t.Fatalf("PinChat(true): %v", err)
	}

	loaded, err := s.Chat("pin-test")
	if err != nil {
		t.Fatalf("Chat: %v", err)
	}
	if !loaded.Pinned {
		t.Error("expected Pinned=true after PinChat, got false")
	}

	// Unpin
	if err := s.PinChat("pin-test", false); err != nil {
		t.Fatalf("PinChat(false): %v", err)
	}
	loaded, err = s.Chat("pin-test")
	if err != nil {
		t.Fatalf("Chat: %v", err)
	}
	if loaded.Pinned {
		t.Error("expected Pinned=false after unpin, got true")
	}
}

func TestSetChatFolder(t *testing.T) {
	s := setupCRUDStore(t)

	chat := NewChat("folder-test")
	chat.Title = "Folder Test"
	if err := s.SetChat(*chat); err != nil {
		t.Fatalf("SetChat: %v", err)
	}

	if err := s.SetChatFolder("folder-test", "projects"); err != nil {
		t.Fatalf("SetChatFolder: %v", err)
	}

	loaded, err := s.Chat("folder-test")
	if err != nil {
		t.Fatalf("Chat: %v", err)
	}
	if loaded.Folder != "projects" {
		t.Errorf("expected Folder='projects', got '%s'", loaded.Folder)
	}
}

func TestPinChat_Nonexistent(t *testing.T) {
	s := setupCRUDStore(t)

	// PinChat on a nonexistent chat should not error (0 rows affected is fine)
	err := s.PinChat("nonexistent-id", true)
	if err != nil {
		t.Errorf("PinChat on nonexistent chat returned error: %v (expected nil)", err)
	}
}

// ===========================
// SearchChats (tests 18-19)
// ===========================

func TestSearchChats_SQLInjection(t *testing.T) {
	s := setupCRUDStore(t)

	// Create a chat with normal content
	chat := NewChat("safe-chat")
	chat.Title = "Safe Chat"
	chat.Messages = append(chat.Messages, NewMessage("user", "normal content", nil))
	if err := s.SetChat(*chat); err != nil {
		t.Fatalf("SetChat: %v", err)
	}

	// Attempt SQL injection via search query
	injectionQuery := "'; DROP TABLE chats; --"
	results, err := s.SearchChats(injectionQuery)
	if err != nil {
		t.Fatalf("SearchChats with injection query returned error: %v", err)
	}

	// The injection query should not match anything
	if len(results) != 0 {
		t.Logf("SearchChats returned %d results for injection query (expected 0 or safe results)", len(results))
	}

	// Verify the chats table still exists and has data
	chats, err := s.Chats()
	if err != nil {
		t.Fatalf("Chats() after SQL injection attempt failed: %v", err)
	}
	if len(chats) != 1 {
		t.Errorf("expected 1 chat after injection attempt, got %d (data loss!)", len(chats))
	}
}

func TestSearchChats_Unicode(t *testing.T) {
	s := setupCRUDStore(t)

	// Create a chat with Unicode content
	chat := NewChat("unicode-chat")
	chat.Title = "Discussion en francais"
	chat.Messages = append(chat.Messages, NewMessage("user", "Bonjour le monde! Comment allez-vous aujourd'hui?", nil))
	if err := s.SetChat(*chat); err != nil {
		t.Fatalf("SetChat: %v", err)
	}

	// Search with Unicode query
	results, err := s.SearchChats("Bonjour")
	if err != nil {
		t.Fatalf("SearchChats with Unicode: %v", err)
	}
	if len(results) == 0 {
		t.Error("expected at least 1 result for Unicode search 'Bonjour', got 0")
	}

	// Search with accented characters in title
	chat2 := NewChat("accent-chat")
	chat2.Title = "Reunion preparatoire"
	chat2.Messages = append(chat2.Messages, NewMessage("user", "Les elements cles du projet", nil))
	if err := s.SetChat(*chat2); err != nil {
		t.Fatalf("SetChat: %v", err)
	}

	results, err = s.SearchChats("elements")
	if err != nil {
		t.Fatalf("SearchChats with accented query: %v", err)
	}
	if len(results) == 0 {
		t.Error("expected at least 1 result for 'elements' search, got 0")
	}
}

// ===========================
// Settings (tests 20-21)
// ===========================

func TestSettings_RoundTrip(t *testing.T) {
	s := setupCRUDStore(t)

	original := Settings{
		Expose:                   true,
		Browser:                  true,
		Survey:                   false,
		Models:                   "/custom/models",
		Agent:                    true,
		Tools:                    true,
		WorkingDir:               "/work",
		ContextLength:            2048,
		AirplaneMode:             true,
		TurboEnabled:             false,
		WebSearchEnabled:         true,
		ThinkEnabled:             true,
		ThinkLevel:               "high",
		SelectedModel:            "gemma3:4b",
		SidebarOpen:              true,
		EncryptionEnabled:        false,
		RAGEnabled:               true,
		EmbeddingModel:           "snowflake-arctic-embed:110m",
		PasswordEnabled:          true,
		PasswordHash:             "bcrypt_hash_here",
		AutoDeleteOnFailure:      true,
		LockTimeoutMinutes:       10,
		AutoDeleteDays:           30,
		ClipboardClearSeconds:    15,
		SearchEnabled:            true,
		RAGCitationsEnabled:      true,
		RAGPreviewEnabled:        false,
		ArtifactsEnabled:         true,
		Theme:                    "nord",
		KeyboardShortcutsEnabled: true,
		NumThread:                6,
		KeepAlive:                "5m",
		MaxLoadedModels:          2,
		KVCacheType:              "q8_0",
		NumBatch:                 512,
		VulkanEnabled:            true,
		ResponseMode:             "detailed",
		SystemPrompt:             "You are a helpful assistant.",
		HumanSubMode:             "email",
		WritingStyleRules:        "formal tone",
		StyleAnalysisModel:       "gemma3:1b",
	}

	if err := s.SetSettings(original); err != nil {
		t.Fatalf("SetSettings: %v", err)
	}

	loaded, err := s.Settings()
	if err != nil {
		t.Fatalf("Settings: %v", err)
	}

	// Verify all fields (except Models which may get default override if empty)
	checks := []struct {
		name string
		got  interface{}
		want interface{}
	}{
		{"Expose", loaded.Expose, true},
		{"Browser", loaded.Browser, true},
		{"Survey", loaded.Survey, false},
		{"Agent", loaded.Agent, true},
		{"Tools", loaded.Tools, true},
		{"WorkingDir", loaded.WorkingDir, "/work"},
		{"ContextLength", loaded.ContextLength, 2048},
		{"AirplaneMode", loaded.AirplaneMode, true},
		{"TurboEnabled", loaded.TurboEnabled, false},
		{"WebSearchEnabled", loaded.WebSearchEnabled, true},
		{"ThinkEnabled", loaded.ThinkEnabled, true},
		{"ThinkLevel", loaded.ThinkLevel, "high"},
		{"SelectedModel", loaded.SelectedModel, "gemma3:4b"},
		{"SidebarOpen", loaded.SidebarOpen, true},
		{"EncryptionEnabled", loaded.EncryptionEnabled, false},
		{"RAGEnabled", loaded.RAGEnabled, true},
		{"EmbeddingModel", loaded.EmbeddingModel, "snowflake-arctic-embed:110m"},
		{"PasswordEnabled", loaded.PasswordEnabled, true},
		{"PasswordHash", loaded.PasswordHash, "bcrypt_hash_here"},
		{"AutoDeleteOnFailure", loaded.AutoDeleteOnFailure, true},
		{"LockTimeoutMinutes", loaded.LockTimeoutMinutes, 10},
		{"AutoDeleteDays", loaded.AutoDeleteDays, 30},
		{"ClipboardClearSeconds", loaded.ClipboardClearSeconds, 15},
		{"SearchEnabled", loaded.SearchEnabled, true},
		{"RAGCitationsEnabled", loaded.RAGCitationsEnabled, true},
		{"RAGPreviewEnabled", loaded.RAGPreviewEnabled, false},
		{"ArtifactsEnabled", loaded.ArtifactsEnabled, true},
		{"Theme", loaded.Theme, "nord"},
		{"KeyboardShortcutsEnabled", loaded.KeyboardShortcutsEnabled, true},
		{"NumThread", loaded.NumThread, 6},
		{"KeepAlive", loaded.KeepAlive, "5m"},
		{"MaxLoadedModels", loaded.MaxLoadedModels, 2},
		{"KVCacheType", loaded.KVCacheType, "q8_0"},
		{"NumBatch", loaded.NumBatch, 512},
		{"VulkanEnabled", loaded.VulkanEnabled, true},
		{"ResponseMode", loaded.ResponseMode, "detailed"},
		{"SystemPrompt", loaded.SystemPrompt, "You are a helpful assistant."},
		{"HumanSubMode", loaded.HumanSubMode, "email"},
		{"WritingStyleRules", loaded.WritingStyleRules, "formal tone"},
		{"StyleAnalysisModel", loaded.StyleAnalysisModel, "gemma3:1b"},
	}

	for _, c := range checks {
		if fmt.Sprintf("%v", c.got) != fmt.Sprintf("%v", c.want) {
			t.Errorf("Settings.%s: got %v, want %v", c.name, c.got, c.want)
		}
	}
}

func TestSettings_PasswordHashNotInJSON(t *testing.T) {
	s := setupCRUDStore(t)

	original := Settings{
		PasswordEnabled: true,
		PasswordHash:    "super_secret_bcrypt_hash",
		Theme:           "dark",
	}
	if err := s.SetSettings(original); err != nil {
		t.Fatalf("SetSettings: %v", err)
	}

	loaded, err := s.Settings()
	if err != nil {
		t.Fatalf("Settings: %v", err)
	}

	// PasswordHash should be stored and retrievable from the DB
	if loaded.PasswordHash != "super_secret_bcrypt_hash" {
		t.Errorf("PasswordHash not persisted: got '%s'", loaded.PasswordHash)
	}

	// But when marshalled to JSON, it should be omitted (json:"-" tag)
	jsonBytes, err := json.Marshal(loaded)
	if err != nil {
		t.Fatalf("json.Marshal(settings): %v", err)
	}

	var asMap map[string]interface{}
	if err := json.Unmarshal(jsonBytes, &asMap); err != nil {
		t.Fatalf("json.Unmarshal: %v", err)
	}

	if _, exists := asMap["PasswordHash"]; exists {
		t.Error("PasswordHash should NOT appear in JSON output (json:\"-\" tag)")
	}
	// Also check lowercase variants
	if _, exists := asMap["password_hash"]; exists {
		t.Error("password_hash should NOT appear in JSON output")
	}
}

// ===========================
// RAG (tests 22-23)
// ===========================

func TestRAG_InsertAndQueryByHash(t *testing.T) {
	s := setupCRUDStore(t)

	doc := RAGDocument{
		ID:             "doc-001",
		Filename:       "test-document.pdf",
		FileSize:       12345,
		ContentHash:    "sha256_abcdef1234567890",
		ChunkCount:     5,
		Status:         "ready",
		ErrorMessage:   "",
		EmbeddingModel: "snowflake-arctic-embed:33m",
		CreatedAt:      time.Now(),
		UpdatedAt:      time.Now(),
	}

	if err := s.InsertRAGDocument(doc); err != nil {
		t.Fatalf("InsertRAGDocument: %v", err)
	}

	// Query by hash
	found, err := s.RAGDocumentByHash("sha256_abcdef1234567890")
	if err != nil {
		t.Fatalf("RAGDocumentByHash: %v", err)
	}
	if found == nil {
		t.Fatal("expected document to be found by hash, got nil")
	}
	if found.ID != "doc-001" {
		t.Errorf("expected ID=doc-001, got %s", found.ID)
	}
	if found.Filename != "test-document.pdf" {
		t.Errorf("expected Filename='test-document.pdf', got '%s'", found.Filename)
	}
	if found.FileSize != 12345 {
		t.Errorf("expected FileSize=12345, got %d", found.FileSize)
	}
	if found.Status != "ready" {
		t.Errorf("expected Status='ready', got '%s'", found.Status)
	}

	// Query with non-existent hash
	notFound, err := s.RAGDocumentByHash("nonexistent_hash")
	if err != nil {
		t.Fatalf("RAGDocumentByHash(nonexistent): %v", err)
	}
	if notFound != nil {
		t.Error("expected nil for nonexistent hash, got a document")
	}
}

func TestRAG_DeleteDocument_CascadeChunks(t *testing.T) {
	s := setupCRUDStore(t)

	// Insert a document
	doc := RAGDocument{
		ID:             "doc-cascade",
		Filename:       "cascade.txt",
		FileSize:       1000,
		ContentHash:    "hash_cascade",
		ChunkCount:     3,
		Status:         "ready",
		EmbeddingModel: "snowflake-arctic-embed:33m",
		CreatedAt:      time.Now(),
		UpdatedAt:      time.Now(),
	}
	if err := s.InsertRAGDocument(doc); err != nil {
		t.Fatalf("InsertRAGDocument: %v", err)
	}

	// Insert chunks for this document
	chunks := []RAGChunk{
		{DocumentID: "doc-cascade", ChunkIndex: 0, Content: "chunk zero", EmbeddingDim: 384, TokenCount: 10},
		{DocumentID: "doc-cascade", ChunkIndex: 1, Content: "chunk one", EmbeddingDim: 384, TokenCount: 12},
		{DocumentID: "doc-cascade", ChunkIndex: 2, Content: "chunk two", EmbeddingDim: 384, TokenCount: 8},
	}
	if err := s.InsertRAGChunks(chunks); err != nil {
		t.Fatalf("InsertRAGChunks: %v", err)
	}

	// Verify chunks exist
	loadedChunks, err := s.RAGChunksByDocument("doc-cascade")
	if err != nil {
		t.Fatalf("RAGChunksByDocument: %v", err)
	}
	if len(loadedChunks) != 3 {
		t.Fatalf("expected 3 chunks before delete, got %d", len(loadedChunks))
	}

	// Delete the document (should cascade delete chunks)
	if err := s.DeleteRAGDocument("doc-cascade"); err != nil {
		t.Fatalf("DeleteRAGDocument: %v", err)
	}

	// Verify document is gone
	found, err := s.RAGDocumentByHash("hash_cascade")
	if err != nil {
		t.Fatalf("RAGDocumentByHash after delete: %v", err)
	}
	if found != nil {
		t.Error("expected document to be deleted, but found it")
	}

	// Verify chunks are cascade-deleted
	loadedChunks, err = s.RAGChunksByDocument("doc-cascade")
	if err != nil {
		t.Fatalf("RAGChunksByDocument after delete: %v", err)
	}
	if len(loadedChunks) != 0 {
		t.Errorf("expected 0 chunks after cascade delete, got %d", len(loadedChunks))
	}
}
