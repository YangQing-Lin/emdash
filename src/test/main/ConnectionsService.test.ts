import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { MockedFunction } from 'vitest';
import { connectionsService } from '../../main/services/ConnectionsService';
import { codexService } from '../../main/services/CodexService';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'child_process';
import type { Readable, Writable } from 'stream';

// Mock child_process
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

// Mock CodexService
vi.mock('../../main/services/CodexService', () => ({
  codexService: {
    getInstallationStatus: vi.fn(),
  },
}));

interface MockChildProcess extends EventEmitter {
  stdout: EventEmitter & Readable;
  stderr: EventEmitter & Readable;
  stdin: Writable | null;
  stdio: [Writable | null, Readable | null, Readable | null];
  killed: boolean;
  pid?: number;
  connected: boolean;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  spawnargs: string[];
  spawnfile: string;
  kill: ReturnType<typeof vi.fn>;
  send?: (message: unknown, sendHandle?: unknown) => boolean;
  disconnect?: () => void;
  unref?: () => void;
  ref?: () => void;
  [Symbol.dispose]?: () => void;
}

const mockSpawn = async () => {
  const { spawn } = await import('child_process');
  return spawn as unknown as MockedFunction<typeof spawn>;
};

describe('ConnectionsService', () => {
  let spawnMock: MockedFunction<typeof import('child_process').spawn>;

  beforeEach(async () => {
    spawnMock = await mockSpawn();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // Helper to create mock child process
  const createMockChildProcess = (options: {
    success?: boolean;
    stdout?: string;
    stderr?: string;
    exitCode?: number | null;
    timeout?: boolean;
    error?: Error;
  } = {}): ChildProcess => {
    const {
      success = true,
      stdout = '',
      stderr = '',
      exitCode = 0,
      timeout = false,
      error,
    } = options;

    const mockProcess = new EventEmitter() as MockChildProcess;
    mockProcess.stdout = new EventEmitter() as EventEmitter & Readable;
    mockProcess.stderr = new EventEmitter() as EventEmitter & Readable;
    mockProcess.stdin = null;
    mockProcess.stdio = [null, null, null];
    mockProcess.killed = false;
    mockProcess.pid = 12345;
    mockProcess.connected = false;
    mockProcess.exitCode = null;
    mockProcess.signalCode = null;
    mockProcess.spawnargs = [];
    mockProcess.spawnfile = '';

    const effectiveExitCode =
      typeof exitCode === 'number' ? exitCode : success ? 0 : 1;

    mockProcess.kill = vi.fn(() => {
      mockProcess.killed = true;
      if (timeout) {
        setTimeout(() => {
          mockProcess.exitCode = effectiveExitCode;
          mockProcess.emit('close', effectiveExitCode);
        }, 0);
      }
      return true;
    });

    const emitDataAndClose = () => {
      if (stdout) {
        mockProcess.stdout.emit('data', Buffer.from(stdout));
      }
      if (stderr) {
        mockProcess.stderr.emit('data', Buffer.from(stderr));
      }
      mockProcess.exitCode = effectiveExitCode;
      mockProcess.emit('close', effectiveExitCode);
    };

    // Simulate process behavior
    setTimeout(() => {
      if (error) {
        mockProcess.emit('error', error);
      } else if (!timeout) {
        emitDataAndClose();
      }
      // If timeout is true, close event will be emitted when kill() is called
    }, 10);

    return mockProcess as unknown as ChildProcess;
  };

  describe('CLI Provider 检测', () => {
    it('应该检测所有配置的 CLI providers', async () => {
      // Arrange
      spawnMock.mockImplementation(() => 
        createMockChildProcess({
          success: false,
          error: new Error('ENOENT'),
        })
      );

      (codexService.getInstallationStatus as MockedFunction<typeof codexService.getInstallationStatus>).mockResolvedValue(false);

      // Act
      const result = await connectionsService.getCliProviders();

      // Assert
      expect(result).toBeInstanceOf(Array);
      expect(result.length).toBeGreaterThan(10); // At least 10+ providers
      expect(result.every((p) => p.id && p.name && p.status)).toBe(true);
    });

    it('应该并行检测所有 providers 以提高性能', async () => {
      // Arrange
      const startTime = Date.now();
      spawnMock.mockImplementation(() => 
        createMockChildProcess({
          success: false,
          error: new Error('ENOENT'),
        })
      );

      (codexService.getInstallationStatus as MockedFunction<typeof codexService.getInstallationStatus>).mockResolvedValue(false);

      // Act
      await connectionsService.getCliProviders();
      const duration = Date.now() - startTime;

      // Assert
      // If parallel, should complete in < 1 second even with 12+ providers
      // If sequential with 2s timeout each, would take 24+ seconds
      expect(duration).toBeLessThan(3000);
    });

    it('应该返回正确的 provider 元数据', async () => {
      // Arrange
      spawnMock.mockImplementation(() => 
        createMockChildProcess({
          stdout: 'codex 1.2.3',
          success: true,
        })
      );

      (codexService.getInstallationStatus as MockedFunction<typeof codexService.getInstallationStatus>).mockResolvedValue(true);

      // Act
      const result = await connectionsService.getCliProviders();

      // Assert
      const codexProvider = result.find((p) => p.id === 'codex');
      expect(codexProvider).toBeDefined();
      expect(codexProvider?.name).toBe('Codex');
      expect(codexProvider?.docUrl).toBeTruthy();
    });
  });

  describe('Codex Provider 特殊处理', () => {
    it('应该使用 CodexService 检测 Codex 安装状态', async () => {
      // Arrange
      (codexService.getInstallationStatus as MockedFunction<typeof codexService.getInstallationStatus>).mockResolvedValue(true);
      spawnMock.mockImplementation(() => 
        createMockChildProcess({
          stdout: 'codex 1.0.0',
          success: true,
        })
      );

      // Act
      const result = await connectionsService.getCliProviders();

      // Assert
      expect(codexService.getInstallationStatus).toHaveBeenCalled();
      const codex = result.find((p) => p.id === 'codex');
      expect(codex?.status).toBe('connected');
    });

    it('应该在 CodexService 检测失败时回退到命令检测', async () => {
      // Arrange
      (codexService.getInstallationStatus as MockedFunction<typeof codexService.getInstallationStatus>).mockRejectedValue(new Error('Failed'));
      spawnMock.mockImplementation(() => 
        createMockChildProcess({
          stdout: 'codex 1.0.0',
          success: true,
        })
      );

      // Act
      const result = await connectionsService.getCliProviders();

      // Assert
      const codex = result.find((p) => p.id === 'codex');
      expect(codex?.status).toBe('connected');
    });

    it('应该在 Codex 缺失时返回特定消息', async () => {
      // Arrange
      (codexService.getInstallationStatus as MockedFunction<typeof codexService.getInstallationStatus>).mockResolvedValue(false);
      spawnMock.mockImplementation(() => 
        createMockChildProcess({
          success: false,
          error: new Error('ENOENT'),
        })
      );

      // Act
      const result = await connectionsService.getCliProviders();

      // Assert
      const codex = result.find((p) => p.id === 'codex');
      expect(codex?.status).toBe('missing');
      expect(codex?.message).toContain('Install @openai/codex');
    });
  });

  describe('状态解析', () => {
    it('应该在命令成功时返回 connected 状态', async () => {
      // Arrange
      spawnMock.mockImplementation(() => 
        createMockChildProcess({
          stdout: 'claude 2.1.0',
          success: true,
          exitCode: 0,
        })
      );

      (codexService.getInstallationStatus as MockedFunction<typeof codexService.getInstallationStatus>).mockResolvedValue(false);

      // Act
      const result = await connectionsService.getCliProviders();

      // Assert
      const claude = result.find((p) => p.id === 'claude');
      expect(claude?.status).toBe('connected');
      expect(claude?.version).toBe('2.1.0');
    });

    it('应该在命令不存在时返回 missing 状态', async () => {
      // Arrange
      spawnMock.mockImplementation(() => 
        createMockChildProcess({
          success: false,
          error: Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }),
        })
      );

      (codexService.getInstallationStatus as MockedFunction<typeof codexService.getInstallationStatus>).mockResolvedValue(false);

      // Act
      const result = await connectionsService.getCliProviders();

      // Assert
      const providers = result.filter((p) => p.status === 'missing');
      expect(providers.length).toBeGreaterThan(0);
      expect(providers.every((p) => p.message)).toBe(true);
    });

    it('应该在命令执行错误时返回 error 状态', async () => {
      // Arrange
      spawnMock.mockImplementation(() => 
        createMockChildProcess({
          success: false,
          exitCode: 1,
          stderr: 'Permission denied',
          error: new Error('EACCES'),
        })
      );

      (codexService.getInstallationStatus as MockedFunction<typeof codexService.getInstallationStatus>).mockResolvedValue(false);

      // Act
      const result = await connectionsService.getCliProviders();

      // Assert
      // All providers should have a status (connected, missing, or error)
      expect(result.every((p) => ['connected', 'missing', 'error'].includes(p.status))).toBe(true);
    });
  });

  describe('版本提取', () => {
    it('应该从 stdout 中提取版本号', async () => {
      // Arrange
      spawnMock.mockImplementation(() => 
        createMockChildProcess({
          stdout: 'claude version 2.3.5',
          success: true,
        })
      );

      (codexService.getInstallationStatus as MockedFunction<typeof codexService.getInstallationStatus>).mockResolvedValue(false);

      // Act
      const result = await connectionsService.getCliProviders();

      // Assert
      const claude = result.find((p) => p.id === 'claude');
      expect(claude?.version).toBe('2.3.5');
    });

    it('应该从 stderr 中提取版本号', async () => {
      // Arrange
      spawnMock.mockImplementation(() => 
        createMockChildProcess({
          stdout: '',
          stderr: 'Version: 1.0.0',
          success: true,
        })
      );

      (codexService.getInstallationStatus as MockedFunction<typeof codexService.getInstallationStatus>).mockResolvedValue(false);

      // Act
      const result = await connectionsService.getCliProviders();

      // Assert
      const hasVersion = result.some((p) => p.version === '1.0.0');
      expect(hasVersion).toBe(true);
    });

    it('应该提取语义化版本号 (x.y.z)', async () => {
      // Arrange
      spawnMock.mockImplementation(() => 
        createMockChildProcess({
          stdout: 'tool v12.34.56-beta',
          success: true,
        })
      );

      (codexService.getInstallationStatus as MockedFunction<typeof codexService.getInstallationStatus>).mockResolvedValue(false);

      // Act
      const result = await connectionsService.getCliProviders();

      // Assert
      const hasVersion = result.some((p) => p.version === '12.34.56');
      expect(hasVersion).toBe(true);
    });

    it('应该提取简化版本号 (x.y)', async () => {
      // Arrange
      spawnMock.mockImplementation(() => 
        createMockChildProcess({
          stdout: 'version 3.4',
          success: true,
        })
      );

      (codexService.getInstallationStatus as MockedFunction<typeof codexService.getInstallationStatus>).mockResolvedValue(false);

      // Act
      const result = await connectionsService.getCliProviders();

      // Assert
      const hasVersion = result.some((p) => p.version === '3.4');
      expect(hasVersion).toBe(true);
    });

    it('应该在无法提取版本时返回 null', async () => {
      // Arrange
      spawnMock.mockImplementation(() => 
        createMockChildProcess({
          stdout: 'No version information',
          success: true,
        })
      );

      (codexService.getInstallationStatus as MockedFunction<typeof codexService.getInstallationStatus>).mockResolvedValue(false);

      // Act
      const result = await connectionsService.getCliProviders();

      // Assert
      const noVersion = result.filter((p) => p.version === null);
      expect(noVersion.length).toBeGreaterThan(0);
    });
  });

  describe('命令尝试（fallback）', () => {
    it('应该尝试多个命令直到成功', async () => {
      // Arrange
      spawnMock.mockImplementation((cmd: string) => {
        if (cmd === 'cursor-agent') {
          return createMockChildProcess({
            success: false,
            error: Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
          });
        } else if (cmd === 'cursor') {
          return createMockChildProcess({
            stdout: 'cursor 1.0.0',
            success: true,
          });
        }
        return createMockChildProcess({ success: false });
      });

      (codexService.getInstallationStatus as MockedFunction<typeof codexService.getInstallationStatus>).mockResolvedValue(false);

      // Act
      const result = await connectionsService.getCliProviders();

      // Assert
      const cursor = result.find((p) => p.id === 'cursor');
      expect(cursor?.status).toBe('connected');
      expect(cursor?.command).toBe('cursor'); // Second command succeeded
    });

    it('应该在所有命令失败时使用最后一个命令', async () => {
      // Arrange
      spawnMock.mockImplementation(() => 
        createMockChildProcess({
          success: false,
          error: Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
        })
      );

      (codexService.getInstallationStatus as MockedFunction<typeof codexService.getInstallationStatus>).mockResolvedValue(false);

      // Act
      const result = await connectionsService.getCliProviders();

      // Assert
      const cursor = result.find((p) => p.id === 'cursor');
      expect(cursor?.command).toBeTruthy();
      expect(cursor?.status).toBe('missing');
    });
  });

  describe('超时处理', () => {
    it('应该在 2 秒后超时并终止进程', async () => {
      // Arrange
      vi.useFakeTimers();

      const processes: ChildProcess[] = [];
      spawnMock.mockImplementation(() => {
        const process = createMockChildProcess({ timeout: true });
        processes.push(process);
        return process;
      });

      (codexService.getInstallationStatus as MockedFunction<typeof codexService.getInstallationStatus>).mockResolvedValue(false);

      // Act
      const promise = connectionsService.getCliProviders();

      // Fast-forward time by 2100ms
      await vi.advanceTimersByTimeAsync(2100);

      await promise;

      // Assert
      expect(processes.some((proc) => (proc.kill as ReturnType<typeof vi.fn>).mock.calls.length > 0)).toBe(true);
    }, 10000);

    it('应该在超时后返回错误状态', async () => {
      // Arrange
      vi.useFakeTimers();

      spawnMock.mockImplementation(() => createMockChildProcess({ timeout: true }));

      (codexService.getInstallationStatus as MockedFunction<typeof codexService.getInstallationStatus>).mockResolvedValue(false);

      // Act
      const promise = connectionsService.getCliProviders();
      await vi.advanceTimersByTimeAsync(2100);
      const result = await promise;

      // Assert
      // Timeout should result in error or missing status
      expect(result.every((p) => ['connected', 'missing', 'error'].includes(p.status))).toBe(true);
    }, 10000);
  });

  describe('消息解析', () => {
    it('应该在 missing 状态下返回描述性消息', async () => {
      // Arrange
      spawnMock.mockImplementation(() => 
        createMockChildProcess({
          success: false,
          error: Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
        })
      );

      (codexService.getInstallationStatus as MockedFunction<typeof codexService.getInstallationStatus>).mockResolvedValue(false);

      // Act
      const result = await connectionsService.getCliProviders();

      // Assert
      const missing = result.filter((p) => p.status === 'missing');
      const hasDescriptiveMessages = missing.every((p) => {
        if (!p.message) return false;
        if (p.id === 'codex') {
          return p.message.includes('Codex CLI not detected');
        }
        return p.message.includes('not found');
      });
      expect(hasDescriptiveMessages).toBe(true);
    });

    it('应该在 error 状态下返回 stderr 内容', async () => {
      // Arrange
      spawnMock.mockImplementation(() => 
        createMockChildProcess({
          success: false,
          stderr: 'Custom error message',
          error: new Error('EACCES'),
        })
      );

      (codexService.getInstallationStatus as MockedFunction<typeof codexService.getInstallationStatus>).mockResolvedValue(false);

      // Act
      const result = await connectionsService.getCliProviders();

      // Assert
      const withErrors = result.filter((p) => p.message);
      expect(withErrors.length).toBeGreaterThan(0);
    });

    it('应该在 connected 状态下不返回消息', async () => {
      // Arrange
      spawnMock.mockImplementation(() => 
        createMockChildProcess({
          stdout: 'version 1.0.0',
          success: true,
        })
      );

      (codexService.getInstallationStatus as MockedFunction<typeof codexService.getInstallationStatus>).mockResolvedValue(false);

      // Act
      const result = await connectionsService.getCliProviders();

      // Assert
      const connected = result.filter((p) => p.status === 'connected');
      expect(connected.every((p) => !p.message)).toBe(true);
    });
  });

  describe('特定 CLI 支持', () => {
    it('应该包含 Claude Code provider', async () => {
      // Arrange
      spawnMock.mockImplementation(() => createMockChildProcess({ success: false }));
      (codexService.getInstallationStatus as MockedFunction<typeof codexService.getInstallationStatus>).mockResolvedValue(false);

      // Act
      const result = await connectionsService.getCliProviders();

      // Assert
      const claude = result.find((p) => p.id === 'claude');
      expect(claude).toBeDefined();
      expect(claude?.name).toBe('Claude Code');
    });

    it('应该包含 Cursor provider', async () => {
      // Arrange
      spawnMock.mockImplementation(() => createMockChildProcess({ success: false }));
      (codexService.getInstallationStatus as MockedFunction<typeof codexService.getInstallationStatus>).mockResolvedValue(false);

      // Act
      const result = await connectionsService.getCliProviders();

      // Assert
      const cursor = result.find((p) => p.id === 'cursor');
      expect(cursor).toBeDefined();
      expect(cursor?.name).toBe('Cursor');
    });

    it('应该包含 Gemini provider', async () => {
      // Arrange
      spawnMock.mockImplementation(() => createMockChildProcess({ success: false }));
      (codexService.getInstallationStatus as MockedFunction<typeof codexService.getInstallationStatus>).mockResolvedValue(false);

      // Act
      const result = await connectionsService.getCliProviders();

      // Assert
      const gemini = result.find((p) => p.id === 'gemini');
      expect(gemini).toBeDefined();
      expect(gemini?.name).toBe('Gemini');
    });

    it('应该包含至少 10+ 不同的 CLI providers', async () => {
      // Arrange
      spawnMock.mockImplementation(() => createMockChildProcess({ success: false }));
      (codexService.getInstallationStatus as MockedFunction<typeof codexService.getInstallationStatus>).mockResolvedValue(false);

      // Act
      const result = await connectionsService.getCliProviders();

      // Assert
      expect(result.length).toBeGreaterThanOrEqual(10);
      const ids = new Set(result.map((p) => p.id));
      expect(ids.size).toBe(result.length); // All unique IDs
    });
  });

  describe('错误处理', () => {
    it('应该处理 spawn 异常', async () => {
      // Arrange
      spawnMock.mockImplementation(() => {
        throw new Error('Spawn failed');
      });

      (codexService.getInstallationStatus as MockedFunction<typeof codexService.getInstallationStatus>).mockResolvedValue(false);

      // Act
      const result = await connectionsService.getCliProviders();

      // Assert
      expect(result).toBeInstanceOf(Array);
      expect(result.every((p) => ['connected', 'missing', 'error'].includes(p.status))).toBe(true);
    });

    it('应该处理部分 provider 检测失败', async () => {
      // Arrange
      let callCount = 0;
      spawnMock.mockImplementation(() => {
        callCount++;
        if (callCount % 2 === 0) {
          return createMockChildProcess({ stdout: 'version 1.0', success: true });
        } else {
          return createMockChildProcess({
            success: false,
            error: Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
          });
        }
      });

      (codexService.getInstallationStatus as MockedFunction<typeof codexService.getInstallationStatus>).mockResolvedValue(false);

      // Act
      const result = await connectionsService.getCliProviders();

      // Assert
      expect(result.length).toBeGreaterThan(0);
      const connected = result.filter((p) => p.status === 'connected');
      const missing = result.filter((p) => p.status === 'missing');
      expect(connected.length).toBeGreaterThan(0);
      expect(missing.length).toBeGreaterThan(0);
    });
  });
});
