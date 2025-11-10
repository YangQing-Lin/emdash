import { beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown> | unknown;

const {
  handlers,
  handleMock,
  getAppSettingsMock,
  updateAppSettingsMock,
} = vi.hoisted(() => {
  const handlers = new Map<string, Handler>();
  const handleMock = vi.fn((channel: string, handler: Handler) => {
    handlers.set(channel, handler);
  });

  const getAppSettingsMock = vi.fn();
  const updateAppSettingsMock = vi.fn();

  return {
    handlers,
    handleMock,
    getAppSettingsMock,
    updateAppSettingsMock,
  };
});

vi.mock('electron', () => ({
  ipcMain: {
    handle: handleMock,
  },
}));

vi.mock('../../main/settings', () => ({
  getAppSettings: getAppSettingsMock,
  updateAppSettings: updateAppSettingsMock,
}));

// eslint-disable-next-line import/first
import { registerSettingsIpc } from '../../main/ipc/settingsIpc';

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

describe('registerSettingsIpc', () => {
  beforeEach(() => {
    handlers.clear();
    handleMock.mockClear();
    getAppSettingsMock.mockReset();
    updateAppSettingsMock.mockReset();
  });

  describe('settings:get', () => {
    it('should return settings on success', async () => {
      const mockSettings = {
        repository: {
          branchTemplate: 'agent/{slug}-{timestamp}',
          pushOnCreate: true,
        },
        projectPrep: {
          autoInstallOnOpenInEditor: false,
        },
      };
      getAppSettingsMock.mockReturnValue(mockSettings);
      registerSettingsIpc();

      const result = await callHandler('settings:get');

      expect(getAppSettingsMock).toHaveBeenCalled();
      expect(result).toEqual({ success: true, settings: mockSettings });
    });

    it('should return minimal settings', async () => {
      const mockSettings = {
        repository: {
          branchTemplate: 'main',
          pushOnCreate: false,
        },
      };
      getAppSettingsMock.mockReturnValue(mockSettings);
      registerSettingsIpc();

      const result = await callHandler('settings:get');

      expect(result).toEqual({ success: true, settings: mockSettings });
    });

    it('should return settings with all fields', async () => {
      const mockSettings = {
        repository: {
          branchTemplate: 'feature/{slug}',
          pushOnCreate: true,
        },
        projectPrep: {
          autoInstallOnOpenInEditor: true,
        },
        theme: 'dark',
        locale: 'en-US',
      };
      getAppSettingsMock.mockReturnValue(mockSettings);
      registerSettingsIpc();

      const result = await callHandler('settings:get');

      expect(result).toEqual({ success: true, settings: mockSettings });
    });

    it('should handle error when getting settings', async () => {
      getAppSettingsMock.mockImplementation(() => {
        throw new Error('Failed to read settings file');
      });
      registerSettingsIpc();

      const result = await callHandler('settings:get');

      expect(result).toEqual({
        success: false,
        error: 'Failed to read settings file',
      });
    });

    it('should handle file system error', async () => {
      getAppSettingsMock.mockImplementation(() => {
        throw new Error('ENOENT: no such file or directory');
      });
      registerSettingsIpc();

      const result = await callHandler('settings:get');

      expect(result).toEqual({
        success: false,
        error: 'ENOENT: no such file or directory',
      });
    });

    it('should handle JSON parse error', async () => {
      getAppSettingsMock.mockImplementation(() => {
        throw new Error('Unexpected token in JSON at position 0');
      });
      registerSettingsIpc();

      const result = await callHandler('settings:get');

      expect(result).toEqual({
        success: false,
        error: 'Unexpected token in JSON at position 0',
      });
    });
  });

  describe('settings:update', () => {
    it('should update repository branchTemplate', async () => {
      const mockSettings = {
        repository: {
          branchTemplate: 'feature/{slug}',
          pushOnCreate: true,
        },
        projectPrep: {
          autoInstallOnOpenInEditor: false,
        },
      };
      updateAppSettingsMock.mockReturnValue(mockSettings);
      registerSettingsIpc();

      const result = await callHandler('settings:update', {
        repository: { branchTemplate: 'feature/{slug}' },
      });

      expect(updateAppSettingsMock).toHaveBeenCalledWith({
        repository: { branchTemplate: 'feature/{slug}' },
      });
      expect(result).toEqual({ success: true, settings: mockSettings });
    });

    it('should update repository pushOnCreate', async () => {
      const mockSettings = {
        repository: {
          branchTemplate: 'agent/{slug}-{timestamp}',
          pushOnCreate: false,
        },
        projectPrep: {
          autoInstallOnOpenInEditor: false,
        },
      };
      updateAppSettingsMock.mockReturnValue(mockSettings);
      registerSettingsIpc();

      const result = await callHandler('settings:update', {
        repository: { pushOnCreate: false },
      });

      expect(updateAppSettingsMock).toHaveBeenCalledWith({
        repository: { pushOnCreate: false },
      });
      expect(result).toEqual({ success: true, settings: mockSettings });
    });

    it('should update projectPrep autoInstallOnOpenInEditor', async () => {
      const mockSettings = {
        repository: {
          branchTemplate: 'agent/{slug}-{timestamp}',
          pushOnCreate: true,
        },
        projectPrep: {
          autoInstallOnOpenInEditor: true,
        },
      };
      updateAppSettingsMock.mockReturnValue(mockSettings);
      registerSettingsIpc();

      const result = await callHandler('settings:update', {
        projectPrep: { autoInstallOnOpenInEditor: true },
      });

      expect(updateAppSettingsMock).toHaveBeenCalledWith({
        projectPrep: { autoInstallOnOpenInEditor: true },
      });
      expect(result).toEqual({ success: true, settings: mockSettings });
    });

    it('should update multiple settings at once', async () => {
      const mockSettings = {
        repository: {
          branchTemplate: 'hotfix/{slug}',
          pushOnCreate: false,
        },
        projectPrep: {
          autoInstallOnOpenInEditor: true,
        },
      };
      updateAppSettingsMock.mockReturnValue(mockSettings);
      registerSettingsIpc();

      const result = await callHandler('settings:update', {
        repository: { branchTemplate: 'hotfix/{slug}', pushOnCreate: false },
        projectPrep: { autoInstallOnOpenInEditor: true },
      });

      expect(updateAppSettingsMock).toHaveBeenCalledWith({
        repository: { branchTemplate: 'hotfix/{slug}', pushOnCreate: false },
        projectPrep: { autoInstallOnOpenInEditor: true },
      });
      expect(result).toEqual({ success: true, settings: mockSettings });
    });

    it('should update with empty partial object', async () => {
      const mockSettings = {
        repository: {
          branchTemplate: 'agent/{slug}-{timestamp}',
          pushOnCreate: true,
        },
        projectPrep: {
          autoInstallOnOpenInEditor: false,
        },
      };
      updateAppSettingsMock.mockReturnValue(mockSettings);
      registerSettingsIpc();

      const result = await callHandler('settings:update', {});

      expect(updateAppSettingsMock).toHaveBeenCalledWith({});
      expect(result).toEqual({ success: true, settings: mockSettings });
    });

    it('should update and return modified settings', async () => {
      const mockSettings = {
        repository: {
          branchTemplate: 'custom/{slug}',
          pushOnCreate: true,
        },
        projectPrep: {
          autoInstallOnOpenInEditor: false,
        },
        theme: 'light',
      };
      updateAppSettingsMock.mockReturnValue(mockSettings);
      registerSettingsIpc();

      const result = await callHandler('settings:update', {
        repository: { branchTemplate: 'custom/{slug}' },
      });

      expect(result).toEqual({ success: true, settings: mockSettings });
    });

    it('should handle error when updating settings', async () => {
      updateAppSettingsMock.mockImplementation(() => {
        throw new Error('Failed to write settings file');
      });
      registerSettingsIpc();

      const result = await callHandler('settings:update', {
        repository: { pushOnCreate: true },
      });

      expect(result).toEqual({
        success: false,
        error: 'Failed to write settings file',
      });
    });

    it('should handle file system error on update', async () => {
      updateAppSettingsMock.mockImplementation(() => {
        throw new Error('EACCES: permission denied');
      });
      registerSettingsIpc();

      const result = await callHandler('settings:update', {
        projectPrep: { autoInstallOnOpenInEditor: true },
      });

      expect(result).toEqual({
        success: false,
        error: 'EACCES: permission denied',
      });
    });

    it('should handle validation error', async () => {
      updateAppSettingsMock.mockImplementation(() => {
        throw new Error('Invalid branch template format');
      });
      registerSettingsIpc();

      const result = await callHandler('settings:update', {
        repository: { branchTemplate: 'invalid template' },
      });

      expect(result).toEqual({
        success: false,
        error: 'Invalid branch template format',
      });
    });

    it('should handle disk full error', async () => {
      updateAppSettingsMock.mockImplementation(() => {
        throw new Error('ENOSPC: no space left on device');
      });
      registerSettingsIpc();

      const result = await callHandler('settings:update', {
        repository: { pushOnCreate: false },
      });

      expect(result).toEqual({
        success: false,
        error: 'ENOSPC: no space left on device',
      });
    });
  });

  it('should register all IPC handlers', () => {
    registerSettingsIpc();

    expect(handlers.size).toBe(2);
    expect(handlers.has('settings:get')).toBe(true);
    expect(handlers.has('settings:update')).toBe(true);
  });
});
