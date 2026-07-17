//go:build windows || darwin

package ui

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ollama/ollama/app/store"
	"github.com/ollama/ollama/app/ui/responses"
)

// setupAPIServer creates a test Server backed by a temp SQLite DB.
// The returned restartCalled pointer tracks whether Restart was invoked.
func setupAPIServer(t *testing.T) (*Server, *bool) {
	t.Helper()
	s := &store.Store{DBPath: filepath.Join(t.TempDir(), "test.db")}
	// Trigger DB initialization
	_, _ = s.Settings()
	t.Cleanup(func() { s.Close() })

	restartCalled := false
	srv := &Server{
		Store:   s,
		Dev:     true,
		Restart: func() { restartCalled = true },
	}
	return srv, &restartCalled
}

// chatCounter ensures unique IDs even when time.Now().UnixNano() returns the
// same value for consecutive calls (Windows timer resolution ~100ns).
var chatCounter atomic.Int64

// createTestChat is a helper that creates a chat in the store and returns its ID.
func createTestChat(t *testing.T, s *store.Store, title string, messages []store.Message) string {
	t.Helper()
	n := chatCounter.Add(1)
	chat := store.NewChat(fmt.Sprintf("test-%d-%d", time.Now().UnixNano(), n))
	chat.Title = title
	chat.Messages = messages
	if err := s.SetChat(*chat); err != nil {
		t.Fatalf("failed to create test chat: %v", err)
	}
	return chat.ID
}

// ──────────────────────────────────────────────────────────────
// 1. GET listChats — empty DB returns empty chatInfos array
// ──────────────────────────────────────────────────────────────
func TestListChats_EmptyDB(t *testing.T) {
	srv, _ := setupAPIServer(t)

	req := httptest.NewRequest("GET", "/api/v1/chats", nil)
	rr := httptest.NewRecorder()

	if err := srv.listChats(rr, req); err != nil {
		t.Fatalf("listChats returned error: %v", err)
	}

	if rr.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", rr.Code, http.StatusOK)
	}

	var resp responses.ChatsResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	if resp.ChatInfos == nil {
		t.Fatal("chatInfos should not be nil")
	}
	if len(resp.ChatInfos) != 0 {
		t.Errorf("chatInfos length = %d, want 0", len(resp.ChatInfos))
	}
}

// ──────────────────────────────────────────────────────────────
// 2. GET listChats — returns 3 items after creating 3 chats
// ──────────────────────────────────────────────────────────────
func TestListChats_ThreeChats(t *testing.T) {
	srv, _ := setupAPIServer(t)

	for i, title := range []string{"Alpha", "Beta", "Gamma"} {
		msg := store.NewMessage("user", "hello "+title, nil)
		createTestChat(t, srv.Store, title, []store.Message{msg})
		// Tiny sleep to ensure distinct created_at timestamps
		if i < 2 {
			time.Sleep(5 * time.Millisecond)
		}
	}

	req := httptest.NewRequest("GET", "/api/v1/chats", nil)
	rr := httptest.NewRecorder()

	if err := srv.listChats(rr, req); err != nil {
		t.Fatalf("listChats returned error: %v", err)
	}

	var resp responses.ChatsResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	if len(resp.ChatInfos) != 3 {
		t.Errorf("chatInfos length = %d, want 3", len(resp.ChatInfos))
	}
}

