import { BrowserWindow, WebContents } from 'electron';
import type { IPtyService } from '../abstractions/IPtyService';
import {
  startPty as spawnPty,
  writePty as writeToPty,
  resizePty as resizeManagedPty,
  killPty as killManagedPty,
  getPty,
} from '../ptyManager';
import { log } from '../../lib/logger';

type PtyStartOptions = Parameters<IPtyService['startPty']>[0];
type PtyStartOptionsWithOwner = PtyStartOptions & { owner?: WebContents };

/**
 * Local adapter for PTY management that preserves the existing IPC event emissions.
 */
export class LocalPtyService implements IPtyService {
  private readonly owners = new Map<string, WebContents>();
  private readonly listeners = new Set<string>();

  async startPty(options: PtyStartOptions): Promise<string> {
    const { owner, ...ptyOptions } = options as PtyStartOptionsWithOwner;
    const { id, cwd, shell, env, cols, rows } = ptyOptions;

    const existing = getPty(id);
    const proc = existing ?? spawnPty(ptyOptions);
    const envKeys = env ? Object.keys(env) : [];
    const planEnv = env && (env.EMDASH_PLAN_MODE || env.EMDASH_PLAN_FILE) ? true : false;

    log.debug('LocalPtyService:start', {
      id,
      cwd,
      shell,
      cols,
      rows,
      reused: !!existing,
      envKeys,
      planEnv,
    });

    const resolvedOwner = owner ?? this.resolveOwner();
    if (resolvedOwner) {
      this.owners.set(id, resolvedOwner);
    }

    if (!this.listeners.has(id)) {
      proc.onData((data) => {
        this.owners.get(id)?.send(`pty:data:${id}`, data);
      });

      proc.onExit(({ exitCode, signal }) => {
        this.owners.get(id)?.send(`pty:exit:${id}`, { exitCode, signal });
        this.cleanup(id);
      });

      this.listeners.add(id);
    }

    this.broadcastStarted(id);
    return id;
  }

  writePty(id: string, data: string): void {
    writeToPty(id, data);
  }

  resizePty(id: string, cols: number, rows: number): void {
    resizeManagedPty(id, cols, rows);
  }

  killPty(id: string): void {
    try {
      killManagedPty(id);
    } finally {
      this.cleanup(id);
    }
  }

  private resolveOwner(): WebContents | undefined {
    try {
      const focused = BrowserWindow.getFocusedWindow();
      if (focused) return focused.webContents;
      const [first] = BrowserWindow.getAllWindows();
      return first?.webContents;
    } catch (error) {
      log.warn('LocalPtyService:resolveOwnerFailed', { error: String(error) });
      return undefined;
    }
  }

  private broadcastStarted(id: string): void {
    try {
      const windows = BrowserWindow.getAllWindows();
      windows.forEach((window) => {
        window.webContents.send('pty:started', { id });
      });
    } catch (error) {
      log.warn('LocalPtyService:broadcastFailed', { id, error: String(error) });
    }
  }

  private cleanup(id: string): void {
    this.owners.delete(id);
    this.listeners.delete(id);
  }
}

export const localPtyService = new LocalPtyService();
