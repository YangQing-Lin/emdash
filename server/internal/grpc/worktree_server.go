package grpc

import (
	"bufio"
	"context"
	"crypto/sha1"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/emdashhq/emdash-server/api/proto/common"
	"github.com/emdashhq/emdash-server/api/proto/worktree"
	auditlogger "github.com/emdashhq/emdash-server/internal/logger"
	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"
)

var slugInvalidChars = regexp.MustCompile(`[^a-z0-9]+`)

// WorktreeServer implements worktree.WorktreeServiceServer.
type WorktreeServer struct {
	worktree.UnimplementedWorktreeServiceServer
	logger      *zap.Logger
	auditLogger *auditlogger.AuditLogger
}

// NewWorktreeServer wires a zap logger into the WorktreeService implementation.
func NewWorktreeServer(logger *zap.Logger) *WorktreeServer {
	if logger == nil {
		logger = zap.NewNop()
	}
	return &WorktreeServer{
		logger:      logger.Named("grpc-worktree-server"),
		auditLogger: auditlogger.NewAuditLogger(logger),
	}
}

// CreateWorktree shells out to git worktree add -b <branch> <path>.
func (s *WorktreeServer) CreateWorktree(ctx context.Context, req *worktree.CreateWorktreeRequest) (_ *worktree.CreateWorktreeResponse, err error) {
	resource := ""
	metadata := map[string]any{
		"project_id":     req.GetProjectId(),
		"workspace_name": strings.TrimSpace(req.GetWorkspaceName()),
	}
	defer func() {
		if s.auditLogger != nil {
			s.auditLogger.LogAudit(ctx, "worktree.create", resource, err == nil, metadata)
		}
	}()
	projectPath, err := s.resolveProjectPath(req.GetProjectPath())
	if err != nil {
		return nil, err
	}
	workspaceName := strings.TrimSpace(req.GetWorkspaceName())
	if workspaceName == "" {
		return nil, status.Error(codes.InvalidArgument, "workspace_name is required")
	}

	worktreePath, err := s.resolveWorktreePath(projectPath, workspaceName, "")
	if err != nil {
		return nil, err
	}
	if _, statErr := os.Stat(worktreePath); statErr == nil {
		return nil, status.Errorf(codes.AlreadyExists, "worktree already exists at %s", worktreePath)
	} else if !errors.Is(statErr, os.ErrNotExist) {
		return nil, status.Errorf(codes.Internal, "stat worktree path: %v", statErr)
	}

	branchName := fmt.Sprintf("workspace/%s", slugify(workspaceName))
	if _, err := s.execGitCommand(projectPath, "worktree", "add", "-b", branchName, worktreePath); err != nil {
		return nil, status.Errorf(codes.Internal, "git worktree add failed: %v", err)
	}

	info, err := s.describeWorktree(worktreePath, workspaceName, branchName, req.GetProjectId(), projectPath)
	if err != nil {
		return nil, err
	}

	resource = worktreePath
	metadata["branch"] = branchName
	s.logger.Info("worktree created", zap.String("path", worktreePath), zap.String("branch", branchName))
	return &worktree.CreateWorktreeResponse{Worktree: info}, nil
}

// CreateWorktreeFromBranch adds a worktree from an existing or remote branch.
func (s *WorktreeServer) CreateWorktreeFromBranch(ctx context.Context, req *worktree.CreateWorktreeFromBranchRequest) (_ *worktree.CreateWorktreeResponse, err error) {
	resource := ""
	metadata := map[string]any{
		"project_id":     req.GetProjectId(),
		"workspace_name": strings.TrimSpace(req.GetWorkspaceName()),
		"branch_name":    strings.TrimSpace(req.GetBranchName()),
		"requested_path": strings.TrimSpace(req.GetWorktreePath()),
	}
	defer func() {
		if s.auditLogger != nil {
			s.auditLogger.LogAudit(ctx, "worktree.create", resource, err == nil, metadata)
		}
	}()
	projectPath, err := s.resolveProjectPath(req.GetProjectPath())
	if err != nil {
		return nil, err
	}
	workspaceName := strings.TrimSpace(req.GetWorkspaceName())
	if workspaceName == "" {
		return nil, status.Error(codes.InvalidArgument, "workspace_name is required")
	}
	branchName := strings.TrimSpace(req.GetBranchName())
	if branchName == "" {
		branchName = fmt.Sprintf("workspace/%s", slugify(workspaceName))
	}

	worktreePath, err := s.resolveWorktreePath(projectPath, workspaceName, req.GetWorktreePath())
	if err != nil {
		return nil, err
	}
	if _, statErr := os.Stat(worktreePath); statErr == nil {
		return nil, status.Errorf(codes.AlreadyExists, "worktree already exists at %s", worktreePath)
	} else if !errors.Is(statErr, os.ErrNotExist) {
		return nil, status.Errorf(codes.Internal, "stat worktree path: %v", statErr)
	}

	var gitErr error
	if s.branchExists(projectPath, branchName) {
		_, gitErr = s.execGitCommand(projectPath, "worktree", "add", worktreePath, branchName)
	} else {
		_, gitErr = s.execGitCommand(projectPath, "worktree", "add", "-b", branchName, worktreePath, fmt.Sprintf("origin/%s", branchName))
	}
	if gitErr != nil {
		return nil, status.Errorf(codes.Internal, "git worktree add failed: %v", gitErr)
	}

	info, err := s.describeWorktree(worktreePath, workspaceName, branchName, req.GetProjectId(), projectPath)
	if err != nil {
		return nil, err
	}
	resource = worktreePath
	metadata["branch"] = branchName
	s.logger.Info("worktree created from branch", zap.String("path", worktreePath), zap.String("branch", branchName))
	return &worktree.CreateWorktreeResponse{Worktree: info}, nil
}

