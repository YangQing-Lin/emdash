import { ipcMain } from 'electron';

import { log } from '../lib/logger';
import { remoteServerService } from '../services/RemoteServerService';

interface RemoteServerPayload {
  name: string;
  grpcUrl: string;
  wsUrl: string;
  token: string;
}

type RemoteServerUpdatePayload = Partial<RemoteServerPayload>;

interface RemoteServerTestPayload {
  grpcUrl: string;
  wsUrl: string;
  token: string;
}

const formatError = (error: unknown): string =>
  error instanceof Error ? error.message : 'Unknown error';

const failure = (action: string, error: unknown) => {
  log.error(`[remote-server] ${action}`, error);
  return { success: false, error: formatError(error) };
};

export function registerRemoteServerIpc(): void {
  ipcMain.handle('remote-server:add', async (_event, payload: RemoteServerPayload) => {
    try {
      const server = await remoteServerService.addServer(payload);
      return { success: true, data: server };
    } catch (error) {
      return failure('add failed', error);
    }
  });

  ipcMain.handle('remote-server:list', async () => {
    try {
      const servers = await remoteServerService.listServers();
      return { success: true, data: servers };
    } catch (error) {
      return failure('list failed', error);
    }
  });

  ipcMain.handle('remote-server:get', async (_event, id: string) => {
    try {
      const server = await remoteServerService.getServer(id);
      return { success: true, data: server };
    } catch (error) {
      return failure('get failed', error);
    }
  });

  ipcMain.handle(
    'remote-server:update',
    async (_event, payload: { id: string; data: RemoteServerUpdatePayload }) => {
      try {
        const updated = await remoteServerService.updateServer(payload.id, payload.data);
        return { success: true, data: updated };
      } catch (error) {
        return failure('update failed', error);
      }
    }
  );

  ipcMain.handle('remote-server:delete', async (_event, id: string) => {
    try {
      await remoteServerService.deleteServer(id);
      return { success: true };
    } catch (error) {
      return failure('delete failed', error);
    }
  });

  ipcMain.handle('remote-server:test', async (_event, payload: RemoteServerTestPayload) => {
    try {
      const result = await remoteServerService.testConnection(
        payload.grpcUrl,
        payload.wsUrl,
        payload.token
      );
      if (result.success) {
        return { success: true, data: result };
      }
      return {
        success: false,
        error: result.message ?? 'Unable to reach remote server',
      };
    } catch (error) {
      return failure('connection test failed', error);
    }
  });
}
