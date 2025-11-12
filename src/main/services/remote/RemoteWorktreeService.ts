import { log } from '../../lib/logger';
import type { IWorktreeService, WorktreeStatus } from '../abstractions/IWorktreeService';
import type { WorktreeInfo } from '../WorktreeService';
import {
  CreateWorktreeRequest,
  CreateWorktreeResponse,
  CreateWorktreeFromBranchRequest,
  Empty,
  GrpcClient,
  ListWorktreesRequest,
  ListWorktreesResponse,
  RemoveWorktreeRequest,
  GetWorktreeStatusRequest,
  GetWorktreeStatusResponse,
  WorktreeInfoProto,
  WorktreeServiceClient,
  WorktreeStatusDetailsProto,
  WorktreeStatusProto,
  promisifyUnary,
  UnaryCall,
  formatGrpcError,
} from './grpc-client';
import { REMOTE_GRPC_URL } from './config';

const FRIENDLY_ERRORS = {
  create: 'Unable to create remote worktree. Please try again later.',
  list: 'Unable to list remote worktrees. Please try again later.',
  remove: 'Unable to remove remote worktree. Please try again later.',
  status: 'Unable to retrieve remote worktree status. Please try again later.',
};

export class RemoteWorktreeService implements IWorktreeService {
  private readonly grpcClient: GrpcClient;
  private readonly ready: Promise<void>;
  private worktreeClient: WorktreeServiceClient | null = null;
  private readonly logger = log;

  constructor(private readonly grpcUrl: string = REMOTE_GRPC_URL) {
    this.grpcClient = new GrpcClient(this.grpcUrl);
    this.ready = this.initialize();
  }

  async createWorktree(
    projectPath: string,
    workspaceName: string,
    projectId: string
  ): Promise<WorktreeInfo> {
    this.assertNonEmpty(projectPath, 'projectPath');
    this.assertNonEmpty(workspaceName, 'workspaceName');
    this.assertNonEmpty(projectId, 'projectId');

    const request: CreateWorktreeRequest = {
      project_path: projectPath,
      workspace_name: workspaceName,
      project_id: projectId,
    };

    return this.callGrpc(FRIENDLY_ERRORS.create, async () => {
      const client = await this.getClient();
      const rpc = promisifyUnary<CreateWorktreeRequest, CreateWorktreeResponse>(
        client.CreateWorktree.bind(client) as UnaryCall<CreateWorktreeRequest, CreateWorktreeResponse>
      );
      const response = await rpc(request);
      return this.convertWorktreeInfo(response.worktree);
    });
  }

  async listWorktrees(projectPath: string): Promise<WorktreeInfo[]> {
    this.assertNonEmpty(projectPath, 'projectPath');

    const request: ListWorktreesRequest = { project_path: projectPath };

    return this.callGrpc(FRIENDLY_ERRORS.list, async () => {
      const client = await this.getClient();
      const rpc = promisifyUnary<ListWorktreesRequest, ListWorktreesResponse>(
        client.ListWorktrees.bind(client) as UnaryCall<ListWorktreesRequest, ListWorktreesResponse>
      );
      const response = await rpc(request);
      return (response.worktrees ?? []).map((wt) => this.convertWorktreeInfo(wt));
    });
  }

  async removeWorktree(
    projectPath: string,
    worktreeId: string,
    worktreePath?: string,
    branch?: string
  ): Promise<void> {
    this.assertNonEmpty(projectPath, 'projectPath');
    this.assertNonEmpty(worktreeId, 'worktreeId');

    const request: RemoveWorktreeRequest = {
      project_path: projectPath,
      worktree_id: worktreeId,
      worktree_path: worktreePath,
      branch,
    };

    await this.callGrpc(FRIENDLY_ERRORS.remove, async () => {
      const client = await this.getClient();
      const rpc = promisifyUnary<RemoveWorktreeRequest, Empty>(
        client.RemoveWorktree.bind(client) as UnaryCall<RemoveWorktreeRequest, Empty>
      );
      await rpc(request);
    });
  }

  async getWorktreeStatus(worktreePath: string): Promise<WorktreeStatus> {
    this.assertNonEmpty(worktreePath, 'worktreePath');

    const request: GetWorktreeStatusRequest = { worktree_path: worktreePath };

    return this.callGrpc(FRIENDLY_ERRORS.status, async () => {
      const client = await this.getClient();
      const rpc = promisifyUnary<GetWorktreeStatusRequest, GetWorktreeStatusResponse>(
        client.GetWorktreeStatus.bind(client) as UnaryCall<GetWorktreeStatusRequest, GetWorktreeStatusResponse>
      );
      const response = await rpc(request);
      return this.convertWorktreeStatus(response.status);
    });
  }