// ListWorktrees enumerates git worktree list --porcelain output.
func (s *WorktreeServer) ListWorktrees(ctx context.Context, req *worktree.ListWorktreesRequest) (*worktree.ListWorktreesResponse, error) {
	projectPath, err := s.resolveProjectPath(req.GetProjectPath())
	if err != nil {
		return nil, err
	}
	output, err := s.execGitCommand(projectPath, "worktree", "list", "--porcelain")
	if err != nil {
		return nil, status.Errorf(codes.Internal, "git worktree list failed: %v", err)
	}

	entries := parseWorktreeList(output)
	infos := make([]*common.WorktreeInfo, 0, len(entries))
	projectID := filepath.Base(projectPath)
	root, err := s.worktreesRoot(projectPath)
	if err != nil {
		return nil, err
	}

	for _, entry := range entries {
		if err := ensureWithinRoot(root, entry.path); err != nil {
			s.logger.Debug("skipping unmanaged worktree entry", zap.String("path", entry.path))
			continue
		}
		info, err := s.describeWorktree(entry.path, filepath.Base(entry.path), entry.branch, projectID, projectPath)
		if err != nil {
			s.logger.Warn("skip worktree entry", zap.String("path", entry.path), zap.Error(err))
			continue
		}
		infos = append(infos, info)
	}
	return &worktree.ListWorktreesResponse{Worktrees: infos}, nil
}

// RemoveWorktree removes a git worktree, forcing removal when dirty.
func (s *WorktreeServer) RemoveWorktree(ctx context.Context, req *worktree.RemoveWorktreeRequest) (_ *emptypb.Empty, err error) {
	resource := ""
	metadata := map[string]any{
		"project_path": strings.TrimSpace(req.GetProjectPath()),
		"worktree_id": strings.TrimSpace(req.GetWorktreeId()),
		"worktree":    strings.TrimSpace(req.GetWorktreePath()),
	}
	defer func() {
		if s.auditLogger != nil {
			s.auditLogger.LogAudit(ctx, "worktree.remove", resource, err == nil, metadata)
		}
	}()
	projectPath, err := s.resolveProjectPath(req.GetProjectPath())
	if err != nil {
		return nil, err
	}
	targetPath, err := s.resolveRemovalTarget(projectPath, req)
	if err != nil {
		return nil, err
	}
	resource = targetPath

	if _, err := s.execGitCommand(projectPath, "worktree", "remove", targetPath); err != nil {
		if strings.Contains(err.Error(), "working tree") || strings.Contains(err.Error(), "local modifications") {
			if _, forceErr := s.execGitCommand(projectPath, "worktree", "remove", "-f", targetPath); forceErr != nil {
				return nil, status.Errorf(codes.Internal, "force remove worktree failed: %v", forceErr)
			}
		} else {
			return nil, status.Errorf(codes.Internal, "remove worktree failed: %v", err)
		}
	}

	s.logger.Info("worktree removed", zap.String("path", targetPath))
	return &emptypb.Empty{}, nil
}

// GetWorktreeStatus reports git status --porcelain for the worktree path.
func (s *WorktreeServer) GetWorktreeStatus(ctx context.Context, req *worktree.GetWorktreeStatusRequest) (*worktree.GetWorktreeStatusResponse, error) {
	worktreePath := strings.TrimSpace(req.GetWorktreePath())
	if worktreePath == "" {
		return nil, status.Error(codes.InvalidArgument, "worktree_path is required")
	}
	absPath, err := filepath.Abs(worktreePath)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid worktree path: %v", err)
	}
	if err := s.ensureWorktreePath(absPath); err != nil {
		return nil, err
	}

	output, err := s.execGitCommand(absPath, "status", "--porcelain=v1")
	if err != nil {
		return nil, status.Errorf(codes.Internal, "git status failed: %v", err)
	}

	details := parseStatus(output)
	return &worktree.GetWorktreeStatusResponse{Status: details}, nil
}

