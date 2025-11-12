import { EventEmitter } from 'events';
import WebSocket, { RawData } from 'ws';
import type { ICodexService } from '../abstractions/ICodexService';
import type { CodexAgent, CodexResponse } from '../CodexService';
import { log } from '../../lib/logger';
import {
  AgentServiceClient,
  Empty,
  GetAgentStatusRequest,
  GetAgentStatusResponse,
  GrpcClient,
  SendMessageRequest,
  StartAgentRequest,
  StartAgentResponse,
  StopAgentRequest,
  UnaryCall,
  formatGrpcError,
  promisifyUnary,
} from './grpc-client';
import { REMOTE_GRPC_URL, REMOTE_SERVER_URL } from './config';

type AgentSocketMessage =
  | {
      type: 'agent:output';
      data?: string;
      stream?: 'stdout' | 'stderr';
      workspace_id?: string;
    }
  | {
      type: 'agent:exit';
      exit_code?: number;
      error?: string;
      workspace_id?: string;
    }
  | {
      type: string;
      [key: string]: unknown;
    };

interface StreamPayload {
  workspaceId: string;
  data: string;
  stream: 'stdout' | 'stderr';
}

interface ExitPayload {
  workspaceId: string;
  exitCode?: number;
  error?: string;
}

const FRIENDLY_ERRORS = {
  start: 'Unable to start remote Codex agent. Please try again later.',
  send: 'Unable to communicate with the remote Codex agent. Please try again.',
  stop: 'Unable to stop the remote Codex agent. Please try again.',
};

const MAX_WS_ATTEMPTS = 3;
const BASE_WS_RETRY_DELAY_MS = 250;

export class RemoteCodexService extends EventEmitter implements ICodexService {
  private readonly grpcClient: GrpcClient;
  private readonly ready: Promise<void>;
  private agentClient: AgentServiceClient | null = null;
  private readonly wsConnections = new Map<string, WebSocket>();
  private readonly wsRetryCounts = new Map<string, number>();
  private readonly wsRetryTimers = new Map<string, NodeJS.Timeout>();
  private readonly wsPendingConnections = new Map<string, Promise<void>>();
  private readonly agents = new Map<string, CodexAgent>();
  private readonly activeConversations = new Map<string, string>();
  private readonly logger = log;

  constructor(
    private readonly wsUrl: string = REMOTE_SERVER_URL,
    private readonly grpcUrl: string = REMOTE_GRPC_URL
  ) {
    super();
    this.grpcClient = new GrpcClient(this.grpcUrl);
    this.ready = this.initialize();
  }

  async createAgent(workspaceId: string, worktreePath: string): Promise<CodexAgent> {
    this.assertNonEmpty(workspaceId, 'workspaceId');
    this.assertNonEmpty(worktreePath, 'worktreePath');

    const existing = this.agents.get(workspaceId);
    if (existing) {
      if (!this.wsConnections.has(workspaceId)) {
        await this.safeConnectWebSocket(workspaceId);
      }
      return existing;
    }

    const request: StartAgentRequest = {
      workspace_id: workspaceId,
      provider: 'codex',
      args: [],
      cwd: worktreePath,
      env: {},
    };

    const response = await this.callGrpc(FRIENDLY_ERRORS.start, async () => {
      const client = await this.getAgentClient();
      const rpc = promisifyUnary<StartAgentRequest, StartAgentResponse>(
        client.StartAgent.bind(client) as UnaryCall<StartAgentRequest, StartAgentResponse>
      );
      return rpc(request);
    });

    const agent: CodexAgent = {
      id: response.agent_id || workspaceId,
      workspaceId,
      worktreePath,
      status: 'running',
      lastMessage: undefined,
      lastResponse: '',
    };

    this.agents.set(workspaceId, agent);
    await this.safeConnectWebSocket(workspaceId);
    this.logger.info('RemoteCodexService:agentStarted', {
      workspaceId,
      agentId: agent.id,
      pid: response.pid,
    });
    return agent;
  }

