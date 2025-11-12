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

export type ServiceMode = 'local' | 'remote';

/**
 * ServiceFactory - 根据项目模式提供对应的服务实例。
 *
 * 当前实现等同于占位实现：默认返回 local 服务，但保留 remote
 * 模式及 remoteServerId 的入口，以方便未来对接 RemoteWorktreeService、
 * RemoteGitService 等远程能力。
 */
export class ServiceFactory {
  private mode: ServiceMode;
  private remoteServerId: string | null;

  constructor(mode: ServiceMode = 'local', remoteServerId: string | null = null) {
    this.mode = this.resolveInitialMode(mode);
    this.remoteServerId = remoteServerId ?? process.env.EMDASH_REMOTE_SERVER_ID ?? null;
  }

  private resolveInitialMode(fallback: ServiceMode): ServiceMode {
    const rawMode = (process.env.EMDASH_SERVICE_MODE ?? process.env.EMDASH_MODE ?? '').toLowerCase();
    if (rawMode === 'remote' || rawMode === 'local') {
      return rawMode;
    }
    return fallback;
  }

  getMode(): ServiceMode {
    return this.mode;
  }

  /**
   * 占位 getter，后续 remote 模式下会根据 remoteServerId 派发远程服务。
   */
  getRemoteServerId(): string | null {
    return this.remoteServerId;
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

// 工厂实例创建辅助函数（占位）
export function createServiceFactory(
  mode: ServiceMode = 'local',
  remoteServerId: string | null = null
): ServiceFactory {
  return new ServiceFactory(mode, remoteServerId);
}

export const serviceFactory = createServiceFactory();
