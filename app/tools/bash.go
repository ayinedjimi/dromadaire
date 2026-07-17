//go:build windows || darwin

package tools

import (
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"runtime"
	"strings"
	"sync"
	"time"
)

// ToolApprovalResult is sent by the frontend via the approve endpoint
type ToolApprovalResult struct {
	Approved bool
}

// Bash executes shell commands with user approval.
// Flow:
//  1. Execute() stores the command in PendingCommand, creates PendingResult channel
//  2. Sends signal on ApprovalCh (goroutine in ui.go reads this and emits SSE)
//  3. Execute() blocks on PendingResult
//  4. POST /tool-approve writes to PendingResult
//  5. Execute() resumes and runs the command (or returns denial)
type Bash struct {
	WorkingDir string

	// ApprovalCh signals that a new approval is needed.
	// The value is the command string to approve.
	ApprovalCh chan string

	// PendingResult receives the approval decision from the approve endpoint.
	PendingResult chan ToolApprovalResult

	mu             sync.Mutex
	PendingCommand string
}

func NewBash(workingDir string) *Bash {
	return &Bash{
		WorkingDir:    workingDir,
		ApprovalCh:    make(chan string, 1),
		PendingResult: make(chan ToolApprovalResult, 1),
	}
}

func (b *Bash) Name() string {
	return "bash"
}

func (b *Bash) Description() string {
	return "Execute a shell command on the local machine. The user will be asked to approve each command before execution."
}

func (b *Bash) Prompt() string {
	osName := runtime.GOOS
	shell := "bash"
	if osName == "windows" {
		shell = "PowerShell"
	}
	return fmt.Sprintf(`You have access to a %s tool that can execute commands on the user's %s system.
Use it to help the user with tasks like file management, system diagnostics, or running scripts.
Each command requires explicit user approval before execution.
Keep commands simple and safe. Avoid destructive operations unless explicitly requested.
Always explain what a command does before executing it.`, shell, osName)
}

func (b *Bash) Schema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"command": map[string]any{
				"type":        "string",
				"description": "The shell command to execute",
			},
		},
		"required": []string{"command"},
	}
}

func (b *Bash) Execute(ctx context.Context, args map[string]any) (any, string, error) {
	cmdStr, ok := args["command"].(string)
	if !ok || strings.TrimSpace(cmdStr) == "" {
		return nil, "", fmt.Errorf("command parameter is required")
	}

	// Store pending command and signal the SSE goroutine
	b.mu.Lock()
	b.PendingCommand = cmdStr
	b.mu.Unlock()

	// Signal that approval is needed (the goroutine in ui.go reads this)
	select {
	case b.ApprovalCh <- cmdStr:
	case <-ctx.Done():
		return nil, "", fmt.Errorf("cancelled while requesting approval")
	}

	// Block until user approves or denies via POST /tool-approve
	select {
	case result := <-b.PendingResult:
		if !result.Approved {
			return nil, "Commande refusee par l'utilisateur.", nil
		}
	case <-ctx.Done():
		return nil, "", fmt.Errorf("cancelled while waiting for approval")
	}

	// Execute the approved command with a timeout
	execCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		cmd = exec.CommandContext(execCtx, "powershell", "-NoProfile", "-NonInteractive", "-Command", cmdStr)
	} else {
		cmd = exec.CommandContext(execCtx, "bash", "-c", cmdStr)
	}

	if b.WorkingDir != "" {
		cmd.Dir = b.WorkingDir
	}

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err := cmd.Run()

	output := stdout.String()
	if stderr.Len() > 0 {
		if output != "" {
			output += "\n"
		}
		output += stderr.String()
	}

	// Truncate very long output
	const maxOutput = 8000
	if len(output) > maxOutput {
		output = output[:maxOutput] + "\n... (sortie tronquee)"
	}

	if err != nil {
		if output == "" {
			output = fmt.Sprintf("Commande echouee: %v", err)
		}
		// Return error as content (not Go error) so the model can see it
		return output, output, nil
	}

	if output == "" {
		output = "(commande executee sans sortie)"
	}

	return output, output, nil
}
