//go:build windows || darwin

package tools

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

// JSSandbox executes JavaScript/TypeScript in a Deno subprocess with all
// dangerous permissions denied by the OS (network, env, subprocess spawn,
// FFI). Unlike Bash, it does not require per-call user approval — the
// sandbox itself is the safety boundary, not human review.
type JSSandbox struct {
	WorkingDir string
	DenoPath   string
}

func NewJSSandbox(workingDir, denoPath string) *JSSandbox {
	return &JSSandbox{WorkingDir: workingDir, DenoPath: denoPath}
}

// ResolveDenoPath looks for a `deno` binary in PATH, then common per-user
// install locations (the official installer puts it in ~/.deno/bin). Returns
// "" if not found — callers should skip registering the tool in that case.
func ResolveDenoPath() string {
	name := "deno"
	if runtime.GOOS == "windows" {
		name = "deno.exe"
	}
	if p, err := exec.LookPath(name); err == nil {
		return p
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	candidate := filepath.Join(home, ".deno", "bin", name)
	if _, err := os.Stat(candidate); err == nil {
		return candidate
	}
	return ""
}

func (j *JSSandbox) Name() string {
	return "run_javascript"
}

func (j *JSSandbox) Description() string {
	return "Execute JavaScript/TypeScript in a sandboxed runtime with no network, environment variable, subprocess, or FFI access. Does not require per-call user approval."
}

func (j *JSSandbox) Prompt() string {
	return `You have access to a sandboxed JavaScript/TypeScript execution tool (run_javascript).
It runs with network access, environment variables, subprocess spawning, and FFI all denied at the OS level —
even malicious code cannot exfiltrate data or escape the sandbox. File access is limited to the working directory.
Prefer this tool over bash for calculations, data transformation, parsing, and file read/write tasks — it runs
without requiring the user's per-call approval, since the sandbox itself enforces safety rather than human review.
Use console.log() to print results; everything logged to stdout/stderr is returned to you.`
}

func (j *JSSandbox) Schema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"code": map[string]any{
				"type":        "string",
				"description": "The JavaScript or TypeScript code to execute",
			},
			"timeout_seconds": map[string]any{
				"type":        "number",
				"description": "Execution timeout in seconds (default 10, max 60)",
			},
		},
		"required": []string{"code"},
	}
}

func (j *JSSandbox) Execute(ctx context.Context, args map[string]any) (any, string, error) {
	code, ok := args["code"].(string)
	if !ok || strings.TrimSpace(code) == "" {
		return nil, "", fmt.Errorf("code parameter is required")
	}

	timeoutSeconds := 10.0
	if v, ok := args["timeout_seconds"].(float64); ok && v > 0 {
		timeoutSeconds = v
	}
	if timeoutSeconds > 60 {
		timeoutSeconds = 60
	}

	tmpFile, err := os.CreateTemp("", "dromadaire-sandbox-*.ts")
	if err != nil {
		return nil, "", fmt.Errorf("failed to create temp script: %w", err)
	}
	defer os.Remove(tmpFile.Name())
	if _, err := tmpFile.WriteString(code); err != nil {
		tmpFile.Close()
		return nil, "", fmt.Errorf("failed to write temp script: %w", err)
	}
	tmpFile.Close()

	workDir := j.WorkingDir
	if workDir == "" {
		workDir = "."
	}

	execCtx, cancel := context.WithTimeout(ctx, time.Duration(timeoutSeconds*float64(time.Second)))
	defer cancel()

	cmd := exec.CommandContext(execCtx, j.DenoPath,
		"run",
		"--allow-read="+workDir,
		"--allow-write="+workDir,
		"--no-prompt",
		"--deny-net",
		"--deny-env",
		"--deny-sys",
		"--deny-run",
		"--deny-ffi",
		tmpFile.Name(),
	)
	cmd.Dir = workDir

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	runErr := cmd.Run()

	output := stdout.String()
	if stderr.Len() > 0 {
		if output != "" {
			output += "\n"
		}
		output += stderr.String()
	}

	const maxOutput = 8000
	if len(output) > maxOutput {
		output = output[:maxOutput] + "\n... (sortie tronquee)"
	}

	if execCtx.Err() == context.DeadlineExceeded {
		msg := "Delai d'execution depasse."
		return msg, msg, nil
	}

	if runErr != nil {
		if output == "" {
			output = fmt.Sprintf("Execution echouee: %v", runErr)
		}
		// Returned as content (not Go error) so the model can see and react to it
		return output, output, nil
	}

	if output == "" {
		output = "(execution terminee sans sortie console)"
	}

	return output, output, nil
}
