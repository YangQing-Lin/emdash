import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';
import Module from 'module';

interface CodexAgent {
  id: string;
  workspaceId: string;
  worktreePath: string;
  status: 'idle' | 'running' | 'error';
  lastMessage?: string;
  lastResponse?: string;
}

interface StreamInfo {
  tail: string;
  startedAt?: string;
}

const {
  handlers,
  handleMock,
  windows,
  getAllWindowsMock,
  getInstallationStatusMock,
  createAgentMock,
  sendMessageMock,
  sendMessageStreamMock,
  getStreamInfoMock,
  stopMessageStreamMock,
  getAgentStatusMock,
  getAllAgentsMock,
  removeAgentMock,
  getInstallationInstructionsMock,
  logMock,
  logInfoMock,
  logDebugMock,
  logErrorMock,
  electronMock,
} = vi.hoisted(() => {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  const handleMock = vi.fn(
    (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    }
  );

  const windows: Array<{ webContents: { send: ReturnType<typeof vi.fn> } }> = [];
  const getAllWindowsMock = vi.fn(() => windows);

  const getInstallationStatusMock = vi.fn<() => Promise<boolean>>();
  const createAgentMock = vi.fn<(workspaceId: string, worktreePath: string) => Promise<CodexAgent>>();
  const sendMessageMock = vi.fn<(workspaceId: string, message: string) => Promise<unknown>>();
  const sendMessageStreamMock = vi.fn<
    (workspaceId: string, message: string, conversationId?: string) => Promise<void>
  >();
  const getStreamInfoMock = vi.fn<(workspaceId: string) => StreamInfo>();
  const stopMessageStreamMock = vi.fn<(workspaceId: string) => Promise<boolean>>();
  const getAgentStatusMock = vi.fn<(workspaceId: string) => CodexAgent | undefined>();
  const getAllAgentsMock = vi.fn<() => CodexAgent[]>();
  const removeAgentMock = vi.fn<(workspaceId: string) => boolean>();
  const getInstallationInstructionsMock = vi.fn<() => string>();

  const logInfoMock = vi.fn();
  const logDebugMock = vi.fn();
  const logErrorMock = vi.fn();
  const logMock = {
    info: logInfoMock,
    debug: logDebugMock,
    error: logErrorMock,
  };
  const electronMock = {
    ipcMain: {
      handle: handleMock,
    },
    BrowserWindow: {
      getAllWindows: getAllWindowsMock,
    },
  };

  return {
    handlers,
    handleMock,
    windows,
    getAllWindowsMock,
    getInstallationStatusMock,
    createAgentMock,
    sendMessageMock,
    sendMessageStreamMock,
    getStreamInfoMock,
    stopMessageStreamMock,
    getAgentStatusMock,
    getAllAgentsMock,
    removeAgentMock,
    getInstallationInstructionsMock,
    logMock,
    logInfoMock,
    logDebugMock,
    logErrorMock,
    electronMock,
  };
});

type CodexServiceMock = EventEmitter & {
  getInstallationStatus: typeof getInstallationStatusMock;
  createAgent: typeof createAgentMock;
  sendMessage: typeof sendMessageMock;
  sendMessageStream: typeof sendMessageStreamMock;
  getStreamInfo: typeof getStreamInfoMock;
  stopMessageStream: typeof stopMessageStreamMock;
  getAgentStatus: typeof getAgentStatusMock;
  getAllAgents: typeof getAllAgentsMock;
  removeAgent: typeof removeAgentMock;
  getInstallationInstructions: typeof getInstallationInstructionsMock;
};

const codexServiceMock: CodexServiceMock = Object.assign(new EventEmitter(), {
  getInstallationStatus: getInstallationStatusMock,
  createAgent: createAgentMock,
  sendMessage: sendMessageMock,
  sendMessageStream: sendMessageStreamMock,
  getStreamInfo: getStreamInfoMock,
  stopMessageStream: stopMessageStreamMock,
  getAgentStatus: getAgentStatusMock,
  getAllAgents: getAllAgentsMock,
  removeAgent: removeAgentMock,
  getInstallationInstructions: getInstallationInstructionsMock,
});

type ModuleWithLoad = typeof Module & {
  _load: (request: string, parent: NodeModule | null, isMain: boolean) => unknown;
};

const moduleWithLoad = Module as ModuleWithLoad;
const originalModuleLoad = moduleWithLoad._load;

vi.mock('electron', () => ({
  ...electronMock,
  default: electronMock,
}));

vi.mock('../../main/services/CodexService', () => ({
  get codexService() {
    return codexServiceMock;
  },
}));

