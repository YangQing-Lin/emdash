import { beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown> | unknown;

const {
  handlers,
  handleMock,
  connectionsServiceMock,
  getCliProvidersMock,
} = vi.hoisted(() => {
  const handlers = new Map<string, Handler>();
  const handleMock = vi.fn((channel: string, handler: Handler) => {
    handlers.set(channel, handler);
  });

  const getCliProvidersMock = vi.fn();

  const connectionsServiceMock = {
    getCliProviders: getCliProvidersMock,
  };

  return {
    handlers,
    handleMock,
    connectionsServiceMock,
    getCliProvidersMock,
  };
});

vi.mock('electron', () => ({
  ipcMain: {
    handle: handleMock,
  },
}));

vi.mock('../../main/services/ConnectionsService', () => ({
  connectionsService: connectionsServiceMock,
}));

// eslint-disable-next-line import/first
import { registerConnectionsIpc } from '../../main/ipc/connectionsIpc';

function getHandler(channel: string): Handler {
  const handler = handlers.get(channel);
  if (!handler) {
    throw new Error(`Handler for ${channel} not registered`);
  }
  return handler;
}

async function callHandler(channel: string, ...args: unknown[]): Promise<unknown> {
  const handler = getHandler(channel);
  return handler({}, ...args);
}

describe('registerConnectionsIpc', () => {
  beforeEach(() => {
    handlers.clear();
    handleMock.mockClear();
    getCliProvidersMock.mockReset();
  });

  describe('connections:getCliProviders', () => {
    it('should return providers on success', async () => {
      const mockProviders = [
        { id: 'codex', name: 'Codex', available: true },
        { id: 'claude', name: 'Claude Code', available: false },
      ];
      getCliProvidersMock.mockResolvedValue(mockProviders);
      registerConnectionsIpc();

      const result = await callHandler('connections:getCliProviders');

      expect(getCliProvidersMock).toHaveBeenCalled();
      expect(result).toEqual({ success: true, providers: mockProviders });
    });

    it('should return empty providers array', async () => {
      getCliProvidersMock.mockResolvedValue([]);
      registerConnectionsIpc();

      const result = await callHandler('connections:getCliProviders');

      expect(result).toEqual({ success: true, providers: [] });
    });

    it('should return multiple providers with details', async () => {
      const mockProviders = [
        {
          id: 'codex',
          name: 'Codex',
          available: true,
          version: '1.0.0',
          path: '/usr/local/bin/codex',
        },
        {
          id: 'claude',
          name: 'Claude Code',
          available: true,
          version: '0.5.0',
          path: '/usr/local/bin/claude',
        },
        {
          id: 'cursor',
          name: 'Cursor',
          available: false,
        },
      ];
      getCliProvidersMock.mockResolvedValue(mockProviders);
      registerConnectionsIpc();

      const result = await callHandler('connections:getCliProviders');

      expect(result).toEqual({ success: true, providers: mockProviders });
    });

    it('should handle Error instance', async () => {
      getCliProvidersMock.mockRejectedValue(new Error('Failed to detect providers'));
      registerConnectionsIpc();

      const result = await callHandler('connections:getCliProviders');

      expect(result).toEqual({
        success: false,
        error: 'Failed to detect providers',
      });
    });

    it('should handle non-Error rejection with unknown error message', async () => {
      getCliProvidersMock.mockRejectedValue('String error');
      registerConnectionsIpc();

      const result = await callHandler('connections:getCliProviders');

      expect(result).toEqual({
        success: false,
        error: 'Unknown error',
      });
    });

    it('should handle null rejection', async () => {
      getCliProvidersMock.mockRejectedValue(null);
      registerConnectionsIpc();

      const result = await callHandler('connections:getCliProviders');

      expect(result).toEqual({
        success: false,
        error: 'Unknown error',
      });
    });

    it('should handle undefined rejection', async () => {
      getCliProvidersMock.mockRejectedValue(undefined);
      registerConnectionsIpc();

      const result = await callHandler('connections:getCliProviders');

      expect(result).toEqual({
        success: false,
        error: 'Unknown error',
      });
    });

    it('should handle service timeout', async () => {
      getCliProvidersMock.mockRejectedValue(new Error('Timeout waiting for provider detection'));
      registerConnectionsIpc();

      const result = await callHandler('connections:getCliProviders');

      expect(result).toEqual({
        success: false,
        error: 'Timeout waiting for provider detection',
      });
    });

    it('should handle spawn error', async () => {
      getCliProvidersMock.mockRejectedValue(new Error('spawn ENOENT'));
      registerConnectionsIpc();

      const result = await callHandler('connections:getCliProviders');

      expect(result).toEqual({
        success: false,
        error: 'spawn ENOENT',
      });
    });

    it('should handle permission error', async () => {
      getCliProvidersMock.mockRejectedValue(new Error('EACCES: permission denied'));
      registerConnectionsIpc();

      const result = await callHandler('connections:getCliProviders');

      expect(result).toEqual({
        success: false,
        error: 'EACCES: permission denied',
      });
    });
  });

  it('should register connections:getCliProviders handler', () => {
    registerConnectionsIpc();

    expect(handlers.size).toBe(1);
    expect(handlers.has('connections:getCliProviders')).toBe(true);
  });
});
