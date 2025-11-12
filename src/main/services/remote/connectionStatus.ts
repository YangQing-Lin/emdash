import { BrowserWindow } from 'electron';
import { log } from '../../lib/logger';
import type { RemoteConnectionStatus } from '../../../shared/remoteConnection';

export const broadcastRemoteConnectionStatus = (payload: RemoteConnectionStatus): void => {
  try {
    const windows = BrowserWindow.getAllWindows();
    if (windows.length === 0) {
      return;
    }
    for (const window of windows) {
      try {
        window.webContents.send('remote:connection-status', payload);
      } catch (error) {
        log.warn('RemoteConnectionStatus:sendFailed', {
          payload,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } catch (error) {
    log.warn('RemoteConnectionStatus:broadcastFailed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
