import type { GitChange } from '../GitService';

export type FileDiffLine = {
  left?: string;
  right?: string;
  type: 'context' | 'add' | 'del';
};

/**
 * Provides Git status and file-diff operations scoped to a workspace path.
 */
export interface IGitService {
  /**
   * Collect staged, unstaged, and untracked changes for a workspace.
   * @param workspacePath Absolute path to the workspace repository.
   */
  getStatus(workspacePath: string): Promise<GitChange[]>;

  /**
   * Stage a single file for commit.
   * @param workspacePath Repository root.
   * @param filePath File path relative to the workspace root.
   */
  stageFile(workspacePath: string, filePath: string): Promise<void>;

  /**
   * Revert a file or unstage it if staged.
   * @param workspacePath Repository root.
   * @param filePath File path relative to the workspace root.
   */
  revertFile(
    workspacePath: string,
    filePath: string
  ): Promise<{ action: 'unstaged' | 'reverted' }>;

  /**
   * Generate a diff for a file relative to HEAD.
   * @param workspacePath Repository root.
   * @param filePath File path relative to the workspace root.
   */
  getFileDiff(
    workspacePath: string,
    filePath: string
  ): Promise<{ lines: Array<FileDiffLine> }>;
}
