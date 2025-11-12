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

	agentpb "github.com/emdashhq/emdash-server/api/proto/agent"
	"github.com/emdashhq/emdash-server/internal/websocket"
	"go.uber.org/zap"
)

const (
	agentReadBufferSize  = 4096
	agentKillGracePeriod = 5 * time.Second
	agentEventTypeOutput = "agent:output"
	agentEventTypeExit   = "agent:exit"
)

var (
	// ErrAgentExists indicates the workspace already has a running agent.
	ErrAgentExists = errors.New("agent session already exists")
	// ErrAgentNotFound is returned when the workspace has no tracked agent session.
	ErrAgentNotFound = errors.New("agent session not found")
	// ErrAgentClosed signals that the session has already terminated.
	ErrAgentClosed = errors.New("agent session already closed")
)

// AgentSession represents a managed agent CLI process.
type AgentSession struct {
	ID       string
	Provider string
	Cmd      *exec.Cmd
	Stdin    io.WriteCloser
	Stdout   io.ReadCloser
	Stderr   io.ReadCloser

	pid int

	mu           sync.Mutex
	closed       bool
	status       agentpb.AgentStatus
	exitCode     int
	errorMessage string

	done      chan struct{}
	closeOnce sync.Once
	ioOnce    sync.Once
	stdinOnce sync.Once
}

// AgentStatusSnapshot captures the latest observable state of an agent workspace.
type AgentStatusSnapshot struct {
	Status       agentpb.AgentStatus
	PID          int
	ErrorMessage string
}

// AgentManager coordinates lifecycle management for remote agent processes.
type AgentManager struct {
	sessions map[string]*AgentSession
	states   map[string]*AgentStatusSnapshot
	mu       sync.RWMutex

	hub    *websocket.Hub
	logger *zap.Logger
}

// NewAgentManager creates a manager with the provided logger and websocket hub.
func NewAgentManager(logger *zap.Logger, hub *websocket.Hub) *AgentManager {
	if logger == nil {
		logger = zap.NewNop()
	}
	return &AgentManager{
		sessions: make(map[string]*AgentSession),
		states:   make(map[string]*AgentStatusSnapshot),
		hub:      hub,
		logger:   logger.Named("agent-manager"),
	}
}

// StartAgent spawns a new agent process for the provided workspace.
func (am *AgentManager) StartAgent(workspaceID, provider string, args []string, cwd string, env map[string]string) (*AgentSession, error) {
	workspaceID = strings.TrimSpace(workspaceID)
	provider = strings.TrimSpace(provider)

	if workspaceID == "" {
		return nil, fmt.Errorf("workspace id is required")
	}
	if provider == "" {
		return nil, fmt.Errorf("provider is required")
	}

	am.mu.Lock()
	if existing, ok := am.sessions[workspaceID]; ok && existing != nil {
		am.mu.Unlock()
		return nil, ErrAgentExists
	}
	am.sessions[workspaceID] = nil
	am.states[workspaceID] = &AgentStatusSnapshot{Status: agentpb.AgentStatus_AGENT_STATUS_STARTING}
	am.mu.Unlock()

	reserved := true
	var startErr error
	defer func() {
		if reserved {
			am.clearPlaceholder(workspaceID)
			if startErr != nil {
				am.setStatus(workspaceID, agentpb.AgentStatus_AGENT_STATUS_ERROR, 0, startErr.Error())
			}
		}
	}()

	cmd := exec.Command(provider, args...)
	if cwd != "" {
		cmd.Dir = cwd
	}
	cmd.Env = am.buildEnvironment(env)

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		startErr = fmt.Errorf("allocate stdout: %w", err)
		return nil, startErr
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		_ = stdout.Close()
		startErr = fmt.Errorf("allocate stderr: %w", err)
		return nil, startErr
	}
	stdin, err := cmd.StdinPipe()
	if err != nil {
		_ = stdout.Close()
		_ = stderr.Close()
		startErr = fmt.Errorf("allocate stdin: %w", err)
		return nil, startErr
	}

	if err := cmd.Start(); err != nil {
		_ = stdout.Close()
		_ = stderr.Close()
		_ = stdin.Close()
		startErr = fmt.Errorf("start agent: %w", err)
		return nil, startErr
	}

	session := &AgentSession{
		ID:       workspaceID,
		Provider: provider,
		Cmd:      cmd,
		Stdin:    stdin,
		Stdout:   stdout,
		Stderr:   stderr,
		pid:      cmd.Process.Pid,
		status:   agentpb.AgentStatus_AGENT_STATUS_RUNNING,
		exitCode: -1,
		done:     make(chan struct{}),
	}

	am.mu.Lock()
	am.sessions[workspaceID] = session
	am.states[workspaceID] = &AgentStatusSnapshot{Status: agentpb.AgentStatus_AGENT_STATUS_RUNNING, PID: session.pid}
	am.mu.Unlock()
	reserved = false

	go am.streamPipe(session, stdout, "stdout")
	go am.streamPipe(session, stderr, "stderr")
	go am.waitForExit(session)

	am.logger.Info("agent started", zap.String("workspace_id", workspaceID), zap.String("provider", provider), zap.Strings("args", args), zap.String("cwd", cwd), zap.Int("pid", session.pid))
	return session, nil
}

