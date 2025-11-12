package main

import (
	"context"
	"errors"
	"net"
	"net/http"
	"os/signal"
	"syscall"
	"time"

	creackpty "github.com/creack/pty"
	agentpb "github.com/emdashhq/emdash-server/api/proto/agent"
	gitpb "github.com/emdashhq/emdash-server/api/proto/git"
	ptypb "github.com/emdashhq/emdash-server/api/proto/pty"
	worktreepb "github.com/emdashhq/emdash-server/api/proto/worktree"
	emdgrpc "github.com/emdashhq/emdash-server/internal/grpc"
	"github.com/emdashhq/emdash-server/internal/service"
	ws "github.com/emdashhq/emdash-server/internal/websocket"
	"go.uber.org/zap"
	"google.golang.org/grpc"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/emptypb"
)

const (
	grpcAddress = ":50051"
	httpAddress = ":8080"
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

	listener, err := net.Listen("tcp", grpcAddress)
	if err != nil {
		logger.Fatal("failed to create gRPC listener", zap.String("addr", grpcAddress), zap.Error(err))
	}
	defer func() {
		if cerr := listener.Close(); cerr != nil {
			logger.Warn("failed to close gRPC listener", zap.Error(cerr))
		}
	}()

	hub := ws.NewHub(logger)
	go hub.Run()

	ptyManager := service.NewPtyManager(logger, hub)
	agentManager := service.NewAgentManager(logger, hub)

	grpcServer := grpc.NewServer()
	worktreepb.RegisterWorktreeServiceServer(grpcServer, emdgrpc.NewWorktreeServer(logger))
	gitpb.RegisterGitServiceServer(grpcServer, emdgrpc.NewGitServer(logger))
	ptypb.RegisterPtyServiceServer(grpcServer, emdgrpc.NewPtyServer(logger, ptyManager))
	agentpb.RegisterAgentServiceServer(grpcServer, emdgrpc.NewAgentServer(logger, agentManager))

	go func() {
		logger.Info("gRPC server listening on :50051", zap.String("addr", grpcAddress))
		if serveErr := grpcServer.Serve(listener); serveErr != nil && !errors.Is(serveErr, grpc.ErrServerStopped) {
			logger.Error("gRPC server stopped unexpectedly", zap.Error(serveErr))
		}
	}()

	httpMux := http.NewServeMux()
	httpMux.Handle("/ws/pty", ws.NewHandler(hub, logger, ptyManager))

	httpServer := &http.Server{
		Addr:    httpAddress,
		Handler: httpMux,
	}

	go func() {
		logger.Info("WebSocket server listening on :8080", zap.String("addr", httpAddress))
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("websocket server stopped unexpectedly", zap.Error(err))
		}
	}()

	ensureProtoRuntime(logger)
	bootstrapPTY(logger)

	<-ctx.Done()
	logger.Info("Shutdown signal received", zap.Any("signal", ctx.Err()))

	shutdownGracefully(logger, grpcServer, httpServer, hub, ptyManager, agentManager)
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
	master, slave, err := creackpty.Open()
	if err != nil {
		logger.Debug("unable to allocate pseudo-terminal", zap.Error(err))
		return
	}
	_ = master.Close()
	_ = slave.Close()
	logger.Debug("pseudo-terminal allocation succeeded")
}

func shutdownGracefully(logger *zap.Logger, grpcServer *grpc.Server, httpServer *http.Server, hub *ws.Hub, ptyManager *service.PtyManager, agentManager *service.AgentManager) {
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if httpServer != nil {
		logger.Info("Shutting down HTTP server")
		if err := httpServer.Shutdown(shutdownCtx); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("HTTP server shutdown error", zap.Error(err))
		}
	}

	if ptyManager != nil {
		logger.Info("Shutting down PTY sessions")
		ptyManager.Shutdown()
	}
	if agentManager != nil {
		logger.Info("Shutting down agent sessions")
		agentManager.Shutdown()
	}

	if hub != nil {
		logger.Info("Shutting down websocket hub")
		hub.Shutdown(shutdownCtx)
	}

	if grpcServer != nil {
		logger.Info("Stopping gRPC server gracefully")
		grpcServer.GracefulStop()
	}
	logger.Info("Emdash Server stopped gracefully", zap.Time("timestamp", time.Now()))
}
