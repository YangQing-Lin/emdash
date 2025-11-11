package websocket

import (
	"net/http"

	"github.com/gorilla/websocket"
	"go.uber.org/zap"
)

// Handler upgrades HTTP connections to websocket clients managed by the hub.
type Handler struct {
	hub      *Hub
	upgrader websocket.Upgrader
	logger   *zap.Logger
	writer   PtyInputWriter
}

// NewHandler creates a websocket HTTP handler with permissive origin policy.
func NewHandler(hub *Hub, logger *zap.Logger, writer PtyInputWriter) *Handler {
	if logger == nil {
		logger = zap.NewNop()
	}
	return &Handler{
		hub:    hub,
		writer: writer,
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool {
				return true // Dev mode; tighten for production.
			},
		},
		logger: logger.Named("websocket-handler"),
	}
}

// ServeHTTP completes the websocket handshake and registers the client.
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.writer == nil {
		http.Error(w, "pty manager unavailable", http.StatusServiceUnavailable)
		return
	}

	ptyID := r.URL.Query().Get("id")
	if ptyID == "" {
		http.Error(w, "missing PTY session id", http.StatusBadRequest)
		return
	}

	conn, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		h.logger.Error("failed to upgrade websocket connection", zap.Error(err))
		return
	}

	client := NewClient(h.hub, conn, ptyID, h.writer)
	select {
	case h.hub.register <- client:
		h.logger.Info("websocket client connected", zap.String("client_id", ptyID))
	case <-h.hub.Done():
		h.logger.Warn("hub is shutting down; closing connection", zap.String("client_id", ptyID))
		_ = conn.Close()
		return
	}

	go client.writePump()
	go client.readPump()
}
