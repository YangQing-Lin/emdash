import { beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown> | unknown;

const {
  handlers,
  handleMock,
  showOpenDialogMock,
  getMainWindowMock,
  existsSyncMock,
  realpathMock,
  execAsyncMock,
  pathJoinMock,
} = vi.hoisted(() => {
  const handlers = new Map<string, Handler>();
  const handleMock = vi.fn((channel: string, handler: Handler) => {
    handlers.set(channel, handler);
  });

  const showOpenDialogMock = vi.fn();
  const getMainWindowMock = vi.fn();
  const existsSyncMock = vi.fn();
  const realpathMock = vi.fn();
  const execAsyncMock = vi.fn();
  const pathJoinMock = vi.fn((...parts) => parts.join('/'));

  return {
    handlers,
    handleMock,
    showOpenDialogMock,
    getMainWindowMock,
    existsSyncMock,
    realpathMock,
    execAsyncMock,
    pathJoinMock,
  };
});

vi.mock('electron', () => ({
  ipcMain: {
    handle: handleMock,
  },
  dialog: {
    showOpenDialog: showOpenDialogMock,
  },
}));

vi.mock('../../main/app/window', () => ({
  getMainWindow: getMainWindowMock,
}));

vi.mock('fs', () => ({
  default: {
    existsSync: existsSyncMock,
    promises: {
      realpath: realpathMock,
    },
  },
  existsSync: existsSyncMock,
  promises: {
    realpath: realpathMock,
  },
}));

vi.mock('path', () => ({
  join: pathJoinMock,
}));

vi.mock('util', () => ({
  promisify: () => execAsyncMock,
}));

// eslint-disable-next-line import/first
import { registerProjectIpc } from '../../main/ipc/projectIpc';

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

describe('registerProjectIpc', () => {
  beforeEach(() => {
    handlers.clear();
    handleMock.mockClear();
    showOpenDialogMock.mockReset();
    getMainWindowMock.mockReset();
    existsSyncMock.mockReset();
    realpathMock.mockReset();
    execAsyncMock.mockReset();
    pathJoinMock.mockClear();
  });

  describe('project:open', () => {
    it('should open project directory successfully', async () => {
      const mockWindow = {};
      getMainWindowMock.mockReturnValue(mockWindow);
      showOpenDialogMock.mockResolvedValue({
        canceled: false,
        filePaths: ['/path/to/project'],
      });
      registerProjectIpc();

      const result = await callHandler('project:open');

      expect(showOpenDialogMock).toHaveBeenCalledWith(mockWindow, {
        title: 'Open Project',
        properties: ['openDirectory'],
        message: 'Select a project directory to open',
      });
      expect(result).toEqual({ success: true, path: '/path/to/project' });
    });

    it('should handle user cancellation', async () => {
      const mockWindow = {};
      getMainWindowMock.mockReturnValue(mockWindow);
      showOpenDialogMock.mockResolvedValue({
        canceled: true,
        filePaths: [],
      });
      registerProjectIpc();

      const result = await callHandler('project:open');

      expect(result).toEqual({ success: false, error: 'No directory selected' });
    });

    it('should handle empty file paths', async () => {
      const mockWindow = {};
      getMainWindowMock.mockReturnValue(mockWindow);
      showOpenDialogMock.mockResolvedValue({
        canceled: false,
        filePaths: [],
      });
      registerProjectIpc();

      const result = await callHandler('project:open');

      expect(result).toEqual({ success: false, error: 'No directory selected' });
    });

    it('should handle dialog error', async () => {
      const mockWindow = {};
      getMainWindowMock.mockReturnValue(mockWindow);
      showOpenDialogMock.mockRejectedValue(new Error('Dialog failed'));
      registerProjectIpc();

      const result = await callHandler('project:open');

      expect(result).toEqual({ success: false, error: 'Failed to open project directory' });
    });

    it('should handle multiple selected paths (use first)', async () => {
      const mockWindow = {};
      getMainWindowMock.mockReturnValue(mockWindow);
      showOpenDialogMock.mockResolvedValue({
        canceled: false,
        filePaths: ['/path/to/project1', '/path/to/project2'],
      });
      registerProjectIpc();

      const result = await callHandler('project:open');

      expect(result).toEqual({ success: true, path: '/path/to/project1' });
    });
  });

  describe('git:getInfo', () => {
    it('should return git info for valid git repository', async () => {
      realpathMock.mockResolvedValue('/resolved/project/path');
      existsSyncMock.mockReturnValue(true);
      execAsyncMock
        .mockResolvedValueOnce({ stdout: 'https://github.com/user/repo.git\n', stderr: '' })
        .mockResolvedValueOnce({ stdout: 'main\n', stderr: '' })
        .mockResolvedValueOnce({ stdout: '/resolved/project/path\n', stderr: '' });
      registerProjectIpc();

      const result = await callHandler('git:getInfo', '/project/path');

      expect(realpathMock).toHaveBeenCalledWith('/project/path');
      expect(existsSyncMock).toHaveBeenCalledWith('/resolved/project/path/.git');
      expect(result).toEqual({
        isGitRepo: true,
        remote: 'https://github.com/user/repo.git',
        branch: 'main',
        path: '/resolved/project/path',
        rootPath: '/resolved/project/path',
      });
    });

    it('should handle non-git directory', async () => {
      realpathMock.mockResolvedValue('/resolved/path');
      existsSyncMock.mockReturnValue(false);
      registerProjectIpc();

      const result = await callHandler('git:getInfo', '/non/git/path');

      expect(result).toEqual({
        isGitRepo: false,
        path: '/resolved/path',
      });
    });

    it('should handle missing remote', async () => {
      realpathMock.mockResolvedValue('/project/path');
      existsSyncMock.mockReturnValue(true);
      execAsyncMock
        .mockRejectedValueOnce(new Error('No remote'))
        .mockResolvedValueOnce({ stdout: 'develop\n', stderr: '' })
        .mockResolvedValueOnce({ stdout: '/project/path\n', stderr: '' });
      registerProjectIpc();

      const result = await callHandler('git:getInfo', '/project/path');

      expect(result).toEqual({
        isGitRepo: true,
        remote: null,
        branch: 'develop',
        path: '/project/path',
        rootPath: '/project/path',
      });
    });

    it('should handle missing branch (detached HEAD)', async () => {
      realpathMock.mockResolvedValue('/project/path');
      existsSyncMock.mockReturnValue(true);
      execAsyncMock
        .mockResolvedValueOnce({ stdout: 'https://github.com/user/repo.git\n', stderr: '' })
        .mockRejectedValueOnce(new Error('Not on a branch'))
        .mockResolvedValueOnce({ stdout: '/project/path\n', stderr: '' });
      registerProjectIpc();

      const result = await callHandler('git:getInfo', '/project/path');

      expect(result).toEqual({
        isGitRepo: true,
        remote: 'https://github.com/user/repo.git',
        branch: null,
        path: '/project/path',
        rootPath: '/project/path',
      });
    });

    it('should handle failing root path resolution', async () => {
      realpathMock.mockResolvedValue('/project/path');
      existsSyncMock.mockReturnValue(true);
      execAsyncMock
        .mockResolvedValueOnce({ stdout: 'https://github.com/user/repo.git\n', stderr: '' })
        .mockResolvedValueOnce({ stdout: 'main\n', stderr: '' })
        .mockRejectedValueOnce(new Error('Failed to get root'));
      registerProjectIpc();

      const result = await callHandler('git:getInfo', '/project/path');

      expect(result).toEqual({
        isGitRepo: true,
        remote: 'https://github.com/user/repo.git',
        branch: 'main',
        path: '/project/path',
        rootPath: '/project/path',
      });
    });

    it('should resolve symlinks in root path', async () => {
      realpathMock
        .mockResolvedValueOnce('/resolved/project')
        .mockResolvedValueOnce('/actual/root');
      existsSyncMock.mockReturnValue(true);
      execAsyncMock
        .mockResolvedValueOnce({ stdout: 'https://github.com/user/repo.git\n', stderr: '' })
        .mockResolvedValueOnce({ stdout: 'feature\n', stderr: '' })
        .mockResolvedValueOnce({ stdout: '/symlink/root\n', stderr: '' });
      registerProjectIpc();

      const result = await callHandler('git:getInfo', '/symlink/project');

      expect(realpathMock).toHaveBeenCalledWith('/symlink/project');
      expect(realpathMock).toHaveBeenCalledWith('/symlink/root');
      expect(result).toEqual({
        isGitRepo: true,
        remote: 'https://github.com/user/repo.git',
        branch: 'feature',
        path: '/resolved/project',
        rootPath: '/actual/root',
      });
    });

    it('should handle realpath failure gracefully', async () => {
      realpathMock.mockRejectedValue(new Error('Failed to resolve'));
      existsSyncMock.mockReturnValue(true);
      execAsyncMock
        .mockResolvedValueOnce({ stdout: 'https://github.com/user/repo.git\n', stderr: '' })
        .mockResolvedValueOnce({ stdout: 'main\n', stderr: '' })
        .mockResolvedValueOnce({ stdout: '/project/path\n', stderr: '' });
      registerProjectIpc();

      const result = await callHandler('git:getInfo', '/project/path');

      expect(result).toEqual({
        isGitRepo: true,
        remote: 'https://github.com/user/repo.git',
        branch: 'main',
        path: '/project/path',
        rootPath: '/project/path',
      });
    });

    it('should handle empty stdout from git commands', async () => {
      realpathMock.mockResolvedValue('/project/path');
      existsSyncMock.mockReturnValue(true);
      execAsyncMock
        .mockResolvedValueOnce({ stdout: '', stderr: '' })
        .mockResolvedValueOnce({ stdout: '', stderr: '' })
        .mockResolvedValueOnce({ stdout: '', stderr: '' });
      registerProjectIpc();

      const result = await callHandler('git:getInfo', '/project/path');

      expect(result).toEqual({
        isGitRepo: true,
        remote: '',
        branch: '',
        path: '/project/path',
        rootPath: '/project/path',
      });
    });

    it('should handle git info error', async () => {
      realpathMock.mockResolvedValue('/project/path');
      existsSyncMock.mockImplementation(() => {
        throw new Error('Fatal error');
      });
      registerProjectIpc();

      const result = await callHandler('git:getInfo', '/project/path');

      expect(result).toEqual({
        isGitRepo: false,
        error: 'Failed to read Git information',
        path: '/project/path',
      });
    });

    it('should handle SSH remote URL', async () => {
      realpathMock.mockResolvedValue('/project/path');
      existsSyncMock.mockReturnValue(true);
      execAsyncMock
        .mockResolvedValueOnce({ stdout: 'git@github.com:user/repo.git\n', stderr: '' })
        .mockResolvedValueOnce({ stdout: 'main\n', stderr: '' })
        .mockResolvedValueOnce({ stdout: '/project/path\n', stderr: '' });
      registerProjectIpc();

      const result = await callHandler('git:getInfo', '/project/path');

      expect(result).toEqual({
        isGitRepo: true,
        remote: 'git@github.com:user/repo.git',
        branch: 'main',
        path: '/project/path',
        rootPath: '/project/path',
      });
    });
  });

  it('should register all IPC handlers', () => {
    registerProjectIpc();

    expect(handlers.size).toBe(2);
    expect(handlers.has('project:open')).toBe(true);
    expect(handlers.has('git:getInfo')).toBe(true);
  });
});
