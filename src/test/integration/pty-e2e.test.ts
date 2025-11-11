import { Socket } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { describe, expect, it, vi } from 'vitest';
import protoLoader from '@grpc/proto-loader';
import * as grpc from '@grpc/grpc-js';
import type { WebContents } from 'electron';
import { RemotePtyService } from '../../main/services/remote/RemotePtyService';

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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../..');
const serverDir = path.join(repoRoot, 'server');
const protoPath = path.join(serverDir, 'api/proto/pty.proto');
const packageDefinition = protoLoader.loadSync(protoPath, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});
const ptyPackage = (grpc.loadPackageDefinition(packageDefinition) as any).emdash.pty;

type PtyServiceClient = InstanceType<typeof ptyPackage.PtyService>;

const waitFor = async (predicate: () => boolean, timeout = 15000): Promise<void> => {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout) {
      throw new Error('timeout waiting for condition');
    }
    await delay(25);
  }
};

const waitForPort = async (port: number, host = '127.0.0.1', timeout = 15000): Promise<void> => {
  const start = Date.now();
  while (Date.now() - start <= timeout) {
    try {
      await new Promise<void>((resolve, reject) => {
        const socket = new Socket();
        socket.once('error', reject);
        socket.connect(port, host, () => {
          socket.end();
          resolve();
        });
      });
      return;
    } catch {
      await delay(50);
    }
  }
  throw new Error(`port ${port} not ready`);
};

const isGoAvailable = async (): Promise<boolean> =>
  new Promise((resolve) => {
    const proc = spawn('go', ['version']);
    proc.once('error', () => resolve(false));
    proc.once('exit', (code) => resolve(code === 0));
  });

const startServerProcess = () => {
  const proc = spawn('go', ['run', './cmd/emdash-server'], {
    cwd: serverDir,
    env: {
      ...process.env,
      TELEMETRY_ENABLED: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logs: string[] = [];
  proc.stdout?.on('data', (chunk) => logs.push(chunk.toString()));
  proc.stderr?.on('data', (chunk) => logs.push(chunk.toString()));
  return { proc, logs };
};

const stopServerProcess = async (proc: ReturnType<typeof startServerProcess>['proc']) => {
  if (proc.exitCode !== null) {
    return;
  }
  proc.kill('SIGINT');
  await once(proc, 'exit');
};

const createOwner = (): MockWebContents => {
  const owner = {
    send: vi.fn(),
    isDestroyed: vi.fn(() => false),
  } as unknown as MockWebContents;
  electronMocks.windows.push({ webContents: owner });
  return owner;
};

const startRemoteSession = (client: PtyServiceClient, id: string) =>
  new Promise<void>((resolve, reject) => {
    client.StartPty(
      {
        id,
        shell: '/bin/bash',
        cols: 80,
        rows: 24,
      },
      (err: Error | null) => {
        if (err) reject(err);
        else resolve();
      }
    );
  });

describe.sequential('Remote PTY e2e', () => {
  it(
    'streams data through the Go server',
    async (ctx) => {
      electronMocks.windows.length = 0;
      if (process.env.SKIP_REMOTE_PTY_E2E === '1' || !(await isGoAvailable())) {
        ctx.skip?.('Go environment unavailable');
        return;
      }

      const { proc, logs } = startServerProcess();
      try {
        await waitForPort(50051);
        await waitForPort(8080);
      } catch (error) {
        await stopServerProcess(proc);
        ctx.skip?.(`server unavailable: ${(error as Error).message}\n${logs.join('\n')}`);
        return;
      }

      const client: PtyServiceClient = new ptyPackage.PtyService('127.0.0.1:50051', grpc.credentials.createInsecure());
      let activeService: RemotePtyService | null = null;
      let activeSession: string | null = null;
      try {
        const id = `e2e-${Date.now()}`;
        await startRemoteSession(client, id);

        const owner = createOwner();
        const service = new RemotePtyService('ws://127.0.0.1:8080');
        await service.startPty({ id, owner });
        activeService = service;
        activeSession = id;

        const chunks: string[] = [];

        service.eventEmitter.on(`pty:data:${id}`, (chunk: string) => {
          chunks.push(chunk);
        });

        const findChunk = (needle: string) => chunks.some((chunk) => chunk.includes(needle));

        const latencyMarker = '__E2E_LAT__';
        const latencyStart = performance.now();
        service.writePty(id, `echo ${latencyMarker}\n`);
        await waitFor(() => findChunk(latencyMarker));
        const latencyMs = performance.now() - latencyStart;

        const payloadMarker = 'E2E_PAYLOAD';
        const throughputStart = performance.now();
        service.writePty(
          id,
          `python - <<'PY'
import sys
sys.stdout.write('${payloadMarker}' * 1024)
PY
`
        );
        await waitFor(() => findChunk(payloadMarker));
        const throughputMs = performance.now() - throughputStart;

        const exitPromise = new Promise((resolve) => service.eventEmitter.once(`pty:exit:${id}`, resolve));
        service.killPty(id);
        await exitPromise;
        activeService = null;
        activeSession = null;

        expect(latencyMs).toBeLessThan(2000);
        expect(throughputMs).toBeLessThan(5000);
      } finally {
        if (activeService && activeSession) {
          try {
            activeService.killPty(activeSession);
          } catch {
            // ignore cleanup errors
          }
        }
        client.close();
        await stopServerProcess(proc);
      }
    },
    120_000
  );
});
