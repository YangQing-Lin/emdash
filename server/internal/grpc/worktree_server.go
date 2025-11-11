package grpc

import (
	"context"
	"time"

	"github.com/emdashhq/emdash-server/api/proto/common"
	"github.com/emdashhq/emdash-server/api/proto/worktree"
	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"
)

// WorktreeServer implements worktree.WorktreeServiceServer with placeholder logic.
type WorktreeServer struct {
	worktree.UnimplementedWorktreeServiceServer
	logger *zap.Logger
}

// NewWorktreeServer wires a zap logger into the WorktreeService stub.
func NewWorktreeServer(logger *zap.Logger) *WorktreeServer {
	return &WorktreeServer{
		logger: logger,
	}
}

// CreateWorktree logs the request and returns mock data until backend logic is ready.
func (s *WorktreeServer) CreateWorktree(ctx context.Context, req *worktree.CreateWorktreeRequest) (*worktree.CreateWorktreeResponse, error) {
	s.logger.Info("CreateWorktree request received", zap.Any("request", req))

	resp := &worktree.CreateWorktreeResponse{
		Worktree: &common.WorktreeInfo{
			Id:        "mock-worktree-id",
			Name:      req.GetWorkspaceName(),
			Branch:    "main",
			Path:      req.GetProjectPath(),
			ProjectId: req.GetProjectId(),
			Status:    common.WorktreeStatus_WORKTREE_STATUS_UNSPECIFIED,
			CreatedAt: time.Now().UTC().Format(time.RFC3339),
		},
	}

	// TODO: implement CreateWorktree by orchestrating git worktree commands.
	return resp, status.Errorf(codes.Unimplemented, "TODO: implement %s", "CreateWorktree")
}

// ListWorktrees logs the request and returns an empty result until real data is available.
func (s *WorktreeServer) ListWorktrees(ctx context.Context, req *worktree.ListWorktreesRequest) (*worktree.ListWorktreesResponse, error) {
	s.logger.Info("ListWorktrees request received", zap.Any("request", req))

	resp := &worktree.ListWorktreesResponse{
		Worktrees: []*common.WorktreeInfo{},
	}

	// TODO: implement ListWorktrees by reading local git worktree metadata.
	return resp, status.Errorf(codes.Unimplemented, "TODO: implement %s", "ListWorktrees")
}

// RemoveWorktree logs the request and returns an empty response until removal logic exists.
func (s *WorktreeServer) RemoveWorktree(ctx context.Context, req *worktree.RemoveWorktreeRequest) (*emptypb.Empty, error) {
	s.logger.Info("RemoveWorktree request received", zap.Any("request", req))

	resp := &emptypb.Empty{}

	// TODO: implement RemoveWorktree by deleting git worktrees and cleaning state.
	return resp, status.Errorf(codes.Unimplemented, "TODO: implement %s", "RemoveWorktree")
}

// GetWorktreeStatus logs the request and returns placeholder status information.
func (s *WorktreeServer) GetWorktreeStatus(ctx context.Context, req *worktree.GetWorktreeStatusRequest) (*worktree.GetWorktreeStatusResponse, error) {
	s.logger.Info("GetWorktreeStatus request received", zap.Any("request", req))

	resp := &worktree.GetWorktreeStatusResponse{
		Status: &common.WorktreeStatusDetails{
			HasChanges:     false,
			StagedFiles:    []string{},
			UnstagedFiles:  []string{},
			UntrackedFiles: []string{},
		},
	}

	// TODO: implement GetWorktreeStatus by diffing the git repository for a worktree.
	return resp, status.Errorf(codes.Unimplemented, "TODO: implement %s", "GetWorktreeStatus")
}

// CreateWorktreeFromBranch logs the request and returns mock worktree metadata.
func (s *WorktreeServer) CreateWorktreeFromBranch(ctx context.Context, req *worktree.CreateWorktreeFromBranchRequest) (*worktree.CreateWorktreeResponse, error) {
	s.logger.Info("CreateWorktreeFromBranch request received", zap.Any("request", req))

	resp := &worktree.CreateWorktreeResponse{
		Worktree: &common.WorktreeInfo{
			Id:        "mock-branch-worktree-id",
			Name:      req.GetWorkspaceName(),
			Branch:    req.GetBranchName(),
			Path:      req.GetProjectPath(),
			ProjectId: req.GetProjectId(),
			Status:    common.WorktreeStatus_WORKTREE_STATUS_UNSPECIFIED,
			CreatedAt: time.Now().UTC().Format(time.RFC3339),
		},
	}

	// TODO: implement CreateWorktreeFromBranch by checking out the requested branch into a worktree.
	return resp, status.Errorf(codes.Unimplemented, "TODO: implement %s", "CreateWorktreeFromBranch")
}
