package logger

import (
	"context"
	"time"

	"github.com/emdashhq/emdash-server/internal/auth"
	"go.uber.org/zap"
)

// AuditLogger emits structured audit events for security-sensitive operations.
type AuditLogger struct {
	logger *zap.Logger
}

// NewAuditLogger wraps the provided zap logger with audit-specific fields.
func NewAuditLogger(baseLogger *zap.Logger) *AuditLogger {
	if baseLogger == nil {
		baseLogger = zap.NewNop()
	}
	return &AuditLogger{logger: baseLogger.Named("audit")}
}

// LogAudit records an audit event using structured JSON fields.
func (a *AuditLogger) LogAudit(ctx context.Context, action, resource string, success bool, metadata map[string]any) {
	if a == nil || a.logger == nil {
		return
	}
	userID, ok := auth.UserIDFromContext(ctx)
	if !ok {
		userID = "unknown"
	}
	fields := []zap.Field{
		zap.Bool("audit", true),
		zap.String("timestamp", time.Now().UTC().Format(time.RFC3339Nano)),
		zap.String("user_id", userID),
		zap.String("action", action),
		zap.String("resource", resource),
		zap.Bool("success", success),
	}
	if len(metadata) > 0 {
		fields = append(fields, zap.Any("metadata", metadata))
	}
	a.logger.Info("audit event", fields...)
}