func (s *WorktreeServer) resolveProjectPath(path string) (string, error) {
	cleaned := strings.TrimSpace(path)
	if cleaned == "" {
		return "", status.Error(codes.InvalidArgument, "project_path is required")
	}
	abs, err := filepath.Abs(cleaned)
	if err != nil {
		return "", status.Errorf(codes.InvalidArgument, "invalid project path: %v", err)
	}
	info, err := os.Stat(abs)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return "", status.Errorf(codes.NotFound, "project path does not exist: %s", abs)
		}
		return "", status.Errorf(codes.Internal, "stat project path: %v", err)
	}
	if !info.IsDir() {
		return "", status.Errorf(codes.InvalidArgument, "project path is not a directory: %s", abs)
	}
	return abs, nil
}

func (s *WorktreeServer) resolveWorktreePath(projectPath, workspaceName, requested string) (string, error) {
	if strings.TrimSpace(requested) != "" {
		abs, err := filepath.Abs(requested)
		if err != nil {
			return "", status.Errorf(codes.InvalidArgument, "invalid worktree path: %v", err)
		}
		root, err := s.worktreesRoot(projectPath)
		if err != nil {
			return "", err
		}
		if err := ensureWithinRoot(root, abs); err != nil {
			return "", status.Errorf(codes.InvalidArgument, "%v", err)
		}
		return abs, nil
	}
	slug := slugify(workspaceName)
	root, err := s.worktreesRoot(projectPath)
	if err != nil {
		return "", err
	}
	if mkErr := os.MkdirAll(root, 0o755); mkErr != nil {
		return "", status.Errorf(codes.Internal, "create worktrees dir: %v", mkErr)
	}
	return filepath.Join(root, slug), nil
}

func (s *WorktreeServer) resolveRemovalTarget(projectPath string, req *worktree.RemoveWorktreeRequest) (string, error) {
	root, err := s.worktreesRoot(projectPath)
	if err != nil {
		return "", err
	}
	if provided := strings.TrimSpace(req.GetWorktreePath()); provided != "" {
		abs, err := filepath.Abs(provided)
		if err != nil {
			return "", status.Errorf(codes.InvalidArgument, "invalid worktree_path: %v", err)
		}
		if err := ensureWithinRoot(root, abs); err != nil {
			return "", status.Errorf(codes.InvalidArgument, "%v", err)
		}
		return abs, nil
	}

	entries, err := s.listWorktreeEntries(projectPath)
	if err != nil {
		return "", err
	}
	if id := strings.TrimSpace(req.GetWorktreeId()); id != "" {
		for _, entry := range entries {
			if stableWorktreeID(entry.path) == id {
				if err := ensureWithinRoot(root, entry.path); err != nil {
					continue
				}
				return entry.path, nil
			}
		}
	}
	if branch := strings.TrimSpace(req.GetBranch()); branch != "" {
		for _, entry := range entries {
			if entry.branch == branch {
				if err := ensureWithinRoot(root, entry.path); err != nil {
					continue
				}
				return entry.path, nil
			}
		}
	}
	return "", status.Error(codes.NotFound, "worktree not found")
}

func (s *WorktreeServer) worktreesRoot(projectPath string) (string, error) {
	root := filepath.Join(projectPath, "..", "worktrees")
	abs, err := filepath.Abs(root)
	if err != nil {
		return "", status.Errorf(codes.Internal, "resolve worktrees root: %v", err)
	}
	return abs, nil
}

func (s *WorktreeServer) describeWorktree(path, name, branch, projectID, projectPath string) (*common.WorktreeInfo, error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid worktree path: %v", err)
	}
	stat, err := os.Stat(abs)
	ts := time.Now().UTC()
	if err == nil {
		ts = stat.ModTime().UTC()
	}
	if projectID == "" {
		projectID = filepath.Base(projectPath)
	}
	return &common.WorktreeInfo{
		Id:        stableWorktreeID(abs),
		Name:      name,
		Branch:    branch,
		Path:      abs,
		ProjectId: projectID,
		Status:    common.WorktreeStatus_WORKTREE_STATUS_ACTIVE,
		CreatedAt: ts.Format(time.RFC3339),
	}, nil
}

