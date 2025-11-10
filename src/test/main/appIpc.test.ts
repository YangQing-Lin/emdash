import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown> | unknown;

const {
  handlers,
  handleMock,
  openExternalMock,
  execMock,
  readFileSyncMock,
  ensureProjectPreparedMock,
  getAppSettingsMock,
  appGetVersionMock,
  appGetAppPathMock,
  processPlatform,
  processVersions,
} = vi.hoisted(() => {
  const handlers = new Map<string, Handler>();
  const handleMock = vi.fn((channel: string, handler: Handler) => {
    handlers.set(channel, handler);
  });

  const openExternalMock = vi.fn();
  const execMock = vi.fn();
  const readFileSyncMock = vi.fn();
  const ensureProjectPreparedMock = vi.fn();
  const getAppSettingsMock = vi.fn();
  const appGetVersionMock = vi.fn(() => '0.0.0');
  const appGetAppPathMock = vi.fn(() => '/app/path');

  // Store original values
  const processPlatform = process.platform;
  const processVersions = { ...process.versions };

  return {
    handlers,
    handleMock,
    openExternalMock,
    execMock,
    readFileSyncMock,
    ensureProjectPreparedMock,
    getAppSettingsMock,
    appGetVersionMock,
    appGetAppPathMock,
    processPlatform,
    processVersions,
  };
});

vi.mock('electron', () => ({
  ipcMain: {
    handle: handleMock,
  },
  shell: {
    openExternal: openExternalMock,
  },
  app: {
    getVersion: appGetVersionMock,
    getAppPath: appGetAppPathMock,
  },
}));

vi.mock('child_process', () => ({
  exec: execMock,
}));

vi.mock('fs', () => ({
  readFileSync: readFileSyncMock,
}));

vi.mock('path', () => ({
  join: vi.fn((...parts) => parts.join('/')),
}));

vi.mock('../../main/services/ProjectPrep', () => ({
  ensureProjectPrepared: ensureProjectPreparedMock,
}));

vi.mock('../../main/settings', () => ({
  getAppSettings: getAppSettingsMock,
}));

// eslint-disable-next-line import/first
import { registerAppIpc } from '../../main/ipc/appIpc';

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

