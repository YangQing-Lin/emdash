package main

import (
	"context"
	"net/http"
	"os/signal"
	"syscall"
	"time"

	"github.com/creack/pty"
	"github.com/gorilla/websocket"
	"go.uber.org/zap"
	"google.golang.org/grpc"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/emptypb"
)

func main() {
	logger, err := zap.NewProduction()
	if err != nil {
		panic(err)
	}
	defer func() { _ = logger.Sync() }()

	logger.Info("Emdash Server Starting...")

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	grpcServer := grpc.NewServer()
	defer grpcServer.GracefulStop()

	wsUpgrader := websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool {
			return true
		},
	}
	logger.Info("WebSocket upgrader initialized", zap.Duration("handshake_timeout", wsUpgrader.HandshakeTimeout))

	ensureProtoRuntime(logger)
	bootstrapPTY(logger)

	logger.Info("gRPC server placeholder initialized", zap.String("addr", "0.0.0.0:50051"))
	logger.Info("WebSocket server placeholder initialized", zap.String("addr", "0.0.0.0:8080"))

	<-ctx.Done()
	logger.Info("Shutdown signal received", zap.Any("signal", ctx.Err()))

	shutdownGracefully(logger)
}

func ensureProtoRuntime(logger *zap.Logger) {
	sample := &emptypb.Empty{}
	if _, err := proto.Marshal(sample); err != nil {
		logger.Warn("protobuf runtime not ready", zap.Error(err))
		return
	}
	logger.Debug("protobuf runtime initialized")
}

func bootstrapPTY(logger *zap.Logger) {
	master, slave, err := pty.Open()
	if err != nil {
		logger.Debug("unable to allocate pseudo-terminal", zap.Error(err))
		return
	}
	_ = master.Close()
	_ = slave.Close()
	logger.Debug("pseudo-terminal allocation succeeded")
}

func shutdownGracefully(logger *zap.Logger) {
	// Placeholder for shutting down gRPC, WebSocket, and PTY resources.
	logger.Info("Emdash Server stopped gracefully", zap.Time("timestamp", time.Now()))
}
