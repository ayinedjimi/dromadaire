//go:build windows || darwin

package ui

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ollama/ollama/app/store"
	"golang.org/x/crypto/bcrypt"
)

func setupTestServer(t *testing.T) *Server {
	t.Helper()
	tmpDir := t.TempDir()
	s := &store.Store{DBPath: filepath.Join(tmpDir, "test.db")}
	// Trigger DB init by reading settings (auto-creates tables)
	_, _ = s.Settings()
	return &Server{
		Store:   s,
		Dev:     true,
		Restart: func() {},
	}
}

// ==================== Security Headers ====================

func TestSecurityHeaders_XContentTypeOptions(t *testing.T) {
	srv := setupTestServer(t)
	defer srv.Store.Close()

	handler := srv.Handler()

	req := httptest.NewRequest("GET", "/api/v1/settings", nil)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	got := rr.Header().Get("X-Content-Type-Options")
	if got != "nosniff" {
		t.Errorf("X-Content-Type-Options = %q, want %q", got, "nosniff")
	}
}

func TestSecurityHeaders_XFrameOptions(t *testing.T) {
	srv := setupTestServer(t)
	defer srv.Store.Close()

	handler := srv.Handler()

	req := httptest.NewRequest("GET", "/api/v1/settings", nil)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	got := rr.Header().Get("X-Frame-Options")
	if got != "DENY" {
		t.Errorf("X-Frame-Options = %q, want %q", got, "DENY")
	}
}

// ==================== LimitReader (body size limits) ====================

func TestSetPassword_LimitReader_UnderLimit(t *testing.T) {
	srv := setupTestServer(t)
	defer srv.Store.Close()

	// Build a JSON body under the 10MB limit but large enough to be meaningful.
	// Use a short password (bcrypt has a 72 byte limit) and pad with an extra field.
	// json.NewDecoder ignores unknown fields, so the padding field is harmless.
	padding := strings.Repeat("x", 5<<20)
	payload := map[string]string{"password": "validpass", "padding": padding}
	body, _ := json.Marshal(payload)

	req := httptest.NewRequest("POST", "/api/v1/auth/set-password", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	err := srv.setPassword(rr, req)
	if err != nil {
		t.Fatalf("setPassword returned unexpected error: %v", err)
	}

	// Password is >= 4 chars so it should succeed
	if rr.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", rr.Code, http.StatusOK)
	}
}

