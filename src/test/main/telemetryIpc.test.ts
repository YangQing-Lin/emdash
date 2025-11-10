import { beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown> | unknown;

const {
  handlers,
  handleMock,
  captureMock,
  isTelemetryEnabledMock,
  getTelemetryStatusMock,
  setTelemetryEnabledViaUserMock,
} = vi.hoisted(() => {
  const handlers = new Map<string, Handler>();
  const handleMock = vi.fn((channel: string, handler: Handler) => {
    handlers.set(channel, handler);
  });

  const captureMock = vi.fn();
  const isTelemetryEnabledMock = vi.fn();
  const getTelemetryStatusMock = vi.fn();
  const setTelemetryEnabledViaUserMock = vi.fn();

  return {
    handlers,
    handleMock,
    captureMock,
    isTelemetryEnabledMock,
    getTelemetryStatusMock,
    setTelemetryEnabledViaUserMock,
  };
});

vi.mock('electron', () => ({
  ipcMain: {
    handle: handleMock,
  },
}));

vi.mock('../../main/telemetry', () => ({
  capture: captureMock,
  isTelemetryEnabled: isTelemetryEnabledMock,
  getTelemetryStatus: getTelemetryStatusMock,
  setTelemetryEnabledViaUser: setTelemetryEnabledViaUserMock,
}));

// eslint-disable-next-line import/first
import { registerTelemetryIpc } from '../../main/ipc/telemetryIpc';

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

describe('registerTelemetryIpc', () => {
  beforeEach(() => {
    handlers.clear();
    handleMock.mockClear();
    captureMock.mockReset();
    isTelemetryEnabledMock.mockReset();
    getTelemetryStatusMock.mockReset();
    setTelemetryEnabledViaUserMock.mockReset();
  });

  describe('telemetry:capture', () => {
    it('should capture allowed event feature_used', async () => {
      isTelemetryEnabledMock.mockReturnValue(true);
      captureMock.mockReturnValue(undefined);
      registerTelemetryIpc();

      const result = await callHandler('telemetry:capture', {
        event: 'feature_used',
        properties: { feature: 'worktree' },
      });

      expect(captureMock).toHaveBeenCalledWith('feature_used', { feature: 'worktree' });
      expect(result).toEqual({ success: true });
    });

    it('should capture allowed event error', async () => {
      isTelemetryEnabledMock.mockReturnValue(true);
      captureMock.mockReturnValue(undefined);
      registerTelemetryIpc();

      const result = await callHandler('telemetry:capture', {
        event: 'error',
        properties: { message: 'test error' },
      });

      expect(captureMock).toHaveBeenCalledWith('error', { message: 'test error' });
      expect(result).toEqual({ success: true });
    });

    it('should return disabled when telemetry is disabled', async () => {
      isTelemetryEnabledMock.mockReturnValue(false);
      registerTelemetryIpc();

      const result = await callHandler('telemetry:capture', { event: 'feature_used' });

      expect(captureMock).not.toHaveBeenCalled();
      expect(result).toEqual({ success: false, disabled: true });
    });

    it('should reject event not in allowed set', async () => {
      isTelemetryEnabledMock.mockReturnValue(true);
      registerTelemetryIpc();

      const result = await callHandler('telemetry:capture', { event: 'custom_event' });

      expect(captureMock).not.toHaveBeenCalled();
      expect(result).toEqual({ success: false, error: 'event_not_allowed' });
    });

    it('should handle missing event', async () => {
      isTelemetryEnabledMock.mockReturnValue(true);
      registerTelemetryIpc();

      const result = await callHandler('telemetry:capture', {});

      expect(captureMock).not.toHaveBeenCalled();
      expect(result).toEqual({ success: false, error: 'event_not_allowed' });
    });

    it('should handle null args', async () => {
      isTelemetryEnabledMock.mockReturnValue(true);
      registerTelemetryIpc();

      const result = await callHandler('telemetry:capture', null);

      expect(captureMock).not.toHaveBeenCalled();
      expect(result).toEqual({ success: false, error: 'event_not_allowed' });
    });

    it('should capture event without properties', async () => {
      isTelemetryEnabledMock.mockReturnValue(true);
      captureMock.mockReturnValue(undefined);
      registerTelemetryIpc();

      const result = await callHandler('telemetry:capture', { event: 'feature_used' });

      expect(captureMock).toHaveBeenCalledWith('feature_used', undefined);
      expect(result).toEqual({ success: true });
    });

    it('should ignore non-object properties', async () => {
      isTelemetryEnabledMock.mockReturnValue(true);
      captureMock.mockReturnValue(undefined);
      registerTelemetryIpc();

      const result = await callHandler('telemetry:capture', {
        event: 'feature_used',
        properties: 'string',
      });

      expect(captureMock).toHaveBeenCalledWith('feature_used', undefined);
      expect(result).toEqual({ success: true });
    });

    it('should handle capture error', async () => {
      isTelemetryEnabledMock.mockReturnValue(true);
      captureMock.mockImplementation(() => {
        throw new Error('Capture failed');
      });
      registerTelemetryIpc();

      const result = await callHandler('telemetry:capture', { event: 'feature_used' });

      expect(result).toEqual({ success: false, error: 'Capture failed' });
    });

    it('should handle non-Error exception', async () => {
      isTelemetryEnabledMock.mockReturnValue(true);
      captureMock.mockImplementation(() => {
        throw 'String error';
      });
      registerTelemetryIpc();

      const result = await callHandler('telemetry:capture', { event: 'feature_used' });

      expect(result).toEqual({ success: false, error: 'capture_failed' });
    });
  });

  describe('telemetry:get-status', () => {
    it('should return telemetry status', async () => {
      getTelemetryStatusMock.mockReturnValue({ enabled: true, hasConsent: true });
      registerTelemetryIpc();

      const result = await callHandler('telemetry:get-status');

      expect(getTelemetryStatusMock).toHaveBeenCalled();
      expect(result).toEqual({ success: true, status: { enabled: true, hasConsent: true } });
    });

    it('should return disabled status', async () => {
      getTelemetryStatusMock.mockReturnValue({ enabled: false, hasConsent: false });
      registerTelemetryIpc();

      const result = await callHandler('telemetry:get-status');

      expect(result).toEqual({
        success: true,
        status: { enabled: false, hasConsent: false },
      });
    });

    it('should handle getTelemetryStatus error', async () => {
      getTelemetryStatusMock.mockImplementation(() => {
        throw new Error('Status error');
      });
      registerTelemetryIpc();

      const result = await callHandler('telemetry:get-status');

      expect(result).toEqual({ success: false, error: 'Status error' });
    });

    it('should handle non-Error exception', async () => {
      getTelemetryStatusMock.mockImplementation(() => {
        throw 'String error';
      });
      registerTelemetryIpc();

      const result = await callHandler('telemetry:get-status');

      expect(result).toEqual({ success: false, error: 'status_failed' });
    });
  });

  describe('telemetry:set-enabled', () => {
    it('should enable telemetry', async () => {
      setTelemetryEnabledViaUserMock.mockReturnValue(undefined);
      getTelemetryStatusMock.mockReturnValue({ enabled: true, hasConsent: true });
      registerTelemetryIpc();

      const result = await callHandler('telemetry:set-enabled', true);

      expect(setTelemetryEnabledViaUserMock).toHaveBeenCalledWith(true);
      expect(getTelemetryStatusMock).toHaveBeenCalled();
      expect(result).toEqual({ success: true, status: { enabled: true, hasConsent: true } });
    });

    it('should disable telemetry', async () => {
      setTelemetryEnabledViaUserMock.mockReturnValue(undefined);
      getTelemetryStatusMock.mockReturnValue({ enabled: false, hasConsent: false });
      registerTelemetryIpc();

      const result = await callHandler('telemetry:set-enabled', false);

      expect(setTelemetryEnabledViaUserMock).toHaveBeenCalledWith(false);
      expect(result).toEqual({ success: true, status: { enabled: false, hasConsent: false } });
    });

    it('should convert non-boolean to boolean', async () => {
      setTelemetryEnabledViaUserMock.mockReturnValue(undefined);
      getTelemetryStatusMock.mockReturnValue({ enabled: true, hasConsent: true });
      registerTelemetryIpc();

      const result = await callHandler('telemetry:set-enabled', 'true');

      expect(setTelemetryEnabledViaUserMock).toHaveBeenCalledWith(true);
      expect(result).toEqual({ success: true, status: { enabled: true, hasConsent: true } });
    });

    it('should convert 0 to false', async () => {
      setTelemetryEnabledViaUserMock.mockReturnValue(undefined);
      getTelemetryStatusMock.mockReturnValue({ enabled: false, hasConsent: false });
      registerTelemetryIpc();

      const result = await callHandler('telemetry:set-enabled', 0);

      expect(setTelemetryEnabledViaUserMock).toHaveBeenCalledWith(false);
      expect(result).toEqual({ success: true, status: { enabled: false, hasConsent: false } });
    });

    it('should handle setTelemetryEnabledViaUser error', async () => {
      setTelemetryEnabledViaUserMock.mockImplementation(() => {
        throw new Error('Update failed');
      });
      registerTelemetryIpc();

      const result = await callHandler('telemetry:set-enabled', true);

      expect(result).toEqual({ success: false, error: 'Update failed' });
    });

    it('should handle non-Error exception', async () => {
      setTelemetryEnabledViaUserMock.mockImplementation(() => {
        throw 'String error';
      });
      registerTelemetryIpc();

      const result = await callHandler('telemetry:set-enabled', true);

      expect(result).toEqual({ success: false, error: 'update_failed' });
    });
  });

  it('should register all IPC handlers', () => {
    registerTelemetryIpc();

    expect(handlers.size).toBe(3);
    expect(handlers.has('telemetry:capture')).toBe(true);
    expect(handlers.has('telemetry:get-status')).toBe(true);
    expect(handlers.has('telemetry:set-enabled')).toBe(true);
  });
});
