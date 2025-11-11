package service

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"sort"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/creack/pty"
	"github.com/emdashhq/emdash-server/internal/websocket"
	"go.uber.org/zap"
)

const (
	defaultShell     = "/bin/bash"
	readBufferSize   = 4096
	defaultCols      = 80
	defaultRows      = 24
	sessionChanSize  = 128
	killGracePeriod  = 5 * time.Second
	ptyEventTypeData = "pty:data"
	ptyEventTypeExit = "pty:exit"
	defaultTERM      = "xterm-256color"
)

var (
	// ErrSessionExists is returned when attempting to start a PTY with an ID that is already active.
	ErrSessionExists = errors.New("pty session already exists")
	// ErrSessionNotFound is returned when the requested PTY session does not exist.
	ErrSessionNotFound = errors.New("pty session not found")
	// ErrSessionClosed indicates the PTY session has already been closed.
	ErrSessionClosed = errors.New("pty session already closed")
)

// PtySession encapsulates a running PTY-backed shell process.
type PtySession struct {
	ID         string
	Pty        *os.File
	Tty        *os.File
	Cmd        *exec.Cmd
	mu         sync.Mutex
	closed     bool
	outputChan chan []byte
	exitChan   chan int

	exitCode   int
	exitSignal string

	done      chan struct{}
	closeOnce sync.Once
	doneOnce  sync.Once
}

// PtyManager tracks active PTY sessions and fans out events to gRPC and websocket clients.
type PtyManager struct {
	sessions map[string]*PtySession
	mu       sync.RWMutex
	logger   *zap.Logger
	hub      *websocket.Hub
}

// NewPtyManager creates a new PtyManager.
func NewPtyManager(logger *zap.Logger, hub *websocket.Hub) *PtyManager {
	if logger == nil {
		logger = zap.NewNop()
	}
	return &PtyManager{
		sessions: make(map[string]*PtySession),
		logger:   logger.Named("pty-manager"),
		hub:      hub,
	}
}

// StartPty allocates a new PTY session and spawns the requested shell.
func (pm *PtyManager) StartPty(id, cwd, shell string, env map[string]string, cols, rows uint32) error {
	if id == "" {
		return fmt.Errorf("pty id is required")
	}

	pm.mu.Lock()
	if _, exists := pm.sessions[id]; exists {
		pm.mu.Unlock()
		return ErrSessionExists
	}
	pm.sessions[id] = nil
	pm.mu.Unlock()
	reserved := true
	defer func() {
		if reserved {
			pm.clearPlaceholder(id)
		}
	}()

	resolvedShell := pm.resolveShell(shell, env)
	cmd := exec.Command(resolvedShell)
	if cwd != "" {
		cmd.Dir = cwd
	}
	cmd.Env = pm.buildEnvironment(env)
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.Setsid = true
	cmd.SysProcAttr.Setctty = true

	ptmx, tty, err := pty.Open()
	if err != nil {
		return fmt.Errorf("open pty: %w", err)
	}

	winSize := pm.buildWinSize(cols, rows)
	if winSize != nil {
		if err := pty.Setsize(ptmx, winSize); err != nil {
			_ = ptmx.Close()
			_ = tty.Close()
			return fmt.Errorf("set pty size: %w", err)
		}
	}

	cmd.Stdin = tty
	cmd.Stdout = tty
	cmd.Stderr = tty

	if err := cmd.Start(); err != nil {
		_ = ptmx.Close()
		_ = tty.Close()
		pm.clearPlaceholder(id)
		return fmt.Errorf("start shell: %w", err)
	}

	session := &PtySession{
		ID:         id,
		Pty:        ptmx,
		Tty:        tty,
		Cmd:        cmd,
		outputChan: make(chan []byte, sessionChanSize),
		exitChan:   make(chan int, 1),
		done:       make(chan struct{}),
	}

	pm.mu.Lock()
	pm.sessions[id] = session
	pm.mu.Unlock()
	reserved = false

	go pm.streamOutput(session)
	go pm.waitForExit(session)

	pm.logger.Info("pty session started", zap.String("pty_id", id), zap.String("shell", resolvedShell), zap.String("cwd", cwd))
	return nil
}

