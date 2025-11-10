import type { IWorktreeService, WorktreeStatus } from '../abstractions/IWorktreeService';
import type { WorktreeInfo } from '../WorktreeService';
import { worktreeService } from '../WorktreeService';

/**
 * Local adapter that reuses the existing singleton WorktreeService.
 */
export class LocalWorktreeService implements IWorktreeService {
  private readonly worktreeService = worktreeService;

  async createWorktree(
    projectPath: string,
    workspaceName: string,
    projectId: string
  ): Promise<WorktreeInfo> {
    return this.worktreeService.createWorktree(projectPath, workspaceName, projectId);
  }

  async listWorktrees(projectPath: string): Promise<WorktreeInfo[]> {
    return this.worktreeService.listWorktrees(projectPath);
  }

  async removeWorktree(
    projectPath: string,
    worktreeId: string,
    worktreePath?: string,
    branch?: string
  ): Promise<void> {
    return this.worktreeService.removeWorktree(projectPath, worktreeId, worktreePath, branch);
  }

  async getWorktreeStatus(worktreePath: string): Promise<WorktreeStatus> {
    return this.worktreeService.getWorktreeStatus(worktreePath);
  }

  async createWorktreeFromBranch(
    projectPath: string,
    workspaceName: string,
    branchName: string,
    projectId: string,
    options?: { worktreePath?: string }
  ): Promise<WorktreeInfo> {
    return this.worktreeService.createWorktreeFromBranch(
      projectPath,
      workspaceName,
      branchName,
      projectId,
      options
    );
  }
}

export const localWorktreeService = new LocalWorktreeService();
