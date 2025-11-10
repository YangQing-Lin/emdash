import { EventEmitter } from 'events';
import type { CodexAgent, CodexResponse } from '../CodexService';

/**
 * Defines the contract for interacting with Codex agents while exposing streaming events.
 */
export interface ICodexService extends EventEmitter {
  /**
   * Provision or look up a Codex agent bound to a workspace.
   * @param workspaceId Local identifier for the workspace.
   * @param worktreePath Absolute path to the workspace's worktree.
   */
  createAgent(workspaceId: string, worktreePath: string): Promise<CodexAgent>;

  /**
   * Execute a Codex command and emit incremental output events for the workspace.
   * @param workspaceId Workspace identifier that owns the stream.
   * @param message Command or prompt text to send to Codex.
   * @param conversationId Optional conversation to associate with persisted output.
   */
  sendMessageStream(workspaceId: string, message: string, conversationId?: string): Promise<void>;

  /**
   * Cancel an active Codex stream for the workspace, resolving when the process exits.
   * @param workspaceId Workspace whose stream should be stopped.
   */
  stopMessageStream(workspaceId: string): Promise<boolean>;

  /**
   * Send a one-off Codex command without streaming the intermediate output.
   * @param workspaceId Workspace identifier that owns the agent.
   * @param message Prompt text.
   */
  sendMessage(workspaceId: string, message: string): Promise<CodexResponse>;

  /**
   * Determine whether the Codex CLI is installed and ready for use.
   */
  getInstallationStatus(): Promise<boolean>;
}
