import WebSocket, { RawData } from 'ws';
import { BrowserWindow, WebContents } from 'electron';
import { EventEmitter } from 'events';
import type { IPtyService } from '../abstractions/IPtyService';
import { log } from '../../lib/logger';
import { REMOTE_SERVER_URL } from './config';
import type { RemotePtyClientMessage, RemotePtyServerMessage } from './types';

type PtyStartOptions = Parameters<IPtyService['startPty']>[0];
type PtyStartOptionsWithOwner = PtyStartOptions & { owner?: WebContents };

const MAX_CONNECT_ATTEMPTS = 3;
const BASE_RETRY_DELAY_MS = 250;

/**
 * Remote PTY service that proxies terminal IO over WebSocket.
 */
export class RemotePtyService implements IPtyService {
  public readonly eventEmitter = new EventEmitter();
  private readonly connections = new Map<string, WebSocket>();
  private readonly owners = new Map<string, WebContents>();
  private readonly exited = new Set<string>();
  private readonly logger = log;

  constructor(private readonly serverUrl: string = 'ws://localhost:8080') {
    this.logger.info('RemotePtyService:configured', { serverUrl: this.serverUrl });
  }

  async startPty(options: PtyStartOptions): Promise<string> {
    const { owner, ...ptyOptions } = options as PtyStartOptionsWithOwner;
    const { id, cwd, shell, cols, rows } = ptyOptions;

    if (!id) {
      throw new Error('RemotePtyService requires an id');
    }

    this.exited.delete(id);

    const resolvedOwner = owner ?? this.resolveOwner();
    if (resolvedOwner) {
      this.owners.set(id, resolvedOwner);
    }

    if (this.connections.has(id)) {
      this.logger.warn('RemotePtyService:duplicateStart', { id });
      this.emitPtyStarted(id);
      return id;
    }

    this.logger.info('RemotePtyService:connecting', {
      id,
      cwd,
      shell,
      cols,
      rows,
      serverUrl: this.serverUrl,
    });

    try {
      const socket = await this.connectWithRetry(id);
      this.connections.set(id, socket);
      this.attachSocketHandlers(id, socket);
    } catch (error) {
      this.owners.delete(id);
      throw error;
    }

    this.emitPtyStarted(id);
    return id;
  }

  writePty(id: string, data: string): void {
    const socket = this.getActiveConnection(id);
    const payload: RemotePtyClientMessage = { type: 'input', data };
    socket.send(JSON.stringify(payload));
  }

  resizePty(id: string, cols: number, rows: number): void {
    const socket = this.getActiveConnection(id);
    const payload: RemotePtyClientMessage = { type: 'resize', cols, rows };
    socket.send(JSON.stringify(payload));
  }

  killPty(id: string): void {
    const socket = this.connections.get(id);
    if (!socket) {
      throw new Error(`No active PTY connection for ${id}`);
    }

    if (socket.readyState === WebSocket.OPEN) {
      const payload: RemotePtyClientMessage = { type: 'kill' };
      socket.send(JSON.stringify(payload));
    }

    socket.close();
    this.emitExit(id, { exitCode: 143 });
  }

  private async connectWithRetry(id: string, attempt = 1): Promise<WebSocket> {
    const url = this.buildPtyUrl(id);

    try {
      this.logger.debug('RemotePtyService:connectAttempt', { id, attempt, url });
      return await this.createSocket(url);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (attempt >= MAX_CONNECT_ATTEMPTS) {
        this.logger.error('RemotePtyService:connectFailed', { id, attempt, error: errorMessage });
        this.emitExit(id, { exitCode: -1 });
        throw new Error(`Unable to connect to remote PTY ${id}: ${errorMessage}`);
      }
      const delayMs = BASE_RETRY_DELAY_MS * 2 ** (attempt - 1);
      this.logger.warn('RemotePtyService:retryConnect', { id, attempt, delayMs });
      await this.delay(delayMs);
      return this.connectWithRetry(id, attempt + 1);
    }
  }

