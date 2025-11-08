import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import path from 'path';
import type { EventEmitter } from 'events';
import type { ChildProcess, ExecFileException, ExecFileOptions, SpawnOptions } from 'child_process';
import type { AgentStartOptions, ProviderId } from '../../main/services/AgentService';

type MockChildProcess = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: null;
  stdio: [null, EventEmitter, EventEmitter];
  killed: boolean;
  connected: boolean;
  signalCode: null;
  exitCode: null;
  spawnargs: string[];
  spawnfile: string;
  channel?: unknown;
  disconnect: () => void;
  unref: () => void;
  ref: () => void;
  send: () => boolean;
  kill: ReturnType<typeof vi.fn>;
  pid: number;
  [Symbol.dispose]?: () => void;
};

type ExecFileResult = {
  error?: ExecFileException;
  stdout?: string;
  stderr?: string;
};

function createAsyncGenerator<T>(
  messages: T[],
  options: { throwAt?: number; error?: Error } = {}
): AsyncGenerator<T, void> {
  let index = 0;
  return {
    async next() {
      if (options.throwAt !== undefined && index === options.throwAt) {
        throw options.error ?? new Error('sdk failure');
      }
      if (index < messages.length) {
        const value = messages[index++];
        return { value, done: false };
      }
      return { value: undefined, done: true };
    },
    async return(value?: void) {
      return { value, done: true };
    },
    async throw(e?: unknown) {
      throw e;
    },
    [Symbol.asyncIterator]() {
      return this;
    },
  };
}

const childProcessState = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { EventEmitter: NodeEventEmitter } = require('events') as typeof import('events');
  const state = {
    spawnCalls: [] as Array<{
      command: string;
      args: string[];
      options: SpawnOptions;
      child: MockChildProcess;
    }>,
    execFileCalls: [] as Array<{ command: string; args: string[]; options?: ExecFileOptions | undefined }>,
    execFileQueue: [] as ExecFileResult[],
    createChildProcess(): MockChildProcess {
      const stdout = new NodeEventEmitter();
      const stderr = new NodeEventEmitter();
      const child = new NodeEventEmitter() as MockChildProcess;
      child.stdout = stdout;
      child.stderr = stderr;
      child.stdin = null;
      child.stdio = [null, stdout, stderr];
      child.killed = false;
      child.connected = false;
      child.signalCode = null;
      child.exitCode = null;
      child.spawnargs = [];
      child.spawnfile = '';
      child.disconnect = vi.fn();
      child.unref = vi.fn();
      child.ref = vi.fn();
      child.send = vi.fn().mockReturnValue(true);
      child.kill = vi.fn().mockReturnValue(true);
      child.pid = Math.floor(Math.random() * 10000);
      return child;
    },
    spawnMock: vi.fn((command: string, args: string[] = [], options: SpawnOptions = {}) => {
      const child = state.createChildProcess();
      state.spawnCalls.push({ command, args, options, child });
      return child;
    }),
    execFileMock: vi.fn(
      (
        command: string,
        argsOrOptions?: string[] | ExecFileOptions | ((error: ExecFileException | null, stdout: string, stderr: string) => void),
        optionsOrCb?: ExecFileOptions | ((error: ExecFileException | null, stdout: string, stderr: string) => void),
        maybeCb?: (error: ExecFileException | null, stdout: string, stderr: string) => void
      ) => {
        const call: { command: string; args: string[]; options?: ExecFileOptions } = {
          command,
          args: [],
        };
        let callback: ((error: ExecFileException | null, stdout: string, stderr: string) => void) | undefined;
        if (Array.isArray(argsOrOptions)) {
          call.args = argsOrOptions;
        } else if (typeof argsOrOptions === 'function') {
          callback = argsOrOptions;
        } else if (argsOrOptions) {
          call.options = argsOrOptions;
        }
        if (typeof optionsOrCb === 'function') {
          callback = optionsOrCb;
        } else if (optionsOrCb) {
          call.options = optionsOrCb;
        }
        if (maybeCb) callback = maybeCb;
        state.execFileCalls.push(call);
        const result = state.execFileQueue.length
          ? state.execFileQueue.shift()!
          : ({ stdout: 'claude 1.0.0', stderr: '' } satisfies ExecFileResult);
        queueMicrotask(() => {
          if (result.error) {
            callback?.(result.error, result.stdout ?? '', result.stderr ?? '');
          } else {
            callback?.(null, result.stdout ?? '', result.stderr ?? '');
          }
        });
        return state.createChildProcess();
      }
    ),
    reset() {
      state.spawnCalls.length = 0;
      state.execFileCalls.length = 0;
      state.execFileQueue.length = 0;
      state.spawnMock.mockClear();
      state.execFileMock.mockClear();
    },
  };
  return state;
});

