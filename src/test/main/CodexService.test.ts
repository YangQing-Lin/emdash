import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventEmitter } from 'events';
import type {
  ExecException,
  ExecFileException,
  ExecFileOptions,
  ExecOptions,
  SpawnOptions,
} from 'child_process';
import type { CodexAgent, CodexResponse } from '../../main/services/CodexService';

type MockChildProcess = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
  pid: number;
};

type ExecResult = {
  error?: NodeJS.ErrnoException;
  stdout?: string;
  stderr?: string;
};

type ExecCallback = (error: ExecException | null, stdout: string, stderr: string) => void;
type ExecFileCallback = (error: ExecFileException | null, stdout: string, stderr: string) => void;

const trackedEnvVars = [
  'CODEX_DANGEROUSLY_BYPASS',
  'CODEX_DANGEROUSLY_BYPASS_APPROVALS_AND_SANDBOX',
  'CODEX_SANDBOX_MODE',
  'CODEX_APPROVAL_POLICY',
] as const;

const childProcessState = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { EventEmitter } = require('events') as typeof import('events');
  const state = {
    spawnCalls: [] as Array<{
      command: string;
      args: string[];
      options: SpawnOptions;
      child: MockChildProcess;
    }>,
    execQueue: [] as ExecResult[],
    execFileQueue: [] as ExecResult[],
    execFileCalls: [] as Array<{ command: string; args: string[]; options?: ExecFileOptions }>,
    createChildProcess(): MockChildProcess {
      const stdout = new EventEmitter();
      const stderr = new EventEmitter();
      const child = new EventEmitter() as MockChildProcess;
      child.stdout = stdout;
      child.stderr = stderr;
      child.kill = vi.fn().mockReturnValue(true);
      child.pid = Date.now();
      return child;
    },
    execMock: vi.fn((command: string, optionsOrCb?: ExecOptions | ExecCallback, maybeCb?: ExecCallback) => {
      const callback: ExecCallback | undefined = typeof optionsOrCb === 'function' ? optionsOrCb : maybeCb;
      const result = state.execQueue.length
        ? state.execQueue.shift()!
        : ({ stdout: 'codex 1.0', stderr: '' } satisfies ExecResult);
      const execError = (result.error ?? null) as ExecException | null;
      if (result.error) {
        callback?.(execError, result.stdout ?? '', result.stderr ?? '');
      } else {
        callback?.(null, result.stdout ?? '', result.stderr ?? '');
      }
      return state.createChildProcess();
    }),
    execFileMock: vi.fn(
      (
        command: string,
        argsOrOptions?: string[] | ExecFileCallback | ExecFileOptions,
        optionsOrCb?: ExecFileOptions | ExecFileCallback,
        maybeCb?: ExecFileCallback
      ) => {
        let actualArgs: string[] = [];
        let options: ExecFileOptions | undefined;
        let callback: ExecFileCallback | undefined;

        if (Array.isArray(argsOrOptions)) {
          actualArgs = argsOrOptions;
        } else if (typeof argsOrOptions === 'function') {
          callback = argsOrOptions;
        } else if (argsOrOptions) {
          options = argsOrOptions;
        }

        if (typeof optionsOrCb === 'function') {
          callback = optionsOrCb;
        } else if (optionsOrCb) {
          options = optionsOrCb;
        }

        if (maybeCb) {
          callback = maybeCb;
        }

        state.execFileCalls.push({ command, args: actualArgs, options });
        const result = state.execFileQueue.length
          ? state.execFileQueue.shift()!
          : ({ stdout: 'ok', stderr: '' } satisfies ExecResult);
        const execFileError = (result.error ?? null) as ExecFileException | null;
        if (result.error) {
          callback?.(execFileError, result.stdout ?? '', result.stderr ?? '');
        } else {
          callback?.(null, result.stdout ?? '', result.stderr ?? '');
        }
        return state.createChildProcess();
      }
    ),
    spawnMock: vi.fn((command: string, args: string[], options?: SpawnOptions) => {
      const child = state.createChildProcess();
      const resolvedOptions: SpawnOptions = options ?? {};
      state.spawnCalls.push({ command, args, options: resolvedOptions, child });
      return child;
    }),
    reset() {
      state.spawnCalls.length = 0;
      state.execQueue.length = 0;
      state.execFileQueue.length = 0;
      state.execFileCalls.length = 0;
      state.execMock.mockClear();
      state.execFileMock.mockClear();
      state.spawnMock.mockClear();
    },
  };
  return state;
});

