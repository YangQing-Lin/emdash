import { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocketServer } from 'ws';
import type WebSocket from 'ws';
import type { WebContents } from 'electron';
import { RemotePtyService } from '../main/services/remote/RemotePtyService';

type MockWebContents = WebContents & {
  send: ReturnType<typeof vi.fn>;
  isDestroyed: ReturnType<typeof vi.fn>;
};

const electronMocks = vi.hoisted(() => {
  const windows: Array<{ webContents: MockWebContents }> = [];
  return {
    windows,
    getAllWindows: vi.fn(() => windows),
    getFocusedWindow: vi.fn(() => (windows[0] ? { webContents: windows[0].webContents } : undefined)),
  };
});

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: electronMocks.getAllWindows,
    getFocusedWindow: electronMocks.getFocusedWindow,
  },
}));

class TestWebSocketServer {
  public readonly server: WebSocketServer;
  public readonly connections = new Map<string, WebSocket>();
  public readonly messages: Array<{ id: string; payload: any }> = [];

  constructor() {
    this.server = new WebSocketServer({ port: 0 });
    this.server.on('connection', (socket, request) => {
      const url = new URL(request.url ?? '', 'http://localhost');
      const id = url.searchParams.get('id') ?? '';
      this.connections.set(id, socket);

      socket.on('message', (data) => {
        try {
          const payload = JSON.parse(data.toString());
          this.messages.push({ id, payload });
        } catch {
          // ignore malformed JSON for tests
        }
      });

      socket.on('close', () => {
        this.connections.delete(id);
      });
    });
  }

  get url(): string {
    const address = this.server.address() as AddressInfo;
    return `ws://127.0.0.1:${address.port}`;
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  send(id: string, payload: unknown): void {
    const socket = this.connections.get(id);
    if (socket) {
      socket.send(JSON.stringify(payload));
    }
  }
}

async function waitFor<T>(fn: () => T | undefined, timeout = 2000): Promise<T> {
  const start = Date.now();
  return new Promise<T>((resolve, reject) => {
    const tick = () => {
      const result = fn();
      if (result !== undefined) {
        resolve(result);
        return;
      }
      if (Date.now() - start > timeout) {
        reject(new Error('timeout waiting for condition'));
        return;
      }
      setTimeout(tick, 10);
    };
    tick();
  });
}

describe('RemotePtyService', () => {
  let server: TestWebSocketServer;
  let service: RemotePtyService;

  beforeEach(() => {
    server = new TestWebSocketServer();
    service = new RemotePtyService(server.url);
    electronMocks.windows.length = 0;
    electronMocks.getAllWindows.mockClear();
    electronMocks.getFocusedWindow.mockClear();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    const connections: Map<string, WebSocket> | undefined = (service as any).connections;
    connections?.forEach((socket) => socket.close());
    await server.close();
  });

  const createOwner = (): MockWebContents => {
    const owner = {
      send: vi.fn(),
      isDestroyed: vi.fn(() => false),
    } as unknown as MockWebContents;
    electronMocks.windows.push({ webContents: owner });
    return owner;
  };

  it('establishes websocket connection when starting PTY', async () => {
    const owner = createOwner();
    const started = new Promise<void>((resolve) => service.eventEmitter.once('pty:started', () => resolve()));

    const id = 'pty-start';
    await service.startPty({ id, owner });
    await started;

    await waitFor(() => (server.connections.has(id) ? true : undefined));
    expect(electronMocks.getAllWindows).toHaveBeenCalled();
  });

  it('sends input payloads via writePty', async () => {
    const owner = createOwner();
    const id = 'pty-write';
    await service.startPty({ id, owner });

    service.writePty(id, 'echo test');
    const message = await waitFor(() =>
      server.messages.find((entry) => entry.id === id && entry.payload?.type === 'input')
    );
    expect(message?.payload).toEqual({ type: 'input', data: 'echo test' });
  });

  it('sends resize commands via resizePty', async () => {
    const owner = createOwner();
    const id = 'pty-resize';
    await service.startPty({ id, owner });

    service.resizePty(id, 132, 48);
    const message = await waitFor(() =>
      server.messages.find((entry) => entry.id === id && entry.payload?.type === 'resize')
    );
    expect(message?.payload).toEqual({ type: 'resize', cols: 132, rows: 48 });
  });

  it('emits exit event and closes connection on kill', async () => {
    const owner = createOwner();
    const id = 'pty-kill';
    await service.startPty({ id, owner });

    const exitPromise = new Promise<{ exitCode: number }>((resolve) =>
      service.eventEmitter.once(`pty:exit:${id}`, resolve)
    );
    service.killPty(id);

    const message = await waitFor(() =>
      server.messages.find((entry) => entry.id === id && entry.payload?.type === 'kill')
    );
    expect(message?.payload).toEqual({ type: 'kill' });

    const exitPayload = await exitPromise;
    expect(exitPayload.exitCode).toBe(143);
  });

  it('re-emits data and exit events received from server', async () => {
    const owner = createOwner();
    const id = 'pty-events';
    await service.startPty({ id, owner });

    const dataPromise = new Promise<string>((resolve) =>
      service.eventEmitter.once(`pty:data:${id}`, (chunk: string) => resolve(chunk))
    );
    const exitPromise = new Promise<{ exitCode: number }>((resolve) =>
      service.eventEmitter.once(`pty:exit:${id}`, resolve)
    );

    server.send(id, { type: 'pty:data', id, data: 'hello' });
    server.send(id, { type: 'pty:exit', id, exitCode: 0 });

    await expect(dataPromise).resolves.toContain('hello');
    await expect(exitPromise).resolves.toEqual({ exitCode: 0, signal: undefined });
    expect(owner.send).toHaveBeenCalledWith(`pty:data:${id}`, 'hello');
    expect(owner.send).toHaveBeenCalledWith(`pty:exit:${id}`, { exitCode: 0, signal: undefined });
  });

  it('retries connection attempts before succeeding', async () => {
    const owner = createOwner();
    const id = 'pty-retry';
    const original = (service as any).createSocket.bind(service);
    const createSocketSpy = vi
      .spyOn(service as any, 'createSocket')
      .mockRejectedValueOnce(new Error('boom'))
      .mockImplementation((url: string) => original(url));

    await expect(service.startPty({ id, owner })).resolves.toBe(id);
    await waitFor(() => (server.connections.has(id) ? true : undefined));
    expect(createSocketSpy).toHaveBeenCalledTimes(2);
  });
});
