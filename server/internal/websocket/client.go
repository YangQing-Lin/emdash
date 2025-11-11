package websocket

import (
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/gorilla/websocket"
	"go.uber.org/zap"
)

const (
	writeWait      = 10 * time.Second
	pongWait       = 75 * time.Second
	pingInterval   = 60 * time.Second
	maxMessageSize = 64 * 1024
)

// Client represents a PTY websocket connection.
type Client struct {
	hub       *Hub
	conn      *websocket.Conn
	send      chan []byte
	id        string
	ptyWriter PtyInputWriter
}

// PtyInputWriter accepts input bytes for a PTY session.
type PtyInputWriter interface {
	WritePty(id string, data []byte) error
	ResizePty(id string, cols, rows uint32) error
	KillPty(id string) error
}

// NewClient wires a websocket connection to the hub.
func NewClient(hub *Hub, conn *websocket.Conn, id string, writer PtyInputWriter) *Client {
	return &Client{
		hub:       hub,
		conn:      conn,
		send:      make(chan []byte, 256),
		id:        id,
		ptyWriter: writer,
	}
}

// readPump consumes websocket messages from the client.
func (c *Client) readPump() {
	defer func() {
		select {
		case c.hub.unregister <- c:
		case <-c.hub.Done():
		}
		_ = c.conn.Close()
	}()

	c.conn.SetReadLimit(maxMessageSize)
	_ = c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error {
		_ = c.conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	for {
		_, message, err := c.conn.ReadMessage()
		if err != nil {
			c.logReadError(err)
			break
		}

		c.hub.logger.Debug("received websocket payload", zap.String("client_id", c.id), zap.Int("bytes", len(message)))
		if err := c.forwardToPty(message); err != nil {
			c.hub.logger.Warn("failed to forward websocket payload to PTY", zap.String("client_id", c.id), zap.Error(err))
			break
		}
	}
}

// writePump delivers PTY output to the websocket connection.
func (c *Client) writePump() {
	ticker := time.NewTicker(pingInterval)
	defer func() {
		ticker.Stop()
		_ = c.conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				_ = c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			if err := c.writeMessage(message); err != nil {
				c.hub.logger.Warn("failed to write websocket message", zap.String("client_id", c.id), zap.Error(err))
				return
			}
			// TODO: deliver PTY stdout/stderr once hooked up to sessions.
		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				c.hub.logger.Warn("failed to send ping", zap.String("client_id", c.id), zap.Error(err))
				return
			}
		case <-c.hub.Done():
			return
		}
	}
}

func (c *Client) writeMessage(message []byte) error {
	w, err := c.conn.NextWriter(websocket.BinaryMessage)
	if err != nil {
		return err
	}

	if _, err = w.Write(message); err != nil {
		_ = w.Close()
		return err
	}

	queued := len(c.send)
	for i := 0; i < queued; i++ {
		if _, err = w.Write([]byte("\n")); err != nil {
			_ = w.Close()
			return err
		}
		next := <-c.send
		if _, err = w.Write(next); err != nil {
			_ = w.Close()
			return err
		}
	}

	return w.Close()
}

func (c *Client) logReadError(err error) {
	if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
		c.hub.logger.Error("unexpected websocket close", zap.String("client_id", c.id), zap.Error(err))
		return
	}
	c.hub.logger.Info("websocket client disconnected", zap.String("client_id", c.id), zap.Error(err))
}

type inboundMessage struct {
	Type string `json:"type"`
	Data string `json:"data"`
	Cols uint32 `json:"cols"`
	Rows uint32 `json:"rows"`
}

func (c *Client) forwardToPty(message []byte) error {
	if c.ptyWriter == nil {
		return errors.New("no PTY writer configured")
	}
	if len(message) == 0 {
		return nil
	}

	var payload inboundMessage
	if err := json.Unmarshal(message, &payload); err != nil || payload.Type == "" {
		// Fallback to treating the payload as raw PTY input for backward compatibility.
		return c.ptyWriter.WritePty(c.id, message)
	}

	switch payload.Type {
	case "input":
		return c.ptyWriter.WritePty(c.id, []byte(payload.Data))
	case "resize":
		return c.ptyWriter.ResizePty(c.id, payload.Cols, payload.Rows)
	case "kill":
		return c.ptyWriter.KillPty(c.id)
	default:
		return fmt.Errorf("unknown websocket payload type: %s", payload.Type)
	}
}