const fsState = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { EventEmitter: NodeEventEmitter } = require('events') as typeof import('events');

  class MemoryWriteStream extends NodeEventEmitter {
    destroyed = false;
    constructor(private readonly filePath: string, private readonly registry: Map<string, string>) {
      super();
      if (!registry.has(filePath)) {
        registry.set(filePath, '');
      }
    }

    write(chunk: string) {
      const current = this.registry.get(this.filePath) ?? '';
      this.registry.set(this.filePath, current + chunk);
      return true;
    }

    end() {
      this.destroyed = true;
      this.emit('finish');
    }
  }

  const files = new Map<string, string>();
  const directories = new Set<string>();
  const streams = new Map<string, MemoryWriteStream>();

  const mkdirCalls: Array<{ target: string; options?: unknown }> = [];
  return {
    files,
    directories,
    streams,
    mkdirCalls,
    MemoryWriteStream,
    createWriteStream: vi.fn((filePath: string) => {
      const stream = new MemoryWriteStream(filePath, files);
      streams.set(filePath, stream);
      return stream;
    }),
    existsSync: vi.fn((target: string) => directories.has(target) || files.has(target)),
    mkdirSync: vi.fn((target: string, options?: unknown) => {
      directories.add(target);
      mkdirCalls.push({ target, options });
    }),
    reset() {
      files.clear();
      directories.clear();
      streams.clear();
      mkdirCalls.length = 0;
      fsState.createWriteStream.mockClear();
      fsState.existsSync.mockClear();
      fsState.mkdirSync.mockClear();
    },
  };
});

const electronState = vi.hoisted(() => {
  const state = {
    userDataPath: '/tmp/emdash-tests',
    getPath: vi.fn((key: string) => {
      if (key !== 'userData') throw new Error(`unknown path ${key}`);
      return state.userDataPath;
    }),
    reset() {
      state.userDataPath = '/tmp/emdash-tests';
      state.getPath.mockClear();
    },
  };
  return state;
});

const codexState = vi.hoisted(() => {
  const state = {
    instructions: 'Install Codex via brew install codex',
    installationStatusResult: true,
    stopResult: true,
    sendMessageStream: vi.fn().mockResolvedValue(undefined),
    stopMessageStream: vi.fn().mockResolvedValue(true),
    getInstallationStatus: vi.fn(async () => state.installationStatusResult),
    getInstallationInstructions: vi.fn(() => state.instructions),
    reset() {
      state.instructions = 'Install Codex via brew install codex';
      state.installationStatusResult = true;
      state.stopResult = true;
      state.sendMessageStream.mockClear();
      state.stopMessageStream.mockClear();
      state.getInstallationStatus.mockClear();
      state.getInstallationInstructions.mockClear();
    },
  };
  return state;
});

const sdkState = vi.hoisted(() => {
  const state = {
    enabled: false,
    shouldThrowOnRequire: false,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    generatorFactory: vi.fn((_payload?: unknown): AsyncGenerator<any, void, any> => createAsyncGenerator([])),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    queryMock: vi.fn((payload: unknown): AsyncGenerator<any, void, any> => state.generatorFactory(payload)),
    reset() {
      state.enabled = false;
      state.shouldThrowOnRequire = false;
      state.generatorFactory.mockReset();
      state.generatorFactory.mockImplementation(() => createAsyncGenerator([]));
      state.queryMock.mockClear();
    },
  };
  return state;
});

const abortState = vi.hoisted(() => {
  class MockAbortController {
    signal: AbortSignal = { aborted: false } as AbortSignal;
    abort = vi.fn(() => {
      (this.signal as { aborted: boolean }).aborted = true;
    });
  }
  const instances: MockAbortController[] = [];
  const Controller = class extends MockAbortController {
    constructor() {
      super();
      instances.push(this);
    }
  };
  return {
    instances,
    Controller,
    reset() {
      instances.forEach((instance) => instance.abort.mockClear());
      instances.length = 0;
    },
  };
});

const originalAbortController = globalThis.AbortController;
vi.stubGlobal('AbortController', abortState.Controller as typeof AbortController);

vi.mock('child_process', () => ({
  spawn: childProcessState.spawnMock,
  execFile: childProcessState.execFileMock,
}));

vi.mock('fs', () => ({
  existsSync: fsState.existsSync,
  mkdirSync: fsState.mkdirSync,
  createWriteStream: fsState.createWriteStream,
  WriteStream: fsState.MemoryWriteStream,
}));

vi.mock('electron', () => ({
  app: {
    getPath: electronState.getPath,
  },
}));

vi.mock('../../main/services/CodexService', () => ({
  codexService: {
    getInstallationStatus: () => codexState.getInstallationStatus(),
    getInstallationInstructions: () => codexState.getInstallationInstructions(),
    sendMessageStream: (...args: Parameters<typeof codexState.sendMessageStream>) =>
      codexState.sendMessageStream(...args),
    stopMessageStream: (...args: Parameters<typeof codexState.stopMessageStream>) =>
      codexState.stopMessageStream(...args),
  },
}));

vi.mock('@anthropic/claude-code-sdk', async () => ({
  get query() {
    if (sdkState.shouldThrowOnRequire) {
      throw new Error('MODULE_NOT_FOUND');
    }
    return sdkState.enabled ? sdkState.queryMock : undefined;
  },
}));

