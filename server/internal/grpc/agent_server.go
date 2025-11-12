package grpc

import (
	"context"
	"errors"
	"fmt"
	"strings"

	agentpb "github.com/emdashhq/emdash-server/api/proto/agent"
	auditlogger "github.com/emdashhq/emdash-server/internal/logger"
	"github.com/emdashhq/emdash-server/internal/service"
	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"
)

// AgentServer wraps the AgentManager with gRPC adapters.
type AgentServer struct {
	agentpb.UnimplementedAgentServiceServer
	logger      *zap.Logger
	manager     *service.AgentManager
	auditLogger *auditlogger.AuditLogger
}

// NewAgentServer wires dependencies for the AgentService.
func NewAgentServer(logger *zap.Logger, manager *service.AgentManager) *AgentServer {
	if logger == nil {
		logger = zap.NewNop()
	}
	return &AgentServer{
		logger:      logger.Named("grpc-agent-server"),
		manager:     manager,
		auditLogger: auditlogger.NewAuditLogger(logger),
	}
}

// StartAgent launches an agent CLI process for the workspace.
func (s *AgentServer) StartAgent(ctx context.Context, req *agentpb.StartAgentRequest) (_ *agentpb.StartAgentResponse, err error) {
	resource := strings.TrimSpace(req.GetWorkspaceId())
	metadata := map[string]any{
		"workspace_id": resource,
		"provider":     strings.TrimSpace(req.GetProvider()),
		"cwd":          strings.TrimSpace(req.GetCwd()),
		"arg_count":    len(req.GetArgs()),
		"env_keys":     len(req.GetEnv()),
	}
	defer func() {
		if s.auditLogger != nil {
			s.auditLogger.LogAudit(ctx, "agent.start", resource, err == nil, metadata)
		}
	}()
	if err := s.ensureManager(); err != nil {
		return nil, err
	}
	if strings.TrimSpace(req.GetWorkspaceId()) == "" {
		return nil, status.Error(codes.InvalidArgument, "workspace_id is required")
	}
	if strings.TrimSpace(req.GetProvider()) == "" {
		return nil, status.Error(codes.InvalidArgument, "provider is required")
	}

	env := make(map[string]string, len(req.GetEnv()))
	for k, v := range req.GetEnv() {
		env[k] = v
	}

	session, err := s.manager.StartAgent(req.GetWorkspaceId(), req.GetProvider(), req.GetArgs(), req.GetCwd(), env)
	if err != nil {
		return nil, s.convertError(err)
	}

	pid := 0
	if session != nil && session.Cmd != nil && session.Cmd.Process != nil {
		pid = session.Cmd.Process.Pid
	}

	s.logger.Info("agent session started", zap.String("workspace_id", req.GetWorkspaceId()), zap.String("provider", req.GetProvider()), zap.Int("pid", pid))
	return &agentpb.StartAgentResponse{AgentId: req.GetWorkspaceId(), Pid: int32(pid)}, nil
}

// SendMessage forwards input to the running agent.
func (s *AgentServer) SendMessage(ctx context.Context, req *agentpb.SendMessageRequest) (*emptypb.Empty, error) {
	if err := s.ensureManager(); err != nil {
		return nil, err
	}
	if strings.TrimSpace(req.GetWorkspaceId()) == "" {
		return nil, status.Error(codes.InvalidArgument, "workspace_id is required")
	}
	if err := s.manager.SendMessage(req.GetWorkspaceId(), req.GetMessage()); err != nil {
		return nil, s.convertError(err)
	}
	return &emptypb.Empty{}, nil
}

// StopAgent terminates the running agent process.
func (s *AgentServer) StopAgent(ctx context.Context, req *agentpb.StopAgentRequest) (_ *emptypb.Empty, err error) {
	resource := strings.TrimSpace(req.GetWorkspaceId())
	metadata := map[string]any{
		"workspace_id": resource,
	}
	defer func() {
		if s.auditLogger != nil {
			s.auditLogger.LogAudit(ctx, "agent.stop", resource, err == nil, metadata)
		}
	}()
	if err := s.ensureManager(); err != nil {
		return nil, err
	}
	if strings.TrimSpace(req.GetWorkspaceId()) == "" {
		return nil, status.Error(codes.InvalidArgument, "workspace_id is required")
	}
	if err := s.manager.StopAgent(req.GetWorkspaceId()); err != nil {
		return nil, s.convertError(err)
	}
	return &emptypb.Empty{}, nil
}

// GetAgentStatus returns the current/last known state for the workspace.
func (s *AgentServer) GetAgentStatus(ctx context.Context, req *agentpb.GetAgentStatusRequest) (*agentpb.GetAgentStatusResponse, error) {
	if err := s.ensureManager(); err != nil {
		return nil, err
	}
	if strings.TrimSpace(req.GetWorkspaceId()) == "" {
		return nil, status.Error(codes.InvalidArgument, "workspace_id is required")
	}

	snapshot, err := s.manager.GetAgentStatus(req.GetWorkspaceId())
	if err != nil {
		return nil, s.convertError(err)
	}

	resp := &agentpb.GetAgentStatusResponse{
		Status: snapshot.Status,
		Pid:    int32(snapshot.PID),
	}
	if snapshot.ErrorMessage != "" {
		resp.ErrorMessage = snapshot.ErrorMessage
	}
	return resp, nil
}

func (s *AgentServer) convertError(err error) error {
	if err == nil {
		return nil
	}
	switch {
	case errors.Is(err, service.ErrAgentExists):
		return status.Error(codes.AlreadyExists, err.Error())
	case errors.Is(err, service.ErrAgentNotFound):
		return status.Error(codes.NotFound, err.Error())
	case errors.Is(err, service.ErrAgentClosed):
		return status.Error(codes.FailedPrecondition, err.Error())
	default:
		s.logger.Error("agent manager operation failed", zap.Error(err))
		return status.Error(codes.Internal, fmt.Sprintf("agent operation failed: %v", err))
	}
}

func (s *AgentServer) ensureManager() error {
	if s.manager == nil {
		return status.Error(codes.FailedPrecondition, "agent manager not initialized")
	}
	return nil
}
