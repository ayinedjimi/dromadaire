//go:build windows || darwin

package store

import (
	"bytes"
	"encoding/base64"
	"os"
	"path/filepath"
	"testing"
)

// ==========================================================================
// GenerateKey
// ==========================================================================

func TestGenerateKey_Returns32Bytes(t *testing.T) {
	key, err := GenerateKey()
	if err != nil {
		t.Fatalf("GenerateKey failed: %v", err)
	}
	if len(key) != 32 {
		t.Errorf("expected 32 bytes, got %d", len(key))
	}
}

func TestGenerateKey_TwoCallsReturnDifferentKeys(t *testing.T) {
	key1, err := GenerateKey()
	if err != nil {
		t.Fatalf("first GenerateKey failed: %v", err)
	}
	key2, err := GenerateKey()
	if err != nil {
		t.Fatalf("second GenerateKey failed: %v", err)
	}
	if bytes.Equal(key1, key2) {
		t.Error("expected two generated keys to be different")
	}
}

// ==========================================================================
// SaveKey / LoadKey
// ==========================================================================

func TestSaveLoadKey_RoundTrip(t *testing.T) {
	tmpDir := t.TempDir()
	keyPath := filepath.Join(tmpDir, "test.key")

	key, err := GenerateKey()
	if err != nil {
		t.Fatalf("GenerateKey failed: %v", err)
	}

	if err := SaveKey(keyPath, key); err != nil {
		t.Fatalf("SaveKey failed: %v", err)
	}

	loaded, err := LoadKey(keyPath)
	if err != nil {
		t.Fatalf("LoadKey failed: %v", err)
	}

	if !bytes.Equal(key, loaded) {
		t.Error("loaded key does not match saved key")
	}
}

func TestLoadKey_WrongSizeFile(t *testing.T) {
	tmpDir := t.TempDir()
	keyPath := filepath.Join(tmpDir, "bad.key")

	// Write 16 bytes instead of the required 32
	if err := os.WriteFile(keyPath, make([]byte, 16), 0o600); err != nil {
		t.Fatalf("write bad key: %v", err)
	}

	_, err := LoadKey(keyPath)
	if err == nil {
		t.Error("expected error for wrong-size key file")
	}
}

func TestLoadKey_NonexistentFile(t *testing.T) {
	_, err := LoadKey(filepath.Join(t.TempDir(), "nonexistent.key"))
	if err == nil {
		t.Error("expected error for nonexistent key file")
	}
}

// ==========================================================================
// EncryptString
// ==========================================================================

func testKey(t *testing.T) []byte {
	t.Helper()
	key, err := GenerateKey()
	if err != nil {
		t.Fatalf("GenerateKey failed: %v", err)
	}
	return key
}

func TestEncryptString_EmptyPlaintext(t *testing.T) {
	key := testKey(t)

	result, err := EncryptString(key, "")
	if err != nil {
		t.Fatalf("EncryptString failed: %v", err)
	}
	if result != "" {
		t.Errorf("expected empty string for empty plaintext, got %q", result)
	}
}

func TestEncryptString_RoundTrip(t *testing.T) {
	key := testKey(t)
	plaintext := "Hello World"

	encrypted, err := EncryptString(key, plaintext)
	if err != nil {
		t.Fatalf("EncryptString failed: %v", err)
	}

	decrypted, err := DecryptString(key, encrypted)
	if err != nil {
		t.Fatalf("DecryptString failed: %v", err)
	}

	if decrypted != plaintext {
		t.Errorf("expected %q, got %q", plaintext, decrypted)
	}
}

func TestEncryptString_HasENCPrefix(t *testing.T) {
	key := testKey(t)

	encrypted, err := EncryptString(key, "test data")
	if err != nil {
		t.Fatalf("EncryptString failed: %v", err)
	}

	if len(encrypted) < 4 || encrypted[:4] != "ENC:" {
		t.Errorf("expected ENC: prefix, got %q", encrypted)
	}
}

func TestEncryptString_NonceUniqueness(t *testing.T) {
	key := testKey(t)
	plaintext := "same text twice"

	enc1, err := EncryptString(key, plaintext)
	if err != nil {
		t.Fatalf("first EncryptString failed: %v", err)
	}

	enc2, err := EncryptString(key, plaintext)
	if err != nil {
		t.Fatalf("second EncryptString failed: %v", err)
	}

	if enc1 == enc2 {
		t.Error("expected different ciphertexts for same plaintext (nonce should differ)")
	}
}

// ==========================================================================
// DecryptString
// ==========================================================================

func TestDecryptString_PlaintextPassthrough(t *testing.T) {
	key := testKey(t)

	// No "ENC:" prefix -- should return as-is
	result, err := DecryptString(key, "plain text without prefix")
	if err != nil {
		t.Fatalf("DecryptString failed: %v", err)
	}
	if result != "plain text without prefix" {
		t.Errorf("expected passthrough, got %q", result)
	}
}