func (pm *PtyManager) clearPlaceholder(id string) {
	pm.mu.Lock()
	if session, ok := pm.sessions[id]; ok && session == nil {
		delete(pm.sessions, id)
	}
	pm.mu.Unlock()
}

// WritePty forwards data into the PTY session stdin.
func (pm *PtyManager) WritePty(id string, data []byte) error {
	session, err := pm.fetchSession(id)
	if err != nil {
		return err
	}

	session.mu.Lock()
	defer session.mu.Unlock()
	if session.closed {
		return ErrSessionClosed
	}

	if len(data) == 0 {
		return nil
	}

	if _, err := session.Pty.Write(data); err != nil {
		return fmt.Errorf("write pty: %w", err)
	}
	return nil
}

// ResizePty updates the PTY window size.
func (pm *PtyManager) ResizePty(id string, cols, rows uint32) error {
	session, err := pm.fetchSession(id)
	if err != nil {
		return err
	}

	session.mu.Lock()
	defer session.mu.Unlock()
	if session.closed {
		return ErrSessionClosed
	}

	if err := pty.Setsize(session.Pty, pm.buildWinSize(cols, rows)); err != nil {
		return fmt.Errorf("resize pty: %w", err)
	}
	return nil
}

// KillPty terminates the PTY session.
func (pm *PtyManager) KillPty(id string) error {
	session, err := pm.fetchSession(id)
	if err != nil {
		return err
	}

	session.mu.Lock()
	if session.closed {
		session.mu.Unlock()
		return nil
	}
	session.closed = true
	session.mu.Unlock()

	if session.Cmd.Process != nil {
		if err := session.Cmd.Process.Signal(syscall.SIGTERM); err != nil && !errors.Is(err, os.ErrProcessDone) {
			pm.logger.Warn("failed to send SIGTERM", zap.String("pty_id", id), zap.Error(err))
		}
	}

	select {
	case <-session.done:
	case <-time.After(killGracePeriod):
		if session.Cmd.Process != nil {
			if err := session.Cmd.Process.Kill(); err != nil && !errors.Is(err, os.ErrProcessDone) {
				pm.logger.Warn("failed to send SIGKILL", zap.String("pty_id", id), zap.Error(err))
			}
		}
		<-session.done
	}

	return nil
}

// GetSession returns a session pointer if it exists.
func (pm *PtyManager) GetSession(id string) (*PtySession, bool) {
	pm.mu.RLock()
	defer pm.mu.RUnlock()
	session, ok := pm.sessions[id]
	return session, ok
}

// Shutdown terminates every tracked PTY session.
func (pm *PtyManager) Shutdown() {
	pm.mu.RLock()
	ids := make([]string, 0, len(pm.sessions))
	for id := range pm.sessions {
		ids = append(ids, id)
	}
	pm.mu.RUnlock()

	for _, id := range ids {
		if err := pm.KillPty(id); err != nil && !errors.Is(err, ErrSessionNotFound) {
			pm.logger.Warn("failed to kill PTY session during shutdown", zap.String("pty_id", id), zap.Error(err))
		}
	}
}

func (pm *PtyManager) fetchSession(id string) (*PtySession, error) {
	pm.mu.RLock()
	session, ok := pm.sessions[id]
	pm.mu.RUnlock()
	if !ok {
		return nil, ErrSessionNotFound
	}
	return session, nil
}

func (pm *PtyManager) resolveShell(shell string, env map[string]string) string {
	if shell != "" {
		return shell
	}
	if env != nil {
		if candidate := env["SHELL"]; candidate != "" {
			return candidate
		}
	}
	if candidate := os.Getenv("SHELL"); candidate != "" {
		return candidate
	}
	return defaultShell
}

