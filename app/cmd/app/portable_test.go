package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDetectPortableModeInDir(t *testing.T) {
	t.Run("no marker file returns false", func(t *testing.T) {
		dir := t.TempDir()
		if detectPortableModeInDir(dir) {
			t.Error("expected false when no portable.marker exists")
		}
	})

	t.Run("marker file present returns true", func(t *testing.T) {
		dir := t.TempDir()
		if err := os.WriteFile(filepath.Join(dir, "portable.marker"), []byte{}, 0o644); err != nil {
			t.Fatal(err)
		}
		if !detectPortableModeInDir(dir) {
			t.Error("expected true when portable.marker exists")
		}
	})
}
