package grpc

import (
	"context"
	"errors"
	"fmt"

	"github.com/emdashhq/emdash-server/api/proto/pty"
	auditlogger "github.com/emdashhq/emdash-server/internal/logger"
	"github.com/emdashhq/emdash-server/internal/service"
	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"
)

// PtyServer implements the full lifecycle for PTY sessions exposed via gRPC.
type PtyServer struct {
	pty.UnimplementedPtyServiceServer
	logger      *zap.Logger
	ptyManager  *service.PtyManager
	auditLogger *auditlogger.AuditLogger
}

// NewPtyServer wires a zap logger into the PtyService.
func NewPtyServer(logger *zap.Logger, manager *service.PtyManager) *PtyServer {
	if logger == nil {
		logger = zap.NewNop()
	}
	return &PtyServer{
		logger:      logger.Named("grpc-pty-server"),
		ptyManager:  manager,
		auditLogger: auditlogger.NewAuditLogger(logger),
	}
}

// StartPty creates a new session and returns the ID once ready.
func (s *PtyServer) StartPty(ctx context.Context, req *pty.PtyStartRequest) (_ *pty.PtyStartResponse, err error) {
	if err := s.ensureManager(); err != nil {
		return nil, err
	}

	id := req.GetId()
	if id == "" {
		return nil, status.Error(codes.InvalidArgument, "pty id is required")
	}
	metadata := map[string]any{
		"pty_id":   id,
		"cwd":      req.GetCwd(),
		"shell":    req.GetShell(),
		"cols":     req.GetCols(),
		"rows":     req.GetRows(),
		"env_keys": len(req.GetEnv()),
	}
	defer func() {
		if s.auditLogger != nil {
			s.auditLogger.LogAudit(ctx, "pty.start", id, err == nil, metadata)
		}
	}()

	env := make(map[string]string, len(req.GetEnv()))
	for k, v := range req.GetEnv() {
		env[k] = v
	}

	if err := s.ptyManager.StartPty(id, req.GetCwd(), req.GetShell(), env, req.GetCols(), req.GetRows()); err != nil {
		return nil, s.convertError(err)
	}

	s.logger.Info("PTY session started", zap.String("pty_id", id))
	return &pty.PtyStartResponse{Id: id}, nil
}

// StreamPtyData fans out PTY output and exit events over the gRPC stream.
func (s *PtyServer) StreamPtyData(req *pty.PtyStreamRequest, stream pty.PtyService_StreamPtyDataServer) error {
	if err := s.ensureManager(); err != nil {
		return err
	}

	id := req.GetId()
	if id == "" {
		return status.Error(codes.InvalidArgument, "pty id is required")
	}

	session, ok := s.ptyManager.GetSession(id)
	if !ok {
		return status.Error(codes.NotFound, "pty session not found")
	}

	outputChan := session.Output()
	exitChan := session.Exit()

	for {
		select {
		case <-stream.Context().Done():
			return stream.Context().Err()
		case chunk, ok := <-outputChan:
			if !ok {
				outputChan = nil
				continue
			}
			if len(chunk) == 0 {
				continue
			}
			event := &pty.PtyStreamEvent{
				Id: id,
				Event: &pty.PtyStreamEvent_Data{
					Data: &pty.PtyDataEvent{
						Id:   id,
						Data: string(chunk),
					},
				},
			}
			if err := stream.Send(event); err != nil {
				return err
			}
		case code, ok := <-exitChan:
			if !ok {
				return nil
			}
			exitEvent := &pty.PtyStreamEvent{
				Id: id,
				Event: &pty.PtyStreamEvent_Exit{
					Exit: &pty.PtyExitEvent{
						Id:       id,
						ExitCode: int32(code),
						Signal:   session.ExitSignal(),
					},
				},
			}
			if err := stream.Send(exitEvent); err != nil {
				return err
			}
			return nil
		}
	}
}

// WritePty forwards the provided data to the PTY stdin.
func (s *PtyServer) WritePty(ctx context.Context, req *pty.PtyWriteRequest) (*emptypb.Empty, error) {
	if err := s.ensureManager(); err != nil {
		return nil, err
	}
	if req.GetId() == "" {
		return nil, status.Error(codes.InvalidArgument, "pty id is required")
	}
	if err := s.ptyManager.WritePty(req.GetId(), []byte(req.GetData())); err != nil {
		return nil, s.convertError(err)
	}
	return &emptypb.Empty{}, nil
}

// ResizePty adjusts the PTY dimensions.
func (s *PtyServer) ResizePty(ctx context.Context, req *pty.PtyResizeRequest) (*emptypb.Empty, error) {
	if err := s.ensureManager(); err != nil {
		return nil, err
	}
	if req.GetId() == "" {
		return nil, status.Error(codes.InvalidArgument, "pty id is required")
	}
	if err := s.ptyManager.ResizePty(req.GetId(), req.GetCols(), req.GetRows()); err != nil {
		return nil, s.convertError(err)
	}
	return &emptypb.Empty{}, nil
}

// KillPty terminates the running PTY session.
func (s *PtyServer) KillPty(ctx context.Context, req *pty.PtyKillRequest) (_ *emptypb.Empty, err error) {
	if err := s.ensureManager(); err != nil {
		return nil, err
	}
	if req.GetId() == "" {
		return nil, status.Error(codes.InvalidArgument, "pty id is required")
	}
	id := req.GetId()
	metadata := map[string]any{"pty_id": id}
	defer func() {
		if s.auditLogger != nil {
			s.auditLogger.LogAudit(ctx, "pty.kill", id, err == nil, metadata)
		}
	}()
	if err := s.ptyManager.KillPty(req.GetId()); err != nil {
		return nil, s.convertError(err)
	}
	return &emptypb.Empty{}, nil
}

func (s *PtyServer) convertError(err error) error {
	if err == nil {
		return nil
	}
	switch {
	case errors.Is(err, service.ErrSessionExists):
		return status.Error(codes.AlreadyExists, err.Error())
	case errors.Is(err, service.ErrSessionNotFound):
		return status.Error(codes.NotFound, err.Error())
	case errors.Is(err, service.ErrSessionClosed):
		return status.Error(codes.FailedPrecondition, err.Error())
	default:
		s.logger.Error("pty manager operation failed", zap.Error(err))
		return status.Error(codes.Internal, fmt.Sprintf("pty operation failed: %v", err))
	}
}

func (s *PtyServer) ensureManager() error {
	if s.ptyManager == nil {
		return status.Error(codes.FailedPrecondition, "pty manager not initialized")
	}
	return nil
}