let AgentServiceModule: typeof import('../../main/services/AgentService') | null = null;

async function createService() {
  if (!AgentServiceModule) {
    AgentServiceModule = await import('../../main/services/AgentService');
  }
  return new AgentServiceModule.AgentService();
}

function buildOptions(overrides: Partial<AgentStartOptions> = {}): AgentStartOptions {
  return {
    providerId: overrides.providerId ?? 'claude',
    workspaceId: overrides.workspaceId ?? 'workspace-1',
    worktreePath: overrides.worktreePath ?? '/tmp/workspaces/workspace-1',
    message: overrides.message ?? 'hello agent',
    conversationId: overrides.conversationId,
  };
}

function resolveLogPath(providerId: ProviderId, workspaceId: string) {
  return path.join(electronState.userDataPath, 'logs', 'agent', providerId, workspaceId, 'stream.log');
}

function readLog(providerId: ProviderId, workspaceId: string) {
  return fsState.files.get(resolveLogPath(providerId, workspaceId)) ?? '';
}

function getWriters(service: unknown) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (service as any).writers as Map<string, unknown>;
}

function getProcesses(service: unknown) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (service as any).processes as Map<string, ChildProcess>;
}

function lastSpawnCall() {
  return childProcessState.spawnCalls[childProcessState.spawnCalls.length - 1];
}

