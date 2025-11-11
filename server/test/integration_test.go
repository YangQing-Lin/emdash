package test

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/creack/pty"
	ptypb "github.com/emdashhq/emdash-server/api/proto/pty"
	emdgrpc "github.com/emdashhq/emdash-server/internal/grpc"
	"github.com/emdashhq/emdash-server/internal/service"
	ws "github.com/emdashhq/emdash-server/internal/websocket"
	"github.com/gorilla/websocket"
	"go.uber.org/zap/zaptest"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

type wsEvent struct {
	Type     string `json:"type"`
	ID       string `json:"id"`
	Data     string `json:"data"`
	ExitCode int    `json:"exitCode"`
	Signal   string `json:"signal"`
}

func TestRemotePtyEndToEnd(t *testing.T) {
	logger := zaptest.NewLogger(t)
	hub := ws.NewHub(logger)
	go hub.Run()
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		hub.Shutdown(ctx)
	})

	manager := service.NewPtyManager(logger, hub)
	t.Cleanup(manager.Shutdown)

	grpcListener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("failed to listen for grpc: %v", err)
	}
	grpcServer := grpc.NewServer()
	ptypb.RegisterPtyServiceServer(grpcServer, emdgrpc.NewPtyServer(logger, manager))
	go func() {
		_ = grpcServer.Serve(grpcListener)
	}()
	t.Cleanup(grpcServer.Stop)

	handler := ws.NewHandler(hub, logger, manager)
	httpServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/ws/pty" {
			http.NotFound(w, r)
			return
		}
		handler.ServeHTTP(w, r)
	}))
	t.Cleanup(httpServer.Close)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	conn, err := grpc.DialContext(
		ctx,
		grpcListener.Addr().String(),
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithBlock(),
	)
	if err != nil {
		t.Fatalf("failed to connect to grpc server: %v", err)
	}
	defer conn.Close()

	client := ptypb.NewPtyServiceClient(conn)
	sessionID := fmt.Sprintf("itest-%d", time.Now().UnixNano())

	if _, err := client.StartPty(ctx, &ptypb.PtyStartRequest{
		Id:    sessionID,
		Shell: "/bin/bash",
		Cols:  80,
		Rows:  24,
	}); err != nil {
		t.Fatalf("StartPty failed: %v", err)
	}

	wsURL := strings.Replace(httpServer.URL, "http", "ws", 1) + "/ws/pty?id=" + sessionID
	socket, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("failed to connect websocket: %v", err)
	}
	defer socket.Close()

	messageCh := make(chan wsEvent, 32)
	go func() {
		defer close(messageCh)
		for {
			_, data, err := socket.ReadMessage()
			if err != nil {
				return
			}
			var evt wsEvent
			if err := json.Unmarshal(data, &evt); err != nil {
				continue
			}
			messageCh <- evt
		}
	}()

	waitForEvent := func(predicate func(wsEvent) bool, timeout time.Duration) wsEvent {
		deadline := time.NewTimer(timeout)
		defer deadline.Stop()
		for {
			select {
			case <-deadline.C:
				t.Fatalf("timed out waiting for websocket event")
			case evt, ok := <-messageCh:
				if !ok {
					t.Fatalf("websocket closed before receiving expected event")
				}
				if predicate(evt) {
					return evt
				}
			}
		}
	}

	sendJSON := func(payload map[string]interface{}) {
		bytes, err := json.Marshal(payload)
		if err != nil {
			t.Fatalf("marshal payload failed: %v", err)
		}
		if err := socket.WriteMessage(websocket.TextMessage, bytes); err != nil {
			t.Fatalf("failed to write websocket message: %v", err)
		}
	}

	waitForEvent(func(evt wsEvent) bool {
		return evt.Type == "pty:data" && strings.Contains(evt.Data, "$")
	}, 10*time.Second)

	const marker = "__REMOTE_E2E__"
	start := time.Now()
	sendJSON(map[string]interface{}{
		"type": "input",
		"data": "echo " + marker + "\n",
	})

	evt := waitForEvent(func(evt wsEvent) bool {
		return evt.Type == "pty:data" && strings.Contains(evt.Data, marker)
	}, 10*time.Second)
	t.Logf("input to output latency: %s", time.Since(start))

	if evt.ID != sessionID {
		t.Fatalf("unexpected session id in event: got %s want %s", evt.ID, sessionID)
	}

	sendJSON(map[string]interface{}{
		"type": "resize",
		"cols": 160,
		"rows": 40,
	})

	time.Sleep(50 * time.Millisecond)
	session, ok := manager.GetSession(sessionID)
	if !ok {
		t.Fatalf("session %s not found after resize", sessionID)
	}
	size, err := pty.GetsizeFull(session.Pty)
	if err != nil {
		t.Fatalf("Getsize failed: %v", err)
	}
	if size.Cols != 160 || size.Rows != 40 {
		t.Fatalf("unexpected resize result: got %dx%d", size.Cols, size.Rows)
	}

	sendJSON(map[string]interface{}{
		"type": "kill",
	})

	waitForEvent(func(evt wsEvent) bool {
		return evt.Type == "pty:exit"
	}, 10*time.Second)
}
