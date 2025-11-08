import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';

type ProviderId = 'codex' | 'claude';

interface AgentSendMessageArgs {
  providerId: ProviderId;
  workspaceId: string;
  worktreePath: string;
  message: string;
  conversationId?: string;
}

const {
  handlers,
  handleMock,
  windows,
  getAllWindowsMock,
  isInstalledMock,
  getInstallationInstructionsMock,
  startStreamMock,
  stopStreamMock,
} = vi.hoisted(() => {
  const handlers = new Map<string, (event: unknown, args: unknown) => unknown>();
  const handleMock = vi.fn(
    (channel: string, handler: (event: unknown, args: unknown) => unknown) => {
      handlers.set(channel, handler);
    }
  );

  const windows: Array<{ webContents: { send: ReturnType<typeof vi.fn> } }> = [];
  const getAllWindowsMock = vi.fn(() => windows);

  const isInstalledMock = vi.fn<(providerId: ProviderId) => Promise<boolean>>();
  const getInstallationInstructionsMock = vi.fn<(providerId: ProviderId) => string>();
  const startStreamMock = vi.fn<(args: AgentSendMessageArgs) => Promise<void>>();
  const stopStreamMock = vi.fn<(providerId: ProviderId, workspaceId: string) => Promise<boolean>>();

  return {
    handlers,
    handleMock,
    windows,
    getAllWindowsMock,
    isInstalledMock,
    getInstallationInstructionsMock,
    startStreamMock,
    stopStreamMock,
  };
});

type AgentServiceMock = EventEmitter & {
  isInstalled: typeof isInstalledMock;
  getInstallationInstructions: typeof getInstallationInstructionsMock;
  startStream: typeof startStreamMock;
  stopStream: typeof stopStreamMock;
};

const agentServiceMock: AgentServiceMock = Object.assign(new EventEmitter(), {
  isInstalled: isInstalledMock,
  getInstallationInstructions: getInstallationInstructionsMock,
  startStream: startStreamMock,
  stopStream: stopStreamMock,
});

const codexServiceMock: EventEmitter = Object.assign(new EventEmitter(), {});

vi.mock('electron', () => ({
  ipcMain: {
    handle: handleMock,
  },
  BrowserWindow: {
    getAllWindows: getAllWindowsMock,
  },
}));

vi.mock('../../main/services/AgentService', () => ({
  get agentService() {
    return agentServiceMock;
  },
}));

vi.mock('../../main/services/CodexService', () => ({
  get codexService() {
    return codexServiceMock;
  },
}));

// eslint-disable-next-line import/first
import { registerAgentIpc } from '../../main/ipc/agentIpc';

function getHandler(channel: string) {
  const handler = handlers.get(channel);
  if (!handler) {
    throw new Error(`Handler for ${channel} not registered`);
  }
  return handler;
}

function createWindowMock() {
  const window = { webContents: { send: vi.fn() } };
  windows.push(window);
  return window;
}