async function waitFor(predicate: () => boolean, timeout = 1000) {
  const start = Date.now();
  // Give async IIFE time to start
  await new Promise((resolve) => setImmediate(resolve));

  while (!predicate()) {
    if (Date.now() - start > timeout) {
      throw new Error('Timed out waiting for condition');
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
}

describe('AgentService', () => {
  beforeEach(() => {
    childProcessState.reset();
    fsState.reset();
    electronState.reset();
    codexState.reset();
    sdkState.reset();
    abortState.reset();
  });

  afterAll(() => {
    if (originalAbortController) {
      globalThis.AbortController = originalAbortController;
    } else {
      Reflect.deleteProperty(globalThis, 'AbortController');
    }
  });

  describe('key()', () => {
    it('生成 provider:workspace 键', async () => {
      const service = await createService();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const internal = service as any;

      // 准备
      const provider: ProviderId = 'codex';
      const workspace = 'alpha';

      // 操作
      const key = internal.key(provider, workspace);

      // 断言
      expect(key).toBe('codex:alpha');
    });

    it('不同 provider 生成不同键', async () => {
      const service = await createService();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const internal = service as any;

      // 准备
      const workspace = 'same';

      // 操作
      const codexKey = internal.key('codex', workspace);
      const claudeKey = internal.key('claude', workspace);

      // 断言
      expect(codexKey).not.toBe(claudeKey);
      expect(claudeKey).toBe('claude:same');
    });
  });

  describe('ensureLog()', () => {
    it('创建日志目录并写入 writers 映射', async () => {
      const service = await createService();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const internal = service as any;

      // 准备
      const provider: ProviderId = 'claude';
      const workspace = 'ws-ensure';

      // 操作
      const writer = internal.ensureLog(provider, workspace);

      // 断言
      expect(writer).toBeDefined();
      expect(fsState.mkdirCalls[0]?.target).toContain(path.join('logs', 'agent', provider, workspace));
      expect(fsState.mkdirCalls[0]?.options).toMatchObject({ recursive: true });
      expect(getWriters(service).has('claude:ws-ensure')).toBeTruthy();
    });

    it('复用已存在的目录而不重复创建', async () => {
      const service = await createService();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const internal = service as any;

      // 准备
      const provider: ProviderId = 'claude';
      const workspace = 'ws-existing';
      fsState.directories.add(path.join(electronState.userDataPath, 'logs', 'agent', provider, workspace));

      // 操作
      internal.ensureLog(provider, workspace);

      // 断言
      expect(fsState.mkdirSync).toHaveBeenCalledTimes(0);
      expect(getWriters(service).has('claude:ws-existing')).toBe(true);
    });
  });

  describe('append()', () => {
    it('写入已存在的 writer', async () => {
      const service = await createService();
      const writers = getWriters(service);
      const writer = {
        destroyed: false,
        write: vi.fn(),
      } as unknown as EventEmitter & { destroyed: boolean; write: (chunk: string) => boolean };
      writers.set('claude:w0', writer as unknown as ReturnType<typeof fsState.createWriteStream>);

      // 准备
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const internal = service as any;

      // 操作
      internal.append('claude', 'w0', 'chunk');

      // 断言
      expect(writer.write).toHaveBeenCalledWith('chunk');
    });

    it('writer 被销毁时不会再写入', async () => {
      const service = await createService();
      const writers = getWriters(service);
      const writer = {
        destroyed: true,
        write: vi.fn(),
      };
      writers.set('claude:w1', writer as unknown as ReturnType<typeof fsState.createWriteStream>);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const internal = service as any;

      // 准备 & 操作
      internal.append('claude', 'w1', 'chunk');

      // 断言
      expect(writer.write).not.toHaveBeenCalled();
    });

    it('缺少 writer 时静默跳过', async () => {
      const service = await createService();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const internal = service as any;

      // 准备 & 操作
      expect(() => internal.append('claude', 'missing', 'chunk')).not.toThrow();

      // 断言
      expect(getWriters(service).has('claude:missing')).toBe(false);
    });
  });

  describe('isInstalled()', () => {
    it('codex provider 代理到 codexService', async () => {
      const service = await createService();
      codexState.installationStatusResult = true;

      // 准备 & 操作
      const result = await service.isInstalled('codex');

      // 断言
      expect(result).toBe(true);
      expect(codexState.getInstallationStatus).toHaveBeenCalledTimes(1);
    });

    it('codex provider 返回 false 时反映为未安装', async () => {
      const service = await createService();
      codexState.installationStatusResult = false;

      // 准备 & 操作
      const result = await service.isInstalled('codex');

      // 断言
      expect(result).toBe(false);
    });

    it('codex provider 抛错时返回 false', async () => {
      const service = await createService();
      codexState.getInstallationStatus.mockRejectedValueOnce(new Error('broken'));

      // 准备 & 操作
      const result = await service.isInstalled('codex');

      // 断言
      expect(result).toBe(false);
    });

    it('claude provider 检查 CLI 版本', async () => {
      const service = await createService();

      // 准备
      childProcessState.execFileQueue.push({ stdout: 'claude 2.0.0' });

      // 操作
      const result = await service.isInstalled('claude');

      // 断言
      expect(result).toBe(true);
      expect(childProcessState.execFileCalls[0]).toMatchObject({ command: 'claude', args: ['--version'] });
    });

    it('claude provider 检查失败时返回 false', async () => {
      const service = await createService();
      const error = Object.assign(new Error('missing') as ExecFileException, { code: 'ENOENT' });
      childProcessState.execFileQueue.push({ error });

      // 准备 & 操作
      const result = await service.isInstalled('claude');

      // 断言
      expect(result).toBe(false);
    });

    it('未知 provider 直接返回 false', async () => {
      const service = await createService();

      // 准备 & 操作
      const result = await service.isInstalled('other' as ProviderId);

      // 断言
      expect(result).toBe(false);
    });
  });

  describe('getInstallationInstructions()', () => {
    it('返回 codex 指南', async () => {
      const service = await createService();
      codexState.instructions = 'install codex please';

      // 准备 & 操作
      const result = service.getInstallationInstructions('codex');

      // 断言
      expect(result).toBe('install codex please');
    });

    it('返回 claude CLI 指南', async () => {
      const service = await createService();

      // 准备 & 操作
      const result = service.getInstallationInstructions('claude');

      // 断言
      expect(result).toContain('Install Claude Code CLI');
    });

    it('未知 provider 返回空字符串', async () => {
      const service = await createService();

      // 准备 & 操作
      const result = service.getInstallationInstructions('unknown' as ProviderId);

      // 断言
      expect(result).toBe('');
    });
  });

  describe('startStream() codex provider', () => {
    it('直接调用 codexService.sendMessageStream', async () => {
      const service = await createService();
      const options = buildOptions({ providerId: 'codex', workspaceId: 'ws-codex', message: 'ping' });

      // 准备 & 操作
      await service.startStream(options);

      // 断言
      expect(codexState.sendMessageStream).toHaveBeenCalledWith('ws-codex', 'ping', undefined);
    });

    it('传递 conversationId', async () => {
      const service = await createService();
      const options = buildOptions({
        providerId: 'codex',
        workspaceId: 'ws-codex',
        message: 'ping',
        conversationId: 'conv-1',
      });

      // 准备 & 操作
      await service.startStream(options);

      // 断言
      expect(codexState.sendMessageStream).toHaveBeenCalledWith('ws-codex', 'ping', 'conv-1');
    });
  });

  describe('startStream() claude 进程管理', () => {
    it('新建流时会终止相同 provider 的旧进程', async () => {
      const service = await createService();
      const fakeProcess = childProcessState.createChildProcess();
      getProcesses(service).set('claude:workspace-1', fakeProcess as unknown as ChildProcess);
      const options = buildOptions({ providerId: 'claude', workspaceId: 'workspace-1' });

      // 准备
      fakeProcess.kill.mockClear();

      // 操作
      await service.startStream(options);

      // 断言
      expect(fakeProcess.kill).toHaveBeenCalledWith('SIGTERM');
      expect(getProcesses(service).get('claude:workspace-1')).not.toBe(fakeProcess);
    });

    it('会同时终止同 workspace 的其他 provider 进程', async () => {
      const service = await createService();
      const codexProcess = childProcessState.createChildProcess();
      getProcesses(service).set('codex:workspace-2', codexProcess as unknown as ChildProcess);

      // 准备
      const options = buildOptions({ providerId: 'claude', workspaceId: 'workspace-2' });

      // 操作
      await service.startStream(options);

      // 断言
      expect(codexProcess.kill).toHaveBeenCalledWith('SIGTERM');
      expect(getProcesses(service).has('codex:workspace-2')).toBe(false);
    });

    it('终止旧进程失败时继续执行', async () => {
      const service = await createService();
      const faultyProcess = childProcessState.createChildProcess();
      faultyProcess.kill.mockImplementation(() => {
        throw new Error('cannot kill');
      });
      getProcesses(service).set('claude:workspace-3', faultyProcess as unknown as ChildProcess);
      const options = buildOptions({ providerId: 'claude', workspaceId: 'workspace-3' });

      // 准备 & 操作
      await expect(service.startStream(options)).resolves.not.toThrow();

      // 断言
      expect(getProcesses(service).get('claude:workspace-3')).not.toBe(faultyProcess);
    });

    it('启动时写入日志头信息', async () => {
      const service = await createService();
      const options = buildOptions({ providerId: 'claude', workspaceId: 'workspace-logs', message: '日志测试' });

      // 准备 & 操作
      await service.startStream(options);

      // 断言
      const log = readLog('claude', 'workspace-logs');
      expect(log).toContain('Provider: claude');
      expect(log).toContain('Workspace: workspace-logs');
      expect(log).toContain('Message: 日志测试');
    });

    it('启动时会缓存 writer 并获取 userData 路径', async () => {
      const service = await createService();
      const options = buildOptions({ providerId: 'claude', workspaceId: 'workspace-writer' });

      // 准备 & 操作
      await service.startStream(options);

      // 断言
      expect(electronState.getPath).toHaveBeenCalledWith('userData');
      expect(getWriters(service).has('claude:workspace-writer')).toBe(true);
    });
  });

  // TODO: SDK模式测试暂时跳过 - 动态require('@anthropic/claude-code-sdk')无法正确加载virtual mock
  // 原因: Vitest的virtual mock在运行时动态require时可能无法正确注入
  // 解决方案: 将来可以通过依赖注入或者集成测试来覆盖SDK模式
  describe.skip('startStream() claude SDK 模式', () => {
    it('调用 SDK query 并传入工作区参数', async () => {
      const service = await createService();
      sdkState.enabled = true;
      const options = buildOptions({ providerId: 'claude', workspaceId: 'sdk-a', worktreePath: '/tmp/sdk-a' });
      sdkState.generatorFactory.mockImplementation(() => createAsyncGenerator([]));

      // 准备 & 操作
      await service.startStream(options);
      await waitFor(() => sdkState.queryMock.mock.calls.length > 0);

      // 断言
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const call = sdkState.queryMock.mock.calls[0]?.[0] as Record<string, any>;
      expect(call.prompt).toBe(options.message);
      expect(call.options.cwd).toBe('/tmp/sdk-a');
      expect(call.options.permissionMode).toBe('acceptEdits');
      expect(call.options.allowedTools).toEqual(['Edit', 'MultiEdit', 'Write', 'Read']);
    });

    it('stream_event 消息会触发 agent:output', async () => {
      const service = await createService();
      sdkState.enabled = true;
      const outputs: string[] = [];
      service.on('agent:output', (payload) => outputs.push(payload.output));
      sdkState.generatorFactory.mockImplementation(() =>
        createAsyncGenerator([{ type: 'stream_event', event: { delta: { text: 'sdk-chunk' } } }])
      );

      // 准备 & 操作
      await service.startStream(buildOptions({ providerId: 'claude', workspaceId: 'sdk-b' }));
      await waitFor(() => outputs.length === 1);

      // 断言
      expect(outputs[0]).toBe('sdk-chunk');
      expect(readLog('claude', 'sdk-b')).toContain('sdk-chunk');
    });

    it('assistant 数组内容被拼接输出', async () => {
      const service = await createService();
      sdkState.enabled = true;
      const outputs: string[] = [];
      service.on('agent:output', (payload) => outputs.push(payload.output));
      sdkState.generatorFactory.mockImplementation(() =>
        createAsyncGenerator([
          { type: 'assistant', message: { content: [{ text: 'line1' }, { text: 'line2' }] } },
        ])
      );

      // 准备 & 操作
      await service.startStream(buildOptions({ providerId: 'claude', workspaceId: 'sdk-c' }));
      await waitFor(() => outputs.length === 1);

      // 断言
      expect(outputs[0]).toBe('line1\nline2');
      expect(readLog('claude', 'sdk-c')).toContain('line1\nline2');
    });

    it('result 字符串同样写入日志与事件', async () => {
      const service = await createService();
      sdkState.enabled = true;
      const outputs: string[] = [];
      service.on('agent:output', (payload) => outputs.push(payload.output));
      sdkState.generatorFactory.mockImplementation(() =>
        createAsyncGenerator([{ type: 'result', result: 'sdk-result' }])
      );

      // 准备 & 操作
      await service.startStream(buildOptions({ providerId: 'claude', workspaceId: 'sdk-d' }));
      await waitFor(() => outputs.includes('sdk-result'));

      // 断言
      expect(readLog('claude', 'sdk-d')).toContain('sdk-result');
    });

    it('成功结束时会发出 agent:complete 事件', async () => {
      const service = await createService();
      sdkState.enabled = true;
      const completes: Array<{ exitCode: number }> = [];
      service.on('agent:complete', (payload) => completes.push(payload));
      sdkState.generatorFactory.mockImplementation(() => createAsyncGenerator([]));

      // 准备 & 操作
      await service.startStream(buildOptions({ providerId: 'claude', workspaceId: 'sdk-e' }));
      await waitFor(() => completes.length === 1);

      // 断言
      expect(completes[0]).toMatchObject({ providerId: 'claude', workspaceId: 'sdk-e', exitCode: 0 });
    });

    it('完成后日志包含 COMPLETE 标记', async () => {
      const service = await createService();
      sdkState.enabled = true;
      sdkState.generatorFactory.mockImplementation(() => createAsyncGenerator([]));

      // 准备 & 操作
      await service.startStream(buildOptions({ providerId: 'claude', workspaceId: 'sdk-f' }));
      await waitFor(() => readLog('claude', 'sdk-f').includes('[COMPLETE] sdk success'));

      // 断言
      expect(readLog('claude', 'sdk-f')).toContain('[COMPLETE] sdk success');
    });

    it('完成后 writers 与 processes 清理干净', async () => {
      const service = await createService();
      sdkState.enabled = true;
      sdkState.generatorFactory.mockImplementation(() => createAsyncGenerator([]));
      const workspaceId = 'sdk-g';

      // 准备 & 操作
      await service.startStream(buildOptions({ providerId: 'claude', workspaceId }));
      await waitFor(() => !getProcesses(service).has(`claude:${workspaceId}`));

      // 断言
      expect(getWriters(service).has(`claude:${workspaceId}`)).toBe(false);
      expect(getProcesses(service).has(`claude:${workspaceId}`)).toBe(false);
    });

    it('SDK 抛错时记录 ERROR 并发出 agent:error', async () => {
      const service = await createService();
      sdkState.enabled = true;
      const errors: string[] = [];
      service.on('agent:error', (payload) => errors.push(payload.error));
      sdkState.generatorFactory.mockImplementation(() =>
        createAsyncGenerator([{ type: 'stream_event', event: { delta: { text: 'before' } } }], {
          throwAt: 1,
          error: new Error('sdk exploded'),
        })
      );

      // 准备 & 操作
      await service.startStream(buildOptions({ providerId: 'claude', workspaceId: 'sdk-h' }));
      await waitFor(() => errors.length === 1);

      // 断言
      expect(errors[0]).toContain('sdk exploded');
      expect(readLog('claude', 'sdk-h')).toContain('[ERROR]');
    });

    it('SDK 抛错后资源同样被清理', async () => {
      const service = await createService();
      sdkState.enabled = true;
      sdkState.generatorFactory.mockImplementation(() =>
        createAsyncGenerator([], { throwAt: 0, error: new Error('boom') })
      );

      // 准备 & 操作
      await service.startStream(buildOptions({ providerId: 'claude', workspaceId: 'sdk-i' }));
      await waitFor(() => !getProcesses(service).has('claude:sdk-i'));

      // 断言
      expect(getWriters(service).has('claude:sdk-i')).toBe(false);
    });
  });

  describe('startStream() claude CLI 模式', () => {
    async function startCliStream(
      service: Awaited<ReturnType<typeof createService>>,
      overrides: Partial<AgentStartOptions> = {}
    ) {
      const options = buildOptions({ providerId: 'claude', ...overrides });
      await service.startStream(options);
      const spawnCall = lastSpawnCall();
      if (!spawnCall) {
        throw new Error('spawn not invoked');
      }
      return { child: spawnCall.child, options };
    }

    it('使用固定参数启动 claude CLI', async () => {
      const service = await createService();
      const workspaceId = 'cli-a';

      // 准备 & 操作
      await startCliStream(service, { workspaceId, message: 'cli message' });

      // 断言
      const call = lastSpawnCall();
      expect(call?.command).toBe('claude');
      expect(call?.options.cwd).toBe('/tmp/workspaces/workspace-1');
      expect(call?.args).toEqual([
        '-p',
        'cli message',
        '--verbose',
        '--output-format',
        'stream-json',
        '--permission-mode',
        'acceptEdits',
        '--allowedTools',
        'Edit',
        '--allowedTools',
        'MultiEdit',
        '--allowedTools',
        'Write',
        '--allowedTools',
        'Read',
      ]);
    });

    it('stream_event JSON 输出会触发事件', async () => {
      const service = await createService();
      const outputs: string[] = [];
      service.on('agent:output', (payload) => outputs.push(payload.output));
      const { child } = await startCliStream(service, { workspaceId: 'cli-b' });

      // 准备 & 操作
      child.stdout.emit(
        'data',
        Buffer.from(JSON.stringify({ type: 'stream_event', event: { delta: { text: 'cli-chunk' } } }) + '\n')
      );
      await waitFor(() => outputs.length === 1);

      // 断言
      expect(outputs[0]).toBe('cli-chunk');
      expect(readLog('claude', 'cli-b')).toContain('cli-chunk');
    });

    it('assistant 字符串同样输出', async () => {
      const service = await createService();
      const outputs: string[] = [];
      service.on('agent:output', (payload) => outputs.push(payload.output));
      const { child } = await startCliStream(service, { workspaceId: 'cli-c' });

      // 准备 & 操作
      child.stdout.emit(
        'data',
        Buffer.from(JSON.stringify({ type: 'assistant', message: { content: 'assistant text' } }) + '\n')
      );
      await waitFor(() => outputs.includes('assistant text'));

      // 断言
      expect(readLog('claude', 'cli-c')).toContain('assistant text');
    });

    it('result 字符串写入日志', async () => {
      const service = await createService();
      const { child } = await startCliStream(service, { workspaceId: 'cli-d' });
      const outputs: string[] = [];
      service.on('agent:output', (payload) => outputs.push(payload.output));

      // 准备 & 操作
      child.stdout.emit('data', Buffer.from(JSON.stringify({ type: 'result', result: 'cli-result' }) + '\n'));
      await waitFor(() => outputs.includes('cli-result'));

      // 断言
      expect(readLog('claude', 'cli-d')).toContain('cli-result');
    });

    it('未知类型但含 message 字段时按文本写入', async () => {
      const service = await createService();
      const { child } = await startCliStream(service, { workspaceId: 'cli-e' });
      const outputs: string[] = [];
      service.on('agent:output', (payload) => outputs.push(payload.output));

      // 准备 & 操作
      child.stdout.emit('data', Buffer.from(JSON.stringify({ type: 'note', message: 'fallback message' }) + '\n'));
      await waitFor(() => outputs.includes('fallback message'));

      // 断言
      expect(readLog('claude', 'cli-e')).toContain('fallback message');
    });

    it('解析失败的行会按原始文本输出', async () => {
      const service = await createService();
      const { child } = await startCliStream(service, { workspaceId: 'cli-f' });
      const outputs: string[] = [];
      service.on('agent:output', (payload) => outputs.push(payload.output));

      // 准备 & 操作
      child.stdout.emit('data', Buffer.from('not-json\n'));
      await waitFor(() => outputs.includes('not-json\n'));

      // 断言
      expect(readLog('claude', 'cli-f')).toContain('not-json');
    });

    it('跨 chunk JSON 能被拼接', async () => {
      const service = await createService();
      const { child } = await startCliStream(service, { workspaceId: 'cli-g' });
      const outputs: string[] = [];
      service.on('agent:output', (payload) => outputs.push(payload.output));

      // 准备 & 操作
      child.stdout.emit('data', Buffer.from('{"type":"stream_event","event":{"delta":{"text":"par'));
      child.stdout.emit('data', Buffer.from('t"}}}\n'));
      await waitFor(() => outputs.includes('part'));

      // 断言
      expect(outputs[0]).toBe('part');
    });

    it('stderr 数据会触发 agent:error 与日志追加', async () => {
      const service = await createService();
      const errors: string[] = [];
      service.on('agent:error', (payload) => errors.push(payload.error));
      const { child } = await startCliStream(service, { workspaceId: 'cli-h' });

      // 准备 & 操作
      child.stderr.emit('data', Buffer.from('warning message'));
      await waitFor(() => errors.length === 1);

      // 断言
      expect(errors[0]).toContain('warning message');
      expect(readLog('claude', 'cli-h')).toContain('[stderr]');
    });

    it('close 事件写入 COMPLETE 并发送 agent:complete', async () => {
      const service = await createService();
      const completes: Array<{ exitCode: number }> = [];
      service.on('agent:complete', (payload) => completes.push(payload));
      const { child, options } = await startCliStream(service, { workspaceId: 'cli-i' });

      // 准备 & 操作
      child.emit('close', 7);
      await waitFor(() => completes.length === 1);

      // 断言
      const log = readLog('claude', options.workspaceId);
      expect(log).toContain('[COMPLETE] exit code 7');
      expect(completes[0]).toMatchObject({ exitCode: 7 });
    });

    it('error 事件触发 agent:error 而不崩溃', async () => {
      const service = await createService();
      const errors: string[] = [];
      service.on('agent:error', (payload) => errors.push(payload.error));
      const { child } = await startCliStream(service, { workspaceId: 'cli-j' });

      // 准备 & 操作
      child.emit('error', new Error('spawn error'));
      await waitFor(() => errors.length === 1);

      // 断言
      expect(errors[0]).toContain('spawn error');
    });

    it('SDK require 抛错时回退到 CLI', async () => {
      const service = await createService();
      sdkState.enabled = true;
      sdkState.shouldThrowOnRequire = true;

      // 准备 & 操作
      await startCliStream(service, { workspaceId: 'cli-k' });

      // 断言
      expect(childProcessState.spawnCalls.length).toBeGreaterThan(0);
    });

    it('spawn 失败会向调用者抛出异常', async () => {
      const service = await createService();
      childProcessState.spawnMock.mockImplementationOnce(() => {
        throw new Error('spawn failed');
      });

      // 准备 & 操作 & 断言
      await expect(service.startStream(buildOptions({ providerId: 'claude', workspaceId: 'cli-l' }))).rejects.toThrow(
        'spawn failed'
      );
    });

    it('CLI 进程会被记录到 processes 映射', async () => {
      const service = await createService();
      const { child } = await startCliStream(service, { workspaceId: 'cli-m' });

      // 准备 & 操作 & 断言
      expect(getProcesses(service).get('claude:cli-m')).toBe(child);
    });

    it('close 之后 writers 与 processes 被清空', async () => {
      const service = await createService();
      const { child } = await startCliStream(service, { workspaceId: 'cli-n' });

      // 准备 & 操作
      child.emit('close', 0);
      await waitFor(() => !getProcesses(service).has('claude:cli-n'));

      // 断言
      expect(getWriters(service).has('claude:cli-n')).toBe(false);
    });
  });

  describe('stopStream()', () => {
    it('codex provider 代理到 codexService.stopMessageStream', async () => {
      const service = await createService();
      codexState.stopMessageStream.mockResolvedValueOnce(true);

      // 准备 & 操作
      const result = await service.stopStream('codex', 'ws-stop');

      // 断言
      expect(result).toBe(true);
      expect(codexState.stopMessageStream).toHaveBeenCalledWith('ws-stop');
    });

    it('claude CLI 进程会发送 SIGTERM 并关闭 writer', async () => {
      const service = await createService();
      const { child } = await (async () => {
        const options = buildOptions({ providerId: 'claude', workspaceId: 'stop-cli' });
        await service.startStream(options);
        const call = lastSpawnCall();
        if (!call) throw new Error('missing spawn');
        return { child: call.child, options };
      })();
      const writerKey = 'claude:stop-cli';
      const writer = getWriters(service).get(writerKey) as { destroyed: boolean };

      // 准备 & 操作
      const result = await service.stopStream('claude', 'stop-cli');

      // 断言
      expect(result).toBe(true);
      expect(child.kill).toHaveBeenCalledWith('SIGTERM');
      expect(writer?.destroyed).toBe(true);
      expect(getProcesses(service).has(writerKey)).toBe(false);
    });

    it('不存在的进程返回 true', async () => {
      const service = await createService();

      // 准备 & 操作
      const result = await service.stopStream('claude', 'missing');

      // 断言
      expect(result).toBe(true);
    });

    it('kill 抛错时返回 false', async () => {
      const service = await createService();
      const fake = childProcessState.createChildProcess();
      fake.kill.mockImplementation(() => {
        throw new Error('kill fail');
      });
      getProcesses(service).set('claude:stop-fail', fake as unknown as ChildProcess);

      // 准备 & 操作
      const result = await service.stopStream('claude', 'stop-fail');

      // 断言
      expect(result).toBe(false);
    });

    it('writer 已销毁也会从 map 中移除', async () => {
      const service = await createService();
      const key = 'claude:stop-destroyed';
      const writer = fsState.createWriteStream(resolveLogPath('claude', 'stop-destroyed'));
      writer.end();
      getWriters(service).set(key, writer);
      const fake = childProcessState.createChildProcess();
      getProcesses(service).set(key, fake as unknown as ChildProcess);

      // 准备 & 操作
      await service.stopStream('claude', 'stop-destroyed');

      // 断言
      expect(getWriters(service).has(key)).toBe(false);
    });

    // TODO: SDK模式测试暂时跳过 - 同上述SDK模式测试的原因
    it.skip('停止 SDK 流时会触发 AbortController', async () => {
      const service = await createService();
      sdkState.enabled = true;
      let finish: (() => void) | undefined;
      sdkState.generatorFactory.mockImplementation(() => {
        return {
          next: () =>
            new Promise((resolve) => {
              finish = () => resolve({ value: undefined, done: true });
            }),
          async return(value?: void) {
            return { value, done: true };
          },
          async throw(e?: unknown) {
            throw e;
          },
          [Symbol.asyncIterator]() {
            return this;
          },
        };
      });
      const workspaceId = 'stop-sdk';

      // 准备
      await service.startStream(buildOptions({ providerId: 'claude', workspaceId }));
      // 等待IIFE启动并创建AbortController
      await waitFor(() => abortState.instances.length === 1);

      // 操作
      const result = await service.stopStream('claude', workspaceId);
      finish?.();

      // 断言
      expect(result).toBe(true);
      expect(abortState.instances[0]?.abort).toHaveBeenCalled();
    });

    it('停止后 writers 与 processes 清空', async () => {
      const service = await createService();
      const options = buildOptions({ providerId: 'claude', workspaceId: 'stop-cleanup' });
      await service.startStream(options);

      // 准备 & 操作
      await service.stopStream('claude', 'stop-cleanup');

      // 断言
      expect(getWriters(service).has('claude:stop-cleanup')).toBe(false);
      expect(getProcesses(service).has('claude:stop-cleanup')).toBe(false);
    });
  });
});