// ──────────────────────────────────────────────────────────────
// 3. GET getChat — returns 200 with messages
// ──────────────────────────────────────────────────────────────
func TestGetChat_WithMessages(t *testing.T) {
	srv, _ := setupAPIServer(t)

	msgs := []store.Message{
		store.NewMessage("user", "What is Go?", nil),
		store.NewMessage("assistant", "Go is a programming language.", nil),
	}
	chatID := createTestChat(t, srv.Store, "Go chat", msgs)

	req := httptest.NewRequest("GET", "/api/v1/chat/"+chatID, nil)
	req.SetPathValue("id", chatID)
	rr := httptest.NewRecorder()

	if err := srv.getChat(rr, req); err != nil {
		t.Fatalf("getChat returned error: %v", err)
	}

	if rr.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", rr.Code, http.StatusOK)
	}

	var resp responses.ChatResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	if resp.Chat.ID != chatID {
		t.Errorf("chat ID = %q, want %q", resp.Chat.ID, chatID)
	}
	if len(resp.Chat.Messages) != 2 {
		t.Errorf("messages count = %d, want 2", len(resp.Chat.Messages))
	}
	if resp.Chat.Messages[0].Content != "What is Go?" {
		t.Errorf("first message content = %q, want %q", resp.Chat.Messages[0].Content, "What is Go?")
	}
}

// ──────────────────────────────────────────────────────────────
// 4. GET getChat — nonexistent ID returns empty chat (not error)
// ──────────────────────────────────────────────────────────────
func TestGetChat_Nonexistent(t *testing.T) {
	srv, _ := setupAPIServer(t)

	req := httptest.NewRequest("GET", "/api/v1/chat/does-not-exist", nil)
	req.SetPathValue("id", "does-not-exist")
	rr := httptest.NewRecorder()

	// getChat returns nil error for nonexistent — returns empty chat
	err := srv.getChat(rr, req)
	if err != nil {
		t.Fatalf("getChat returned error: %v", err)
	}

	var resp responses.ChatResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	// Empty chat has empty ID
	if resp.Chat.ID != "" {
		t.Errorf("expected empty chat ID for nonexistent, got %q", resp.Chat.ID)
	}
}

