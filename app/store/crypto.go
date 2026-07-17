//go:build windows || darwin

// Dromadaire: AES-256-GCM encryption primitives for chat data at rest
package store

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

const (
	encryptedPrefix     = "ENC:"
	encryptedBytesMagic = "ENC\x00"
	keySize             = 32 // AES-256
	nonceSize           = 12 // GCM standard nonce
)

// DefaultKeyPath returns the platform-specific path for the encryption key file.
// In non-portable mode, this is the standard location.
func DefaultKeyPath() string {
	switch runtime.GOOS {
	case "windows":
		return filepath.Join(os.Getenv("LOCALAPPDATA"), "Ollama", "dromadaire.key")
	case "darwin":
		return filepath.Join(os.Getenv("HOME"), "Library", "Application Support", "Ollama", "dromadaire.key")
	default:
		return filepath.Join(os.Getenv("HOME"), ".ollama", "dromadaire.key")
	}
}

// KeyPathForDB returns the encryption key path relative to a given DB path.
// In portable mode, the key is stored next to the database (e.g. ./data/dromadaire.key).
func KeyPathForDB(dbPath string) string {
	if dbPath == "" {
		return DefaultKeyPath()
	}
	return filepath.Join(filepath.Dir(dbPath), "dromadaire.key")
}

// GenerateKey creates a cryptographically secure random 256-bit key
func GenerateKey() ([]byte, error) {
	key := make([]byte, keySize)
	if _, err := io.ReadFull(rand.Reader, key); err != nil {
		return nil, fmt.Errorf("generate encryption key: %w", err)
	}
	return key, nil
}

// SaveKey writes the encryption key to a file with restricted permissions
func SaveKey(path string, key []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("create key directory: %w", err)
	}
	if err := os.WriteFile(path, key, 0o600); err != nil {
		return fmt.Errorf("write encryption key: %w", err)
	}
	return nil
}

// LoadKey reads and validates the encryption key from a file
func LoadKey(path string) ([]byte, error) {
	key, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read encryption key: %w", err)
	}
	if len(key) != keySize {
		return nil, fmt.Errorf("invalid key size: got %d, want %d", len(key), keySize)
	}
	return key, nil
}

// EncryptString encrypts plaintext using AES-256-GCM.
// Returns "ENC:" + base64(nonce + ciphertext + tag).
// Returns empty string if plaintext is empty.
func EncryptString(key []byte, plaintext string) (string, error) {
	if plaintext == "" {
		return "", nil
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return "", fmt.Errorf("create cipher: %w", err)
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("create GCM: %w", err)
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", fmt.Errorf("generate nonce: %w", err)
	}

	// Seal appends ciphertext+tag to nonce
	sealed := gcm.Seal(nonce, nonce, []byte(plaintext), nil)
	return encryptedPrefix + base64.StdEncoding.EncodeToString(sealed), nil
}

// DecryptString decrypts a string encrypted by EncryptString.
// If the string doesn't have the "ENC:" prefix, returns it as-is (plaintext passthrough).
func DecryptString(key []byte, ciphertext string) (string, error) {
	if !strings.HasPrefix(ciphertext, encryptedPrefix) {
		return ciphertext, nil
	}

	data, err := base64.StdEncoding.DecodeString(ciphertext[len(encryptedPrefix):])
	if err != nil {
		return "", fmt.Errorf("decode base64: %w", err)
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return "", fmt.Errorf("create cipher: %w", err)
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("create GCM: %w", err)
	}

	if len(data) < gcm.NonceSize() {
		return "", fmt.Errorf("ciphertext too short")
	}

	nonce := data[:gcm.NonceSize()]
	encrypted := data[gcm.NonceSize():]

	plaintext, err := gcm.Open(nil, nonce, encrypted, nil)
	if err != nil {
		return "", fmt.Errorf("decrypt: %w", err)
	}

	return string(plaintext), nil
}

// EncryptBytes encrypts binary data using AES-256-GCM.
// Returns [ENC\x00] + nonce + ciphertext + tag.
// Returns nil if data is nil or empty.
func EncryptBytes(key []byte, data []byte) ([]byte, error) {
	if len(data) == 0 {
		return nil, nil
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("create cipher: %w", err)
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("create GCM: %w", err)
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, fmt.Errorf("generate nonce: %w", err)
	}

	sealed := gcm.Seal(nonce, nonce, data, nil)

	// Prepend magic bytes
	result := make([]byte, len(encryptedBytesMagic)+len(sealed))
	copy(result, encryptedBytesMagic)
	copy(result[len(encryptedBytesMagic):], sealed)
	return result, nil
}

// DecryptBytes decrypts binary data encrypted by EncryptBytes.
// If the data doesn't have the "ENC\x00" magic prefix, returns it as-is.
func DecryptBytes(key []byte, data []byte) ([]byte, error) {
	if !IsEncryptedBytes(data) {
		return data, nil
	}

	encData := data[len(encryptedBytesMagic):]

	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("create cipher: %w", err)
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("create GCM: %w", err)
	}

	if len(encData) < gcm.NonceSize() {
		return nil, fmt.Errorf("ciphertext too short")
	}

	nonce := encData[:gcm.NonceSize()]
	encrypted := encData[gcm.NonceSize():]

	plaintext, err := gcm.Open(nil, nonce, encrypted, nil)
	if err != nil {
		return nil, fmt.Errorf("decrypt: %w", err)
	}

	return plaintext, nil
}

// IsEncrypted checks if a string has the encrypted prefix
func IsEncrypted(s string) bool {
	return strings.HasPrefix(s, encryptedPrefix)
}

// IsEncryptedBytes checks if binary data has the encrypted magic bytes
func IsEncryptedBytes(b []byte) bool {
	if len(b) < len(encryptedBytesMagic) {
		return false
	}
	return string(b[:len(encryptedBytesMagic)]) == encryptedBytesMagic
}