// SendMessage writes the provided payload to the agent stdin, appending a newline when missing.
func (am *AgentManager) SendMessage(workspaceID, message string) error {
	session, err := am.fetchSession(workspaceID)
	if err != nil {
		return err
	}
	if message == "" {
		return nil
	}

	session.mu.Lock()
	defer session.mu.Unlock()
	if session.closed {
		return ErrAgentClosed
	}
	if session.Stdin == nil {
		return fmt.Errorf("agent stdin unavailable")
	}

	payload := message
	if !strings.HasSuffix(payload, "\n") {
		payload += "\n"
	}
	if _, err := io.WriteString(session.Stdin, payload); err != nil {
		return fmt.Errorf("write agent stdin: %w", err)
	}
	return nil
}

// StopAgent attempts a graceful shutdown before resorting to SIGKILL.
func (am *AgentManager) StopAgent(workspaceID string) error {
	session, err := am.fetchSession(workspaceID)
	if err != nil {
		return err
	}

	session.mu.Lock()
	if session.closed {
		session.mu.Unlock()
		return nil
	}
	session.mu.Unlock()

	if session.Cmd == nil || session.Cmd.Process == nil {
		return fmt.Errorf("agent process unavailable")
	}

	_ = session.closeInput()
	if err := session.Cmd.Process.Signal(syscall.SIGTERM); err != nil && !errors.Is(err, os.ErrProcessDone) {
		return fmt.Errorf("signal agent: %w", err)
	}

	select {
	case <-session.done:
		return nil
	case <-time.After(agentKillGracePeriod):
		if err := session.Cmd.Process.Kill(); err != nil && !errors.Is(err, os.ErrProcessDone) {
			return fmt.Errorf("kill agent: %w", err)
		}
		<-session.done
		return nil
	}
}

// GetAgentStatus returns the current or last-known status for the workspace.
func (am *AgentManager) GetAgentStatus(workspaceID string) (*AgentStatusSnapshot, error) {
	am.mu.RLock()
	if session, ok := am.sessions[workspaceID]; ok && session != nil {
		snapshot := session.snapshot()
		am.mu.RUnlock()
		return snapshot, nil
	}
	state, ok := am.states[workspaceID]
	am.mu.RUnlock()
	if !ok {
		return nil, ErrAgentNotFound
	}
	copy := *state
	return &copy, nil
}

// Shutdown terminates every tracked agent session.
func (am *AgentManager) Shutdown() {
	am.mu.RLock()
	ids := make([]string, 0, len(am.sessions))
	for id := range am.sessions {
		ids = append(ids, id)
	}
	am.mu.RUnlock()

	for _, id := range ids {
		if err := am.StopAgent(id); err != nil && !errors.Is(err, ErrAgentNotFound) && !errors.Is(err, ErrAgentClosed) {
			am.logger.Warn("failed to stop agent during shutdown", zap.String("workspace_id", id), zap.Error(err))
		}
	}
}

// GetSession exposes the underlying session for observability/testing.
func (am *AgentManager) GetSession(workspaceID string) (*AgentSession, bool) {
	am.mu.RLock()
	defer am.mu.RUnlock()
	session, ok := am.sessions[workspaceID]
	return session, ok && session != nil
}

func (am *AgentManager) fetchSession(workspaceID string) (*AgentSession, error) {
	am.mu.RLock()
	session, ok := am.sessions[workspaceID]
	am.mu.RUnlock()
	if !ok || session == nil {
		return nil, ErrAgentNotFound
	}
	return session, nil
}

func (am *AgentManager) clearPlaceholder(workspaceID string) {
	am.mu.Lock()
	if session, ok := am.sessions[workspaceID]; ok && session == nil {
		delete(am.sessions, workspaceID)
	}
	am.mu.Unlock()
}

func (am *AgentManager) waitForExit(session *AgentSession) {
	err := session.Cmd.Wait()
	exitCode := deriveAgentExitCode(err, session.Cmd.ProcessState)
	errMsg := ""
	if err != nil {
		errMsg = err.Error()
	}
	am.finalizeSession(session, exitCode, errMsg)
}

func deriveAgentExitCode(waitErr error, state *os.ProcessState) int {
	if state != nil {
		return state.ExitCode()
	}
	if waitErr == nil {
		return 0
	}
	if exitErr, ok := waitErr.(*exec.ExitError); ok {
		return exitErr.ExitCode()
	}
	return -1
}