// ──────────────────────────────────────────────────────────────
// 5. DELETE deleteChat — success then getChat returns empty
// ──────────────────────────────────────────────────────────────
func TestDeleteChat_Success(t *testing.T) {
	srv, _ := setupAPIServer(t)

	chatID := createTestChat(t, srv.Store, "to-delete", []store.Message{
		store.NewMessage("user", "bye", nil),
	})

	// Delete
	req := httptest.NewRequest("DELETE", "/api/v1/chat/"+chatID, nil)
	req.SetPathValue("id", chatID)
	rr := httptest.NewRecorder()

	if err := srv.deleteChat(rr, req); err != nil {
		t.Fatalf("deleteChat returned error: %v", err)
	}
	if rr.Code != http.StatusOK {
		t.Errorf("delete status = %d, want %d", rr.Code, http.StatusOK)
	}

	// Confirm deleted: getChat should return empty chat
	req2 := httptest.NewRequest("GET", "/api/v1/chat/"+chatID, nil)
	req2.SetPathValue("id", chatID)
	rr2 := httptest.NewRecorder()

	if err := srv.getChat(rr2, req2); err != nil {
		t.Fatalf("getChat after delete returned error: %v", err)
	}

	var resp responses.ChatResponse
	if err := json.NewDecoder(rr2.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.Chat.ID != "" {
		t.Errorf("expected empty chat after delete, got ID %q", resp.Chat.ID)
	}
}

// ──────────────────────────────────────────────────────────────
// 6. DELETE deleteChat — nonexistent returns error
// ──────────────────────────────────────────────────────────────
func TestDeleteChat_Nonexistent(t *testing.T) {
	srv, _ := setupAPIServer(t)

	req := httptest.NewRequest("DELETE", "/api/v1/chat/nonexistent-id", nil)
	req.SetPathValue("id", "nonexistent-id")
	rr := httptest.NewRecorder()

	err := srv.deleteChat(rr, req)
	if err == nil {
		t.Error("expected error for deleting nonexistent chat, got nil")
	}
}

// ──────────────────────────────────────────────────────────────
// 7. PUT renameChat — title changes
// ──────────────────────────────────────────────────────────────
func TestRenameChat_Success(t *testing.T) {
	srv, _ := setupAPIServer(t)

	chatID := createTestChat(t, srv.Store, "Old Title", []store.Message{
		store.NewMessage("user", "hi", nil),
	})

	body, _ := json.Marshal(map[string]string{"title": "New Title"})
	req := httptest.NewRequest("PUT", "/api/v1/chat/"+chatID+"/rename", bytes.NewReader(body))
	req.SetPathValue("id", chatID)
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	if err := srv.renameChat(rr, req); err != nil {
		t.Fatalf("renameChat returned error: %v", err)
	}

	// Verify via the response
	var info responses.ChatInfo
	if err := json.NewDecoder(rr.Body).Decode(&info); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if info.Title != "New Title" {
		t.Errorf("title = %q, want %q", info.Title, "New Title")
	}

	// Double-check via store
	chat, err := srv.Store.Chat(chatID)
	if err != nil {
		t.Fatalf("store.Chat: %v", err)
	}
	if chat.Title != "New Title" {
		t.Errorf("store title = %q, want %q", chat.Title, "New Title")
	}
}

// ──────────────────────────────────────────────────────────────
// 8. PUT renameChat — empty body returns error
// ──────────────────────────────────────────────────────────────
func TestRenameChat_EmptyBody(t *testing.T) {
	srv, _ := setupAPIServer(t)

	chatID := createTestChat(t, srv.Store, "Some Title", []store.Message{
		store.NewMessage("user", "hi", nil),
	})

	req := httptest.NewRequest("PUT", "/api/v1/chat/"+chatID+"/rename", bytes.NewReader(nil))
	req.SetPathValue("id", chatID)
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	err := srv.renameChat(rr, req)
	if err == nil {
		t.Error("expected error for empty body, got nil")
	}
}

// ──────────────────────────────────────────────────────────────
// 9. PUT pinChat — pin/unpin roundtrip
// ──────────────────────────────────────────────────────────────
func TestPinChat_Roundtrip(t *testing.T) {
	srv, _ := setupAPIServer(t)

	chatID := createTestChat(t, srv.Store, "Pin test", []store.Message{
		store.NewMessage("user", "pin me", nil),
	})

	// Pin
	body, _ := json.Marshal(map[string]bool{"pinned": true})
	req := httptest.NewRequest("PUT", "/api/v1/chat/"+chatID+"/pin", bytes.NewReader(body))
	req.SetPathValue("id", chatID)
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	if err := srv.pinChat(rr, req); err != nil {
		t.Fatalf("pinChat(true) returned error: %v", err)
	}
	if rr.Code != http.StatusOK {
		t.Errorf("pin status = %d, want %d", rr.Code, http.StatusOK)
	}

	// Verify pinned via store
	chat, err := srv.Store.Chat(chatID)
	if err != nil {
		t.Fatalf("store.Chat: %v", err)
	}
	if !chat.Pinned {
		t.Error("expected chat to be pinned")
	}

	// Unpin
	body2, _ := json.Marshal(map[string]bool{"pinned": false})
	req2 := httptest.NewRequest("PUT", "/api/v1/chat/"+chatID+"/pin", bytes.NewReader(body2))
	req2.SetPathValue("id", chatID)
	req2.Header.Set("Content-Type", "application/json")
	rr2 := httptest.NewRecorder()

	if err := srv.pinChat(rr2, req2); err != nil {
		t.Fatalf("pinChat(false) returned error: %v", err)
	}

	chat2, err := srv.Store.Chat(chatID)
	if err != nil {
		t.Fatalf("store.Chat after unpin: %v", err)
	}
	if chat2.Pinned {
		t.Error("expected chat to be unpinned")
	}
}

// ──────────────────────────────────────────────────────────────
// 10. PUT setChatFolder — set + clear folder
// ──────────────────────────────────────────────────────────────
func TestSetChatFolder_SetAndClear(t *testing.T) {
	srv, _ := setupAPIServer(t)

	chatID := createTestChat(t, srv.Store, "Folder test", []store.Message{
		store.NewMessage("user", "folder me", nil),
	})

	// Set folder
	body, _ := json.Marshal(map[string]string{"folder": "Work"})
	req := httptest.NewRequest("PUT", "/api/v1/chat/"+chatID+"/folder", bytes.NewReader(body))
	req.SetPathValue("id", chatID)
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	if err := srv.setChatFolder(rr, req); err != nil {
		t.Fatalf("setChatFolder returned error: %v", err)
	}
	if rr.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", rr.Code, http.StatusOK)
	}

	// Verify folder via listChats
	chat, err := srv.Store.Chat(chatID)
	if err != nil {
		t.Fatalf("store.Chat: %v", err)
	}
	if chat.Folder != "Work" {
		t.Errorf("folder = %q, want %q", chat.Folder, "Work")
	}

	// Clear folder
	body2, _ := json.Marshal(map[string]string{"folder": ""})
	req2 := httptest.NewRequest("PUT", "/api/v1/chat/"+chatID+"/folder", bytes.NewReader(body2))
	req2.SetPathValue("id", chatID)
	req2.Header.Set("Content-Type", "application/json")
	rr2 := httptest.NewRecorder()

	if err := srv.setChatFolder(rr2, req2); err != nil {
		t.Fatalf("setChatFolder(clear) returned error: %v", err)
	}

	chat2, err := srv.Store.Chat(chatID)
	if err != nil {
		t.Fatalf("store.Chat after clear: %v", err)
	}
	if chat2.Folder != "" {
		t.Errorf("folder after clear = %q, want empty", chat2.Folder)
	}
}