func TestSetPassword_LimitReader_OverLimit(t *testing.T) {
	srv := setupTestServer(t)
	defer srv.Store.Close()

	// Build a JSON body exceeding the 10MB limit.
	// The LimitReader truncates at 10<<20, so the JSON decoder
	// should fail with an unexpected EOF or similar error.
	padding := strings.Repeat("a", 11<<20)
	body, _ := json.Marshal(map[string]string{"password": padding})

	req := httptest.NewRequest("POST", "/api/v1/auth/set-password", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	err := srv.setPassword(rr, req)
	if err == nil {
		t.Fatal("expected error from setPassword with oversized body, got nil")
	}
	if !strings.Contains(err.Error(), "invalid request body") {
		t.Errorf("error = %q, want it to contain %q", err.Error(), "invalid request body")
	}
}

func TestVerifyPassword_LimitReader_UnderLimit(t *testing.T) {
	srv := setupTestServer(t)
	defer srv.Store.Close()

	// verifyPassword uses 1<<20 (1MB) limit.
	// Build a body under 1MB.
	padding := strings.Repeat("a", 500<<10) // ~500KB
	body, _ := json.Marshal(map[string]string{"password": padding})

	req := httptest.NewRequest("POST", "/api/v1/auth/verify-password", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	err := srv.verifyPassword(rr, req)
	if err != nil {
		t.Fatalf("verifyPassword returned unexpected error: %v", err)
	}

	// No password is set, so it should return authenticated: true
	if rr.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", rr.Code, http.StatusOK)
	}
}

func TestVerifyPassword_LimitReader_OverLimit(t *testing.T) {
	srv := setupTestServer(t)
	defer srv.Store.Close()

	// verifyPassword uses 1<<20 (1MB) limit.
	// Build a body exceeding 1MB so the LimitReader truncates it.
	padding := strings.Repeat("a", 2<<20) // 2MB
	body, _ := json.Marshal(map[string]string{"password": padding})

	req := httptest.NewRequest("POST", "/api/v1/auth/verify-password", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	err := srv.verifyPassword(rr, req)
	if err == nil {
		t.Fatal("expected error from verifyPassword with oversized body, got nil")
	}
	if !strings.Contains(err.Error(), "invalid request body") {
		t.Errorf("error = %q, want it to contain %q", err.Error(), "invalid request body")
	}
}

// ==================== Password + bcrypt cost 13 ====================

func TestSetPassword_TooShort(t *testing.T) {
	srv := setupTestServer(t)
	defer srv.Store.Close()

	body, _ := json.Marshal(map[string]string{"password": "ab"})
	req := httptest.NewRequest("POST", "/api/v1/auth/set-password", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	err := srv.setPassword(rr, req)
	if err != nil {
		t.Fatalf("setPassword returned unexpected error: %v", err)
	}

	if rr.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", rr.Code, http.StatusBadRequest)
	}

	var resp map[string]string
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if resp["error"] != "password must be at least 4 characters" {
		t.Errorf("error = %q, want %q", resp["error"], "password must be at least 4 characters")
	}
}

func TestSetPassword_ValidMinLength(t *testing.T) {
	srv := setupTestServer(t)
	defer srv.Store.Close()

	body, _ := json.Marshal(map[string]string{"password": "abcd"})
	req := httptest.NewRequest("POST", "/api/v1/auth/set-password", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	err := srv.setPassword(rr, req)
	if err != nil {
		t.Fatalf("setPassword returned error: %v", err)
	}

	if rr.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", rr.Code, http.StatusOK)
	}

	var resp map[string]bool
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if !resp["ok"] {
		t.Error("expected ok=true in response")
	}
}

func TestSetPassword_BcryptCost13(t *testing.T) {
	srv := setupTestServer(t)
	defer srv.Store.Close()

	body, _ := json.Marshal(map[string]string{"password": "testpassword123"})
	req := httptest.NewRequest("POST", "/api/v1/auth/set-password", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	err := srv.setPassword(rr, req)
	if err != nil {
		t.Fatalf("setPassword returned error: %v", err)
	}

	// Read the stored hash from the database
	settings, err := srv.Store.Settings()
	if err != nil {
		t.Fatalf("failed to read settings: %v", err)
	}

	if !settings.PasswordEnabled {
		t.Fatal("expected PasswordEnabled to be true")
	}

	cost, err := bcrypt.Cost([]byte(settings.PasswordHash))
	if err != nil {
		t.Fatalf("failed to get bcrypt cost: %v", err)
	}
	if cost != 13 {
		t.Errorf("bcrypt cost = %d, want 13", cost)
	}
}

// ==================== verifyPassword correctness ====================

func TestVerifyPassword_Correct(t *testing.T) {
	srv := setupTestServer(t)
	defer srv.Store.Close()

	password := "securepass"

	// First set a password
	setBody, _ := json.Marshal(map[string]string{"password": password})
	setReq := httptest.NewRequest("POST", "/api/v1/auth/set-password", bytes.NewReader(setBody))
	setReq.Header.Set("Content-Type", "application/json")
	setRR := httptest.NewRecorder()
	if err := srv.setPassword(setRR, setReq); err != nil {
		t.Fatalf("setPassword failed: %v", err)
	}

	// Verify with correct password
	verifyBody, _ := json.Marshal(map[string]string{"password": password})
	verifyReq := httptest.NewRequest("POST", "/api/v1/auth/verify-password", bytes.NewReader(verifyBody))
	verifyReq.Header.Set("Content-Type", "application/json")
	verifyRR := httptest.NewRecorder()

	err := srv.verifyPassword(verifyRR, verifyReq)
	if err != nil {
		t.Fatalf("verifyPassword returned error: %v", err)
	}

	var resp map[string]interface{}
	if err := json.NewDecoder(verifyRR.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if resp["authenticated"] != true {
		t.Errorf("authenticated = %v, want true", resp["authenticated"])
	}
}

func TestVerifyPassword_Wrong(t *testing.T) {
	srv := setupTestServer(t)
	defer srv.Store.Close()

	// Set a password
	setBody, _ := json.Marshal(map[string]string{"password": "correct"})
	setReq := httptest.NewRequest("POST", "/api/v1/auth/set-password", bytes.NewReader(setBody))
	setReq.Header.Set("Content-Type", "application/json")
	setRR := httptest.NewRecorder()
	if err := srv.setPassword(setRR, setReq); err != nil {
		t.Fatalf("setPassword failed: %v", err)
	}

	// Verify with wrong password
	verifyBody, _ := json.Marshal(map[string]string{"password": "wrong"})
	verifyReq := httptest.NewRequest("POST", "/api/v1/auth/verify-password", bytes.NewReader(verifyBody))
	verifyReq.Header.Set("Content-Type", "application/json")
	verifyRR := httptest.NewRecorder()

	err := srv.verifyPassword(verifyRR, verifyReq)
	if err != nil {
		t.Fatalf("verifyPassword returned error: %v", err)
	}

	if verifyRR.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want %d", verifyRR.Code, http.StatusUnauthorized)
	}

	var resp map[string]interface{}
	if err := json.NewDecoder(verifyRR.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if resp["authenticated"] != false {
		t.Errorf("authenticated = %v, want false", resp["authenticated"])
	}
}

func TestVerifyPassword_AttemptsDecrement(t *testing.T) {
	srv := setupTestServer(t)
	defer srv.Store.Close()

	// Set a password
	setBody, _ := json.Marshal(map[string]string{"password": "correct"})
	setReq := httptest.NewRequest("POST", "/api/v1/auth/set-password", bytes.NewReader(setBody))
	setReq.Header.Set("Content-Type", "application/json")
	setRR := httptest.NewRecorder()
	if err := srv.setPassword(setRR, setReq); err != nil {
		t.Fatalf("setPassword failed: %v", err)
	}

	// Submit wrong password 3 times and verify attemptsLeft decrements
	for i := 1; i <= 3; i++ {
		verifyBody, _ := json.Marshal(map[string]string{"password": "wrong"})
		verifyReq := httptest.NewRequest("POST", "/api/v1/auth/verify-password", bytes.NewReader(verifyBody))
		verifyReq.Header.Set("Content-Type", "application/json")
		verifyRR := httptest.NewRecorder()

		err := srv.verifyPassword(verifyRR, verifyReq)
		if err != nil {
			t.Fatalf("attempt %d: verifyPassword returned error: %v", i, err)
		}

		var resp map[string]interface{}
		if err := json.NewDecoder(verifyRR.Body).Decode(&resp); err != nil {
			t.Fatalf("attempt %d: failed to decode response: %v", i, err)
		}

		if resp["authenticated"] != false {
			t.Errorf("attempt %d: authenticated = %v, want false", i, resp["authenticated"])
		}

		expectedLeft := float64(3 - i)
		got, ok := resp["attemptsLeft"]
		if !ok {
			t.Fatalf("attempt %d: attemptsLeft missing from response", i)
		}
		if got != expectedLeft {
			t.Errorf("attempt %d: attemptsLeft = %v, want %v", i, got, expectedLeft)
		}
	}
}

// ==================== Auth token middleware ====================

func TestAuthToken_NoDev_MissingCookie(t *testing.T) {
	srv := setupTestServer(t)
	defer srv.Store.Close()

	// Disable dev mode to enforce token auth
	srv.Dev = false
	srv.Token = "secret-token-abc"

	handler := srv.Handler()

	req := httptest.NewRequest("GET", "/api/v1/settings", nil)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Errorf("status = %d, want %d", rr.Code, http.StatusForbidden)
	}

	var resp map[string]string
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if resp["error"] != "Token is required" {
		t.Errorf("error = %q, want %q", resp["error"], "Token is required")
	}
}

func TestAuthToken_NoDev_WrongCookie(t *testing.T) {
	srv := setupTestServer(t)
	defer srv.Store.Close()

	srv.Dev = false
	srv.Token = "secret-token-abc"

	handler := srv.Handler()

	req := httptest.NewRequest("GET", "/api/v1/settings", nil)
	req.AddCookie(&http.Cookie{Name: "token", Value: "wrong-token"})
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Errorf("status = %d, want %d", rr.Code, http.StatusForbidden)
	}

	var resp map[string]string
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if resp["error"] != "Token is required" {
		t.Errorf("error = %q, want %q", resp["error"], "Token is required")
	}
}

func TestAuthToken_DevMode_NoCookie(t *testing.T) {
	srv := setupTestServer(t)
	defer srv.Store.Close()

	// Dev mode is already true from setupTestServer
	srv.Token = "secret-token-abc"

	handler := srv.Handler()

	req := httptest.NewRequest("GET", "/api/v1/settings", nil)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("status = %d, want %d (dev mode should bypass auth)", rr.Code, http.StatusOK)
	}
}
