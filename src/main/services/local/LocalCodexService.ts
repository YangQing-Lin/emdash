import { EventEmitter } from 'events';
import type { ICodexService } from '../abstractions/ICodexService';
import type { CodexAgent, CodexResponse } from '../CodexService';
import { codexService } from '../CodexService';

/**
 * Local adapter that simply delegates to the singleton CodexService while mirroring events.
 */
export class LocalCodexService extends EventEmitter implements ICodexService {
  private readonly codexService = codexService;

  constructor() {
    super();
    this.forwardEvents();
  }

  private forwardEvents(): void {
    (['codex:output', 'codex:error', 'codex:complete'] as const).forEach((event) => {
      this.codexService.on(event, (...args: any[]) => {
        this.emit(event, ...args);
      });
    });
  }

  async createAgent(workspaceId: string, worktreePath: string): Promise<CodexAgent> {
    return this.codexService.createAgent(workspaceId, worktreePath);
  }

  async sendMessageStream(
    workspaceId: string,
    message: string,
    conversationId?: string
  ): Promise<void> {
    return this.codexService.sendMessageStream(workspaceId, message, conversationId);
  }

  async stopMessageStream(workspaceId: string): Promise<boolean> {
    return this.codexService.stopMessageStream(workspaceId);
  }

  async sendMessage(workspaceId: string, message: string): Promise<CodexResponse> {
    return this.codexService.sendMessage(workspaceId, message);
  }

  async getInstallationStatus(): Promise<boolean> {
    return this.codexService.getInstallationStatus();
  }

  getStreamInfo(workspaceId: string): { tail: string; startedAt?: string } {
    return this.codexService.getStreamInfo(workspaceId);
  }

  getAgentStatus(workspaceId: string): CodexAgent | null {
    return this.codexService.getAgentStatus(workspaceId);
  }

  getAllAgents(): CodexAgent[] {
    return this.codexService.getAllAgents();
  }

  removeAgent(workspaceId: string): boolean {
    return this.codexService.removeAgent(workspaceId);
  }

  getInstallationInstructions(): string {
    return this.codexService.getInstallationInstructions();
  }

  getActiveConversationId(workspaceId: string): string | undefined {
    return this.codexService.getActiveConversationId(workspaceId);
  }
}

export const localCodexService = new LocalCodexService();
