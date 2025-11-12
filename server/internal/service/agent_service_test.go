package service

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	agentpb "github.com/emdashhq/emdash-server/api/proto/agent"
	"go.uber.org/zap"
)

func newTestAgentManager(t *testing.T) *AgentManager {
	t.Helper()
	am := NewAgentManager(zap.NewNop(), nil)
	t.Cleanup(am.Shutdown)
	return am
}

func uniqueWorkspaceID(prefix string) string {
	return fmt.Sprintf("%s-%d", prefix, time.Now().UnixNano())
}

func TestAgentManager_StartAgentTracksStatus(t *testing.T) {
	am := newTestAgentManager(t)
	id := uniqueWorkspaceID("agent")

	session, err := am.StartAgent(id, "/bin/sh", []string{"-c", "sleep 0.2"}, "", nil)
	if err != nil {
		t.Fatalf("StartAgent failed: %v", err)
	}
	if session == nil || session.Cmd == nil || session.Cmd.Process == nil {
		t.Fatalf("expected running process for %s", id)
	}

	snapshot, err := am.GetAgentStatus(id)
	if err != nil {
		t.Fatalf("GetAgentStatus failed: %v", err)
	}
	if snapshot.Status != agentpb.AgentStatus_AGENT_STATUS_RUNNING {
		t.Fatalf("expected running status, got %v", snapshot.Status)
	}

	select {
	case <-session.Done():
	case <-time.After(2 * time.Second):
		t.Fatal("agent did not exit within timeout")
	}

	snapshot, err = am.GetAgentStatus(id)
	if err != nil {
		t.Fatalf("GetAgentStatus after exit failed: %v", err)
	}
	if snapshot.Status != agentpb.AgentStatus_AGENT_STATUS_STOPPED {
		t.Fatalf("expected stopped status, got %v", snapshot.Status)
	}
}

func TestAgentManager_SendMessageWritesInput(t *testing.T) {
	am := newTestAgentManager(t)
	id := uniqueWorkspaceID("agent-send")
	tmpDir := t.TempDir()
	outputFile := filepath.Join(tmpDir, "agent-output.txt")
	script := "read line; printf '%s' \"$line\" > \"$OUT_PATH\""

	session, err := am.StartAgent(id, "/bin/sh", []string{"-c", script}, "", map[string]string{"OUT_PATH": outputFile})
	if err != nil {
		t.Fatalf("StartAgent failed: %v", err)
	}

	message := "hello remote agent"
	if err := am.SendMessage(id, message); err != nil {
		t.Fatalf("SendMessage failed: %v", err)
	}

	deadline := time.After(2 * time.Second)
	for {
		select {
		case <-deadline:
			t.Fatalf("timed out waiting for output file")
		default:
			data, err := os.ReadFile(outputFile)
			if err == nil {
				got := strings.TrimSpace(string(data))
				if got != message {
					t.Fatalf("unexpected file contents: got %q want %q", got, message)
				}
				goto waitExit
			}
			if !os.IsNotExist(err) {
				t.Fatalf("failed reading output file: %v", err)
			}
			time.Sleep(25 * time.Millisecond)
		}
	}

waitExit:
	select {
	case <-session.Done():
	case <-time.After(2 * time.Second):
		t.Fatal("agent did not exit after handling message")
	}

	snapshot, err := am.GetAgentStatus(id)
	if err != nil {
		t.Fatalf("GetAgentStatus failed: %v", err)
	}
	if snapshot.Status != agentpb.AgentStatus_AGENT_STATUS_STOPPED {
		t.Fatalf("expected stopped status, got %v", snapshot.Status)
	}
}

func TestAgentManager_StopAgentTerminatesGracefully(t *testing.T) {
	am := newTestAgentManager(t)
	id := uniqueWorkspaceID("agent-stop")
	script := "trap 'exit 0' TERM; while true; do sleep 1; done"

	session, err := am.StartAgent(id, "/bin/sh", []string{"-c", script}, "", nil)
	if err != nil {
		t.Fatalf("StartAgent failed: %v", err)
	}

	// Give the loop a moment to start.
	time.Sleep(100 * time.Millisecond)

	if err := am.StopAgent(id); err != nil {
		t.Fatalf("StopAgent failed: %v", err)
	}

	select {
	case <-session.Done():
	case <-time.After(2 * time.Second):
		t.Fatal("agent did not stop after StopAgent")
	}

	snapshot, err := am.GetAgentStatus(id)
	if err != nil {
		t.Fatalf("GetAgentStatus failed: %v", err)
	}
	if snapshot.Status != agentpb.AgentStatus_AGENT_STATUS_STOPPED {
		t.Fatalf("expected stopped status after StopAgent, got %v", snapshot.Status)
	}
}
