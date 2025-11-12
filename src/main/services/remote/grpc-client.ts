import path from 'path';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';

const PROTO_ROOT = path.resolve(__dirname, '../../../server/api/proto');
const DEFAULT_DEADLINE_MS = 5000;

export type Empty = Record<string, never>;

export type UnaryCall<TRequest, TResponse> = (
  request: TRequest,
  metadata: grpc.Metadata | undefined,
  options: grpc.CallOptions | undefined,
  callback: (error: grpc.ServiceError | null, response: TResponse) => void
) => grpc.ClientUnaryCall;

export class GrpcClient {
  private client: grpc.Client | null = null;

  constructor(private readonly serverUrl: string = 'localhost:50051') {}

  async loadService<T>(protoFile: string, packageName: string, serviceName: string): Promise<T> {
    const packageDefinition = await protoLoader.load(path.join(PROTO_ROOT, protoFile), {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    });

    const proto = grpc.loadPackageDefinition(packageDefinition);
    const resolvedPackage = this.resolvePackage(proto, packageName);
    if (!resolvedPackage) {
      throw new Error(`Unable to find package ${packageName} inside ${protoFile}`);
    }

    const ServiceConstructor = resolvedPackage[serviceName] as grpc.ServiceClientConstructor | undefined;
    if (!ServiceConstructor) {
      throw new Error(`Unable to find service ${serviceName} in package ${packageName}`);
    }

    this.client = new ServiceConstructor(this.serverUrl, grpc.credentials.createInsecure());
    return this.client as unknown as T;
  }

  close(): void {
    if (this.client) {
      this.client.close();
      this.client = null;
    }
  }

  private resolvePackage(proto: grpc.GrpcObject, packageName: string): any {
    return packageName.split('.').reduce((acc: any, key) => {
      if (!acc) return undefined;
      return acc[key];
    }, proto as any);
  }
}

export function promisifyUnary<TRequest, TResponse>(
  fn: UnaryCall<TRequest, TResponse>,
  timeoutMs: number = DEFAULT_DEADLINE_MS
): (request: TRequest, metadata?: grpc.Metadata) => Promise<TResponse> {
  return (request: TRequest, metadata?: grpc.Metadata) =>
    new Promise<TResponse>((resolve, reject) => {
      const deadline = Date.now() + timeoutMs;
      fn(
        request,
        metadata,
        { deadline },
        (error, response) => {
          if (error) {
            reject(error);
            return;
          }
          if (response === undefined || response === null) {
            reject(new Error('gRPC call completed without a response payload'));
            return;
          }
          resolve(response);
        }
      );
    });
}

export function formatGrpcError(error: unknown): string {
  if (!error) return 'Unknown gRPC error';
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && 'message' in (error as Record<string, unknown>)) {
    return String((error as Record<string, unknown>).message);
  }
  return String(error);
}

// Agent service types ----------------------------------------------

export interface AgentServiceClient extends grpc.Client {
  StartAgent(
    request: StartAgentRequest,
    callback: (error: grpc.ServiceError | null, response: StartAgentResponse) => void
  ): grpc.ClientUnaryCall;

  SendMessage(
    request: SendMessageRequest,
    callback: (error: grpc.ServiceError | null, response: Empty) => void
  ): grpc.ClientUnaryCall;

  StopAgent(
    request: StopAgentRequest,
    callback: (error: grpc.ServiceError | null, response: Empty) => void
  ): grpc.ClientUnaryCall;

  GetAgentStatus(
    request: GetAgentStatusRequest,
    callback: (error: grpc.ServiceError | null, response: GetAgentStatusResponse) => void
  ): grpc.ClientUnaryCall;
}

export interface StartAgentRequest {
  workspace_id: string;
  provider: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
}

export interface StartAgentResponse {
  agent_id: string;
  pid: number;
}

export interface SendMessageRequest {
  workspace_id: string;
  message: string;
}

export interface StopAgentRequest {
  workspace_id: string;
}

export interface GetAgentStatusRequest {
  workspace_id: string;
}

export enum AgentStatus {
  AGENT_STATUS_UNSPECIFIED = 0,
  AGENT_STATUS_STARTING = 1,
  AGENT_STATUS_RUNNING = 2,
  AGENT_STATUS_STOPPED = 3,
  AGENT_STATUS_ERROR = 4,
}

export interface GetAgentStatusResponse {
  status: AgentStatus | keyof typeof AgentStatus | string | number;
  pid: number;
  error_message: string;
}

// Worktree service types -------------------------------------------

export interface WorktreeServiceClient extends grpc.Client {
  CreateWorktree(
    request: CreateWorktreeRequest,
    callback: (error: grpc.ServiceError | null, response: CreateWorktreeResponse) => void
  ): grpc.ClientUnaryCall;

  ListWorktrees(
    request: ListWorktreesRequest,
    callback: (error: grpc.ServiceError | null, response: ListWorktreesResponse) => void
  ): grpc.ClientUnaryCall;

  RemoveWorktree(
    request: RemoveWorktreeRequest,
    callback: (error: grpc.ServiceError | null, response: Empty) => void
  ): grpc.ClientUnaryCall;

  GetWorktreeStatus(
    request: GetWorktreeStatusRequest,
    callback: (error: grpc.ServiceError | null, response: GetWorktreeStatusResponse) => void
  ): grpc.ClientUnaryCall;

  CreateWorktreeFromBranch(
    request: CreateWorktreeFromBranchRequest,
    callback: (error: grpc.ServiceError | null, response: CreateWorktreeResponse) => void
  ): grpc.ClientUnaryCall;
}

export interface CreateWorktreeRequest {
  project_path: string;
  workspace_name: string;
  project_id: string;
}

export interface CreateWorktreeResponse {
  worktree: WorktreeInfoProto;
}

export interface ListWorktreesRequest {
  project_path: string;
}

export interface ListWorktreesResponse {
  worktrees: WorktreeInfoProto[];
}

export interface RemoveWorktreeRequest {
  project_path: string;
  worktree_id: string;
  worktree_path?: string;
  branch?: string;
}

export interface GetWorktreeStatusRequest {
  worktree_path: string;
}

export interface GetWorktreeStatusResponse {
  status: WorktreeStatusDetailsProto;
}

export interface CreateWorktreeFromBranchRequest {
  project_path: string;
  workspace_name: string;
  branch_name: string;
  project_id: string;
  worktree_path?: string;
}

export enum WorktreeStatusProto {
  WORKTREE_STATUS_UNSPECIFIED = 0,
  WORKTREE_STATUS_ACTIVE = 1,
  WORKTREE_STATUS_PAUSED = 2,
  WORKTREE_STATUS_COMPLETED = 3,
  WORKTREE_STATUS_ERROR = 4,
}

export interface WorktreeInfoProto {
  id: string;
  name: string;
  branch: string;
  path: string;
  project_id: string;
  status: WorktreeStatusProto | keyof typeof WorktreeStatusProto | string | number;
  created_at: string;
  last_activity?: string | null;
}

export interface WorktreeStatusDetailsProto {
  has_changes: boolean;
  staged_files: string[];
  unstaged_files: string[];
  untracked_files: string[];
}
