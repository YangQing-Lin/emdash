package service

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/creack/pty"
	"go.uber.org/zap"
)

const (
	testShell   = defaultShell
	testPrompt  = "emdash-test$ "
	testTimeout = 10 * time.Second
	testCols    = uint32(80)
	testRows    = uint32(24)
)

func newTestManager(t *testing.T) *PtyManager {
	t.Helper()
	pm := NewPtyManager(zap.NewNop(), nil)
	t.Cleanup(pm.Shutdown)
	return pm
}

func uniqueID(prefix string) string {
	return fmt.Sprintf("%s-%d", prefix, time.Now().UnixNano())
}

func startSession(t *testing.T, pm *PtyManager, id string) (*PtySession, <-chan []byte) {
	t.Helper()

	env := map[string]string{
		"PS1":  testPrompt,
		"HOME": t.TempDir(),
		"USER": "emdash-test",
	}

	if err := pm.StartPty(id, "", testShell, env, testCols, testRows); err != nil {
		t.Fatalf("StartPty failed: %v", err)
	}

	session, ok := pm.GetSession(id)
	if !ok {
		t.Fatalf("session %s not found after start", id)
	}

	outputCh := session.Output()

	t.Cleanup(func() {
		_ = pm.KillPty(id)
	})

	return session, outputCh
}

func waitForOutput(t *testing.T, ch <-chan []byte, want string) string {
	t.Helper()
	deadline := time.NewTimer(testTimeout)
	defer deadline.Stop()

	var buf strings.Builder
	for {
		select {
		case <-deadline.C:
			t.Fatalf("timed out waiting for output containing %q; captured %q", want, buf.String())
		case chunk, ok := <-ch:
			if !ok {
				t.Fatalf("output channel closed before receiving %q; captured %q", want, buf.String())
			}
			buf.Write(chunk)
			if want == "" || strings.Contains(buf.String(), want) {
				return buf.String()
			}
		}
	}
}

func TestPtyManager_StartPtyCreatesSessionAndStreamsOutput(t *testing.T) {
	pm := newTestManager(t)
	id := uniqueID("start")

	session, output := startSession(t, pm, id)

	if session.Cmd == nil || session.Cmd.Process == nil {
		t.Fatalf("expected spawned process for session %s", id)
	}
	if session.Cmd.ProcessState != nil && session.Cmd.ProcessState.Exited() {
		t.Fatalf("process already exited for session %s", id)
	}

	got := waitForOutput(t, output, "")
	if strings.TrimSpace(got) == "" {
		t.Fatalf("expected initial PTY output, got empty string")
	}
}

func TestPtyManager_WritePtyEchoesInput(t *testing.T) {
	pm := newTestManager(t)
	id := uniqueID("write")
	_, output := startSession(t, pm, id)

	waitForOutput(t, output, "")
	const marker = "__ECHO__"
	if err := pm.WritePty(id, []byte("echo "+marker+"\n")); err != nil {
		t.Fatalf("WritePty failed: %v", err)
	}

	got := waitForOutput(t, output, marker)
	if !strings.Contains(got, marker) {
		t.Fatalf("expected to read %q from PTY output, got %q", marker, got)
	}
}

func TestPtyManager_ResizePtyUpdatesWindowSize(t *testing.T) {
	pm := newTestManager(t)
	id := uniqueID("resize")
	session, output := startSession(t, pm, id)

	waitForOutput(t, output, "")
	const cols uint32 = 132
	const rows uint32 = 48

	if err := pm.ResizePty(id, cols, rows); err != nil {
		t.Fatalf("ResizePty failed: %v", err)
	}

	// Allow the kernel to apply the resize before inspecting.
	time.Sleep(50 * time.Millisecond)

	size, err := pty.GetsizeFull(session.Pty)
	if err != nil {
		t.Fatalf("Getsize failed: %v", err)
	}

	if size.Cols != uint16(cols) || size.Rows != uint16(rows) {
		t.Fatalf("unexpected PTY size: got %dx%d, want %dx%d", size.Cols, size.Rows, cols, rows)
	}
}

func TestPtyManager_KillPtyTerminatesProcessAndCleansSession(t *testing.T) {
	pm := newTestManager(t)
	id := uniqueID("kill")
	session, output := startSession(t, pm, id)

	waitForOutput(t, output, "")
	exitCh := session.Exit()

	if err := pm.KillPty(id); err != nil {
		t.Fatalf("KillPty failed: %v", err)
	}

	select {
	case code, ok := <-exitCh:
		if !ok {
			t.Fatalf("exit channel closed without code for session %s", id)
		}
		if code == 0 {
			// graceful exit expected
		}
	case <-time.After(killGracePeriod):
		t.Fatalf("timed out waiting for exit notification for session %s", id)
	}

	if _, ok := pm.GetSession(id); ok {
		t.Fatalf("session %s still registered after KillPty", id)
	}
}
