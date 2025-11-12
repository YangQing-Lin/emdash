package auth

import (
	"context"
	"strings"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

const userIDContextKey = "userId"

// AuditLogger captures audit events without importing the concrete logger package.
type AuditLogger interface {
	LogAudit(ctx context.Context, action, resource string, success bool, metadata map[string]any)
}

var auditLogger AuditLogger = noopAuditLogger{}

// SetAuditLogger configures the audit logger implementation for this package.
func SetAuditLogger(logger AuditLogger) {
	if logger == nil {
		auditLogger = noopAuditLogger{}
		return
	}
	auditLogger = logger
}

type noopAuditLogger struct{}

func (noopAuditLogger) LogAudit(context.Context, string, string, bool, map[string]any) {}

// ContextWithUserID stores the authenticated user identifier in the context.
func ContextWithUserID(ctx context.Context, userID string) context.Context {
	if ctx == nil {
		ctx = context.Background()
	}
	return context.WithValue(ctx, userIDContextKey, userID)
}

// UserIDFromContext extracts the user identifier from the context.
func UserIDFromContext(ctx context.Context) (string, bool) {
	if ctx == nil {
		return "", false
	}
	val, ok := ctx.Value(userIDContextKey).(string)
	return val, ok && val != ""
}

// AuthInterceptor returns a unary interceptor that validates Authorization metadata.
func AuthInterceptor(secret string) grpc.UnaryServerInterceptor {
	return func(ctx context.Context, req interface{}, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (interface{}, error) {
		userID, err := extractUserID(ctx, secret)
		if err != nil {
			if auditLogger != nil {
				auditLogger.LogAudit(ctx, "auth.failed", info.FullMethod, false, map[string]any{
					"error": err.Error(),
				})
			}
			return nil, err
		}
		ctx = ContextWithUserID(ctx, userID)
		return handler(ctx, req)
	}
}

func extractUserID(ctx context.Context, secret string) (string, error) {
	if secret == "" {
		return "", status.Error(codes.Unauthenticated, "auth secret not configured")
	}

	md, ok := metadata.FromIncomingContext(ctx)
	if !ok {
		return "", status.Error(codes.Unauthenticated, "missing metadata")
	}

	values := md.Get("authorization")
	if len(values) == 0 {
		return "", status.Error(codes.Unauthenticated, "authorization metadata not found")
	}

	token := strings.TrimSpace(values[0])
	if token == "" {
		return "", status.Error(codes.Unauthenticated, "authorization token empty")
	}

	if len(token) > 6 && strings.EqualFold(token[:6], "bearer") {
		token = strings.TrimSpace(token[6:])
	}
	if token == "" {
		return "", status.Error(codes.Unauthenticated, "authorization token empty")
	}

	userID, err := VerifyToken(token, secret)
	if err != nil {
		return "", status.Errorf(codes.Unauthenticated, "invalid token: %v", err)
	}
	return userID, nil
}
