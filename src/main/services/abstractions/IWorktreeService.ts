import { WorktreeInfo } from '../WorktreeService';

export interface WorktreeStatus {
  hasChanges: boolean;
  stagedFiles: string[];
  unstagedFiles: string[];
  untrackedFiles: string[];
}

/**
 * Describes the operations required to manage Git worktrees for agent workspaces.
 */
export interface IWorktreeService {
  /**
   * Create a managed worktree rooted at the provided project path.
   * @param projectPath Absolute path to the primary repository.
   * @param workspaceName Human-friendly name for the workspace.
   * @param projectId Identifier tying the worktree back to the project metadata.
   */
  createWorktree(projectPath: string, workspaceName: string, projectId: string): Promise<WorktreeInfo>;

  /**
   * Enumerate all managed worktrees for a project path.
   * @param projectPath Absolute path to the primary repository.
   */
  listWorktrees(projectPath: string): Promise<WorktreeInfo[]>;

  /**
   * Remove an existing worktree and optionally delete the associated branch.
   * @param projectPath Absolute path to the primary repository.
   * @param worktreeId Stable identifier of the worktree.
   * @param worktreePath Optional explicit path override when the worktree has not been tracked yet.
   * @param branch Optional branch name to delete after removing the worktree.
   */
  removeWorktree(
    projectPath: string,
    worktreeId: string,
    worktreePath?: string,
    branch?: string
  ): Promise<void>;

  /**
   * Retrieve the change summary for a specific worktree directory.
   * @param worktreePath Absolute path to the worktree.
   */
  getWorktreeStatus(worktreePath: string): Promise<WorktreeStatus>;

  /**
   * Create a worktree using an existing branch as its starting point.
   * @param projectPath Absolute path to the primary repository.
   * @param workspaceName Desired workspace label.
   * @param branchName Existing branch to check out in the worktree.
   * @param projectId Identifier tying the worktree back to the project metadata.
   * @param options Optional controls for overriding the worktree target path.
   */
  createWorktreeFromBranch(
    projectPath: string,
    workspaceName: string,
    branchName: string,
    projectId: string,
    options?: { worktreePath?: string }
  ): Promise<WorktreeInfo>;
}