  async sendMessageStream(
    workspaceId: string,
    message: string,
    conversationId?: string
  ): Promise<void> {
    this.assertNonEmpty(workspaceId, 'workspaceId');
    this.assertNonEmpty(message, 'message');

    const agent = this.agents.get(workspaceId);
    if (!agent) {
      throw new Error('No remote Codex agent is running for this workspace');
    }

    agent.status = 'running';
    agent.lastMessage = message;
    agent.lastResponse = '';
    if (conversationId) {
      this.activeConversations.set(workspaceId, conversationId);
    } else {
      this.activeConversations.delete(workspaceId);
    }

    await this.safeConnectWebSocket(workspaceId);

    await this.callGrpc(FRIENDLY_ERRORS.send, async () => {
      const client = await this.getAgentClient();
      const rpc = promisifyUnary<SendMessageRequest, Empty>(
        client.SendMessage.bind(client) as UnaryCall<SendMessageRequest, Empty>
      );
      await rpc({ workspace_id: workspaceId, message });
    });
  }

  async stopMessageStream(workspaceId: string): Promise<boolean> {
    this.assertNonEmpty(workspaceId, 'workspaceId');

    try {
      await this.callGrpc(FRIENDLY_ERRORS.stop, async () => {
        const client = await this.getAgentClient();
        const rpc = promisifyUnary<StopAgentRequest, Empty>(
          client.StopAgent.bind(client) as UnaryCall<StopAgentRequest, Empty>
        );
        await rpc({ workspace_id: workspaceId });
      });
      this.cleanup(workspaceId);
      return true;
    } catch (error) {
      this.logger.error('RemoteCodexService:stopFailed', {
        workspaceId,
        error: formatGrpcError(error),
      });
      return false;
    }
  }