func TestDecryptString_WrongKey(t *testing.T) {
	key1 := testKey(t)
	key2 := testKey(t)

	encrypted, err := EncryptString(key1, "secret message")
	if err != nil {
		t.Fatalf("EncryptString failed: %v", err)
	}

	_, err = DecryptString(key2, encrypted)
	if err == nil {
		t.Error("expected error when decrypting with wrong key")
	}
}

func TestDecryptString_TruncatedCiphertext(t *testing.T) {
	// "ENC:AAAA" -- valid base64 but way too short for nonce + ciphertext
	_, err := DecryptString(testKey(t), "ENC:AAAA")
	if err == nil {
		t.Error("expected error for truncated ciphertext")
	}
}

func TestDecryptString_InvalidBase64(t *testing.T) {
	_, err := DecryptString(testKey(t), "ENC:!!!invalid")
	if err == nil {
		t.Error("expected error for invalid base64")
	}
}

func TestDecryptString_TamperedCiphertext(t *testing.T) {
	key := testKey(t)

	encrypted, err := EncryptString(key, "sensitive data")
	if err != nil {
		t.Fatalf("EncryptString failed: %v", err)
	}

	// Decode the base64 payload, flip a byte, re-encode
	payload := encrypted[4:] // strip "ENC:"
	raw, err := base64.StdEncoding.DecodeString(payload)
	if err != nil {
		t.Fatalf("decode base64: %v", err)
	}

	// Flip the last byte (part of the ciphertext/tag)
	raw[len(raw)-1] ^= 0xFF
	tampered := "ENC:" + base64.StdEncoding.EncodeToString(raw)

	_, err = DecryptString(key, tampered)
	if err == nil {
		t.Error("expected error for tampered ciphertext")
	}
}

// ==========================================================================
// EncryptBytes
// ==========================================================================

func TestEncryptBytes_NilInput(t *testing.T) {
	key := testKey(t)

	result, err := EncryptBytes(key, nil)
	if err != nil {
		t.Fatalf("EncryptBytes failed: %v", err)
	}
	if result != nil {
		t.Errorf("expected nil for nil input, got %v", result)
	}
}

func TestEncryptBytes_RoundTrip(t *testing.T) {
	key := testKey(t)
	data := []byte{0x00, 0x01, 0x02, 0xFF, 0xFE, 0xFD, 0x80, 0x7F}

	encrypted, err := EncryptBytes(key, data)
	if err != nil {
		t.Fatalf("EncryptBytes failed: %v", err)
	}

	decrypted, err := DecryptBytes(key, encrypted)
	if err != nil {
		t.Fatalf("DecryptBytes failed: %v", err)
	}

	if !bytes.Equal(data, decrypted) {
		t.Errorf("expected %v, got %v", data, decrypted)
	}
}

func TestEncryptBytes_MagicPrefix(t *testing.T) {
	key := testKey(t)

	encrypted, err := EncryptBytes(key, []byte("binary payload"))
	if err != nil {
		t.Fatalf("EncryptBytes failed: %v", err)
	}

	magic := "ENC\x00"
	if len(encrypted) < len(magic) || string(encrypted[:len(magic)]) != magic {
		t.Errorf("expected magic bytes %q prefix, got first 4 bytes %v", magic, encrypted[:4])
	}
}

// ==========================================================================
// DecryptBytes
// ==========================================================================

func TestDecryptBytes_WithoutMagicPassthrough(t *testing.T) {
	key := testKey(t)
	plain := []byte("not encrypted data")

	result, err := DecryptBytes(key, plain)
	if err != nil {
		t.Fatalf("DecryptBytes failed: %v", err)
	}
	if !bytes.Equal(plain, result) {
		t.Errorf("expected passthrough, got %v", result)
	}
}

func TestDecryptBytes_WrongKey(t *testing.T) {
	key1 := testKey(t)
	key2 := testKey(t)

	encrypted, err := EncryptBytes(key1, []byte("secret bytes"))
	if err != nil {
		t.Fatalf("EncryptBytes failed: %v", err)
	}

	_, err = DecryptBytes(key2, encrypted)
	if err == nil {
		t.Error("expected error when decrypting bytes with wrong key")
	}
}

// ==========================================================================
// IsEncrypted / IsEncryptedBytes
// ==========================================================================

func TestIsEncrypted(t *testing.T) {
	if !IsEncrypted("ENC:somedata") {
		t.Error("expected IsEncrypted to return true for 'ENC:somedata'")
	}
	if IsEncrypted("plain text") {
		t.Error("expected IsEncrypted to return false for 'plain text'")
	}
	if IsEncrypted("") {
		t.Error("expected IsEncrypted to return false for empty string")
	}
}

// ==========================================================================
// Store integration: SetEncryptionEnabled
// ==========================================================================

