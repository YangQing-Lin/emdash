package websocket

import (
	"context"
	"sync"

	"go.uber.org/zap"
)

// Hub maintains active websocket connections and broadcasts messages.
type Hub struct {
	clients    map[*Client]bool
	register   chan *Client
	unregister chan *Client
	broadcast  chan broadcastMessage
	logger     *zap.Logger

	quit chan struct{}
	done chan struct{}
	once sync.Once
}

type broadcastMessage struct {
	targetID string
	payload  []byte
}

// NewHub returns a Hub ready to accept websocket clients.
func NewHub(logger *zap.Logger) *Hub {
	if logger == nil {
		logger = zap.NewNop()
	}
	return &Hub{
		clients:    make(map[*Client]bool),
		register:   make(chan *Client),
		unregister: make(chan *Client),
		broadcast:  make(chan broadcastMessage),
		logger:     logger.Named("websocket-hub"),
		quit:       make(chan struct{}),
		done:       make(chan struct{}),
	}
}

// Run processes register, unregister and broadcast events until shutdown.
func (h *Hub) Run() {
	h.logger.Info("websocket hub started")
	defer func() {
		h.logger.Info("websocket hub stopped")
		close(h.done)
	}()

	for {
		select {
		case client := <-h.register:
			h.clients[client] = true
			h.logger.Info("client registered", zap.String("client_id", client.id), zap.Int("active_clients", len(h.clients)))
		case client := <-h.unregister:
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				close(client.send)
				h.logger.Info("client unregistered", zap.String("client_id", client.id), zap.Int("active_clients", len(h.clients)))
			}
		case message := <-h.broadcast:
			for client := range h.clients {
				if message.targetID != "" && client.id != message.targetID {
					continue
				}
				select {
				case client.send <- message.payload:
				default:
					// Drop clients that cannot keep up.
					close(client.send)
					delete(h.clients, client)
					h.logger.Warn("client send buffer full, dropping", zap.String("client_id", client.id))
				}
			}
		case <-h.quit:
			for client := range h.clients {
				close(client.send)
				delete(h.clients, client)
			}
			return
		}
	}
}

// Shutdown requests hub termination and waits for confirmation or context cancel.
func (h *Hub) Shutdown(ctx context.Context) {
	h.once.Do(func() {
		close(h.quit)
	})

	select {
	case <-h.done:
	case <-ctx.Done():
		h.logger.Warn("hub shutdown exceeded context deadline", zap.Error(ctx.Err()))
	}
}

// Done returns a channel closed once the hub exits Run.
func (h *Hub) Done() <-chan struct{} {
	return h.done
}

// BroadcastTo enqueues a payload for the specified client ID. If targetID is empty, the payload is sent to all clients.
func (h *Hub) BroadcastTo(targetID string, payload []byte) {
	if len(payload) == 0 {
		return
	}
	msg := broadcastMessage{targetID: targetID, payload: payload}
	select {
	case h.broadcast <- msg:
	case <-h.done:
		h.logger.Warn("hub stopped before broadcast delivered", zap.String("target_id", targetID))
	}
}
