package grpc

import (
	"context"

	"github.com/emdashhq/emdash-server/api/proto/git"
	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"
)

// GitServer implements git.GitServiceServer with logging and unimplemented stubs.
type GitServer struct {
	git.UnimplementedGitServiceServer
	logger *zap.Logger
}

// NewGitServer wires a zap logger into the GitService stub.
func NewGitServer(logger *zap.Logger) *GitServer {
	return &GitServer{
		logger: logger,
	}
}

// GetStatus logs the request and returns placeholder change information.
func (s *GitServer) GetStatus(ctx context.Context, req *git.GetStatusRequest) (*git.GetStatusResponse, error) {
	s.logger.Info("GetStatus request received", zap.Any("request", req))

	resp := &git.GetStatusResponse{
		Changes: []*git.GitChange{},
	}

	// TODO: implement GetStatus by shelling out to git status within the workspace.
	return resp, status.Errorf(codes.Unimplemented, "TODO: implement %s", "GetStatus")
}

// StageFile logs the request and returns an empty response until staging logic exists.
func (s *GitServer) StageFile(ctx context.Context, req *git.StageFileRequest) (*emptypb.Empty, error) {
	s.logger.Info("StageFile request received", zap.Any("request", req))

	resp := &emptypb.Empty{}

	// TODO: implement StageFile by staging files via git add.
	return resp, status.Errorf(codes.Unimplemented, "TODO: implement %s", "StageFile")
}

// RevertFile logs the request and returns a mock action result.
func (s *GitServer) RevertFile(ctx context.Context, req *git.RevertFileRequest) (*git.RevertFileResponse, error) {
	s.logger.Info("RevertFile request received", zap.Any("request", req))

	resp := &git.RevertFileResponse{
		Action: git.RevertAction_REVERT_ACTION_UNSPECIFIED,
	}

	// TODO: implement RevertFile by invoking git checkout -- file or similar.
	return resp, status.Errorf(codes.Unimplemented, "TODO: implement %s", "RevertFile")
}

// GetFileDiff logs the request and returns mock diff data.
func (s *GitServer) GetFileDiff(ctx context.Context, req *git.GetFileDiffRequest) (*git.GetFileDiffResponse, error) {
	s.logger.Info("GetFileDiff request received", zap.Any("request", req))

	resp := &git.GetFileDiffResponse{
		Lines: []*git.FileDiffLine{},
	}

	// TODO: implement GetFileDiff by capturing git diff output and streaming lines.
	return resp, status.Errorf(codes.Unimplemented, "TODO: implement %s", "GetFileDiff")
}