describe('registerAgentIpc', () => {
  beforeEach(() => {
    handlers.clear();
    handleMock.mockClear();
    isInstalledMock.mockReset();
    getInstallationInstructionsMock.mockReset();
    startStreamMock.mockReset();
    stopStreamMock.mockReset();
    windows.length = 0;
    getAllWindowsMock.mockClear();
    agentServiceMock.removeAllListeners();
    codexServiceMock.removeAllListeners();
  });

  describe('agent:check-installation', () => {
    it('returns success when agent is installed (codex)', async () => {
      isInstalledMock.mockResolvedValue(true);

      registerAgentIpc();
      const handler = getHandler('agent:check-installation');

      const result = await handler({}, 'codex');

      expect(isInstalledMock).toHaveBeenCalledWith('codex');
      expect(result).toEqual({ success: true, isInstalled: true });
    });

    it('returns success with isInstalled=false when agent is missing', async () => {
      isInstalledMock.mockResolvedValue(false);

      registerAgentIpc();
      const handler = getHandler('agent:check-installation');

      const result = await handler({}, 'codex');

      expect(result).toEqual({ success: true, isInstalled: false });
    });

    it('handles service errors gracefully', async () => {
      isInstalledMock.mockRejectedValue(new Error('kaboom'));

      registerAgentIpc();
      const handler = getHandler('agent:check-installation');

      const result = await handler({}, 'codex');

      expect(result).toEqual({ success: false, error: 'kaboom' });
    });

    it('stringifies unexpected rejection values', async () => {
      isInstalledMock.mockRejectedValue('bad-things');

      registerAgentIpc();
      const handler = getHandler('agent:check-installation');

      const result = await handler({}, 'codex');

      expect(result).toEqual({ success: false, error: 'bad-things' });
    });

    it('supports claude provider checks', async () => {
      isInstalledMock.mockResolvedValue(true);

      registerAgentIpc();
      const handler = getHandler('agent:check-installation');

      await handler({}, 'claude');

      expect(isInstalledMock).toHaveBeenCalledWith('claude');
    });
  });

  describe('agent:get-installation-instructions', () => {
    it('returns installation instructions for codex', async () => {
      getInstallationInstructionsMock.mockReturnValue('Use Codex installer');

      registerAgentIpc();
      const handler = getHandler('agent:get-installation-instructions');

      const result = await handler({}, 'codex');

      expect(getInstallationInstructionsMock).toHaveBeenCalledWith('codex');
      expect(result).toEqual({ success: true, instructions: 'Use Codex installer' });
    });

    it('returns installation instructions for claude', async () => {
      getInstallationInstructionsMock.mockReturnValue('npm install claude');

      registerAgentIpc();
      const handler = getHandler('agent:get-installation-instructions');

      const result = await handler({}, 'claude');

      expect(getInstallationInstructionsMock).toHaveBeenCalledWith('claude');
      expect(result).toEqual({ success: true, instructions: 'npm install claude' });
    });

    it('handles service errors gracefully', async () => {
      getInstallationInstructionsMock.mockImplementation(() => {
        throw new Error('not supported');
      });

      registerAgentIpc();
      const handler = getHandler('agent:get-installation-instructions');

      const result = await handler({}, 'codex');

      expect(result).toEqual({ success: false, error: 'not supported' });
    });

    it('stringifies unexpected errors', async () => {
      getInstallationInstructionsMock.mockImplementation(() => {
        throw 'boom';
      });

      registerAgentIpc();
      const handler = getHandler('agent:get-installation-instructions');

      const result = await handler({}, 'codex');

      expect(result).toEqual({ success: false, error: 'boom' });
    });
  });

  describe('agent:send-message-stream', () => {
    const baseArgs: AgentSendMessageArgs = {
      providerId: 'codex',
      workspaceId: 'workspace-123',
      worktreePath: '/tmp/workspace',
      message: 'hello world',
    };

    it('starts stream successfully with all required args', async () => {
      startStreamMock.mockResolvedValue(undefined);

      registerAgentIpc();
      const handler = getHandler('agent:send-message-stream');

      const result = await handler({}, baseArgs);

      expect(startStreamMock).toHaveBeenCalledWith(baseArgs);
      expect(result).toEqual({ success: true });
    });

    it('starts stream with optional conversationId', async () => {
      startStreamMock.mockResolvedValue(undefined);
      const args: AgentSendMessageArgs = { ...baseArgs, conversationId: 'conversation-1' };

      registerAgentIpc();
      const handler = getHandler('agent:send-message-stream');

      const result = await handler({}, args);

      expect(startStreamMock).toHaveBeenCalledWith(args);
      expect(result).toEqual({ success: true });
    });

    it('validates providerId presence', async () => {
      registerAgentIpc();
      const handler = getHandler('agent:send-message-stream');

      const result = await handler(
        {},
        {
          workspaceId: 'workspace-123',
          worktreePath: '/tmp/workspace',
          message: 'hello world',
        } as unknown as AgentSendMessageArgs
      );

      expect(result).toEqual({
        success: false,
        error: 'Invalid argument: providerId must be "codex" or "claude"',
      });
      expect(startStreamMock).not.toHaveBeenCalled();
    });

    it('validates providerId value', async () => {
      registerAgentIpc();
      const handler = getHandler('agent:send-message-stream');

      const result = await handler(
        {},
        {
          ...baseArgs,
          providerId: 'not-real' as ProviderId,
        }
      );

      expect(result).toEqual({
        success: false,
        error: 'Invalid argument: providerId must be "codex" or "claude"',
      });
      expect(startStreamMock).not.toHaveBeenCalled();
    });

    it('validates workspaceId', async () => {
      registerAgentIpc();
      const handler = getHandler('agent:send-message-stream');

      const result = await handler({}, { ...baseArgs, workspaceId: '' });

      expect(result).toEqual({
        success: false,
        error: 'Invalid argument: workspaceId must be a non-empty string',
      });
      expect(startStreamMock).not.toHaveBeenCalled();
    });

    it('validates worktreePath', async () => {
      registerAgentIpc();
      const handler = getHandler('agent:send-message-stream');

      const result = await handler({}, { ...baseArgs, worktreePath: '' });

      expect(result).toEqual({
        success: false,
        error: 'Invalid argument: worktreePath must be a non-empty string',
      });
      expect(startStreamMock).not.toHaveBeenCalled();
    });

    it('validates message text', async () => {
      registerAgentIpc();
      const handler = getHandler('agent:send-message-stream');

      const result = await handler({}, { ...baseArgs, message: '' });

      expect(result).toEqual({
        success: false,
        error: 'Invalid argument: message must be a non-empty string',
      });
      expect(startStreamMock).not.toHaveBeenCalled();
    });

    it('validates conversationId type', async () => {
      registerAgentIpc();
      const handler = getHandler('agent:send-message-stream');

      const result = await handler(
        {},
        { ...baseArgs, conversationId: 123 as unknown as string }
      );

      expect(result).toEqual({
        success: false,
        error: 'Invalid argument: conversationId must be a string',
      });
      expect(startStreamMock).not.toHaveBeenCalled();
    });

    it('validates argument object', async () => {
      registerAgentIpc();
      const handler = getHandler('agent:send-message-stream');

      const result = await handler({}, null as unknown as AgentSendMessageArgs);

      expect(result).toEqual({
        success: false,
        error: 'Invalid arguments object',
      });
      expect(startStreamMock).not.toHaveBeenCalled();
    });

    it('handles agent service errors', async () => {
      startStreamMock.mockRejectedValue(new Error('agent not installed'));

      registerAgentIpc();
      const handler = getHandler('agent:send-message-stream');

      const result = await handler({}, baseArgs);

      expect(result).toEqual({ success: false, error: 'agent not installed' });
    });

    it('stringifies unexpected rejections', async () => {
      startStreamMock.mockRejectedValue('timeout');

      registerAgentIpc();
      const handler = getHandler('agent:send-message-stream');

      const result = await handler({}, baseArgs);

      expect(result).toEqual({ success: false, error: 'timeout' });
    });

    it('supports claude provider requests', async () => {
      startStreamMock.mockResolvedValue(undefined);
      const args: AgentSendMessageArgs = {
        ...baseArgs,
        providerId: 'claude',
      };

      registerAgentIpc();
      const handler = getHandler('agent:send-message-stream');

      await handler({}, args);

      expect(startStreamMock).toHaveBeenCalledWith(args);
    });
  });

  describe('agent:stop-stream', () => {
    it('stops stream successfully', async () => {
      stopStreamMock.mockResolvedValue(true);

      registerAgentIpc();
      const handler = getHandler('agent:stop-stream');

      const result = await handler({}, { providerId: 'codex', workspaceId: 'workspace-1' });

      expect(stopStreamMock).toHaveBeenCalledWith('codex', 'workspace-1');
      expect(result).toEqual({ success: true });
    });

    it('returns success=false when stream is not found', async () => {
      stopStreamMock.mockResolvedValue(false);

      registerAgentIpc();
      const handler = getHandler('agent:stop-stream');

      const result = await handler({}, { providerId: 'codex', workspaceId: 'workspace-1' });

      expect(result).toEqual({ success: false });
    });

    it('handles service errors gracefully', async () => {
      stopStreamMock.mockRejectedValue(new Error('failed to stop'));

      registerAgentIpc();
      const handler = getHandler('agent:stop-stream');

      const result = await handler({}, { providerId: 'codex', workspaceId: 'workspace-1' });

      expect(result).toEqual({ success: false, error: 'failed to stop' });
    });

    it('stringifies unexpected errors', async () => {
      stopStreamMock.mockRejectedValue('bad');

      registerAgentIpc();
      const handler = getHandler('agent:stop-stream');

      const result = await handler({}, { providerId: 'codex', workspaceId: 'workspace-1' });

      expect(result).toEqual({ success: false, error: 'bad' });
    });

    it('supports claude provider requests', async () => {
      stopStreamMock.mockResolvedValue(true);

      registerAgentIpc();
      const handler = getHandler('agent:stop-stream');

      await handler({}, { providerId: 'claude', workspaceId: 'workspace-1' });

      expect(stopStreamMock).toHaveBeenCalledWith('claude', 'workspace-1');
    });

    it('validates providerId before stopping stream', async () => {
      registerAgentIpc();
      const handler = getHandler('agent:stop-stream');

      const result = await handler(
        {},
        { providerId: 'invalid' as ProviderId, workspaceId: 'workspace-1' }
      );

      expect(result).toEqual({
        success: false,
        error: 'Invalid argument: providerId must be "codex" or "claude"',
      });
      expect(stopStreamMock).not.toHaveBeenCalled();
    });

    it('validates workspaceId before stopping stream', async () => {
      registerAgentIpc();
      const handler = getHandler('agent:stop-stream');

      const result = await handler({}, { providerId: 'codex', workspaceId: '' });

      expect(result).toEqual({
        success: false,
        error: 'Invalid argument: workspaceId must be a non-empty string',
      });
      expect(stopStreamMock).not.toHaveBeenCalled();
    });

    it('validates stop args object', async () => {
      registerAgentIpc();
      const handler = getHandler('agent:stop-stream');

      const result = await handler({}, null as unknown as { providerId: ProviderId; workspaceId: string });

      expect(result).toEqual({
        success: false,
        error: 'Invalid arguments object',
      });
      expect(stopStreamMock).not.toHaveBeenCalled();
    });
  });

  describe('Event forwarding', () => {
    it("forwards codexService 'codex:output' events", () => {
      registerAgentIpc();
      const window = createWindowMock();

      codexServiceMock.emit('codex:output', { workspaceId: 'ws', output: 'text' });

      expect(window.webContents.send).toHaveBeenCalledWith('agent:stream-output', {
        providerId: 'codex',
        workspaceId: 'ws',
        output: 'text',
      });
    });

    it("forwards codexService 'codex:error' events", () => {
      registerAgentIpc();
      const window = createWindowMock();

      codexServiceMock.emit('codex:error', { workspaceId: 'ws', error: 'boom' });

      expect(window.webContents.send).toHaveBeenCalledWith('agent:stream-error', {
        providerId: 'codex',
        workspaceId: 'ws',
        error: 'boom',
      });
    });

    it("forwards codexService 'codex:complete' events", () => {
      registerAgentIpc();
      const window = createWindowMock();

      codexServiceMock.emit('codex:complete', { workspaceId: 'ws', exitCode: 0 });

      expect(window.webContents.send).toHaveBeenCalledWith('agent:stream-complete', {
        providerId: 'codex',
        workspaceId: 'ws',
        exitCode: 0,
      });
    });

    it("forwards agentService 'agent:output' events", () => {
      registerAgentIpc();
      const window = createWindowMock();

      agentServiceMock.emit('agent:output', {
        providerId: 'claude',
        workspaceId: 'ws',
        output: 'value',
      });

      expect(window.webContents.send).toHaveBeenCalledWith('agent:stream-output', {
        providerId: 'claude',
        workspaceId: 'ws',
        output: 'value',
      });
    });

    it("forwards agentService 'agent:error' events", () => {
      registerAgentIpc();
      const window = createWindowMock();

      agentServiceMock.emit('agent:error', {
        providerId: 'claude',
        workspaceId: 'ws',
        error: 'bad',
      });

      expect(window.webContents.send).toHaveBeenCalledWith('agent:stream-error', {
        providerId: 'claude',
        workspaceId: 'ws',
        error: 'bad',
      });
    });

    it("forwards agentService 'agent:complete' events", () => {
      registerAgentIpc();
      const window = createWindowMock();

      agentServiceMock.emit('agent:complete', {
        providerId: 'claude',
        workspaceId: 'ws',
        exitCode: 0,
      });

      expect(window.webContents.send).toHaveBeenCalledWith('agent:stream-complete', {
        providerId: 'claude',
        workspaceId: 'ws',
        exitCode: 0,
      });
    });

    it('broadcasts events to all windows', () => {
      registerAgentIpc();
      const windowA = createWindowMock();
      const windowB = createWindowMock();

      agentServiceMock.emit('agent:output', {
        providerId: 'claude',
        workspaceId: 'ws',
        output: 'text',
      });

      expect(windowA.webContents.send).toHaveBeenCalledWith('agent:stream-output', {
        providerId: 'claude',
        workspaceId: 'ws',
        output: 'text',
      });
      expect(windowB.webContents.send).toHaveBeenCalledWith('agent:stream-output', {
        providerId: 'claude',
        workspaceId: 'ws',
        output: 'text',
      });
    });
  });
});