  async createWorktreeFromBranch(
    projectPath: string,
    workspaceName: string,
    branchName: string,
    projectId: string,
    options?: { worktreePath?: string }
  ): Promise<WorktreeInfo> {
    this.assertNonEmpty(projectPath, 'projectPath');
    this.assertNonEmpty(workspaceName, 'workspaceName');
    this.assertNonEmpty(branchName, 'branchName');
    this.assertNonEmpty(projectId, 'projectId');

    const request: CreateWorktreeFromBranchRequest = {
      project_path: projectPath,
      workspace_name: workspaceName,
      branch_name: branchName,
      project_id: projectId,
      worktree_path: options?.worktreePath,
    };

    return this.callGrpc(FRIENDLY_ERRORS.create, async () => {
      const client = await this.getClient();
      const rpc = promisifyUnary<CreateWorktreeFromBranchRequest, CreateWorktreeResponse>(
        client.CreateWorktreeFromBranch.bind(client) as UnaryCall<
          CreateWorktreeFromBranchRequest,
          CreateWorktreeResponse
        >
      );
      const response = await rpc(request);
      return this.convertWorktreeInfo(response.worktree);
    });
  }

  private async initialize(): Promise<void> {
    try {
      this.worktreeClient = await this.grpcClient.loadService<WorktreeServiceClient>(
        'worktree.proto',
        'emdash.worktree',
        'WorktreeService'
      );
      this.logger.info('RemoteWorktreeService:initialized', { grpcUrl: this.grpcUrl });
    } catch (error) {
      this.logger.error('RemoteWorktreeService:initFailed', {
        grpcUrl: this.grpcUrl,
        error: formatGrpcError(error),
      });
      throw error;
    }
  }

  private async getClient(): Promise<WorktreeServiceClient> {
    await this.ready;
    if (!this.worktreeClient) {
      throw new Error('Remote worktree gRPC client is not ready');
    }
    return this.worktreeClient;
  }

  private async callGrpc<T>(friendlyMessage: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      this.logger.error('RemoteWorktreeService:grpcError', {
        error: formatGrpcError(error),
      });
      throw new Error(friendlyMessage);
    }
  }

  private assertNonEmpty(value: string | undefined, label: string): void {
    if (!value || !value.trim()) {
      throw new Error(`${label} is required`);
    }
  }

  private convertWorktreeInfo(proto?: WorktreeInfoProto | null): WorktreeInfo {
    if (!proto) {
      throw new Error('Invalid worktree payload received from remote server');
    }

    return {
      id: proto.id || '',
      name: proto.name || '',
      branch: proto.branch || '',
      path: proto.path || '',
      projectId: proto.project_id || '',
      status: this.mapWorktreeStatus(proto.status),
      createdAt: proto.created_at || new Date().toISOString(),
      lastActivity: proto.last_activity ?? undefined,
    };
  }

  private convertWorktreeStatus(proto?: WorktreeStatusDetailsProto | null): WorktreeStatus {
    return {
      hasChanges: Boolean(proto?.has_changes),
      stagedFiles: proto?.staged_files ?? [],
      unstagedFiles: proto?.unstaged_files ?? [],
      untrackedFiles: proto?.untracked_files ?? [],
    };
  }

  private mapWorktreeStatus(status: WorktreeInfoProto['status']): WorktreeInfo['status'] {
    const normalized = this.normalizeStatus(status);
    switch (normalized) {
      case WorktreeStatusProto.WORKTREE_STATUS_PAUSED:
        return 'paused';
      case WorktreeStatusProto.WORKTREE_STATUS_COMPLETED:
        return 'completed';
      case WorktreeStatusProto.WORKTREE_STATUS_ERROR:
        return 'error';
      case WorktreeStatusProto.WORKTREE_STATUS_ACTIVE:
        return 'active';
      default:
        return 'active';
    }
  }

  private normalizeStatus(status: WorktreeInfoProto['status']): WorktreeStatusProto {
    if (typeof status === 'number') {
      return status as WorktreeStatusProto;
    }
    if (typeof status === 'string') {
      const value = (WorktreeStatusProto as Record<string, number | string>)[status];
      if (typeof value === 'number') {
        return value as WorktreeStatusProto;
      }
    }
    return WorktreeStatusProto.WORKTREE_STATUS_UNSPECIFIED;
  }
}

export const remoteWorktreeService = new RemoteWorktreeService();
