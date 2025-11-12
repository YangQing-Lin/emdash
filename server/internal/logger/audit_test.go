package logger

import (
	"context"
	"testing"
	"time"

	"github.com/emdashhq/emdash-server/internal/auth"
	"go.uber.org/zap"
	"go.uber.org/zap/zaptest/observer"
)

func TestNewAuditLoggerCreatesNamedLogger(t *testing.T) {
	core, logs := observer.New(zap.InfoLevel)
	a := NewAuditLogger(zap.New(core))
	if a == nil || a.logger == nil {
		t.Fatal("expected audit logger to be initialized")
	}

	a.LogAudit(context.Background(), "health.check", "healthz", true, nil)
	entries := logs.All()
	if len(entries) != 1 {
		t.Fatalf("expected 1 log entry, got %d", len(entries))
	}
	if entries[0].LoggerName != "audit" {
		t.Fatalf("expected logger name 'audit', got %q", entries[0].LoggerName)
	}
	if entries[0].Message != "audit event" {
		t.Fatalf("unexpected log message: %q", entries[0].Message)
	}
}

func TestNewAuditLoggerDefaultsToNop(t *testing.T) {
	logger := NewAuditLogger(nil)
	if logger == nil || logger.logger == nil {
		t.Fatal("expected fallback logger to be initialized")
	}
	// Should not panic when logging with the fallback logger.
	logger.LogAudit(context.Background(), "noop", "resource", true, nil)
}

func TestAuditLogger_LogAuditIncludesFields(t *testing.T) {
	core, logs := observer.New(zap.InfoLevel)
	a := NewAuditLogger(zap.New(core))

	ctx := auth.ContextWithUserID(context.Background(), "audit-user")
	metadata := map[string]any{"operation": "clone", "repo": "git@github.com/foo/bar.git"}

	a.LogAudit(ctx, "git.clone", "repo/foo", true, metadata)

	entries := logs.All()
	if len(entries) != 1 {
		t.Fatalf("expected 1 log entry, got %d", len(entries))
	}

	fields := entries[0].ContextMap()
	if auditFlag, ok := fields["audit"].(bool); !ok || !auditFlag {
		t.Fatalf("expected audit flag true, got %#v", fields["audit"])
	}
	ts, ok := fields["timestamp"].(string)
	if !ok {
		t.Fatalf("expected timestamp string, got %#v", fields["timestamp"])
	}
	if _, err := time.Parse(time.RFC3339Nano, ts); err != nil {
		t.Fatalf("timestamp not RFC3339Nano: %v", err)
	}
	if fields["user_id"] != "audit-user" {
		t.Fatalf("unexpected user_id: %#v", fields["user_id"])
	}
	if fields["action"] != "git.clone" {
		t.Fatalf("unexpected action: %#v", fields["action"])
	}
	if fields["resource"] != "repo/foo" {
		t.Fatalf("unexpected resource: %#v", fields["resource"])
	}
	if success, ok := fields["success"].(bool); !ok || !success {
		t.Fatalf("expected success true, got %#v", fields["success"])
	}
	meta, ok := fields["metadata"].(map[string]any)
	if !ok {
		t.Fatalf("expected metadata map, got %#v", fields["metadata"])
	}
	if meta["operation"] != "clone" || meta["repo"] != "git@github.com/foo/bar.git" {
		t.Fatalf("unexpected metadata contents: %#v", meta)
	}
}

func TestAuditLogger_LogAuditHandlesUnknownUserAndNoMetadata(t *testing.T) {
	core, logs := observer.New(zap.InfoLevel)
	a := NewAuditLogger(zap.New(core))

	a.LogAudit(context.Background(), "git.pull", "repo/foo", false, nil)

	entries := logs.All()
	if len(entries) != 1 {
		t.Fatalf("expected 1 log entry, got %d", len(entries))
	}
	fields := entries[0].ContextMap()
	if fields["user_id"] != "unknown" {
		t.Fatalf("expected user_id 'unknown', got %#v", fields["user_id"])
	}
	if _, exists := fields["metadata"]; exists {
		t.Fatalf("metadata field should be omitted when nil, got %#v", fields["metadata"])
	}
	if success, ok := fields["success"].(bool); !ok || success {
		t.Fatalf("expected success false, got %#v", fields["success"])
	}
}

func TestAuditLogger_NilReceiverSafe(t *testing.T) {
	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("LogAudit panicked: %v", r)
		}
	}()
	var a *AuditLogger
	a.LogAudit(context.Background(), "noop", "resource", true, nil)
}