  private createSocket(url: string): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);

      const cleanup = (): void => {
        socket.off('open', handleOpen);
        socket.off('error', handleError);
      };

      const handleOpen = (): void => {
        cleanup();
        resolve(socket);
      };

      const handleError = (error: Error): void => {
        cleanup();
        reject(error);
      };

      socket.once('open', handleOpen);
      socket.once('error', handleError);
    });
  }

  private attachSocketHandlers(id: string, socket: WebSocket): void {
    socket.on('message', (data) => this.handleMessage(id, data));
    socket.on('close', (code, reason) => this.handleClose(id, code, reason));
    socket.on('error', (error) => {
      this.logger.error('RemotePtyService:socketError', {
        id,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  private handleMessage(id: string, raw: RawData): void {
    let message: RemotePtyServerMessage;
    try {
      message = JSON.parse(raw.toString()) as RemotePtyServerMessage;
    } catch (error) {
      this.logger.warn('RemotePtyService:invalidJson', {
        id,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    if (message.id && message.id !== id) {
      this.logger.warn('RemotePtyService:idMismatch', { expected: id, received: message.id });
      return;
    }

    switch (message.type) {
      case 'pty:data':
        this.emitData(id, message.data ?? '');
        break;
      case 'pty:exit':
        this.emitExit(id, { exitCode: message.exitCode, signal: message.signal });
        break;
      default:
        this.logger.warn('RemotePtyService:unknownMessage', {
          id,
          messageType: (message as RemotePtyServerMessage).type,
        });
    }
  }

  private handleClose(id: string, code: number, reason?: Buffer): void {
    this.logger.info('RemotePtyService:close', {
      id,
      code,
      reason: reason?.toString(),
    });
    this.emitExit(id, {});
    this.cleanup(id);
    this.exited.delete(id);
  }

  private emitData(id: string, data: string): void {
    this.eventEmitter.emit(`pty:data:${id}`, data);
    const owner = this.getOwner(id);
    owner?.send(`pty:data:${id}`, data);
  }

  private emitExit(id: string, payload: { exitCode?: number; signal?: string }): void {
    if (this.exited.has(id)) {
      return;
    }

    this.exited.add(id);
    const normalizedExitCode = typeof payload.exitCode === 'number' ? payload.exitCode : 0;
    const normalizedSignal =
      typeof payload.signal === 'number'
        ? payload.signal
        : typeof payload.signal === 'string'
          ? Number.parseInt(payload.signal, 10)
          : undefined;

    const exitPayload = {
      exitCode: normalizedExitCode,
      signal: Number.isFinite(normalizedSignal) ? normalizedSignal : undefined,
    };

    this.eventEmitter.emit(`pty:exit:${id}`, exitPayload);
    const owner = this.getOwner(id);
    owner?.send(`pty:exit:${id}`, exitPayload);
  }

  private emitPtyStarted(id: string): void {
    this.eventEmitter.emit('pty:started', { id });
    this.broadcastStarted(id);
  }

  private getActiveConnection(id: string): WebSocket {
    const socket = this.connections.get(id);
    if (!socket) {
      throw new Error(`No active PTY connection for ${id}`);
    }
    if (socket.readyState !== WebSocket.OPEN) {
      throw new Error(`PTY ${id} is not ready (state: ${socket.readyState})`);
    }
    return socket;
  }

  private resolveOwner(): WebContents | undefined {
    try {
      const focused = BrowserWindow.getFocusedWindow();
      if (focused) return focused.webContents;
      const [first] = BrowserWindow.getAllWindows();
      return first?.webContents;
    } catch (error) {
      this.logger.warn('RemotePtyService:resolveOwnerFailed', { error: String(error) });
      return undefined;
    }
  }

  private getOwner(id: string): WebContents | undefined {
    const owner = this.owners.get(id);
    if (owner && !owner.isDestroyed()) {
      return owner;
    }
    if (owner?.isDestroyed()) {
      this.owners.delete(id);
    }
    return undefined;
  }

  private broadcastStarted(id: string): void {
    try {
      BrowserWindow.getAllWindows().forEach((window) => {
        window.webContents.send('pty:started', { id });
      });
    } catch (error) {
      this.logger.warn('RemotePtyService:broadcastFailed', { id, error: String(error) });
    }
  }

  private cleanup(id: string): void {
    this.connections.delete(id);
    this.owners.delete(id);
  }

  private buildPtyUrl(id: string): string {
    try {
      const url = new URL('/ws/pty', this.serverUrl);
      url.searchParams.set('id', id);
      return url.toString();
    } catch (error) {
      this.logger.warn('RemotePtyService:urlBuildFailed', {
        serverUrl: this.serverUrl,
        error: error instanceof Error ? error.message : String(error),
      });
      const sanitized = this.serverUrl.endsWith('/')
        ? this.serverUrl.slice(0, -1)
        : this.serverUrl;
      return `${sanitized}/ws/pty?id=${encodeURIComponent(id)}`;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const remotePtyService = new RemotePtyService(REMOTE_SERVER_URL);
