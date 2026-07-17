package server

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	pidFile       = filepath.Join(os.Getenv("LOCALAPPDATA"), "Ollama", "ollama.pid")
	serverLogPath = filepath.Join(os.Getenv("LOCALAPPDATA"), "Ollama", "server.log")
)

func commandContext(ctx context.Context, name string, arg ...string) *exec.Cmd {
	cmd := exec.CommandContext(ctx, name, arg...)
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: windows.CREATE_NEW_PROCESS_GROUP,
	}

	return cmd
}

func terminate(proc *os.Process) error {
	dll, err := windows.LoadDLL("kernel32.dll")
	if err != nil {
		return err
	}
	defer dll.Release()

	pid := proc.Pid

	f, err := dll.FindProc("AttachConsole")
	if err != nil {
		return err
	}

	r1, _, err := f.Call(uintptr(pid))
	if r1 == 0 && err != syscall.ERROR_ACCESS_DENIED {
		return err
	}

	f, err = dll.FindProc("SetConsoleCtrlHandler")
	if err != nil {
		return err
	}

	r1, _, err = f.Call(0, 1)
	if r1 == 0 {
		return err
	}

	f, err = dll.FindProc("GenerateConsoleCtrlEvent")
	if err != nil {
		return err
	}

	r1, _, err = f.Call(windows.CTRL_BREAK_EVENT, uintptr(pid))
	if r1 == 0 {
		return err
	}

	r1, _, err = f.Call(windows.CTRL_C_EVENT, uintptr(pid))
	if r1 == 0 {
		return err
	}

	return nil
}

type SystemMemory struct {
	TotalBytes     uint64  `json:"totalBytes"`
	AvailableBytes uint64  `json:"availableBytes"`
	UsedBytes      uint64  `json:"usedBytes"`
	UsedPercent    float64 `json:"usedPercent"`
	TotalGB        float64 `json:"totalGB"`
	AvailableGB    float64 `json:"availableGB"`
	UsedGB         float64 `json:"usedGB"`
}

func GetSystemMemory() SystemMemory {
	var memStatus [64]byte // MEMORYSTATUSEX
	*(*uint32)(unsafe.Pointer(&memStatus[0])) = 64
	kernel32 := syscall.NewLazyDLL("kernel32.dll")
	proc := kernel32.NewProc("GlobalMemoryStatusEx")
	r1, _, _ := proc.Call(uintptr(unsafe.Pointer(&memStatus[0])))
	if r1 == 0 {
		return SystemMemory{}
	}
	totalPhys := *(*uint64)(unsafe.Pointer(&memStatus[8]))
	availPhys := *(*uint64)(unsafe.Pointer(&memStatus[16]))
	usedPhys := totalPhys - availPhys
	var usedPct float64
	if totalPhys > 0 {
		usedPct = float64(usedPhys) / float64(totalPhys) * 100
	}
	return SystemMemory{
		TotalBytes:     totalPhys,
		AvailableBytes: availPhys,
		UsedBytes:      usedPhys,
		UsedPercent:    usedPct,
		TotalGB:        float64(totalPhys) / (1024 * 1024 * 1024),
		AvailableGB:    float64(availPhys) / (1024 * 1024 * 1024),
		UsedGB:         float64(usedPhys) / (1024 * 1024 * 1024),
	}
}

func GetTotalRAMGB() float64 {
	return GetSystemMemory().TotalGB
}

const STILL_ACTIVE = 259

func terminated(pid int) (bool, error) {
	hProcess, err := windows.OpenProcess(windows.PROCESS_QUERY_INFORMATION, false, uint32(pid))
	if err != nil {
		if errno, ok := err.(windows.Errno); ok && errno == windows.ERROR_INVALID_PARAMETER {
			return true, nil
		}
		return false, fmt.Errorf("failed to open process: %v", err)
	}
	defer windows.CloseHandle(hProcess)

	var exitCode uint32
	err = windows.GetExitCodeProcess(hProcess, &exitCode)
	if err != nil {
		return false, fmt.Errorf("failed to get exit code: %v", err)
	}

	if exitCode == STILL_ACTIVE {
		return false, nil
	}

	return true, nil
}

func ollamaServeProcess(pid int) bool {
	cmd := exec.Command("wmic", "process", "where", fmt.Sprintf("ProcessId=%d", pid), "get", "CommandLine", "/value")
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	output, err := cmd.Output()
	if err != nil {
		slog.Debug("failed to inspect ollama process", "pid", pid, "err", err)
		return false
	}

	for _, line := range strings.Split(string(output), "\n") {
		line = strings.TrimSpace(line)
		commandLine, ok := strings.CutPrefix(line, "CommandLine=")
		if !ok {
			continue
		}

		return ollamaServeArgs(strings.Fields(strings.ToLower(commandLine)))
	}

	return false
}

func GetSystemGPUName() string {
	cmd := exec.Command("powershell", "-NoProfile", "-Command",
		"Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name")
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	output, err := cmd.Output()
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(output), "\n") {
		line = strings.TrimSpace(line)
		if line != "" {
			return line
		}
	}
	return ""
}

// reapServers kills external ollama serve processes except our own.
func reapServers() error {
	// Get current process ID to avoid killing ourselves
	currentPID := os.Getpid()

	// Use wmic to find ollama processes
	cmd := exec.Command("wmic", "process", "where", "name='ollama.exe'", "get", "ProcessId")
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	output, err := cmd.Output()
	if err != nil {
		// No ollama processes found
		slog.Debug("no ollama processes found")
		return nil //nolint:nilerr
	}

	lines := strings.Split(string(output), "\n")
	var pids []string
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || line == "ProcessId" {
			continue
		}

		if _, err := strconv.Atoi(line); err == nil {
			pids = append(pids, line)
		}
	}

	for _, pidStr := range pids {
		pid, err := strconv.Atoi(pidStr)
		if err != nil {
			continue
		}

		if pid == currentPID {
			continue
		}
		if !ollamaServeProcess(pid) {
			continue
		}

		cmd := exec.Command("taskkill", "/F", "/T", "/PID", pidStr)
		if err := cmd.Run(); err != nil {
			slog.Warn("failed to kill ollama process", "pid", pid, "err", err)
		}
	}

	return nil
}