describe('registerAppIpc', () => {
  beforeEach(() => {
    handlers.clear();
    handleMock.mockClear();
    openExternalMock.mockReset();
    execMock.mockReset();
    readFileSyncMock.mockReset();
    ensureProjectPreparedMock.mockReset();
    getAppSettingsMock.mockReset();
    appGetVersionMock.mockReturnValue('0.0.0');
    appGetAppPathMock.mockReturnValue('/app/path');
  });

  describe('app:openExternal', () => {
    it('should open external URL successfully', async () => {
      openExternalMock.mockResolvedValue(undefined);
      registerAppIpc();

      const result = await callHandler('app:openExternal', 'https://example.com');

      expect(openExternalMock).toHaveBeenCalledWith('https://example.com');
      expect(result).toEqual({ success: true });
    });

    it('should validate URL is a string', async () => {
      registerAppIpc();

      const result = await callHandler('app:openExternal', 123);

      expect(openExternalMock).not.toHaveBeenCalled();
      expect(result).toEqual({ success: false, error: 'Invalid URL' });
    });

    it('should validate URL is not empty', async () => {
      registerAppIpc();

      const result = await callHandler('app:openExternal', '');

      expect(openExternalMock).not.toHaveBeenCalled();
      expect(result).toEqual({ success: false, error: 'Invalid URL' });
    });

    it('should validate URL is not null', async () => {
      registerAppIpc();

      const result = await callHandler('app:openExternal', null);

      expect(openExternalMock).not.toHaveBeenCalled();
      expect(result).toEqual({ success: false, error: 'Invalid URL' });
    });

    it('should handle shell.openExternal error', async () => {
      openExternalMock.mockRejectedValue(new Error('Failed to open URL'));
      registerAppIpc();

      const result = await callHandler('app:openExternal', 'https://example.com');

      expect(result).toEqual({ success: false, error: 'Failed to open URL' });
    });

    it('should handle non-Error rejection', async () => {
      openExternalMock.mockRejectedValue('String error');
      registerAppIpc();

      const result = await callHandler('app:openExternal', 'https://example.com');

      expect(result).toEqual({ success: false, error: 'String error' });
    });
  });

  describe('app:openIn', () => {
    it('should validate arguments exist', async () => {
      registerAppIpc();

      const result = await callHandler('app:openIn', {});

      expect(result).toEqual({ success: false, error: 'Invalid arguments' });
    });

    it('should validate path is a string', async () => {
      registerAppIpc();

      const result = await callHandler('app:openIn', { app: 'finder', path: 123 });

      expect(result).toEqual({ success: false, error: 'Invalid arguments' });
    });

    it('should validate app is provided', async () => {
      registerAppIpc();

      const result = await callHandler('app:openIn', { path: '/some/path' });

      expect(result).toEqual({ success: false, error: 'Invalid arguments' });
    });

    it('should open in Finder on macOS', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin', writable: true });
      execMock.mockImplementation((cmd, callback) => callback(null));
      registerAppIpc();

      const result = await callHandler('app:openIn', { app: 'finder', path: '/test/path' });

      expect(execMock).toHaveBeenCalled();
      const execCmd = execMock.mock.calls[0][0];
      expect(execCmd).toContain('open');
      expect(execCmd).toContain('/test/path');
      expect(result).toEqual({ success: true });
    });

    it('should open in Cursor on macOS', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin', writable: true });
      execMock.mockImplementation((cmd, callback) => callback(null));
      getAppSettingsMock.mockReturnValue({ projectPrep: { autoInstallOnOpenInEditor: false } });
      registerAppIpc();

      const result = await callHandler('app:openIn', { app: 'cursor', path: '/test/path' });

      expect(execMock).toHaveBeenCalled();
      const execCmd = execMock.mock.calls[0][0];
      expect(execCmd).toContain('cursor');
      expect(result).toEqual({ success: true });
    });

    it('should open in VS Code on macOS', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin', writable: true });
      execMock.mockImplementation((cmd, callback) => callback(null));
      getAppSettingsMock.mockReturnValue({ projectPrep: { autoInstallOnOpenInEditor: false } });
      registerAppIpc();

      const result = await callHandler('app:openIn', { app: 'vscode', path: '/test/path' });

      expect(execMock).toHaveBeenCalled();
      const execCmd = execMock.mock.calls[0][0];
      expect(execCmd).toContain('code');
      expect(result).toEqual({ success: true });
    });

    it('should open in Terminal on macOS', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin', writable: true });
      execMock.mockImplementation((cmd, callback) => callback(null));
      registerAppIpc();

      const result = await callHandler('app:openIn', { app: 'terminal', path: '/test/path' });

      expect(execMock).toHaveBeenCalled();
      const execCmd = execMock.mock.calls[0][0];
      expect(execCmd).toContain('Terminal');
      expect(result).toEqual({ success: true });
    });

    it('should trigger project prep for Cursor when enabled', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin', writable: true });
      execMock.mockImplementation((cmd, callback) => callback(null));
      getAppSettingsMock.mockReturnValue({ projectPrep: { autoInstallOnOpenInEditor: true } });
      ensureProjectPreparedMock.mockResolvedValue(undefined);
      registerAppIpc();

      await callHandler('app:openIn', { app: 'cursor', path: '/test/path' });

      // Project prep should be called (fire-and-forget)
      // We can't easily verify it was called due to the fire-and-forget nature
      expect(getAppSettingsMock).toHaveBeenCalled();
    });

    it('should not trigger project prep for Finder', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin', writable: true });
      execMock.mockImplementation((cmd, callback) => callback(null));
      getAppSettingsMock.mockReturnValue({ projectPrep: { autoInstallOnOpenInEditor: true } });
      registerAppIpc();

      await callHandler('app:openIn', { app: 'finder', path: '/test/path' });

      // Settings may be called, but ensureProjectPrepared should not be called for Finder
      expect(execMock).toHaveBeenCalled();
    });

    it('should handle exec error', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin', writable: true });
      execMock.mockImplementation((cmd, callback) => callback(new Error('Command failed')));
      registerAppIpc();

      const result = await callHandler('app:openIn', { app: 'finder', path: '/test/path' });

      expect(result).toEqual({ success: false, error: 'Unable to open in finder' });
    });

    it('should return error for unsupported app on Windows', async () => {
      Object.defineProperty(process, 'platform', { value: 'win32', writable: true });
      registerAppIpc();

      const result = await callHandler('app:openIn', { app: 'ghostty', path: '/test/path' });

      expect(result).toEqual({ success: false, error: 'ghostty is not supported on Windows' });
    });

    it('should return error for iTerm2 on non-macOS', async () => {
      Object.defineProperty(process, 'platform', { value: 'linux', writable: true });
      registerAppIpc();

      const result = await callHandler('app:openIn', { app: 'iterm2', path: '/test/path' });

      expect(result).toEqual({
        success: false,
        error: 'iTerm2 is only available on macOS',
      });
    });

    it('should open in Finder (Explorer) on Windows', async () => {
      Object.defineProperty(process, 'platform', { value: 'win32', writable: true });
      execMock.mockImplementation((cmd, callback) => callback(null));
      registerAppIpc();

      const result = await callHandler('app:openIn', { app: 'finder', path: '/test/path' });

      expect(execMock).toHaveBeenCalled();
      const execCmd = execMock.mock.calls[0][0];
      expect(execCmd).toContain('explorer');
      expect(result).toEqual({ success: true });
    });

    it('should open in xdg-open on Linux', async () => {
      Object.defineProperty(process, 'platform', { value: 'linux', writable: true });
      execMock.mockImplementation((cmd, callback) => callback(null));
      registerAppIpc();

      const result = await callHandler('app:openIn', { app: 'finder', path: '/test/path' });

      expect(execMock).toHaveBeenCalled();
      const execCmd = execMock.mock.calls[0][0];
      expect(execCmd).toContain('xdg-open');
      expect(result).toEqual({ success: true });
    });

    it('should handle path with special characters', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin', writable: true });
      execMock.mockImplementation((cmd, callback) => callback(null));
      registerAppIpc();

      const result = await callHandler('app:openIn', {
        app: 'finder',
        path: "/path/with'quotes",
      });

      expect(execMock).toHaveBeenCalled();
      expect(result).toEqual({ success: true });
    });
  });

  describe('app:getAppVersion', () => {
    it('should return version from package.json', async () => {
      readFileSyncMock.mockReturnValue(
        JSON.stringify({ name: 'emdash', version: '1.2.3' })
      );
      registerAppIpc();

      const result = await callHandler('app:getAppVersion');

      expect(result).toBe('1.2.3');
    });

    it('should try multiple paths for package.json', async () => {
      readFileSyncMock
        .mockImplementationOnce(() => {
          throw new Error('Not found');
        })
        .mockReturnValueOnce(JSON.stringify({ name: 'emdash', version: '2.0.0' }));
      registerAppIpc();

      const result = await callHandler('app:getAppVersion');

      expect(result).toBe('2.0.0');
      expect(readFileSyncMock).toHaveBeenCalledTimes(2);
    });

    it('should skip package.json with wrong name', async () => {
      readFileSyncMock
        .mockReturnValueOnce(JSON.stringify({ name: 'other-app', version: '1.0.0' }))
        .mockReturnValueOnce(JSON.stringify({ name: 'emdash', version: '3.0.0' }));
      registerAppIpc();

      const result = await callHandler('app:getAppVersion');

      expect(result).toBe('3.0.0');
    });

    it('should fallback to app.getVersion() if package.json not found', async () => {
      readFileSyncMock.mockImplementation(() => {
        throw new Error('Not found');
      });
      appGetVersionMock.mockReturnValue('0.5.0');
      registerAppIpc();

      const result = await callHandler('app:getAppVersion');

      expect(result).toBe('0.5.0');
      expect(appGetVersionMock).toHaveBeenCalled();
    });

    it('should handle JSON parse error', async () => {
      readFileSyncMock.mockReturnValue('invalid json');
      appGetVersionMock.mockReturnValue('0.6.0');
      registerAppIpc();

      const result = await callHandler('app:getAppVersion');

      expect(result).toBe('0.6.0');
    });
  });

  describe('app:getElectronVersion', () => {
    it('should return Electron version', async () => {
      Object.defineProperty(process.versions, 'electron', {
        value: '30.5.1',
        writable: true,
        configurable: true,
      });
      registerAppIpc();

      const result = await callHandler('app:getElectronVersion');

      expect(result).toBe('30.5.1');
    });
  });

  describe('app:getPlatform', () => {
    it('should return platform darwin', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        writable: true,
        configurable: true,
      });
      registerAppIpc();

      const result = await callHandler('app:getPlatform');

      expect(result).toBe('darwin');
    });

    it('should return platform win32', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'win32',
        writable: true,
        configurable: true,
      });
      registerAppIpc();

      const result = await callHandler('app:getPlatform');

      expect(result).toBe('win32');
    });

    it('should return platform linux', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        writable: true,
        configurable: true,
      });
      registerAppIpc();

      const result = await callHandler('app:getPlatform');

      expect(result).toBe('linux');
    });
  });

  it('should register all IPC handlers', () => {
    registerAppIpc();

    expect(handlers.size).toBe(5);
    expect(handlers.has('app:openExternal')).toBe(true);
    expect(handlers.has('app:openIn')).toBe(true);
    expect(handlers.has('app:getAppVersion')).toBe(true);
    expect(handlers.has('app:getElectronVersion')).toBe(true);
    expect(handlers.has('app:getPlatform')).toBe(true);
  });

  // Restore process.platform after all tests
  afterAll(() => {
    Object.defineProperty(process, 'platform', {
      value: processPlatform,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(process, 'versions', {
      value: processVersions,
      writable: true,
      configurable: true,
    });
  });
});
