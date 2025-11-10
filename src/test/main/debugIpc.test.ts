import { beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown> | unknown;

const {
  handlers,
  handleMock,
  mkdirMock,
  writeFileMock,
  dirnameMock,
} = vi.hoisted(() => {
  const handlers = new Map<string, Handler>();
  const handleMock = vi.fn((channel: string, handler: Handler) => {
    handlers.set(channel, handler);
  });

  const mkdirMock = vi.fn();
  const writeFileMock = vi.fn();
  const dirnameMock = vi.fn((p: string) => {
    const parts = p.split('/');
    parts.pop();
    return parts.join('/');
  });

  return {
    handlers,
    handleMock,
    mkdirMock,
    writeFileMock,
    dirnameMock,
  };
});

vi.mock('electron', () => ({
  ipcMain: {
    handle: handleMock,
  },
}));

vi.mock('fs', () => ({
  default: {
    promises: {
      mkdir: mkdirMock,
      writeFile: writeFileMock,
    },
  },
  promises: {
    mkdir: mkdirMock,
    writeFile: writeFileMock,
  },
}));

vi.mock('path', () => ({
  dirname: dirnameMock,
}));

// eslint-disable-next-line import/first
import { registerDebugIpc } from '../../main/ipc/debugIpc';

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

describe('registerDebugIpc', () => {
  beforeEach(() => {
    handlers.clear();
    handleMock.mockClear();
    mkdirMock.mockReset();
    writeFileMock.mockReset();
    dirnameMock.mockClear();
  });

  describe('debug:append-log', () => {
    it('should append log to file', async () => {
      mkdirMock.mockResolvedValue(undefined);
      writeFileMock.mockResolvedValue(undefined);
      dirnameMock.mockReturnValue('/test/logs');
      registerDebugIpc();

      const result = await callHandler(
        'debug:append-log',
        '/test/logs/debug.log',
        'Log message\n'
      );

      expect(mkdirMock).toHaveBeenCalledWith('/test/logs', { recursive: true });
      expect(writeFileMock).toHaveBeenCalledWith('/test/logs/debug.log', 'Log message\n', {
        flag: 'a',
        encoding: 'utf8',
      });
      expect(result).toEqual({ success: true });
    });

    it('should reset log file when reset option is true', async () => {
      mkdirMock.mockResolvedValue(undefined);
      writeFileMock.mockResolvedValue(undefined);
      dirnameMock.mockReturnValue('/test/logs');
      registerDebugIpc();

      const result = await callHandler(
        'debug:append-log',
        '/test/logs/debug.log',
        'New log\n',
        { reset: true }
      );

      expect(writeFileMock).toHaveBeenCalledWith('/test/logs/debug.log', 'New log\n', {
        flag: 'w',
        encoding: 'utf8',
      });
      expect(result).toEqual({ success: true });
    });

    it('should validate filePath is provided', async () => {
      registerDebugIpc();

      const result = await callHandler('debug:append-log', '', 'Log content');

      expect(mkdirMock).not.toHaveBeenCalled();
      expect(writeFileMock).not.toHaveBeenCalled();
      expect(result).toEqual({ success: false, error: 'filePath is required' });
    });

    it('should validate filePath is not null', async () => {
      registerDebugIpc();

      const result = await callHandler('debug:append-log', null, 'Log content');

      expect(mkdirMock).not.toHaveBeenCalled();
      expect(writeFileMock).not.toHaveBeenCalled();
      expect(result).toEqual({ success: false, error: 'filePath is required' });
    });

    it('should create directory if it does not exist', async () => {
      mkdirMock.mockResolvedValue(undefined);
      writeFileMock.mockResolvedValue(undefined);
      dirnameMock.mockReturnValue('/nested/path/to/logs');
      registerDebugIpc();

      const result = await callHandler(
        'debug:append-log',
        '/nested/path/to/logs/debug.log',
        'Log'
      );

      expect(mkdirMock).toHaveBeenCalledWith('/nested/path/to/logs', { recursive: true });
      expect(result).toEqual({ success: true });
    });

    it('should handle mkdir error', async () => {
      mkdirMock.mockRejectedValue(new Error('Permission denied'));
      dirnameMock.mockReturnValue('/test/logs');
      registerDebugIpc();

      const result = await callHandler('debug:append-log', '/test/logs/debug.log', 'Log');

      expect(result).toEqual({ success: false, error: 'Permission denied' });
    });

    it('should handle writeFile error', async () => {
      mkdirMock.mockResolvedValue(undefined);
      writeFileMock.mockRejectedValue(new Error('Disk full'));
      dirnameMock.mockReturnValue('/test/logs');
      registerDebugIpc();

      const result = await callHandler('debug:append-log', '/test/logs/debug.log', 'Log');

      expect(result).toEqual({ success: false, error: 'Disk full' });
    });

    it('should handle non-Error rejection', async () => {
      mkdirMock.mockRejectedValue('String error');
      dirnameMock.mockReturnValue('/test/logs');
      registerDebugIpc();

      const result = await callHandler('debug:append-log', '/test/logs/debug.log', 'Log');

      expect(result).toEqual({ success: false, error: 'Unknown error' });
    });

    it('should append empty content', async () => {
      mkdirMock.mockResolvedValue(undefined);
      writeFileMock.mockResolvedValue(undefined);
      dirnameMock.mockReturnValue('/test/logs');
      registerDebugIpc();

      const result = await callHandler('debug:append-log', '/test/logs/debug.log', '');

      expect(writeFileMock).toHaveBeenCalledWith('/test/logs/debug.log', '', {
        flag: 'a',
        encoding: 'utf8',
      });
      expect(result).toEqual({ success: true });
    });

    it('should handle options parameter not provided', async () => {
      mkdirMock.mockResolvedValue(undefined);
      writeFileMock.mockResolvedValue(undefined);
      dirnameMock.mockReturnValue('/test/logs');
      registerDebugIpc();

      const result = await callHandler('debug:append-log', '/test/logs/debug.log', 'Log');

      expect(writeFileMock).toHaveBeenCalledWith('/test/logs/debug.log', 'Log', {
        flag: 'a',
        encoding: 'utf8',
      });
      expect(result).toEqual({ success: true });
    });

    it('should handle options with reset false', async () => {
      mkdirMock.mockResolvedValue(undefined);
      writeFileMock.mockResolvedValue(undefined);
      dirnameMock.mockReturnValue('/test/logs');
      registerDebugIpc();

      const result = await callHandler('debug:append-log', '/test/logs/debug.log', 'Log', {
        reset: false,
      });

      expect(writeFileMock).toHaveBeenCalledWith('/test/logs/debug.log', 'Log', {
        flag: 'a',
        encoding: 'utf8',
      });
      expect(result).toEqual({ success: true });
    });

    it('should handle multiline content', async () => {
      mkdirMock.mockResolvedValue(undefined);
      writeFileMock.mockResolvedValue(undefined);
      dirnameMock.mockReturnValue('/test/logs');
      registerDebugIpc();

      const multilineContent = 'Line 1\nLine 2\nLine 3\n';
      const result = await callHandler(
        'debug:append-log',
        '/test/logs/debug.log',
        multilineContent
      );

      expect(writeFileMock).toHaveBeenCalledWith('/test/logs/debug.log', multilineContent, {
        flag: 'a',
        encoding: 'utf8',
      });
      expect(result).toEqual({ success: true });
    });
  });

  it('should register debug:append-log handler', () => {
    registerDebugIpc();

    expect(handlers.size).toBe(1);
    expect(handlers.has('debug:append-log')).toBe(true);
  });
});