func (pm *PtyManager) buildEnvironment(custom map[string]string) []string {
	envMap := map[string]string{}
	for _, kv := range os.Environ() {
		parts := strings.SplitN(kv, "=", 2)
		if len(parts) != 2 {
			continue
		}
		envMap[parts[0]] = parts[1]
	}
	for k, v := range custom {
		envMap[k] = v
	}
	if _, ok := envMap["TERM"]; !ok {
		envMap["TERM"] = defaultTERM
	}

	keys := make([]string, 0, len(envMap))
	for k := range envMap {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	env := make([]string, 0, len(envMap))
	for _, k := range keys {
		env = append(env, fmt.Sprintf("%s=%s", k, envMap[k]))
	}
	return env
}

func (pm *PtyManager) buildWinSize(cols, rows uint32) *pty.Winsize {
	if cols == 0 {
		cols = defaultCols
	}
	if rows == 0 {
		rows = defaultRows
	}
	return &pty.Winsize{
		Cols: uint16(cols),
		Rows: uint16(rows),
	}
}

func (pm *PtyManager) streamOutput(session *PtySession) {
	defer close(session.outputChan)

	buf := make([]byte, readBufferSize)
	for {
		n, err := session.Pty.Read(buf)
		if n > 0 {
			chunk := make([]byte, n)
			copy(chunk, buf[:n])
			pm.pushOutput(session.ID, chunk)
			select {
			case session.outputChan <- chunk:
			default:
				pm.logger.Warn("dropping PTY output (slow consumer)", zap.String("pty_id", session.ID), zap.Int("bytes", len(chunk)))
			}
		}

		if err != nil {
			if !errors.Is(err, io.EOF) && !errors.Is(err, os.ErrClosed) {
				pm.logger.Warn("pty read error", zap.String("pty_id", session.ID), zap.Error(err))
			}
			return
		}
	}
}

func (pm *PtyManager) waitForExit(session *PtySession) {
	err := session.Cmd.Wait()
	exitCode, signal := deriveExitDetails(err, session.Cmd.ProcessState)

	pm.finalizeSession(session, exitCode, signal)
	pm.logger.Info("pty session exited", zap.String("pty_id", session.ID), zap.Int("exit_code", exitCode), zap.String("signal", signal))
}

func deriveExitDetails(waitErr error, state *os.ProcessState) (int, string) {
	if state == nil {
		if waitErr == nil {
			return 0, ""
		}
		return -1, waitErr.Error()
	}

	status, ok := state.Sys().(syscall.WaitStatus)
	if !ok {
		if waitErr != nil {
			return -1, waitErr.Error()
		}
		return 0, ""
	}

	if status.Signaled() {
		return 128 + int(status.Signal()), status.Signal().String()
	}
	return status.ExitStatus(), ""
}

func (pm *PtyManager) finalizeSession(session *PtySession, exitCode int, signal string) {
	session.mu.Lock()
	if !session.closed {
		session.closed = true
	}
	session.exitCode = exitCode
	session.exitSignal = signal
	session.mu.Unlock()

	session.closeOnce.Do(func() {
		if session.Pty != nil {
			_ = session.Pty.Close()
		}
		if session.Tty != nil {
			_ = session.Tty.Close()
		}
	})

	pm.mu.Lock()
	delete(pm.sessions, session.ID)
	pm.mu.Unlock()

	select {
	case session.exitChan <- exitCode:
	default:
	}
	close(session.exitChan)
	session.doneOnce.Do(func() {
		close(session.done)
	})

	pm.pushExit(session.ID, exitCode, signal)
}

func (pm *PtyManager) pushOutput(id string, data []byte) {
	if pm.hub == nil {
		return
	}
	payload := map[string]interface{}{
		"type": ptyEventTypeData,
		"id":   id,
		"data": string(data),
	}
	pm.broadcastJSON(id, payload)
}

func (pm *PtyManager) pushExit(id string, code int, signal string) {
	if pm.hub == nil {
		return
	}
	payload := map[string]interface{}{
		"type":     ptyEventTypeExit,
		"id":       id,
		"exitCode": code,
		"signal":   signal,
	}
	pm.broadcastJSON(id, payload)
}

func (pm *PtyManager) broadcastJSON(id string, payload map[string]interface{}) {
	data, err := json.Marshal(payload)
	if err != nil {
		pm.logger.Warn("failed to marshal websocket payload", zap.String("pty_id", id), zap.Error(err))
		return
	}
	pm.hub.BroadcastTo(id, data)
}

// Output returns a receive-only channel for PTY stdout/stderr.
func (s *PtySession) Output() <-chan []byte {
	return s.outputChan
}

// Exit returns the exit channel.
func (s *PtySession) Exit() <-chan int {
	return s.exitChan
}

// ExitSignal returns the recorded signal string.
func (s *PtySession) ExitSignal() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.exitSignal
}

// ExitCode returns the last recorded exit code.
func (s *PtySession) ExitCode() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.exitCode
}