vi.mock('../../main/lib/logger', () => ({
  log: logMock,
}));

// eslint-disable-next-line import/first
import { setupCodexIpc } from '../../main/services/codexIpc';

function getHandler(channel: string) {
  const handler = handlers.get(channel);
  if (!handler) {
    throw new Error(`No handler registered for ${channel}`);
  }
  return handler;
}

function createWindowMock() {
  const window = { webContents: { send: vi.fn() } };
  windows.push(window);
  return window;
}

describe('setupCodexIpc', () => {
  beforeAll(() => {
    moduleWithLoad._load = ((request: string, parent: NodeModule | null, isMain: boolean) => {
      if (request === 'electron') {
        return electronMock;
      }
      return originalModuleLoad(request, parent, isMain);
    }) as typeof originalModuleLoad;
  });

  afterAll(() => {
    moduleWithLoad._load = originalModuleLoad;
  });

  beforeEach(() => {
    handlers.clear();
    handleMock.mockClear();
    windows.length = 0;
    getAllWindowsMock.mockClear();
    codexServiceMock.removeAllListeners();
    getInstallationStatusMock.mockReset();
    createAgentMock.mockReset();
    sendMessageMock.mockReset();
    sendMessageStreamMock.mockReset();
    getStreamInfoMock.mockReset();
    stopMessageStreamMock.mockReset();
    getAgentStatusMock.mockReset();
    getAllAgentsMock.mockReset();
    removeAgentMock.mockReset();
    getInstallationInstructionsMock.mockReset();
    logInfoMock.mockReset();
    logDebugMock.mockReset();
    logErrorMock.mockReset();
  });

  describe('codex:check-installation', () => {
    it('returns success when Codex is installed', async () => {
      getInstallationStatusMock.mockResolvedValue(true);

      setupCodexIpc();
      const handler = getHandler('codex:check-installation');

      const result = await handler({}, undefined);

      expect(getInstallationStatusMock).toHaveBeenCalled();
      expect(result).toEqual({ success: true, isInstalled: true });
    });

    it('returns success with isInstalled=false when Codex is missing', async () => {
      getInstallationStatusMock.mockResolvedValue(false);

      setupCodexIpc();
      const handler = getHandler('codex:check-installation');

      const result = await handler({}, undefined);

      expect(result).toEqual({ success: true, isInstalled: false });
    });

    it('handles service errors gracefully', async () => {
      getInstallationStatusMock.mockRejectedValue(new Error('unreachable service'));

      setupCodexIpc();
      const handler = getHandler('codex:check-installation');

      const result = await handler({}, undefined);

      expect(result).toEqual({ success: false, error: 'unreachable service' });
    });

    it('returns "Unknown error" for unexpected rejection values', async () => {
      getInstallationStatusMock.mockRejectedValue('nope');

      setupCodexIpc();
      const handler = getHandler('codex:check-installation');

      const result = await handler({}, undefined);

      expect(result).toEqual({ success: false, error: 'Unknown error' });
    });
  });

  describe('codex:create-agent', () => {
    it('creates an agent with workspaceId and worktreePath', async () => {
      const agent: CodexAgent = {
        id: 'agent-1',
        workspaceId: 'workspace-123',
        worktreePath: '/tmp/workspace',
        status: 'idle',
      };
      createAgentMock.mockResolvedValue(agent);

      setupCodexIpc();
      const handler = getHandler('codex:create-agent');

      await handler({}, 'workspace-123', '/tmp/workspace');

      expect(createAgentMock).toHaveBeenCalledWith('workspace-123', '/tmp/workspace');
    });

    it('returns the agent object when creation succeeds', async () => {
      const agent: CodexAgent = {
        id: 'agent-2',
        workspaceId: 'workspace-999',
        worktreePath: '/repo',
        status: 'running',
      };
      createAgentMock.mockResolvedValue(agent);

      setupCodexIpc();
      const handler = getHandler('codex:create-agent');

      const result = await handler({}, 'workspace-999', '/repo');

      expect(result).toEqual({ success: true, agent });
    });

    it('handles service errors such as missing worktrees', async () => {
      createAgentMock.mockRejectedValue(new Error('worktree not found'));

      setupCodexIpc();
      const handler = getHandler('codex:create-agent');

      const result = await handler({}, 'workspace-bad', '/missing');

      expect(result).toEqual({ success: false, error: 'worktree not found' });
    });

    it('propagates validation failures from the service', async () => {
      createAgentMock.mockImplementation(async (workspaceId: string) => {
        if (!workspaceId) {
          throw new Error('workspaceId is required');
        }
        return {
          id: 'agent-x',
          workspaceId,
          worktreePath: '/tmp',
          status: 'idle',
        };
      });

      setupCodexIpc();
      const handler = getHandler('codex:create-agent');

      const result = await handler({}, '' as unknown as string, '/tmp');

      expect(result).toEqual({ success: false, error: 'workspaceId is required' });
    });
  });

  describe('codex:send-message', () => {
    it('sends a message successfully', async () => {
      sendMessageMock.mockResolvedValue({ result: 'ok' });

      setupCodexIpc();
      const handler = getHandler('codex:send-message');

      await handler({}, 'workspace-1', 'hello world');

      expect(sendMessageMock).toHaveBeenCalledWith('workspace-1', 'hello world');
    });

    it('returns the response from the service', async () => {
      const response = { agentId: 'agent-123', output: 'hi' };
      sendMessageMock.mockResolvedValue(response);

      setupCodexIpc();
      const handler = getHandler('codex:send-message');

      const result = await handler({}, 'workspace-1', 'hello world');

      expect(result).toEqual({ success: true, response });
    });

    it('handles service errors', async () => {
      sendMessageMock.mockRejectedValue(new Error('agent offline'));

      setupCodexIpc();
      const handler = getHandler('codex:send-message');

      const result = await handler({}, 'workspace-1', 'hello world');

      expect(result).toEqual({ success: false, error: 'agent offline' });
    });

    it('returns validation errors for missing message text', async () => {
      sendMessageMock.mockImplementation(async (_workspaceId: string, message: string) => {
        if (!message) {
          throw new Error('message required');
        }
        return { ok: true };
      });

      setupCodexIpc();
      const handler = getHandler('codex:send-message');

      const result = await handler({}, 'workspace-1', '' as unknown as string);

      expect(result).toEqual({ success: false, error: 'message required' });
    });
  });

  describe('codex:send-message-stream', () => {
    it('starts streaming with workspace and message', async () => {
      sendMessageStreamMock.mockResolvedValue(undefined);

      setupCodexIpc();
      const handler = getHandler('codex:send-message-stream');

      const result = await handler({}, 'workspace-1', 'message text');

      expect(sendMessageStreamMock).toHaveBeenCalledWith('workspace-1', 'message text', undefined);
      expect(result).toEqual({ success: true });
    });

    it('supports optional conversationId parameter', async () => {
      sendMessageStreamMock.mockResolvedValue(undefined);

      setupCodexIpc();
      const handler = getHandler('codex:send-message-stream');

      const result = await handler({}, 'workspace-1', 'message text', 'conversation-1');

      expect(sendMessageStreamMock).toHaveBeenCalledWith('workspace-1', 'message text', 'conversation-1');
      expect(result).toEqual({ success: true });
    });

    it('handles service errors while starting', async () => {
      sendMessageStreamMock.mockRejectedValue(new Error('stream failed'));

      setupCodexIpc();
      const handler = getHandler('codex:send-message-stream');

      const result = await handler({}, 'workspace-1', 'message text');

      expect(result).toEqual({ success: false, error: 'stream failed' });
    });

    it('reports validation failures from the service', async () => {
      sendMessageStreamMock.mockImplementation(async (workspaceId: string) => {
        if (!workspaceId) {
          throw new Error('workspaceId required');
        }
      });

      setupCodexIpc();
      const handler = getHandler('codex:send-message-stream');

      const result = await handler({}, undefined as unknown as string, 'message text');

      expect(result).toEqual({ success: false, error: 'workspaceId required' });
    });
  });

  describe('codex:get-stream-tail', () => {
    it('returns stream info when a stream is active', async () => {
      const info: StreamInfo = { tail: 'logs', startedAt: '2024-01-01T00:00:00.000Z' };
      getStreamInfoMock.mockReturnValue(info);

      setupCodexIpc();
      const handler = getHandler('codex:get-stream-tail');

      const result = await handler({}, 'workspace-1');

      expect(getStreamInfoMock).toHaveBeenCalledWith('workspace-1');
      expect(result).toEqual({ success: true, ...info });
    });

    it('returns empty info when no stream is running', async () => {
      getStreamInfoMock.mockReturnValue({ tail: '' });

      setupCodexIpc();
      const handler = getHandler('codex:get-stream-tail');

      const result = await handler({}, 'workspace-void');

      expect(result).toEqual({ success: true, tail: '' });
    });

    it('handles errors from getStreamInfo', async () => {
      getStreamInfoMock.mockImplementation(() => {
        throw new Error('read failure');
      });

      setupCodexIpc();
      const handler = getHandler('codex:get-stream-tail');

      const result = await handler({}, 'workspace-1');

      expect(result).toEqual({ success: false, error: 'read failure' });
    });
  });

  describe('codex:stop-stream', () => {
    it('stops an active stream successfully', async () => {
      stopMessageStreamMock.mockResolvedValue(true);

      setupCodexIpc();
      const handler = getHandler('codex:stop-stream');

      const result = await handler({}, 'workspace-1');

      expect(stopMessageStreamMock).toHaveBeenCalledWith('workspace-1');
      expect(result).toEqual({ success: true, stopped: true });
    });

    it('returns success=false when the stream was not running', async () => {
      stopMessageStreamMock.mockResolvedValue(false);

      setupCodexIpc();
      const handler = getHandler('codex:stop-stream');

      const result = await handler({}, 'workspace-void');

      expect(result).toEqual({ success: false, stopped: false });
    });

    it('handles errors thrown by stopMessageStream', async () => {
      stopMessageStreamMock.mockRejectedValue(new Error('stop failed'));

      setupCodexIpc();
      const handler = getHandler('codex:stop-stream');

      const result = await handler({}, 'workspace-1');

      expect(logErrorMock).toHaveBeenCalledWith('[codex:stop-stream] failed', expect.any(Error));
      expect(result).toEqual({ success: false, error: 'stop failed' });
    });

    it('logs debug information before and after stopping', async () => {
      stopMessageStreamMock.mockResolvedValue(true);

      setupCodexIpc();
      const handler = getHandler('codex:stop-stream');

      await handler({}, 'workspace-1');

      expect(logDebugMock).toHaveBeenNthCalledWith(1, '[codex:stop-stream] request received', 'workspace-1');
      expect(logDebugMock).toHaveBeenNthCalledWith(2, '[codex:stop-stream] result', {
        workspaceId: 'workspace-1',
        stopped: true,
      });
    });
  });

  describe('codex:get-agent-status', () => {
    it('returns agent status for an existing agent', async () => {
      const agent: CodexAgent = {
        id: 'agent-1',
        workspaceId: 'workspace-1',
        worktreePath: '/tmp',
        status: 'running',
      };
      getAgentStatusMock.mockReturnValue(agent);

      setupCodexIpc();
      const handler = getHandler('codex:get-agent-status');

      const result = await handler({}, 'workspace-1');

      expect(getAgentStatusMock).toHaveBeenCalledWith('workspace-1');
      expect(result).toEqual({ success: true, agent });
    });

    it('returns errors when the agent does not exist', async () => {
      getAgentStatusMock.mockImplementation(() => {
        throw new Error('agent not found');
      });

      setupCodexIpc();
      const handler = getHandler('codex:get-agent-status');

      const result = await handler({}, 'missing-workspace');

      expect(result).toEqual({ success: false, error: 'agent not found' });
    });

    it('validates workspaceId via service checks', async () => {
      getAgentStatusMock.mockImplementation((workspaceId: string) => {
        if (!workspaceId) {
          throw new Error('workspaceId required');
        }
        return {
          id: 'agent-x',
          workspaceId,
          worktreePath: '/tmp',
          status: 'idle',
        };
      });

      setupCodexIpc();
      const handler = getHandler('codex:get-agent-status');

      const result = await handler({}, '' as unknown as string);

      expect(result).toEqual({ success: false, error: 'workspaceId required' });
    });
  });

  describe('codex:get-all-agents', () => {
    it('returns all known agents', async () => {
      const agents: CodexAgent[] = [
        { id: 'a', workspaceId: 'ws-a', worktreePath: '/a', status: 'idle' },
        { id: 'b', workspaceId: 'ws-b', worktreePath: '/b', status: 'running' },
      ];
      getAllAgentsMock.mockReturnValue(agents);

      setupCodexIpc();
      const handler = getHandler('codex:get-all-agents');

      const result = await handler({}, undefined);

      expect(result).toEqual({ success: true, agents });
    });

    it('returns an empty list when no agents are registered', async () => {
      getAllAgentsMock.mockReturnValue([]);

      setupCodexIpc();
      const handler = getHandler('codex:get-all-agents');

      const result = await handler({}, undefined);

      expect(result).toEqual({ success: true, agents: [] });
    });

    it('handles errors from getAllAgents', async () => {
      getAllAgentsMock.mockImplementation(() => {
        throw new Error('database offline');
      });

      setupCodexIpc();
      const handler = getHandler('codex:get-all-agents');

      const result = await handler({}, undefined);

      expect(result).toEqual({ success: false, error: 'database offline' });
    });
  });

  describe('codex:remove-agent', () => {
    it('requests removal for the provided workspace', async () => {
      removeAgentMock.mockReturnValue(true);

      setupCodexIpc();
      const handler = getHandler('codex:remove-agent');

      await handler({}, 'workspace-1');

      expect(removeAgentMock).toHaveBeenCalledWith('workspace-1');
    });

    it('returns removed=true when an agent was deleted', async () => {
      removeAgentMock.mockReturnValue(true);

      setupCodexIpc();
      const handler = getHandler('codex:remove-agent');

      const result = await handler({}, 'workspace-1');

      expect(result).toEqual({ success: true, removed: true });
    });

    it('returns removed=false when there was nothing to delete', async () => {
      removeAgentMock.mockReturnValue(false);

      setupCodexIpc();
      const handler = getHandler('codex:remove-agent');

      const result = await handler({}, 'workspace-void');

      expect(result).toEqual({ success: true, removed: false });
    });

    it('handles errors when removal fails', async () => {
      removeAgentMock.mockImplementation(() => {
        throw new Error('permission denied');
      });

      setupCodexIpc();
      const handler = getHandler('codex:remove-agent');

      const result = await handler({}, 'workspace-1');

      expect(result).toEqual({ success: false, error: 'permission denied' });
    });
  });

  describe('codex:get-installation-instructions', () => {
    it('returns installation instructions text', async () => {
      getInstallationInstructionsMock.mockReturnValue('run npm install codex');

      setupCodexIpc();
      const handler = getHandler('codex:get-installation-instructions');

      const result = await handler({}, undefined);

      expect(result).toEqual({ success: true, instructions: 'run npm install codex' });
    });

    it('handles service errors when retrieving instructions', async () => {
      getInstallationInstructionsMock.mockImplementation(() => {
        throw new Error('docs missing');
      });

      setupCodexIpc();
      const handler = getHandler('codex:get-installation-instructions');

      const result = await handler({}, undefined);

      expect(result).toEqual({ success: false, error: 'docs missing' });
    });
  });

  describe('Event forwarding', () => {
    it("forwards 'codex:output' events to codex:stream-output", () => {
      setupCodexIpc();
      const window = createWindowMock();

      const payload = { workspaceId: 'ws-1', output: 'text' };
      codexServiceMock.emit('codex:output', payload);

      expect(getAllWindowsMock).toHaveBeenCalled();
      expect(window.webContents.send).toHaveBeenCalledWith('codex:stream-output', payload);
    });

    it("forwards 'codex:error' events to codex:stream-error", () => {
      setupCodexIpc();
      const window = createWindowMock();

      const payload = { workspaceId: 'ws-1', error: 'boom' };
      codexServiceMock.emit('codex:error', payload);

      expect(window.webContents.send).toHaveBeenCalledWith('codex:stream-error', payload);
    });

    it("forwards 'codex:complete' events to codex:stream-complete", () => {
      setupCodexIpc();
      const window = createWindowMock();

      const payload = { workspaceId: 'ws-1', exitCode: 0 };
      codexServiceMock.emit('codex:complete', payload);

      expect(window.webContents.send).toHaveBeenCalledWith('codex:stream-complete', payload);
    });

    it('broadcasts output events to all windows', () => {
      setupCodexIpc();
      const windowA = createWindowMock();
      const windowB = createWindowMock();

      const payload = { workspaceId: 'ws-1', output: 'update' };
      codexServiceMock.emit('codex:output', payload);

      expect(windowA.webContents.send).toHaveBeenCalledWith('codex:stream-output', payload);
      expect(windowB.webContents.send).toHaveBeenCalledWith('codex:stream-output', payload);
    });

    it('handles multiple windows created between events', () => {
      setupCodexIpc();
      const firstWindow = createWindowMock();

      const payloadA = { workspaceId: 'ws-1', output: 'first' };
      codexServiceMock.emit('codex:output', payloadA);

      const secondWindow = createWindowMock();
      const payloadB = { workspaceId: 'ws-1', error: 'oops' };
      codexServiceMock.emit('codex:error', payloadB);

      expect(firstWindow.webContents.send).toHaveBeenNthCalledWith(1, 'codex:stream-output', payloadA);
      expect(firstWindow.webContents.send).toHaveBeenNthCalledWith(2, 'codex:stream-error', payloadB);
      expect(secondWindow.webContents.send).toHaveBeenCalledWith('codex:stream-error', payloadB);
    });
  });
});