func TestStoreEncryption_EnableThenReadChat(t *testing.T) {
	s, cleanup := setupTestStore(t)
	defer cleanup()

	// Initialize DB by reading settings
	if _, err := s.Settings(); err != nil {
		t.Fatal(err)
	}

	// Create a chat with plaintext data
	chat := NewChat("enc-test-1")
	chat.Title = "My Secret Chat"
	chat.Messages = append(chat.Messages,
		NewMessage("user", "What is the password?", nil),
		NewMessage("assistant", "I cannot share passwords.", &MessageOptions{
			Model:    "llama4",
			Thinking: "The user wants a password, I should refuse.",
		}),
	)
	if err := s.SetChat(*chat); err != nil {
		t.Fatalf("SetChat failed: %v", err)
	}

	// Enable encryption (migrates existing data + generates key)
	if err := s.SetEncryptionEnabled(true); err != nil {
		t.Fatalf("SetEncryptionEnabled(true) failed: %v", err)
	}
	// Persist the setting so getEncryptionKey returns the key on subsequent reads
	if err := s.SetSettings(Settings{EncryptionEnabled: true}); err != nil {
		t.Fatalf("SetSettings failed: %v", err)
	}

	// Read the chat back -- Store.Chat() should decrypt transparently
	retrieved, err := s.Chat("enc-test-1")
	if err != nil {
		t.Fatalf("Chat failed: %v", err)
	}

	if retrieved.Title != "My Secret Chat" {
		t.Errorf("expected title 'My Secret Chat', got %q", retrieved.Title)
	}
	if len(retrieved.Messages) != 2 {
		t.Fatalf("expected 2 messages, got %d", len(retrieved.Messages))
	}
	if retrieved.Messages[0].Content != "What is the password?" {
		t.Errorf("expected user content 'What is the password?', got %q", retrieved.Messages[0].Content)
	}
	if retrieved.Messages[1].Content != "I cannot share passwords." {
		t.Errorf("expected assistant content 'I cannot share passwords.', got %q", retrieved.Messages[1].Content)
	}
	if retrieved.Messages[1].Thinking != "The user wants a password, I should refuse." {
		t.Errorf("expected thinking text, got %q", retrieved.Messages[1].Thinking)
	}
}

func TestStoreEncryption_EnableThenDisable_BackToPlaintext(t *testing.T) {
	s, cleanup := setupTestStore(t)
	defer cleanup()

	// Initialize DB
	if _, err := s.Settings(); err != nil {
		t.Fatal(err)
	}

	// Create a chat with plaintext data
	chat := NewChat("enc-test-2")
	chat.Title = "Toggled Chat"
	chat.Messages = append(chat.Messages,
		NewMessage("user", "toggle test message", nil),
	)
	if err := s.SetChat(*chat); err != nil {
		t.Fatalf("SetChat failed: %v", err)
	}

	// Enable encryption
	if err := s.SetEncryptionEnabled(true); err != nil {
		t.Fatalf("SetEncryptionEnabled(true) failed: %v", err)
	}
	if err := s.SetSettings(Settings{EncryptionEnabled: true}); err != nil {
		t.Fatalf("SetSettings(enabled) failed: %v", err)
	}

	// Verify data is encrypted in the raw DB by reading directly
	// (the Chat() method decrypts, so we check that the underlying data was encrypted)
	rawChat, err := s.db.getChatWithOptions("enc-test-2", false)
	if err != nil {
		t.Fatalf("getChatWithOptions failed: %v", err)
	}
	if !IsEncrypted(rawChat.Title) {
		t.Error("expected raw title to be encrypted after enabling encryption")
	}
	if len(rawChat.Messages) > 0 && !IsEncrypted(rawChat.Messages[0].Content) {
		t.Error("expected raw message content to be encrypted after enabling encryption")
	}

	// Now disable encryption
	if err := s.SetEncryptionEnabled(false); err != nil {
		t.Fatalf("SetEncryptionEnabled(false) failed: %v", err)
	}
	if err := s.SetSettings(Settings{EncryptionEnabled: false}); err != nil {
		t.Fatalf("SetSettings(disabled) failed: %v", err)
	}

	// Read raw data again -- should be back to plaintext
	rawChat2, err := s.db.getChatWithOptions("enc-test-2", false)
	if err != nil {
		t.Fatalf("getChatWithOptions after disable failed: %v", err)
	}
	if rawChat2.Title != "Toggled Chat" {
		t.Errorf("expected plaintext title 'Toggled Chat', got %q", rawChat2.Title)
	}
	if len(rawChat2.Messages) > 0 && rawChat2.Messages[0].Content != "toggle test message" {
		t.Errorf("expected plaintext content 'toggle test message', got %q", rawChat2.Messages[0].Content)
	}

	// And the high-level API should still return correct data
	retrieved, err := s.Chat("enc-test-2")
	if err != nil {
		t.Fatalf("Chat after disable failed: %v", err)
	}
	if retrieved.Title != "Toggled Chat" {
		t.Errorf("expected title 'Toggled Chat', got %q", retrieved.Title)
	}
	if retrieved.Messages[0].Content != "toggle test message" {
		t.Errorf("expected content 'toggle test message', got %q", retrieved.Messages[0].Content)
	}
}