const fsState = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { EventEmitter } = require('events') as typeof import('events');
  class MemoryWriteStream extends EventEmitter {
    destroyed = false;

    constructor(private readonly filePath: string, private readonly files: Map<string, string>) {
      super();
      this.files.set(this.filePath, '');
    }

    write(chunk: string) {
      const previous = this.files.get(this.filePath) ?? '';
      this.files.set(this.filePath, previous + chunk);
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

  return {
    files,
    directories,
    streams,
    createWriteStream: vi.fn((filePath: string) => {
      const stream = new MemoryWriteStream(filePath, files);
      streams.set(filePath, stream);
      return stream;
    }),
    existsSync: vi.fn((target: string) => directories.has(target) || files.has(target)),
    mkdirSync: vi.fn((target: string) => {
      directories.add(target);
    }),
    readFileSync: vi.fn((filePath: string) => {
      if (!files.has(filePath)) {
        const error = new Error(`ENOENT: ${filePath}`) as NodeJS.ErrnoException;
        error.code = 'ENOENT';
        throw error;
      }
      return files.get(filePath) ?? '';
    }),
    statSync: vi.fn(() => ({ isFile: () => true })),
    reset() {
      files.clear();
      directories.clear();
      streams.clear();
      fsState.createWriteStream.mockClear();
      fsState.existsSync.mockClear();
      fsState.mkdirSync.mockClear();
      fsState.readFileSync.mockClear();
      fsState.statSync.mockClear();
    },
  };
});

const databaseState = vi.hoisted(() => {
  const state = {
    saveMessage: vi.fn().mockResolvedValue(undefined as void),
    reset() {
      state.saveMessage.mockReset();
    },
  };
  return state;
});

const appState = vi.hoisted(() => {
  const state = {
    userDataPath: '/tmp/emdash-tests',
    getPath: vi.fn((key: string) => (key === 'userData' ? state.userDataPath : state.userDataPath)),
    reset() {
      state.userDataPath = '/tmp/emdash-tests';
      state.getPath.mockClear();
    },
  };
  return state;
});

const logState = vi.hoisted(() => {
  const state = {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    reset() {
      state.info.mockClear();
      state.debug.mockClear();
      state.warn.mockClear();
      state.error.mockClear();
    },
  };
  return state;
});

vi.mock('child_process', () => ({
  spawn: childProcessState.spawnMock,
  exec: childProcessState.execMock,
  execFile: childProcessState.execFileMock,
}));

vi.mock('fs', () => ({
  createWriteStream: fsState.createWriteStream,
  existsSync: fsState.existsSync,
  mkdirSync: fsState.mkdirSync,
  readFileSync: fsState.readFileSync,
  statSync: fsState.statSync,
}));

vi.mock('electron', () => ({
  app: {
    getPath: appState.getPath,
  },
}));

vi.mock('../../main/services/DatabaseService', () => ({
  databaseService: databaseState,
}));

vi.mock('../../main/lib/logger', () => ({
  log: logState,
}));

// eslint-disable-next-line import/first
import { CodexService } from '../../main/services/CodexService';

interface ServiceInternals {
  agents: Map<string, CodexAgent>;
  runningProcesses: Map<string, MockChildProcess>;
  streamLogWriters: Map<string, NodeJS.WritableStream & { destroyed?: boolean }>;
  pendingCancellationLogs: Set<string>;
  activeConversations: Map<string, string>;
  isCodexInstalled: boolean | null;
  buildCodexExecArgs(message: string): string[];
  initializeStreamLog(workspaceId: string, agent: CodexAgent, prompt: string): void;
  appendStreamLog(workspaceId: string, content: string): void;
  finalizeStreamLog(workspaceId: string): void;
  getStreamLogPath(agent: CodexAgent): string;
}

function internals(service: CodexService): ServiceInternals {
  return service as unknown as ServiceInternals;
}

function buildAgent(overrides: Partial<CodexAgent> = {}): CodexAgent {
  return {
    id: overrides.id ?? `agent-${Math.random().toString(36).slice(2, 8)}`,
    workspaceId: overrides.workspaceId ?? 'workspace-test',
    worktreePath: overrides.worktreePath ?? '/repo/demo',
    status: overrides.status ?? 'idle',
    lastMessage: overrides.lastMessage,
    lastResponse: overrides.lastResponse,
  };
}

