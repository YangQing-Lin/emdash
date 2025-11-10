import type { FileDiffLine, IGitService } from '../abstractions/IGitService';
import type { GitChange } from '../GitService';
import { getStatus, stageFile, revertFile, getFileDiff } from '../GitService';

/**
 * Local adapter that proxies Git operations to the existing helpers.
 */
export class LocalGitService implements IGitService {
  async getStatus(workspacePath: string): Promise<GitChange[]> {
    return getStatus(workspacePath);
  }

  async stageFile(workspacePath: string, filePath: string): Promise<void> {
    return stageFile(workspacePath, filePath);
  }

  async revertFile(
    workspacePath: string,
    filePath: string
  ): Promise<{ action: 'unstaged' | 'reverted' }> {
    return revertFile(workspacePath, filePath);
  }

  async getFileDiff(
    workspacePath: string,
    filePath: string
  ): Promise<{ lines: Array<FileDiffLine> }> {
    return getFileDiff(workspacePath, filePath);
  }
}

export const localGitService = new LocalGitService();