  async sendMessage(workspaceId: string, message: string): Promise<CodexResponse> {
    this.assertNonEmpty(workspaceId, 'workspaceId');
    this.assertNonEmpty(message, 'message');

    const agent = this.agents.get(workspaceId);
    if (!agent) {
      return {
        success: false,
        error: 'No remote Codex agent is running for this workspace',
        agentId: '',
      };
    }

    try {
      return await new Promise<CodexResponse>((resolve, reject) => {
        let stdout = '';
        let stderr = '';
        const streamEvent = this.streamEventName(workspaceId);
        const exitEvent = this.exitEventName(workspaceId);

      const handleStream = (payload: StreamPayload): void => {
        if (payload.stream === 'stdout') {
          stdout += payload.data;
        } else {
          stderr += payload.data;
        }
      };

      const handleExit = (payload: ExitPayload): void => {
        cleanup();
        const exitCode = typeof payload.exitCode === 'number' ? payload.exitCode : 0;
        if (exitCode === 0) {
          resolve({
            success: true,
            output: stdout,
            agentId: agent.id,
          });
        } else {
          resolve({
            success: false,
            error: stderr || payload.error || 'Remote Codex agent exited with an error',
            agentId: agent.id,
          });
        }
      };

      const handleGlobalError = (payload: any): void => {
        if (payload?.workspaceId === workspaceId && typeof payload?.error === 'string') {
          stderr += payload.error;
        }
      };

      const cleanup = (): void => {
        this.off(streamEvent, handleStream);
        this.off(exitEvent, handleExit);
        this.off('codex:error', handleGlobalError);
      };

      this.on(streamEvent, handleStream);
      this.on(exitEvent, handleExit);
        this.on('codex:error', handleGlobalError);

        this.sendMessageStream(workspaceId, message).catch((error) => {
          cleanup();
          reject(error);
        });
      });
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : FRIENDLY_ERRORS.send,
        agentId: agent.id,
      };
    }
  }

  async getInstallationStatus(): Promise<boolean> {
    try {
      const client = await this.getAgentClient();
      const rpc = promisifyUnary<GetAgentStatusRequest, GetAgentStatusResponse>(
        client.GetAgentStatus.bind(client) as UnaryCall<GetAgentStatusRequest, GetAgentStatusResponse>
      );
      await rpc({ workspace_id: '__health_check__' });
      return true;
    } catch (error) {
      this.logger.warn('RemoteCodexService:healthCheckFailed', {
        error: formatGrpcError(error),
      });
      return false;
    }
  }

  private async initialize(): Promise<void> {
    try {
      this.agentClient = await this.grpcClient.loadService<AgentServiceClient>(
        'agent.proto',
        'emdash.agent',
        'AgentService'
      );
      this.logger.info('RemoteCodexService:grpcReady', { grpcUrl: this.grpcUrl });
    } catch (error) {
      this.logger.error('RemoteCodexService:initFailed', {
        grpcUrl: this.grpcUrl,
        error: formatGrpcError(error),
      });
      throw error;
    }
  }

  private async getAgentClient(): Promise<AgentServiceClient> {
    await this.ready;
    if (!this.agentClient) {
      throw new Error('Remote Codex agent client is not ready');
    }
    return this.agentClient;
  }

  private async safeConnectWebSocket(workspaceId: string): Promise<void> {
    if (this.wsConnections.has(workspaceId)) {
      return;
    }
    const pending = this.wsPendingConnections.get(workspaceId);
    if (pending) {
      await pending;
      return;
    }

    const connectPromise = this.connectWebSocket(workspaceId).finally(() => {
      this.wsPendingConnections.delete(workspaceId);
    });

    this.wsPendingConnections.set(workspaceId, connectPromise);
    await connectPromise;
  }

  private async connectWebSocket(workspaceId: string, attempt = 1): Promise<void> {
    const url = this.buildAgentSocketUrl(workspaceId);
    try {
      this.logger.debug('RemoteCodexService:wsConnectAttempt', { workspaceId, attempt, url });
      const socket = await this.createSocket(url);
      if (!this.agents.has(workspaceId)) {
        socket.close();
        throw new Error(`No remote agent registered for workspace ${workspaceId}`);
      }
      this.wsConnections.set(workspaceId, socket);
      this.wsRetryCounts.set(workspaceId, 0);
      const timer = this.wsRetryTimers.get(workspaceId);
      if (timer) {
        clearTimeout(timer);
        this.wsRetryTimers.delete(workspaceId);
      }
      this.attachSocketHandlers(workspaceId, socket);
      this.logger.info('RemoteCodexService:wsConnected', { workspaceId });
    } catch (error) {
      if (attempt >= MAX_WS_ATTEMPTS) {
        this.logger.error('RemoteCodexService:wsConnectFailed', {
          workspaceId,
          error: formatGrpcError(error),
        });
        throw new Error('Failed to connect to remote Codex stream');
      }
      const delay = BASE_WS_RETRY_DELAY_MS * 2 ** (attempt - 1);
      this.logger.warn('RemoteCodexService:wsRetry', { workspaceId, attempt, delay });
      await this.delay(delay);
      await this.connectWebSocket(workspaceId, attempt + 1);
    }
  }

  private attachSocketHandlers(workspaceId: string, socket: WebSocket): void {
    socket.on('message', (data) => this.handleSocketMessage(workspaceId, data));
    socket.on('close', (code, reason) => this.handleSocketClose(workspaceId, code, reason));
    socket.on('error', (error) => {
      this.logger.error('RemoteCodexService:wsError', {
        workspaceId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  private handleSocketMessage(workspaceId: string, raw: RawData): void {
    let payload: AgentSocketMessage;
    try {
      payload = JSON.parse(raw.toString()) as AgentSocketMessage;
    } catch (error) {
      this.logger.warn('RemoteCodexService:invalidMessage', {
        workspaceId,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    const expectedId = workspaceId;
    const incomingId = payload.workspace_id;
    if (incomingId && incomingId !== expectedId) {
      this.logger.warn('RemoteCodexService:workspaceMismatch', {
        expected: expectedId,
        received: incomingId,
      });
      return;
    }

    switch (payload.type) {
      case 'agent:output':
        this.handleAgentOutput(workspaceId, payload);
        break;
      case 'agent:exit':
        this.handleAgentExit(workspaceId, payload);
        break;
      default:
        this.logger.debug('RemoteCodexService:unknownSocketMessage', {
          workspaceId,
          payloadType: payload.type,
        });
    }
  }

  private handleAgentOutput(workspaceId: string, payload: AgentSocketMessage): void {
    const agent = this.agents.get(workspaceId);
    if (!agent) {
      this.logger.warn('RemoteCodexService:outputWithoutAgent', { workspaceId });
      return;
    }

    const data = typeof payload.data === 'string' ? payload.data : '';
    const stream = payload.stream === 'stderr' ? 'stderr' : 'stdout';
    if (stream === 'stdout') {
      agent.lastResponse = (agent.lastResponse || '') + data;
    }

    const streamPayload: StreamPayload = {
      workspaceId,
      data,
      stream,
    };

    this.emit(this.streamEventName(workspaceId), streamPayload);
    const conversationId = this.activeConversations.get(workspaceId);

    if (stream === 'stdout') {
      this.emit('codex:output', {
        workspaceId,
        output: data,
        agentId: agent.id,
        conversationId,
      });
    } else {
      this.emit('codex:error', {
        workspaceId,
        error: data,
        agentId: agent.id,
        conversationId,
      });
    }
  }

  private handleAgentExit(workspaceId: string, payload: AgentSocketMessage): void {
    const agent = this.agents.get(workspaceId);
    const exitCode =
      typeof payload.exit_code === 'number' ? payload.exit_code : Number(payload.exit_code ?? 0);
    const exitPayload: ExitPayload = {
      workspaceId,
      exitCode: Number.isFinite(exitCode) ? exitCode : undefined,
      error: typeof payload.error === 'string' ? payload.error : undefined,
    };

    if (agent) {
      agent.status = 'idle';
    }

    this.emit(this.exitEventName(workspaceId), exitPayload);
    const conversationId = this.activeConversations.get(workspaceId);

    this.emit('codex:complete', {
      workspaceId,
      exitCode: exitPayload.exitCode,
      agentId: agent?.id,
      conversationId,
    });

    this.activeConversations.delete(workspaceId);
    this.cleanup(workspaceId);
  }

  private handleSocketClose(workspaceId: string, code: number, reason?: Buffer): void {
    this.logger.warn('RemoteCodexService:wsClosed', {
      workspaceId,
      code,
      reason: reason?.toString(),
    });
    this.wsConnections.delete(workspaceId);

    if (!this.agents.has(workspaceId)) {
      return;
    }

    const previousAttempts = this.wsRetryCounts.get(workspaceId) ?? 0;
    if (previousAttempts >= MAX_WS_ATTEMPTS) {
      this.logger.error('RemoteCodexService:wsMaxRetries', { workspaceId });
      this.emit('codex:error', {
        workspaceId,
        error: 'Lost connection to remote Codex stream',
        agentId: this.agents.get(workspaceId)?.id,
      });
      return;
    }

    const nextAttempt = previousAttempts + 1;
    this.wsRetryCounts.set(workspaceId, nextAttempt);
    const delay = BASE_WS_RETRY_DELAY_MS * 2 ** (nextAttempt - 1);
    const timer = setTimeout(() => {
      this.wsRetryTimers.delete(workspaceId);
      if (!this.agents.has(workspaceId)) {
        return;
      }
      this.connectWebSocket(workspaceId, nextAttempt).catch((error) => {
        this.logger.error('RemoteCodexService:wsReconnectFailed', {
          workspaceId,
          error: formatGrpcError(error),
        });
      });
    }, delay);
    this.wsRetryTimers.set(workspaceId, timer);
  }

  private cleanup(workspaceId: string): void {
    const socket = this.wsConnections.get(workspaceId);
    if (socket) {
      try {
        socket.terminate();
      } catch {}
      this.wsConnections.delete(workspaceId);
    }

    const timer = this.wsRetryTimers.get(workspaceId);
    if (timer) {
      clearTimeout(timer);
      this.wsRetryTimers.delete(workspaceId);
    }

    this.wsRetryCounts.delete(workspaceId);
    this.agents.delete(workspaceId);
    this.activeConversations.delete(workspaceId);
  }

  private streamEventName(workspaceId: string): string {
    return `codex:stream:${workspaceId}`;
  }

  private exitEventName(workspaceId: string): string {
    return `codex:exit:${workspaceId}`;
  }

  private buildAgentSocketUrl(workspaceId: string): string {
    try {
      const url = new URL('/ws/agent', this.wsUrl);
      url.searchParams.set('workspace_id', workspaceId);
      return url.toString();
    } catch (error) {
      this.logger.warn('RemoteCodexService:invalidWsUrl', {
        workspaceId,
        serverUrl: this.wsUrl,
        error: error instanceof Error ? error.message : String(error),
      });
      const sanitized = this.wsUrl.endsWith('/') ? this.wsUrl.slice(0, -1) : this.wsUrl;
      return `${sanitized}/ws/agent?workspace_id=${encodeURIComponent(workspaceId)}`;
    }
  }

  private createSocket(url: string): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);

      const cleanup = (): void => {
        socket.off('open', handleOpen);
        socket.off('error', handleError);
      };

      const handleOpen = (): void => {
        cleanup();
        resolve(socket);
      };

      const handleError = (error: Error): void => {
        cleanup();
        reject(error);
      };

      socket.once('open', handleOpen);
      socket.once('error', handleError);
    });
  }

  private async callGrpc<T>(friendlyMessage: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      this.logger.error('RemoteCodexService:grpcError', {
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

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const remoteCodexService = new RemoteCodexService();
