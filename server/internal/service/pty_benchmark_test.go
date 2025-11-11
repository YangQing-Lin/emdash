package service

import (
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"

	"go.uber.org/zap"
)

func BenchmarkStartPty(b *testing.B) {
	logger := zap.NewNop()
	pm := NewPtyManager(logger, nil)
	b.Cleanup(pm.Shutdown)

	var total time.Duration
	env := map[string]string{"PS1": testPrompt}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		id := fmt.Sprintf("bench-start-%d", i)
		start := time.Now()
		if err := pm.StartPty(id, "", testShell, env, testCols, testRows); err != nil {
			b.Fatalf("StartPty failed: %v", err)
		}
		total += time.Since(start)
		b.StopTimer()
		_ = pm.WritePty(id, []byte("exit\n"))
		if err := pm.KillPty(id); err != nil && err != ErrSessionNotFound {
			b.Fatalf("KillPty failed: %v", err)
		}
		b.StartTimer()
	}
	b.StopTimer()

	if b.N == 0 {
		return
	}

	avg := total / time.Duration(b.N)
	b.ReportMetric(float64(avg.Microseconds()), "us/start")
	if avg > 50*time.Millisecond {
		b.Fatalf("pty creation exceeded 50ms target: %s", avg)
	}
}

func BenchmarkWritePty(b *testing.B) {
	logger := zap.NewNop()
	pm := NewPtyManager(logger, nil)
	b.Cleanup(pm.Shutdown)

	env := map[string]string{"PS1": testPrompt}
	sessionID := fmt.Sprintf("bench-write-%d", time.Now().UnixNano())
	if err := pm.StartPty(sessionID, "", testShell, env, testCols, testRows); err != nil {
		b.Fatalf("StartPty failed: %v", err)
	}
	session, ok := pm.GetSession(sessionID)
	if !ok {
		b.Fatalf("session %s not found", sessionID)
	}
	go func() {
		for range session.Output() {
		}
	}()

	payload := []byte("echo benchmark\n")
	var total time.Duration

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		start := time.Now()
		if err := pm.WritePty(sessionID, payload); err != nil {
			b.Fatalf("WritePty failed: %v", err)
		}
		total += time.Since(start)
	}
	b.StopTimer()

	_ = pm.WritePty(sessionID, []byte("exit\n"))
	if err := pm.KillPty(sessionID); err != nil && err != ErrSessionNotFound {
		b.Fatalf("KillPty failed: %v", err)
	}

	if b.N == 0 {
		return
	}

	avg := total / time.Duration(b.N)
	b.ReportMetric(float64(avg.Microseconds()), "us/write")
	if avg > 5*time.Millisecond {
		b.Fatalf("write latency exceeded 5ms target: %s", avg)
	}
}

func BenchmarkConcurrentPty(b *testing.B) {
	logger := zap.NewNop()
	pm := NewPtyManager(logger, nil)
	b.Cleanup(pm.Shutdown)

	const sessionCount = 12
	env := map[string]string{"PS1": testPrompt}
	sessionIDs := make([]string, sessionCount)

	for i := 0; i < sessionCount; i++ {
		id := fmt.Sprintf("bench-concurrent-%d-%d", i, time.Now().UnixNano())
		sessionIDs[i] = id
		if err := pm.StartPty(id, "", testShell, env, testCols, testRows); err != nil {
			b.Fatalf("StartPty failed: %v", err)
		}
		if session, ok := pm.GetSession(id); ok {
			go func(s *PtySession) {
				for range s.Output() {
				}
			}(session)
		}
	}

	b.Cleanup(func() {
		for _, id := range sessionIDs {
			_ = pm.WritePty(id, []byte("exit\n"))
			_ = pm.KillPty(id)
		}
	})

	payload := []byte("echo concurrent\n")
	var total time.Duration

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		start := time.Now()
		errCh := make(chan error, sessionCount)
		var wg sync.WaitGroup
		wg.Add(sessionCount)
		for _, id := range sessionIDs {
			go func(ptyID string) {
				defer wg.Done()
				if err := pm.WritePty(ptyID, payload); err != nil && !errors.Is(err, ErrSessionClosed) {
					errCh <- err
				}
			}(id)
		}
		wg.Wait()
		close(errCh)
		for err := range errCh {
			b.Fatalf("concurrent WritePty failed: %v", err)
		}
		total += time.Since(start)
	}
	b.StopTimer()

	if b.N == 0 {
		return
	}

	avg := total / time.Duration(b.N)
	b.ReportMetric(float64(avg.Milliseconds()), "ms/batch")
	if avg > 50*time.Millisecond {
		b.Fatalf("concurrent batch latency exceeded 50ms target: %s", avg)
	}
}
