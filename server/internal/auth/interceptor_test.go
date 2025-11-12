package auth

import (
	"context"
	"strings"
	"testing"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

func TestAuthInterceptor_AllowsValidTokenAndInjectsUserID(t *testing.T) {
	secret := "interceptor-secret"
	token, err := GenerateToken("interceptor-user", secret, 1)
	if err != nil {
		t.Fatalf("GenerateToken failed: %v", err)
	}

	ctx := metadata.NewIncomingContext(context.Background(), metadata.Pairs("authorization", " Bearer  "+token+" "))
	handlerCalled := false
	handler := func(ctx context.Context, req interface{}) (interface{}, error) {
		handlerCalled = true
		user, ok := UserIDFromContext(ctx)
		if !ok {
			t.Fatal("expected user id in context")
		}
		if user != "interceptor-user" {
			t.Fatalf("unexpected user id %q", user)
		}
		return "ok", nil
	}

	info := &grpc.UnaryServerInfo{FullMethod: "/auth.Test/Method"}
	resp, err := AuthInterceptor(secret)(ctx, nil, info, handler)
	if err != nil {
		t.Fatalf("AuthInterceptor returned error: %v", err)
	}
	if resp != "ok" {
		t.Fatalf("unexpected handler response %v", resp)
	}
	if !handlerCalled {
		t.Fatal("handler was not invoked")
	}
}

func TestAuthInterceptor_MissingToken(t *testing.T) {
	mockLogger := &recordingAuditLogger{}
	SetAuditLogger(mockLogger)
	t.Cleanup(func() { SetAuditLogger(nil) })

	handlerCalled := false
	handler := func(ctx context.Context, req interface{}) (interface{}, error) {
		handlerCalled = true
		return nil, nil
	}

	info := &grpc.UnaryServerInfo{FullMethod: "/auth.Test/Missing"}
	_, err := AuthInterceptor("secret")(context.Background(), nil, info, handler)
	if err == nil {
		t.Fatal("expected error for missing metadata")
	}
	if status.Code(err) != codes.Unauthenticated {
		t.Fatalf("unexpected error code: %v", status.Code(err))
	}
	if handlerCalled {
		t.Fatal("handler should not be called on auth failure")
	}
	if len(mockLogger.entries) != 1 {
		t.Fatalf("expected audit log entry, got %d", len(mockLogger.entries))
	}
	entry := mockLogger.entries[0]
	if entry.action != "auth.failed" || entry.resource != info.FullMethod || entry.success {
		t.Fatalf("unexpected audit entry: %+v", entry)
	}
	if entry.metadata == nil || !strings.Contains(entry.metadata["error"].(string), "missing metadata") {
		t.Fatalf("expected missing metadata error, got %#v", entry.metadata)
	}
}

func TestAuthInterceptor_InvalidToken(t *testing.T) {
	mockLogger := &recordingAuditLogger{}
	SetAuditLogger(mockLogger)
	t.Cleanup(func() { SetAuditLogger(nil) })

	md := metadata.Pairs("authorization", "Bearer invalid.token.value")
	ctx := metadata.NewIncomingContext(context.Background(), md)
	handlerCalled := false
	handler := func(ctx context.Context, req interface{}) (interface{}, error) {
		handlerCalled = true
		return nil, nil
	}

	info := &grpc.UnaryServerInfo{FullMethod: "/auth.Test/Invalid"}
	_, err := AuthInterceptor("secret")(ctx, nil, info, handler)
	if err == nil {
		t.Fatal("expected error for invalid token")
	}
	if status.Code(err) != codes.Unauthenticated {
		t.Fatalf("unexpected error code: %v", status.Code(err))
	}
	if handlerCalled {
		t.Fatal("handler should not run for invalid token")
	}
	if len(mockLogger.entries) != 1 {
		t.Fatalf("expected audit log entry, got %d", len(mockLogger.entries))
	}
	if !strings.Contains(mockLogger.entries[0].metadata["error"].(string), "parse token") {
		t.Fatalf("expected parse token error, got %#v", mockLogger.entries[0].metadata)
	}
}

func TestContextWithUserIDAndUserIDFromContext(t *testing.T) {
	ctx := ContextWithUserID(context.Background(), "ctx-user")
	user, ok := UserIDFromContext(ctx)
	if !ok || user != "ctx-user" {
		t.Fatalf("unexpected context user: %q ok=%v", user, ok)
	}

	nilCtx := ContextWithUserID(nil, "nil-user")
	user, ok = UserIDFromContext(nilCtx)
	if !ok || user != "nil-user" {
		t.Fatalf("expected user id from nil context: %q ok=%v", user, ok)
	}
}

func TestUserIDFromContextMissing(t *testing.T) {
	if _, ok := UserIDFromContext(context.Background()); ok {
		t.Fatal("expected missing user id for empty context")
	}

	ctx := context.WithValue(context.Background(), userIDContextKey, "")
	if _, ok := UserIDFromContext(ctx); ok {
		t.Fatal("expected missing user id for empty value")
	}

	if _, ok := UserIDFromContext(nil); ok {
		t.Fatal("expected missing user id for nil context")
	}
}

type auditEntry struct {
	action   string
	resource string
	success  bool
	metadata map[string]any
}

type recordingAuditLogger struct {
	entries []auditEntry
}

func (r *recordingAuditLogger) LogAudit(ctx context.Context, action, resource string, success bool, metadata map[string]any) {
	r.entries = append(r.entries, auditEntry{
		action:   action,
		resource: resource,
		success:  success,
		metadata: metadata,
	})
}
