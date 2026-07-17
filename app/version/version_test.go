//go:build windows || darwin

package version

import "testing"

func TestVersionValue(t *testing.T) {
	if Version != "6.0.0" {
		t.Errorf("expected Version to be %q, got %q", "6.0.0", Version)
	}
}

func TestVersionNotEmpty(t *testing.T) {
	if Version == "" {
		t.Error("Version should not be empty")
	}
}