func (am *AgentManager) finalizeSession(session *AgentSession, exitCode int, errMsg string) {
	session.mu.Lock()
	if session.closed {
		session.mu.Unlock()
		return
	}
	session.closed = true
	session.exitCode = exitCode
	if errMsg != "" {
		session.errorMessage = errMsg
	}

	status := agentpb.AgentStatus_AGENT_STATUS_STOPPED
	if exitCode != 0 {
		status = agentpb.AgentStatus_AGENT_STATUS_ERROR
		if session.errorMessage == "" {
			session.errorMessage = fmt.Sprintf("agent exited with code %d", exitCode)
		}
	}
	session.status = status
	session.mu.Unlock()

	session.closeIO()

	am.mu.Lock()
	delete(am.sessions, session.ID)
	am.states[session.ID] = &AgentStatusSnapshot{
		Status:       status,
		PID:          0,
		ErrorMessage: session.errorMessage,
	}
	am.mu.Unlock()

	session.closeOnce.Do(func() {
		close(session.done)
	})

	am.pushExit(session.ID, exitCode, session.errorMessage)
	am.logger.Info("agent exited", zap.String("workspace_id", session.ID), zap.Int("exit_code", exitCode), zap.String("provider", session.Provider))
}

func (session *AgentSession) snapshot() *AgentStatusSnapshot {
	session.mu.Lock()
	defer session.mu.Unlock()
	return &AgentStatusSnapshot{
		Status:       session.status,
		PID:          session.pid,
		ErrorMessage: session.errorMessage,
	}
}

// Done returns a channel closed once the underlying process exits.
func (session *AgentSession) Done() <-chan struct{} {
	return session.done
}

func (session *AgentSession) closeIO() {
	session.ioOnce.Do(func() {
		_ = session.closeInput()
		if session.Stdout != nil {
			_ = session.Stdout.Close()
		}
		if session.Stderr != nil {
			_ = session.Stderr.Close()
		}
	})
}

func (session *AgentSession) closeInput() error {
	session.stdinOnce.Do(func() {
		if session.Stdin != nil {
			_ = session.Stdin.Close()
		}
	})
	return nil
}

func (am *AgentManager) streamPipe(session *AgentSession, reader io.ReadCloser, stream string) {
	defer func() {
		if reader != nil {
			_ = reader.Close()
		}
	}()

	buf := make([]byte, agentReadBufferSize)
	for {
		n, err := reader.Read(buf)
		if n > 0 {
			chunk := make([]byte, n)
			copy(chunk, buf[:n])
			am.pushOutput(session.ID, chunk, stream)
		}
		if err != nil {
			if !errors.Is(err, io.EOF) && !errors.Is(err, os.ErrClosed) {
				am.logger.Warn("agent stream error", zap.String("workspace_id", session.ID), zap.String("stream", stream), zap.Error(err))
			}
			return
		}
	}
}

func (am *AgentManager) pushOutput(workspaceID string, data []byte, stream string) {
	if am.hub == nil || len(data) == 0 {
		return
	}
	payload := map[string]interface{}{
		"type":         agentEventTypeOutput,
		"workspace_id": workspaceID,
		"data":         string(data),
		"stream":       stream,
	}
	am.broadcastJSON(workspaceID, payload)
}

func (am *AgentManager) pushExit(workspaceID string, exitCode int, errMsg string) {
	if am.hub == nil {
		return
	}
	payload := map[string]interface{}{
		"type":         agentEventTypeExit,
		"workspace_id": workspaceID,
		"exit_code":    exitCode,
	}
	if errMsg != "" {
		payload["error_message"] = errMsg
	}
	am.broadcastJSON(workspaceID, payload)
}

func (am *AgentManager) broadcastJSON(workspaceID string, payload map[string]interface{}) {
	data, err := json.Marshal(payload)
	if err != nil {
		am.logger.Warn("failed to marshal agent websocket payload", zap.String("workspace_id", workspaceID), zap.Error(err))
		return
	}
	am.hub.BroadcastTo(workspaceID, data)
}

func (am *AgentManager) buildEnvironment(custom map[string]string) []string {
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

	keys := make([]string, 0, len(envMap))
	for k := range envMap {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	env := make([]string, 0, len(keys))
	for _, k := range keys {
		env = append(env, fmt.Sprintf("%s=%s", k, envMap[k]))
	}
	return env
}

func (am *AgentManager) setStatus(workspaceID string, status agentpb.AgentStatus, pid int, message string) {
	am.mu.Lock()
	defer am.mu.Unlock()
	am.states[workspaceID] = &AgentStatusSnapshot{Status: status, PID: pid, ErrorMessage: message}
}