// ──────────────────────────────────────────────────────────────
// 11. GET getSettings — returns 200 with settings JSON
// ──────────────────────────────────────────────────────────────
func TestGetSettings_OK(t *testing.T) {
	srv, _ := setupAPIServer(t)

	req := httptest.NewRequest("GET", "/api/v1/settings", nil)
	rr := httptest.NewRecorder()

	if err := srv.getSettings(rr, req); err != nil {
		t.Fatalf("getSettings returned error: %v", err)
	}

	if rr.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", rr.Code, http.StatusOK)
	}

	var resp responses.SettingsResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	// ContextLength defaults to 4096 in DB (capped at 2048 in runtime)
	if resp.Settings.ContextLength != 4096 {
		t.Errorf("default ContextLength = %d, want 4096", resp.Settings.ContextLength)
	}
}

// ──────────────────────────────────────────────────────────────
// 12. POST settings — field changed on next GET
// ──────────────────────────────────────────────────────────────
func TestPostSettings_UpdateField(t *testing.T) {
	srv, _ := setupAPIServer(t)

	// Update a boolean setting
	newSettings := store.Settings{
		RAGEnabled: true,
		Theme:      "nord",
	}
	body, _ := json.Marshal(newSettings)
	req := httptest.NewRequest("POST", "/api/v1/settings", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	if err := srv.settings(rr, req); err != nil {
		t.Fatalf("settings POST returned error: %v", err)
	}

	// Read back via store to confirm persistence
	saved, err := srv.Store.Settings()
	if err != nil {
		t.Fatalf("store.Settings: %v", err)
	}
	if !saved.RAGEnabled {
		t.Error("expected RAGEnabled = true after POST")
	}
	if saved.Theme != "nord" {
		t.Errorf("Theme = %q, want %q", saved.Theme, "nord")
	}
}

// ──────────────────────────────────────────────────────────────
// 13. POST settings with performance change — Restart called
// ──────────────────────────────────────────────────────────────
func TestPostSettings_RestartCalled(t *testing.T) {
	srv, restartCalled := setupAPIServer(t)

	// Changing ContextLength triggers Restart
	newSettings := store.Settings{
		ContextLength: 4096,
	}
	body, _ := json.Marshal(newSettings)
	req := httptest.NewRequest("POST", "/api/v1/settings", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	if err := srv.settings(rr, req); err != nil {
		t.Fatalf("settings POST returned error: %v", err)
	}

	if rr.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", rr.Code, http.StatusOK)
	}

	if !*restartCalled {
		t.Error("expected Restart to be called when ContextLength changes")
	}
}

// ──────────────────────────────────────────────────────────────
// 14. GET authStatus — no password → passwordEnabled: false
// ──────────────────────────────────────────────────────────────
func TestAuthStatus_NoPassword(t *testing.T) {
	srv, _ := setupAPIServer(t)

	req := httptest.NewRequest("GET", "/api/v1/auth/status", nil)
	rr := httptest.NewRecorder()

	if err := srv.authStatus(rr, req); err != nil {
		t.Fatalf("authStatus returned error: %v", err)
	}

	var resp map[string]bool
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	if resp["passwordEnabled"] {
		t.Error("expected passwordEnabled = false when no password set")
	}
}

// ──────────────────────────────────────────────────────────────
// 15. GET searchChats — empty query returns empty results
// ──────────────────────────────────────────────────────────────
func TestSearchChats_EmptyQuery(t *testing.T) {
	srv, _ := setupAPIServer(t)

	// Enable search first
	settings, _ := srv.Store.Settings()
	settings.SearchEnabled = true
	if err := srv.Store.SetSettings(settings); err != nil {
		t.Fatalf("failed to enable search: %v", err)
	}

	req := httptest.NewRequest("GET", "/api/v1/search?q=", nil)
	rr := httptest.NewRecorder()

	if err := srv.searchChats(rr, req); err != nil {
		t.Fatalf("searchChats returned error: %v", err)
	}

	var resp responses.SearchResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	if resp.Results == nil {
		t.Fatal("results should not be nil")
	}
	if len(resp.Results) != 0 {
		t.Errorf("results length = %d, want 0", len(resp.Results))
	}
}

// ──────────────────────────────────────────────────────────────
// 16. GET searchChats — keyword search finds matching chats
// ──────────────────────────────────────────────────────────────
func TestSearchChats_FindsMatch(t *testing.T) {
	srv, _ := setupAPIServer(t)

	// Enable search
	settings, _ := srv.Store.Settings()
	settings.SearchEnabled = true
	if err := srv.Store.SetSettings(settings); err != nil {
		t.Fatalf("failed to enable search: %v", err)
	}

	// Create chats with identifiable content
	createTestChat(t, srv.Store, "Golang tutorial", []store.Message{
		store.NewMessage("user", "How do I write a goroutine?", nil),
		store.NewMessage("assistant", "Use the go keyword.", nil),
	})
	createTestChat(t, srv.Store, "Recipe", []store.Message{
		store.NewMessage("user", "How to make pasta?", nil),
	})

	req := httptest.NewRequest("GET", "/api/v1/search?q=goroutine", nil)
	rr := httptest.NewRecorder()

	if err := srv.searchChats(rr, req); err != nil {
		t.Fatalf("searchChats returned error: %v", err)
	}

	var resp responses.SearchResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	if len(resp.Results) == 0 {
		t.Fatal("expected at least 1 search result for 'goroutine'")
	}

	// All results should reference the Golang chat
	for _, r := range resp.Results {
		if !strings.Contains(strings.ToLower(r.Excerpt), "goroutine") &&
			!strings.Contains(strings.ToLower(r.ChatTitle), "goroutine") {
			t.Errorf("unexpected result: title=%q excerpt=%q", r.ChatTitle, r.Excerpt)
		}
	}
}

// ──────────────────────────────────────────────────────────────
// 17. GET ragListDocuments — empty returns empty array
// ──────────────────────────────────────────────────────────────
func TestRAGListDocuments_Empty(t *testing.T) {
	srv, _ := setupAPIServer(t)

	req := httptest.NewRequest("GET", "/api/v1/rag/documents", nil)
	rr := httptest.NewRecorder()

	if err := srv.ragListDocuments(rr, req); err != nil {
		t.Fatalf("ragListDocuments returned error: %v", err)
	}

	var docs []store.RAGDocument
	if err := json.NewDecoder(rr.Body).Decode(&docs); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	if docs == nil {
		t.Fatal("docs should not be nil")
	}
	if len(docs) != 0 {
		t.Errorf("docs length = %d, want 0", len(docs))
	}
}

// ──────────────────────────────────────────────────────────────
// 18. GET ragListDocuments — returns inserted document
// ──────────────────────────────────────────────────────────────
func TestRAGListDocuments_WithDocument(t *testing.T) {
	srv, _ := setupAPIServer(t)

	doc := store.RAGDocument{
		ID:             "doc-123",
		Filename:       "notes.txt",
		FileSize:       1024,
		ContentHash:    "abc123hash",
		ChunkCount:     5,
		Status:         "ready",
		EmbeddingModel: "snowflake-arctic-embed:33m",
		CreatedAt:      time.Now(),
		UpdatedAt:      time.Now(),
	}
	if err := srv.Store.InsertRAGDocument(doc); err != nil {
		t.Fatalf("InsertRAGDocument: %v", err)
	}

	req := httptest.NewRequest("GET", "/api/v1/rag/documents", nil)
	rr := httptest.NewRecorder()

	if err := srv.ragListDocuments(rr, req); err != nil {
		t.Fatalf("ragListDocuments returned error: %v", err)
	}

	var docs []store.RAGDocument
	if err := json.NewDecoder(rr.Body).Decode(&docs); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	if len(docs) != 1 {
		t.Fatalf("docs length = %d, want 1", len(docs))
	}
	if docs[0].ID != "doc-123" {
		t.Errorf("doc ID = %q, want %q", docs[0].ID, "doc-123")
	}
	if docs[0].Filename != "notes.txt" {
		t.Errorf("doc filename = %q, want %q", docs[0].Filename, "notes.txt")
	}
}

// ──────────────────────────────────────────────────────────────
// 19. POST renameChat — malformed JSON returns error
// ──────────────────────────────────────────────────────────────
func TestRenameChat_MalformedJSON(t *testing.T) {
	srv, _ := setupAPIServer(t)

	chatID := createTestChat(t, srv.Store, "JSON test", []store.Message{
		store.NewMessage("user", "hi", nil),
	})

	// Send invalid JSON
	req := httptest.NewRequest("PUT", "/api/v1/chat/"+chatID+"/rename",
		bytes.NewReader([]byte("{invalid json")))
	req.SetPathValue("id", chatID)
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	err := srv.renameChat(rr, req)
	if err == nil {
		t.Error("expected error for malformed JSON, got nil")
	}
	if !strings.Contains(err.Error(), "invalid request body") {
		t.Errorf("error = %q, want it to contain 'invalid request body'", err.Error())
	}
}

// ──────────────────────────────────────────────────────────────
// 20. POST settings — oversized body (>10MB) returns error
// ──────────────────────────────────────────────────────────────
func TestPostSettings_OversizedBody(t *testing.T) {
	srv, _ := setupAPIServer(t)

	// Create a body larger than the 10MB limit used in LimitReader
	// The handler uses io.LimitReader(r.Body, 10<<20) = 10MB
	// After reading 10MB, the JSON decoder will fail because the
	// JSON is truncated or invalid.
	bigBody := make([]byte, 11<<20) // 11 MB
	// Fill with valid JSON start but way too long
	bigBody[0] = '{'
	bigBody[1] = '"'
	bigBody[2] = 'x'
	bigBody[3] = '"'
	bigBody[4] = ':'
	bigBody[5] = '"'
	for i := 6; i < len(bigBody)-1; i++ {
		bigBody[i] = 'A'
	}
	bigBody[len(bigBody)-1] = '"'
	// Note: missing closing brace — the LimitReader will truncate, causing decode error

	req := httptest.NewRequest("POST", "/api/v1/settings", bytes.NewReader(bigBody))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	err := srv.settings(rr, req)
	if err == nil {
		t.Error("expected error for oversized body, got nil")
	}
}