function buildResponse(overrides: Partial<CodexResponse> = {}): CodexResponse {
  return {
    success: overrides.success ?? true,
    output: overrides.output,
    error: overrides.error,
    agentId: overrides.agentId ?? 'agent-default',
  };
}

async function flushAsync() {
  await Promise.resolve();
  await Promise.resolve();
}

async function createService(options: { installed?: boolean } = {}): Promise<CodexService> {
  const service = new CodexService();
  await flushAsync();
  if (typeof options.installed === 'boolean') {
    internals(service).isCodexInstalled = options.installed;
  }
  return service;
}

function registerAgent(service: CodexService, overrides: Partial<CodexAgent> = {}): CodexAgent {
  const agent = buildAgent(overrides);
  internals(service).agents.set(agent.id, agent);
  return agent;
}

describe('CodexService', () => {
  const envBackup: Record<string, string | undefined> = {};

  beforeEach(() => {
    childProcessState.reset();
    fsState.reset();
    databaseState.reset();
    appState.reset();
    logState.reset();
    for (const key of trackedEnvVars) {
      envBackup[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of trackedEnvVars) {
      if (envBackup[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = envBackup[key] as string;
      }
    }
  });

  describe('buildCodexExecArgs', () => {
    it('应该在默认情况下使用 workspace-write sandbox', async () => {
      // Arrange
      const service = await createService();

      // Act
      const args = internals(service).buildCodexExecArgs('运行脚本');

      // Assert
      expect(args).toEqual(['exec', '--sandbox', 'workspace-write', '运行脚本']);
    });

    it('应该在危险模式下启用 bypass 参数', async () => {
      // Arrange
      process.env.CODEX_DANGEROUSLY_BYPASS = 'true';
      const service = await createService();

      // Act
      const args = internals(service).buildCodexExecArgs('ls');

      // Assert
      expect(args).toEqual(['exec', '--dangerously-bypass-approvals-and-sandbox', 'ls']);
    });

    it('应该根据 sandbox 和 approval 环境变量构建参数', async () => {
      // Arrange
      process.env.CODEX_SANDBOX_MODE = 'read-only';
      process.env.CODEX_APPROVAL_POLICY = 'on-request';
      const service = await createService();

      // Act
      const args = internals(service).buildCodexExecArgs('node cli');

      // Assert
      expect(args).toEqual([
        'exec',
        '--sandbox',
        'read-only',
        '--approval',
        'on-request',
        'node cli',
      ]);
    });

    it('应该在 danger-full-access sandbox 时强制 bypass', async () => {
      // Arrange
      process.env.CODEX_SANDBOX_MODE = 'danger-full-access';
      const service = await createService();

      // Act
      const args = internals(service).buildCodexExecArgs('status');

      // Assert
      expect(args).toEqual(['exec', '--dangerously-bypass-approvals-and-sandbox', 'status']);
    });
  });

  describe('Agent 管理', () => {
    it('应该创建 agent 并通过 getAgentStatus 返回', async () => {
      // Arrange
      const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
      const service = await createService();

      // Act
      const agent = await service.createAgent('workspace-a', '/repo/a');

      // Assert
      expect(agent.id).toBe('agent-workspace-a-1700000000000');
      expect(service.getAgentStatus('workspace-a')).toEqual(agent);
      expect(service.getAllAgents()).toHaveLength(1);
      nowSpy.mockRestore();
    });

    it('应该在移除 agent 后返回空状态', async () => {
      // Arrange
      const service = await createService();
      await service.createAgent('workspace-remove', '/repo/remove');

      // Act
      const removed = service.removeAgent('workspace-remove');

      // Assert
      expect(removed).toBe(true);
      expect(service.getAgentStatus('workspace-remove')).toBeNull();
      expect(service.getAllAgents()).toHaveLength(0);
    });
  });

  describe('getInstallationStatus', () => {
    it('应该在未知状态下触发 CLI 检测', async () => {
      // Arrange
      const service = await createService();
      childProcessState.execMock.mockClear();
      internals(service).isCodexInstalled = null;

      // Act
      const installed = await service.getInstallationStatus();

      // Assert
      expect(installed).toBe(true);
      expect(childProcessState.execMock).toHaveBeenCalledTimes(1);
    });

    it('应该缓存检测结果避免重复执行', async () => {
      // Arrange
      const service = await createService();
      childProcessState.execMock.mockClear();

      // Act
      const status = await service.getInstallationStatus();

      // Assert
      expect(status).toBe(true);
      expect(childProcessState.execMock).not.toHaveBeenCalled();
    });

    it('应该在 CLI 缺失时返回 false 并记录', async () => {
      // Arrange
      const error = Object.assign(new Error('missing'), { code: 'ENOENT' }) as NodeJS.ErrnoException;
      const service = await createService();
      childProcessState.execMock.mockClear();
      internals(service).isCodexInstalled = null;
      childProcessState.execQueue.push({ error });

      // Act
      const status = await service.getInstallationStatus();

      // Assert
      expect(status).toBe(false);
      expect(childProcessState.execMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('sendMessage', () => {
    it('应该执行命令并返回成功输出', async () => {
      // Arrange
      const service = await createService({ installed: true });
      const agent = await service.createAgent('workspace-send', '/repo/send');
      childProcessState.execFileQueue.push({ stdout: '完成\n', stderr: '' });

      // Act
      const response = await service.sendMessage(agent.workspaceId, 'echo hi');

      // Assert
      expect(response).toEqual(
        buildResponse({ agentId: agent.id, success: true, output: '完成\n', error: undefined })
      );
      const call = childProcessState.execFileCalls.at(0);
      expect(call).toMatchObject({ command: 'codex', args: expect.arrayContaining(['exec']) });
    });

    it('应该在 CLI 未安装时直接报错', async () => {
      // Arrange
      const service = await createService({ installed: false });
      const agent = await service.createAgent('workspace-no-cli', '/repo/no-cli');

      // Act
      const response = await service.sendMessage(agent.workspaceId, 'run tests');

      // Assert
      expect(response.success).toBe(false);
      expect(response.error).toMatch(/Codex CLI is not installed/);
      expect(response.agentId).toBe(agent.id);
    });

    it('应该将 ENOENT 错误转化为友好提示', async () => {
      // Arrange
      const service = await createService({ installed: true });
      const agent = await service.createAgent('workspace-enoent', '/repo/enoent');
      const error = Object.assign(new Error('ENOENT'), { code: 'ENOENT' }) as NodeJS.ErrnoException;
      childProcessState.execFileQueue.push({ error, stdout: '', stderr: '' });

      // Act
      const response = await service.sendMessage(agent.workspaceId, 'ls');

      // Assert
      expect(response.success).toBe(false);
      expect(response.error).toMatch(/Codex CLI not found/);
      expect(internals(service).agents.get(agent.id)?.status).toBe('error');
    });

    it('应该在超时错误时返回特定消息', async () => {
      // Arrange
      const service = await createService({ installed: true });
      const agent = await service.createAgent('workspace-timeout', '/repo/timeout');
      const error = Object.assign(new Error('TIMEOUT'), { code: 'TIMEOUT' }) as NodeJS.ErrnoException;
      childProcessState.execFileQueue.push({ error, stdout: '', stderr: '' });

      // Act
      const response = await service.sendMessage(agent.workspaceId, 'sleep 120');

      // Assert
      expect(response.success).toBe(false);
      expect(response.error).toBe('Codex command timed out');
    });
  });

  describe('sendMessageStream', () => {
    it('应该在缺少 agent 时触发错误事件', async () => {
      // Arrange
      const service = await createService({ installed: true });
      const errorSpy = vi.fn();
      service.on('codex:error', errorSpy);

      // Act
      await service.sendMessageStream('unknown-workspace', 'help me');

      // Assert
      expect(errorSpy).toHaveBeenCalledWith({
        workspaceId: 'unknown-workspace',
        error: 'No agent found for this workspace',
      });
    });

    it('应该在 CLI 未安装时写入日志并返回', async () => {
      // Arrange
      const service = await createService({ installed: false });
      const agent = registerAgent(service, { workspaceId: 'workspace-log', worktreePath: '/repo/log' });
      const errorSpy = vi.fn();
      service.on('codex:error', errorSpy);

      // Act
      await service.sendMessageStream(agent.workspaceId, 'diagnose issue');

      // Assert
      expect(errorSpy).toHaveBeenCalledWith({
        workspaceId: agent.workspaceId,
        error: 'Codex CLI is not installed. Please install it with: npm install -g @openai/codex',
      });
      const logPath = internals(service).getStreamLogPath(agent);
      expect(fsState.files.get(logPath)).toMatch(/Codex CLI is not installed/);
    });

    it('应该流式输出 stdout/stderr 并保存消息', async () => {
      // Arrange
      const service = await createService({ installed: true });
      const agent = registerAgent(service, { workspaceId: 'workspace-stream', worktreePath: '/repo/stream' });
      const outputSpy = vi.fn();
      const errSpy = vi.fn();
      const completeSpy = vi.fn();
      service.on('codex:output', outputSpy);
      service.on('codex:error', errSpy);
      service.on('codex:complete', completeSpy);

      // Act
      await service.sendMessageStream(agent.workspaceId, 'explain code', 'conversation-1');
      const spawnCall = childProcessState.spawnCalls[0];
      expect(spawnCall.command).toBe('codex');
      expect(spawnCall.options.cwd).toBe(agent.worktreePath);
      spawnCall.child.stdout.emit('data', Buffer.from('第一段输出\n'));
      spawnCall.child.stderr.emit('data', Buffer.from('警告'));
      await flushAsync();
      spawnCall.child.emit('close', 0);
      await flushAsync();

      // Assert
      expect(outputSpy).toHaveBeenCalled();
      expect(errSpy).toHaveBeenCalledWith({
        workspaceId: agent.workspaceId,
        error: '警告',
        agentId: agent.id,
        conversationId: 'conversation-1',
      });
      expect(completeSpy).toHaveBeenCalledWith({
        workspaceId: agent.workspaceId,
        exitCode: 0,
        agentId: agent.id,
        conversationId: 'conversation-1',
      });
      expect(databaseState.saveMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: 'conversation-1',
          content: '第一段输出',
          sender: 'agent',
        })
      );
      const logPath = internals(service).getStreamLogPath(agent);
      const logContent = fsState.files.get(logPath) ?? '';
      expect(logContent).toMatch(/\[COMPLETE] exit code 0/);
      expect(service.getActiveConversationId(agent.workspaceId)).toBeUndefined();
      expect(internals(service).runningProcesses.size).toBe(0);
    });

    it('应该在 spawn 错误时设置 agent 状态为 error', async () => {
      // Arrange
      const service = await createService({ installed: true });
      const agent = registerAgent(service, { workspaceId: 'workspace-error' });
      const errorSpy = vi.fn();
      service.on('codex:error', errorSpy);
      childProcessState.spawnMock.mockImplementationOnce(() => {
        throw new Error('spawn failed');
      });

      // Act
      await service.sendMessageStream(agent.workspaceId, 'fail please');

      // Assert
      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: agent.workspaceId,
          error: 'spawn failed',
          agentId: agent.id,
        })
      );
      expect(internals(service).agents.get(agent.id)?.status).toBe('error');
    });

    it('应该在子进程 error 事件时清理状态', async () => {
      // Arrange
      const service = await createService({ installed: true });
      const agent = registerAgent(service, { workspaceId: 'workspace-child-error' });
      const errorSpy = vi.fn();
      service.on('codex:error', errorSpy);

      // Act
      await service.sendMessageStream(agent.workspaceId, 'handle error');
      const spawnCall = childProcessState.spawnCalls[0];
      spawnCall.child.emit('error', new Error('child crash'));
      await flushAsync();

      // Assert
      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: agent.workspaceId,
          error: 'child crash',
          agentId: agent.id,
        })
      );
      expect(internals(service).runningProcesses.size).toBe(0);
      expect(internals(service).agents.get(agent.id)?.status).toBe('error');
    });
  });

  describe('stopMessageStream', () => {
    it('应该在没有运行进程时立即返回', async () => {
      // Arrange
      const service = await createService({ installed: true });

      // Act
      const result = await service.stopMessageStream('unknown');

      // Assert
      expect(result).toBe(true);
    });

    it('应该发送信号并写入取消日志', async () => {
      // Arrange
      const service = await createService({ installed: true });
      const agent = registerAgent(service, { workspaceId: 'workspace-stop' });
      internals(service).initializeStreamLog(agent.workspaceId, agent, 'prompt');
      const process = childProcessState.createChildProcess();
      internals(service).runningProcesses.set(agent.workspaceId, process);
      internals(service).activeConversations.set(agent.workspaceId, 'conversation-stop');

      // Act
      const resultPromise = service.stopMessageStream(agent.workspaceId);
      process.emit('close');
      const result = await resultPromise;

      // Assert
      expect(result).toBe(true);
      const logPath = internals(service).getStreamLogPath(agent);
      expect(fsState.files.get(logPath)).toMatch(/\[CANCELLED]/);
      expect(internals(service).streamLogWriters.has(agent.workspaceId)).toBe(false);
      expect(service.getActiveConversationId(agent.workspaceId)).toBeUndefined();
    });

    it('应该在进程缺失时吞掉 ESRCH 异常', async () => {
      // Arrange
      const service = await createService({ installed: true });
      const agent = registerAgent(service, { workspaceId: 'workspace-esrch' });
      const process = childProcessState.createChildProcess();
      process.kill.mockImplementation(() => {
        const error = Object.assign(new Error('missing'), { code: 'ESRCH' }) as NodeJS.ErrnoException;
        throw error;
      });
      internals(service).runningProcesses.set(agent.workspaceId, process);

      // Act
      const result = await service.stopMessageStream(agent.workspaceId);

      // Assert
      expect(result).toBe(true);
      expect(internals(service).runningProcesses.size).toBe(0);
    });
  });

  describe('getStreamInfo', () => {
    it('应该返回当前日志尾部和开始时间', async () => {
      // Arrange
      const service = await createService({ installed: true });
      const agent = registerAgent(service, { workspaceId: 'workspace-tail' });
      const logPath = internals(service).getStreamLogPath(agent);
      const logContent = [
        '=== Codex Stream 2024-05-01T10:00:00.000Z ===',
        'Workspace ID: workspace-tail',
        '',
        '--- Output ---',
        '',
        '最后输出',
        '',
        '[COMPLETE] exit code 0',
      ].join('\n');
      fsState.files.set(logPath, logContent);
      internals(service).runningProcesses.set(agent.workspaceId, childProcessState.createChildProcess());

      // Act
      const info = service.getStreamInfo(agent.workspaceId);

      // Assert
      expect(info.startedAt).toBe('2024-05-01T10:00:00.000Z');
      expect(info.tail).toContain('最后输出');
    });

    it('应该在没有运行进程时返回空串', async () => {
      // Arrange
      const service = await createService({ installed: true });

      // Act
      const info = service.getStreamInfo('no-process');

      // Assert
      expect(info).toEqual({ tail: '' });
    });
  });

  describe('日志写入工具', () => {
    it('应该初始化、追加并完成日志文件', async () => {
      // Arrange
      const service = await createService({ installed: true });
      const agent = registerAgent(service, { workspaceId: 'workspace-log-utils' });
      internals(service).pendingCancellationLogs.add(agent.workspaceId);

      // Act
      internals(service).initializeStreamLog(agent.workspaceId, agent, '测试 Prompt');
      internals(service).appendStreamLog(agent.workspaceId, '追加内容');
      internals(service).finalizeStreamLog(agent.workspaceId);

      // Assert
      const logPath = internals(service).getStreamLogPath(agent);
      const content = fsState.files.get(logPath) ?? '';
      expect(content).toMatch(/测试 Prompt/);
      expect(content).toMatch(/追加内容/);
      expect(internals(service).streamLogWriters.has(agent.workspaceId)).toBe(false);
      expect(internals(service).pendingCancellationLogs.has(agent.workspaceId)).toBe(false);
    });
  });

  describe('对话追踪', () => {
    it('应该跟踪活动会话并在完成后清理', async () => {
      // Arrange
      const service = await createService({ installed: true });
      const agent = registerAgent(service, { workspaceId: 'workspace-conv' });

      // Act
      await service.sendMessageStream(agent.workspaceId, 'trace chat', 'conversation-xyz');
      const spawnCall = childProcessState.spawnCalls[0];
      expect(service.getActiveConversationId(agent.workspaceId)).toBe('conversation-xyz');
      spawnCall.child.emit('close', 0);
      await flushAsync();

      // Assert
      expect(service.getActiveConversationId(agent.workspaceId)).toBeUndefined();
    });
  });
});
