import type { IWorktreeService } from './abstractions/IWorktreeService';
import type { IPtyService } from './abstractions/IPtyService';
import type { ICodexService } from './abstractions/ICodexService';
import type { IGitService } from './abstractions/IGitService';
import { localWorktreeService } from './local/LocalWorktreeService';
import { localPtyService } from './local/LocalPtyService';
import { remotePtyService } from './remote/RemotePtyService';
import { localCodexService } from './local/LocalCodexService';
import { localGitService } from './local/LocalGitService';
import { remoteCodexService } from './remote/RemoteCodexService';
import { remoteWorktreeService } from './remote/RemoteWorktreeService';

type ServiceMode = 'local' | 'remote';

/**
 * ServiceFactory provides a unified interface to access service implementations.
 * Defaults to 'local' mode, with future support for 'remote' mode.
 */
class ServiceFactory {
  private mode: ServiceMode;

  constructor() {
    this.mode = this.resolveInitialMode();
  }

  private resolveInitialMode(): ServiceMode {
    const rawMode = (process.env.EMDASH_SERVICE_MODE ?? process.env.EMDASH_MODE ?? '').toLowerCase();
    if (rawMode === 'remote' || rawMode === 'local') {
      return rawMode;
    }
    return 'local';
  }

  /**
   * Get the current service mode.
   */
  getMode(): ServiceMode {
    return this.mode;
  }

  /**
   * Set the service mode (for testing or future remote support).
   * @param mode 'local' or 'remote'
   */
  setMode(mode: ServiceMode): void {
    this.mode = mode;
  }

  /**
   * Get the Worktree service implementation.
   */
  getWorktreeService(): IWorktreeService {
    if (this.mode === 'local') {
      return localWorktreeService;
    }
    if (this.mode === 'remote') {
      return remoteWorktreeService;
    }
    throw new Error(`Worktree service not available for mode: ${this.mode}`);
  }

  /**
   * Get the PTY service implementation.
   */
  getPtyService(): IPtyService {
    if (this.mode === 'local') {
      return localPtyService;
    }
    if (this.mode === 'remote') {
      return remotePtyService;
    }
    throw new Error(`PTY service not available for mode: ${this.mode}`);
  }

  /**
   * Get the Codex service implementation.
   */
  getCodexService(): ICodexService {
    if (this.mode === 'local') {
      return localCodexService;
    }
    if (this.mode === 'remote') {
      return remoteCodexService;
    }
    throw new Error(`Codex service not available for mode: ${this.mode}`);
  }

  /**
   * Get the Git service implementation.
   */
  getGitService(): IGitService {
    if (this.mode === 'local') {
      return localGitService;
    }
    throw new Error(`Git service not available for mode: ${this.mode}`);
  }
}

export const serviceFactory = new ServiceFactory();