func (s *WorktreeServer) execGitCommand(cwd string, args ...string) (string, error) {
	cmd := exec.Command("git", args...)
	if cwd != "" {
		cmd.Dir = cwd
	}
	output, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("git %s: %w (output: %s)", strings.Join(args, " "), err, strings.TrimSpace(string(output)))
	}
	s.logger.Debug("git command", zap.String("cwd", cwd), zap.Strings("args", args))
	return string(output), nil
}

func (s *WorktreeServer) listWorktreeEntries(projectPath string) ([]worktreeEntry, error) {
	output, err := s.execGitCommand(projectPath, "worktree", "list", "--porcelain")
	if err != nil {
		return nil, status.Errorf(codes.Internal, "git worktree list failed: %v", err)
	}
	return parseWorktreeList(output), nil
}

func (s *WorktreeServer) branchExists(projectPath, branch string) bool {
	_, err := s.execGitCommand(projectPath, "rev-parse", "--verify", branch)
	return err == nil
}

func (s *WorktreeServer) ensureWorktreePath(path string) error {
	info, err := os.Stat(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return status.Errorf(codes.NotFound, "worktree path does not exist: %s", path)
		}
		return status.Errorf(codes.Internal, "stat worktree path: %v", err)
	}
	if !info.IsDir() {
		return status.Errorf(codes.InvalidArgument, "worktree path is not a directory: %s", path)
	}
	if !strings.Contains(path, string(os.PathSeparator)+"worktrees"+string(os.PathSeparator)) {
		return status.Errorf(codes.InvalidArgument, "worktree path must reside under a worktrees directory")
	}
	return nil
}

func parseStatus(output string) *common.WorktreeStatusDetails {
	details := &common.WorktreeStatusDetails{}
	scanner := bufio.NewScanner(strings.NewReader(output))
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "?? ") {
			details.UntrackedFiles = append(details.UntrackedFiles, strings.TrimSpace(line[3:]))
			continue
		}
		if len(line) < 4 {
			continue
		}
		indexStatus := line[0]
		worktreeStatus := line[1]
		path := strings.TrimSpace(line[3:])
		if indexStatus != ' ' {
			details.StagedFiles = append(details.StagedFiles, path)
		}
		if worktreeStatus != ' ' {
			details.UnstagedFiles = append(details.UnstagedFiles, path)
		}
	}
	details.HasChanges = len(details.StagedFiles) > 0 || len(details.UnstagedFiles) > 0 || len(details.UntrackedFiles) > 0
	return details
}

func slugify(name string) string {
	slug := strings.ToLower(strings.TrimSpace(name))
	slug = slugInvalidChars.ReplaceAllString(slug, "-")
	slug = strings.Trim(slug, "-")
	if slug == "" {
		slug = fmt.Sprintf("workspace-%d", time.Now().Unix())
	}
	return slug
}

func stableWorktreeID(path string) string {
	cleaned := filepath.Clean(path)
	sum := sha1.Sum([]byte(cleaned))
	return "wt-" + hex.EncodeToString(sum[:6])
}

type worktreeEntry struct {
	path   string
	branch string
}

func parseWorktreeList(output string) []worktreeEntry {
	scanner := bufio.NewScanner(strings.NewReader(output))
	entries := []worktreeEntry{}
	current := worktreeEntry{}
	haveCurrent := false

	flush := func() {
		if haveCurrent {
			entries = append(entries, current)
			current = worktreeEntry{}
			haveCurrent = false
		}
	}

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			flush()
			continue
		}
		switch {
		case strings.HasPrefix(line, "worktree "):
			flush()
			current.path = strings.TrimSpace(strings.TrimPrefix(line, "worktree"))
			haveCurrent = true
		case strings.HasPrefix(line, "branch "):
			current.branch = strings.TrimSpace(strings.TrimPrefix(line, "branch"))
			current.branch = strings.TrimPrefix(current.branch, "refs/heads/")
		case line == "detached":
			if current.branch == "" {
				current.branch = "(detached)"
			}
		}
	}
	flush()
	return entries
}

func ensureWithinRoot(root, candidate string) error {
	rootAbs, err := filepath.Abs(root)
	if err != nil {
		return fmt.Errorf("resolve root: %w", err)
	}
	candAbs, err := filepath.Abs(candidate)
	if err != nil {
		return fmt.Errorf("resolve candidate: %w", err)
	}
	rootPrefix := rootAbs + string(os.PathSeparator)
	if candAbs != rootAbs && !strings.HasPrefix(candAbs, rootPrefix) {
		return fmt.Errorf("path %s is outside allowed root %s", candAbs, rootAbs)
	}
	return nil
}
