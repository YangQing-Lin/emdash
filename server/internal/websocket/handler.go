package websocket

import (
	"context"
	"compress/flate"
	"net/http"
	"strings"

	"github.com/emdashhq/emdash-server/internal/auth"
	auditlogger "github.com/emdashhq/emdash-server/internal/logger"
	"github.com/gorilla/websocket"
	"go.uber.org/zap"
)

const wsCompressionLevel = flate.DefaultCompression

// Handler upgrades HTTP connections to websocket clients managed by the hub.
type Handler struct {
	hub         *Hub
	upgrader    websocket.Upgrader
	logger      *zap.Logger
	writer      PtyInputWriter
	authSecret  string
	auditLogger *auditlogger.AuditLogger
}

// NewHandler creates a websocket HTTP handler with permissive origin policy.
func NewHandler(hub *Hub, logger *zap.Logger, writer PtyInputWriter, authSecret string) *Handler {
	if logger == nil {
		logger = zap.NewNop()
	}
	return &Handler{
		hub:        hub,
		writer:     writer,
		authSecret: authSecret,
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool {
				return true // Dev mode; tighten for production.
			},
			EnableCompression: true,
		},
		logger:      logger.Named("websocket-handler"),
		auditLogger: auditlogger.NewAuditLogger(logger),
	}
}

// ServeHTTP completes the websocket handshake and registers the client.
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.writer == nil {
		http.Error(w, "pty manager unavailable", http.StatusServiceUnavailable)
		return
	}
	if h.authSecret == "" {
		h.logger.Error("auth secret is not configured; refusing websocket upgrade")
		http.Error(w, "server misconfiguration", http.StatusInternalServerError)
		return
	}

	authHeader := r.Header.Get("Authorization")
	if authHeader == "" {
		h.logAudit(r.Context(), "auth.failed", "", false, map[string]any{
			"transport": "websocket",
			"reason":    "missing_authorization",
		})
		http.Error(w, "missing Authorization header", http.StatusUnauthorized)
		return
	}
	token := strings.TrimSpace(authHeader)
	if len(token) > 6 && strings.EqualFold(token[:6], "bearer") {
		token = strings.TrimSpace(token[6:])
	}
	if token == "" {
		h.logAudit(r.Context(), "auth.failed", "", false, map[string]any{
			"transport": "websocket",
			"reason":    "empty_token",
		})
		http.Error(w, "invalid Authorization header", http.StatusUnauthorized)
		return
	}
	userID, err := auth.VerifyToken(token, h.authSecret)
	if err != nil {
		h.logger.Warn("invalid websocket auth token", zap.Error(err))
		h.logAudit(r.Context(), "auth.failed", "", false, map[string]any{
			"transport": "websocket",
			"reason":    "invalid_token",
			"error":     err.Error(),
		})
		http.Error(w, "invalid token", http.StatusUnauthorized)
		return
	}
	ctx := auth.ContextWithUserID(r.Context(), userID)

	ptyID := r.URL.Query().Get("id")
	if ptyID == "" {
		h.logAudit(ctx, "websocket.connected", "", false, map[string]any{
			"transport": "websocket",
			"reason":    "missing_pty_id",
		})
		http.Error(w, "missing PTY session id", http.StatusBadRequest)
		return
	}

	conn, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		h.logger.Error("failed to upgrade websocket connection", zap.Error(err))
		return
	}

	conn.EnableWriteCompression(true)
	if err := conn.SetCompressionLevel(wsCompressionLevel); err != nil {
		h.logger.Warn("failed to configure websocket compression level", zap.Error(err))
	}

	client := NewClient(h.hub, conn, ptyID, h.writer)
	select {
	case h.hub.register <- client:
		h.logger.Info("websocket client connected", zap.String("client_id", ptyID), zap.String("user_id", userID))
		h.logAudit(ctx, "websocket.connected", ptyID, true, map[string]any{
			"remote_addr": r.RemoteAddr,
			"transport":   "websocket",
			"client_id":   ptyID,
		})
	case <-h.hub.Done():
		h.logger.Warn("hub is shutting down; closing connection", zap.String("client_id", ptyID))
		_ = conn.Close()
		return
	}

	go client.writePump()
	go client.readPump()
}

func (h *Handler) logAudit(ctx context.Context, action, resource string, success bool, metadata map[string]any) {
	if h.auditLogger == nil {
		return
	}
	h.auditLogger.LogAudit(ctx, action, resource, success, metadata)
}
