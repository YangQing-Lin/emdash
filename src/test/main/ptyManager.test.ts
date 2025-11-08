import Module from 'module';
import os from 'os';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  IPty,
  IPtyForkOptions,
  IWindowsPtyForkOptions,
  IBasePtyForkOptions,
} from 'node-pty';

type MockRecord = {
  writes: string[];
  resizes: Array<{ cols: number; rows: number }>;
  killCount: number;
};

type SpawnOptionsRecord = (IPtyForkOptions | IWindowsPtyForkOptions) &
  Required<Pick<IBasePtyForkOptions, 'name' | 'cols' | 'rows' | 'cwd' | 'env'>>;

type SpawnCall = {
  shell: string;
  args: string[] | string;
  options: SpawnOptionsRecord;
  proc: IPty;
};

type PtyManagerModule = typeof import('../../main/services/ptyManager');
type NodePtyModule = Pick<typeof import('node-pty'), 'spawn'>;

const spawnMock = vi.fn<NodePtyModule['spawn']>();
const execSyncMock = vi.fn();
const existsSyncMock = vi.fn();
const warnMock = vi.fn();
const errorMock = vi.fn();

const originalEnv = { ...process.env };

let ptyRecords: WeakMap<IPty, MockRecord> = new WeakMap();
const spawnHistory: SpawnCall[] = [];

let startPty: PtyManagerModule['startPty'];
let writePty: PtyManagerModule['writePty'];
let resizePty: PtyManagerModule['resizePty'];
let killPty: PtyManagerModule['killPty'];
let hasPty: PtyManagerModule['hasPty'];
let getPty: PtyManagerModule['getPty'];
let platformSpy: ReturnType<typeof vi.spyOn>;

const createNodePtyModule = (): NodePtyModule => ({
  spawn: spawnMock,
});

let nodePtyFactory: () => NodePtyModule = createNodePtyModule;

const resolveNodePty = (): NodePtyModule => nodePtyFactory();

vi.mock('node-pty', () => resolveNodePty());
vi.mock('../../main/lib/logger', () => ({
  log: {
    warn: warnMock,
    error: errorMock,
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

const originalRequire = Module.prototype.require;

Module.prototype.require = function mockableRequire(this: NodeModule, id: string) {
  if (this && typeof this.id === 'string' && this.id.includes('ptyManager')) {
    if (id === 'node-pty') {
      return resolveNodePty();
    }
    if (id === 'child_process') {
      return { execSync: execSyncMock };
    }
    if (id === 'fs') {
      return { existsSync: existsSyncMock };
    }
  }
  return originalRequire.call(this, id);
};

afterAll(() => {
  Module.prototype.require = originalRequire;
});

const createMockPty = () => {
  const record: MockRecord = {
    writes: [],
    resizes: [],
    killCount: 0,
  };

  const proc = {
    pid: Math.floor(Math.random() * 10000),
    write: vi.fn((data: string) => {
      record.writes.push(data);
    }),
    resize: vi.fn((cols: number, rows: number) => {
      record.resizes.push({ cols, rows });
    }),
    kill: vi.fn(() => {
      record.killCount += 1;
    }),
  };

  return { proc: proc as unknown as IPty, record };
};

function configureSpawnDefault() {
  spawnMock.mockImplementation(
    (shell: string, args: string[] | string, options: IPtyForkOptions | IWindowsPtyForkOptions) => {
      const { proc, record } = createMockPty();
      ptyRecords.set(proc, record);
      const normalizedOptions = normalizeSpawnOptions(options);
      spawnHistory.push({ shell, args, options: normalizedOptions, proc });
      return proc;
    }
  );
}

function normalizeSpawnOptions(
  options: IPtyForkOptions | IWindowsPtyForkOptions
): SpawnOptionsRecord {
  return {
    ...options,
    name: options.name ?? '',
    cols: options.cols ?? Number.NaN,
    rows: options.rows ?? Number.NaN,
    cwd: options.cwd ?? '',
    env: options.env ?? process.env,
  };
}

function resetNodePtyFactory() {
  nodePtyFactory = createNodePtyModule;
}

function setNodePtyFactory(factory: () => NodePtyModule) {
  nodePtyFactory = factory;
}

async function importManager() {
  vi.resetModules();
  const mod = await import('../../main/services/ptyManager');
  startPty = mod.startPty;
  writePty = mod.writePty;
  resizePty = mod.resizePty;
  killPty = mod.killPty;
  hasPty = mod.hasPty;
  getPty = mod.getPty;
}

function lastSpawn(): SpawnCall {
  expect(spawnHistory.length).toBeGreaterThan(0);
  return spawnHistory[spawnHistory.length - 1]!;
}

function getRecord(id: string): MockRecord {
  const proc = getPty(id);
  expect(proc).toBeTruthy();
  const record = proc ? ptyRecords.get(proc) : undefined;
  if (!record) {
    throw new Error(`Missing record for ${id}`);
  }
  return record;
}

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  spawnMock.mockReset();
  execSyncMock.mockReset();
  existsSyncMock.mockReset();
  warnMock.mockReset();
  errorMock.mockReset();
  existsSyncMock.mockReturnValue(false);
  spawnHistory.length = 0;
  ptyRecords = new WeakMap();
  process.env = { ...originalEnv };
  platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
  resetNodePtyFactory();
  await importManager();
  configureSpawnDefault();
});

describe('ptyManager', () => {
  describe('startPty 基础能力', () => {
    it('应该调用 node-pty spawn 启动进程', () => {
      // Arrange
      process.env.SHELL = '/bin/zsh';

      // Act
      const proc = startPty({ id: 'pty-1' });

      // Assert
      expect(spawnMock).toHaveBeenCalledTimes(1);
      expect(lastSpawn().shell).toBe('/bin/zsh');
      expect(proc).toBe(lastSpawn().proc);
    });

    it('应该传递自定义 cwd', () => {
      // Arrange
      const cwd = '/tmp/project';

      // Act
      startPty({ id: 'pty-2', cwd });

      // Assert
      expect(lastSpawn().options.cwd).toBe(cwd);
    });

    it('应该合并环境变量', () => {
      // Arrange
      process.env.PATH = '/bin';
      const env = { CUSTOM_FLAG: 'yes' };

      // Act
      startPty({ id: 'pty-3', env });

      // Assert
      const { env: mergedEnv } = lastSpawn().options;
      expect(mergedEnv.TERM).toBe('xterm-256color');
      expect(mergedEnv.CUSTOM_FLAG).toBe('yes');
      expect(mergedEnv.PATH).toBe('/bin');
    });

    it('应该使用默认终端尺寸', () => {
      // Arrange
      process.env.SHELL = '/bin/bash';

      // Act
      startPty({ id: 'pty-4' });

      // Assert
      const { cols, rows } = lastSpawn().options;
      expect(cols).toBe(80);
      expect(rows).toBe(24);
    });

    it('应该使用自定义终端尺寸', () => {
      // Arrange
      const cols = 132;
      const rows = 50;

      // Act
      startPty({ id: 'pty-5', cols, rows });

      // Assert
      const call = lastSpawn();
      expect(call.options.cols).toBe(cols);
      expect(call.options.rows).toBe(rows);
    });

    it('应该返回 spawn 的同一个实例', () => {
      // Arrange
      process.env.SHELL = '/bin/bash';

      // Act
      const proc = startPty({ id: 'pty-6' });

      // Assert
      expect(proc).toBe(lastSpawn().proc);
    });

    it('应该把 PTY 保存到 Map', () => {
      // Arrange
      const id = 'pty-7';

      // Act
      startPty({ id });

      // Assert
      expect(hasPty(id)).toBe(true);
      expect(getPty(id)).toBe(lastSpawn().proc);
    });

    it('应该在缺少 cwd 时使用 process.cwd()', () => {
      // Arrange
      const cwdSpy = vi.spyOn(process, 'cwd');
      cwdSpy.mockReturnValue('/workspace');

      // Act
      startPty({ id: 'pty-8' });

      // Assert
      expect(lastSpawn().options.cwd).toBe('/workspace');
    });

    it('应该在 process.cwd 返回空字符串时 fallback 到家目录', () => {
      // Arrange
      vi.spyOn(process, 'cwd').mockReturnValue('');
      vi.spyOn(os, 'homedir').mockReturnValue('/home/mock');

      // Act
      startPty({ id: 'pty-9' });

      // Assert
      expect(lastSpawn().options.cwd).toBe('/home/mock');
    });
  });

  describe('startPty Shell 选择', () => {
    it('应该在 Windows 上默认使用 ComSpec', () => {
      // Arrange
      platformSpy.mockReturnValue('win32');
      process.env.ComSpec = 'C:\\Windows\\System32\\cmd.exe';

      // Act
      startPty({ id: 'shell-1' });

      // Assert
      expect(lastSpawn().shell).toBe('C:\\Windows\\System32\\cmd.exe');
    });

    it('应该在 Windows 上 fallback 到 PowerShell', () => {
      // Arrange
      platformSpy.mockReturnValue('win32');
      delete process.env.ComSpec;

      // Act
      startPty({ id: 'shell-2' });

      // Assert
      expect(lastSpawn().shell).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    });

    it('应该在 macOS 上使用 $SHELL', () => {
      // Arrange
      platformSpy.mockReturnValue('darwin');
      process.env.SHELL = '/bin/zsh';

      // Act
      startPty({ id: 'shell-3' });

      // Assert
      expect(lastSpawn().shell).toBe('/bin/zsh');
    });

    it('应该在 Linux 上使用 $SHELL', () => {
      // Arrange
      platformSpy.mockReturnValue('linux');
      process.env.SHELL = '/usr/bin/fish';

      // Act
      startPty({ id: 'shell-4' });

      // Assert
      expect(lastSpawn().shell).toBe('/usr/bin/fish');
    });

    it('应该在缺省时 fallback 到 /bin/bash', () => {
      // Arrange
      platformSpy.mockReturnValue('linux');
      delete process.env.SHELL;

      // Act
      startPty({ id: 'shell-5' });

      // Assert
      expect(lastSpawn().shell).toBe('/bin/bash');
    });

    it('应该优先使用自定义 shell 参数', () => {
      // Arrange
      platformSpy.mockReturnValue('linux');

      // Act
      startPty({ id: 'shell-6', shell: '/opt/custom-shell' });

      // Assert
      expect(lastSpawn().shell).toBe('/opt/custom-shell');
    });
  });

  describe('startPty Shell 参数', () => {
    it('应该为 zsh 添加 -il 参数', () => {
      // Arrange
      process.env.SHELL = '/bin/zsh';

      // Act
      startPty({ id: 'args-1' });

      // Assert
      expect(lastSpawn().args).toEqual(['-il']);
    });

    it('应该为 bash 添加 --noprofile --norc -i 参数', () => {
      // Arrange
      process.env.SHELL = '/bin/bash';

      // Act
      startPty({ id: 'args-2' });

      // Assert
      expect(lastSpawn().args).toEqual(['--noprofile', '--norc', '-i']);
    });

    it('应该为 fish 添加 -i 参数', () => {
      // Arrange
      process.env.SHELL = '/usr/bin/fish';

      // Act
      startPty({ id: 'args-3' });

      // Assert
      expect(lastSpawn().args).toEqual(['-i']);
    });

    it('应该为 sh 添加 -i 参数', () => {
      // Arrange
      process.env.SHELL = '/bin/sh';

      // Act
      startPty({ id: 'args-4' });

      // Assert
      expect(lastSpawn().args).toEqual(['-i']);
    });

    it('应该为 codex CLI 不添加任何参数', () => {
      // Arrange
      process.env.SHELL = '/usr/local/bin/codex';

      // Act
      startPty({ id: 'args-5' });

      // Assert
      expect(lastSpawn().args).toEqual([]);
    });

    it('应该为 claude CLI 不添加任何参数', () => {
      // Arrange
      process.env.SHELL = '/usr/local/bin/claude';

      // Act
      startPty({ id: 'args-6' });

      // Assert
      expect(lastSpawn().args).toEqual([]);
    });
  });

  describe('startPty Windows 路径解析', () => {
    it('应该优先调用 where <cli>.cmd', () => {
      // Arrange
      platformSpy.mockReturnValue('win32');
      execSyncMock.mockImplementation((cmd: string) => {
        expect(cmd).toBe('where codex.cmd');
        return 'C:\\Tools\\codex.cmd\r\n';
      });

      // Act
      startPty({ id: 'win-1', shell: 'codex' });

      // Assert
      expect(lastSpawn().shell).toBe('C:\\Tools\\codex.cmd');
      expect(execSyncMock).toHaveBeenCalledTimes(1);
    });

    it('应该在 .cmd 缺失时 fallback 到无扩展 where', () => {
      // Arrange
      platformSpy.mockReturnValue('win32');
      execSyncMock.mockImplementation((cmd: string) => {
        if (cmd.includes('.cmd')) {
          throw new Error('not found');
        }
        return 'C:\\Tools\\codex.exe\r\n';
      });

      // Act
      startPty({ id: 'win-2', shell: 'codex' });

      // Assert
      expect(execSyncMock).toHaveBeenCalledTimes(2);
      expect(lastSpawn().shell).toBe('C:\\Tools\\codex.exe');
    });

    it('应该在缺少扩展时 append .cmd', () => {
      // Arrange
      platformSpy.mockReturnValue('win32');
      execSyncMock.mockReturnValue('C:\\Tools\\codex');
      existsSyncMock.mockImplementation((file: string) => file === 'C:\\Tools\\codex.cmd');

      // Act
      startPty({ id: 'win-3', shell: 'codex' });

      // Assert
      expect(lastSpawn().shell).toBe('C:\\Tools\\codex.cmd');
    });

    it('应该保持已有 .exe 扩展', () => {
      // Arrange
      platformSpy.mockReturnValue('win32');
      execSyncMock.mockReturnValue('C:\\Tools\\codex.exe');

      // Act
      startPty({ id: 'win-4', shell: 'codex' });

      // Assert
      expect(lastSpawn().shell).toBe('C:\\Tools\\codex.exe');
    });

    it('应该在 where 失败时回退到原始 shell 名称', () => {
      // Arrange
      platformSpy.mockReturnValue('win32');
      execSyncMock.mockImplementation(() => {
        throw new Error('where failed');
      });

      // Act
      startPty({ id: 'win-5', shell: 'codex' });

      // Assert
      expect(lastSpawn().shell).toBe('codex');
    });

    it('应该处理多个 where 结果并去除回车符', () => {
      // Arrange
      platformSpy.mockReturnValue('win32');
      execSyncMock.mockReturnValue('C:\\npm\\codex.cmd\r\nC:\\backup\\codex.cmd\r\n');

      // Act
      startPty({ id: 'win-6', shell: 'codex' });

      // Assert
      expect(lastSpawn().shell).toBe('C:\\npm\\codex.cmd');
    });
  });

  describe('writePty 行为', () => {
    it('应该写入数据到指定 PTY', () => {
      // Arrange
      startPty({ id: 'write-1' });

      // Act
      writePty('write-1', 'hello');

      // Assert
      expect(getRecord('write-1').writes).toEqual(['hello']);
    });

    it('应该记录缺失 PTY 的警告', () => {
      // Arrange
      const payload = 'missing';

      // Act
      writePty('write-missing', payload);

      // Assert
      expect(warnMock).toHaveBeenCalledWith('ptyManager:writeMissing', {
        id: 'write-missing',
        bytes: payload.length,
      });
    });

    it('应该支持多次写入保持顺序', () => {
      // Arrange
      startPty({ id: 'write-2' });

      // Act
      writePty('write-2', 'a');
      writePty('write-2', 'b');

      // Assert
      expect(getRecord('write-2').writes).toEqual(['a', 'b']);
    });

    it('应该传播底层 write 异常', () => {
      // Arrange
      startPty({ id: 'write-3' });
      const proc = getPty('write-3')!;
      vi.mocked(proc.write).mockImplementation(() => {
        throw new Error('write boom');
      });

      // Act & Assert
      expect(() => writePty('write-3', 'boom')).toThrow('write boom');
    });

    it('应该在存在 PTY 时不记录警告', () => {
      // Arrange
      startPty({ id: 'write-4' });

      // Act
      writePty('write-4', 'ok');

      // Assert
      expect(warnMock).not.toHaveBeenCalled();
    });

    it('应该允许空字符串写入', () => {
      // Arrange
      startPty({ id: 'write-5' });

      // Act
      writePty('write-5', '');

      // Assert
      expect(getRecord('write-5').writes).toEqual(['']);
    });
  });

  describe('resizePty 行为', () => {
    it('应该调用 PTY 的 resize', () => {
      // Arrange
      startPty({ id: 'resize-1' });

      // Act
      resizePty('resize-1', 120, 40);

      // Assert
      expect(getRecord('resize-1').resizes).toEqual([{ cols: 120, rows: 40 }]);
    });

    it('应该在缺失 PTY 时记录警告', () => {
      // Arrange
      const id = 'resize-missing';

      // Act
      resizePty(id, 10, 10);

      // Assert
      expect(warnMock).toHaveBeenCalledWith('ptyManager:resizeMissing', { id, cols: 10, rows: 10 });
    });

    it('应该在 EBADF code 时记录退出警告', () => {
      // Arrange
      startPty({ id: 'resize-2' });
      const proc = getPty('resize-2')!;
      vi.mocked(proc.resize).mockImplementation(() => {
        const err: NodeJS.ErrnoException = new Error('bad');
        err.code = 'EBADF';
        throw err;
      });

      // Act
      resizePty('resize-2', 80, 20);

      // Assert
      expect(warnMock).toHaveBeenCalledWith('ptyManager:resizeAfterExit', {
        id: 'resize-2',
        cols: 80,
        rows: 20,
        error: expect.stringContaining('bad'),
      });
      expect(errorMock).not.toHaveBeenCalled();
    });

    it('应该在错误信息包含 EBADF 时退出', () => {
      // Arrange
      startPty({ id: 'resize-3' });
      const proc = getPty('resize-3')!;
      vi.mocked(proc.resize).mockImplementation(() => {
        throw new Error('EBADF: invalid');
      });

      // Act
      resizePty('resize-3', 90, 30);

      // Assert
      expect(warnMock).toHaveBeenCalledWith('ptyManager:resizeAfterExit', expect.any(Object));
    });

    it('应该在错误信息包含 Napi::Error 时退出', () => {
      // Arrange
      startPty({ id: 'resize-4' });
      const proc = getPty('resize-4')!;
      vi.mocked(proc.resize).mockImplementation(() => {
        throw new Error('Napi::Error: binding closed');
      });

      // Act
      resizePty('resize-4', 70, 25);

      // Assert
      expect(warnMock).toHaveBeenCalledWith('ptyManager:resizeAfterExit', expect.any(Object));
    });

    it('应该在其他错误时记录 error 日志', () => {
      // Arrange
      startPty({ id: 'resize-5' });
      const proc = getPty('resize-5')!;
      vi.mocked(proc.resize).mockImplementation(() => {
        throw new Error('unexpected');
      });

      // Act
      resizePty('resize-5', 60, 15);

      // Assert
      expect(errorMock).toHaveBeenCalledWith('ptyManager:resizeFailed', expect.any(Object));
    });
  });

  describe('killPty 行为', () => {
    it('应该调用 kill 并清理记录', () => {
      // Arrange
      startPty({ id: 'kill-1' });
      const proc = getPty('kill-1')!;
      const record = ptyRecords.get(proc);
      expect(record).toBeTruthy();

      // Act
      killPty('kill-1');

      // Assert
      expect(record?.killCount).toBe(1);
      expect(hasPty('kill-1')).toBe(false);
    });

    it('应该忽略未知 id', () => {
      // Arrange & Act
      killPty('kill-missing');

      // Assert
      expect(hasPty('kill-missing')).toBe(false);
    });

    it('应该在 kill 抛错时依然清理 Map', () => {
      // Arrange
      startPty({ id: 'kill-2' });
      const proc = getPty('kill-2')!;
      vi.mocked(proc.kill).mockImplementation(() => {
        throw new Error('kill failed');
      });

      // Act
      expect(() => killPty('kill-2')).toThrow('kill failed');

      // Assert
      expect(hasPty('kill-2')).toBe(false);
    });

    it('应该确保重复 kill 不会再次调用底层方法', () => {
      // Arrange
      startPty({ id: 'kill-3' });

      // Act
      killPty('kill-3');
      killPty('kill-3');

      // Assert
      const proc = lastSpawn().proc;
      const killMock = vi.mocked(proc.kill);
      expect(killMock.mock.calls.length).toBe(1);
    });

    it('应该允许多个 PTY 独立 kill', () => {
      // Arrange
      startPty({ id: 'kill-a' });
      startPty({ id: 'kill-b' });

      // Act
      killPty('kill-a');
      killPty('kill-b');

      // Assert
      expect(hasPty('kill-a')).toBe(false);
      expect(hasPty('kill-b')).toBe(false);
    });

    it('应该返回 void 不抛错', () => {
      // Arrange
      startPty({ id: 'kill-void' });

      // Act & Assert
      expect(killPty('kill-void')).toBeUndefined();
    });
  });

  describe('hasPty 行为', () => {
    it('应该在未启动时返回 false', () => {
      // Arrange & Act
      const result = hasPty('has-1');

      // Assert
      expect(result).toBe(false);
    });

    it('应该在启动后返回 true', () => {
      // Arrange
      startPty({ id: 'has-2' });

      // Act
      const result = hasPty('has-2');

      // Assert
      expect(result).toBe(true);
    });

    it('应该在 kill 后返回 false', () => {
      // Arrange
      startPty({ id: 'has-3' });
      killPty('has-3');

      // Act
      const result = hasPty('has-3');

      // Assert
      expect(result).toBe(false);
    });

    it('应该只影响匹配的 id', () => {
      // Arrange
      startPty({ id: 'has-a' });
      startPty({ id: 'has-b' });

      // Act
      const result = hasPty('has-b');

      // Assert
      expect(result).toBe(true);
      expect(hasPty('has-a')).toBe(true);
    });

    it('应该允许相同 id 重新启动覆盖旧实例', () => {
      // Arrange
      startPty({ id: 'has-4' });
      const first = getPty('has-4');

      // Act
      startPty({ id: 'has-4' });

      // Assert
      expect(hasPty('has-4')).toBe(true);
      expect(getPty('has-4')).not.toBe(first);
    });
  });

  describe('getPty 行为', () => {
    it('应该返回启动时的实例', () => {
      // Arrange
      startPty({ id: 'get-1' });
      const created = lastSpawn().proc;

      // Act
      const fetched = getPty('get-1');

      // Assert
      expect(fetched).toBe(created);
    });

    it('应该在未知 id 时返回 undefined', () => {
      // Arrange & Act
      const fetched = getPty('get-missing');

      // Assert
      expect(fetched).toBeUndefined();
    });

    it('应该在 kill 后返回 undefined', () => {
      // Arrange
      startPty({ id: 'get-2' });
      killPty('get-2');

      // Act
      const fetched = getPty('get-2');

      // Assert
      expect(fetched).toBeUndefined();
    });

    it('应该支持多次调用返回同一引用', () => {
      // Arrange
      startPty({ id: 'get-3' });

      // Act
      const first = getPty('get-3');
      const second = getPty('get-3');

      // Assert
      expect(first).toBe(second);
    });

    it('应该不在获取时修改内部 Map', () => {
      // Arrange
      startPty({ id: 'get-4' });

      // Act
      getPty('get-4');

      // Assert
      expect(hasPty('get-4')).toBe(true);
    });
  });

  describe('并发管理', () => {
    it('应该支持多个 PTY 同时运行', () => {
      // Arrange
      startPty({ id: 'con-1' });
      startPty({ id: 'con-2' });

      // Act & Assert
      expect(hasPty('con-1')).toBe(true);
      expect(hasPty('con-2')).toBe(true);
    });

    it('应该隔离不同 ID 的写入', () => {
      // Arrange
      startPty({ id: 'con-3' });
      startPty({ id: 'con-4' });

      // Act
      writePty('con-3', 'A');
      writePty('con-4', 'B');

      // Assert
      expect(getRecord('con-3').writes).toEqual(['A']);
      expect(getRecord('con-4').writes).toEqual(['B']);
    });

    it('应该隔离不同 ID 的 resize', () => {
      // Arrange
      startPty({ id: 'con-5' });
      startPty({ id: 'con-6' });

      // Act
      resizePty('con-5', 100, 20);
      resizePty('con-6', 50, 10);

      // Assert
      expect(getRecord('con-5').resizes).toEqual([{ cols: 100, rows: 20 }]);
      expect(getRecord('con-6').resizes).toEqual([{ cols: 50, rows: 10 }]);
    });

    it('应该在 kill 某个 PTY 时不影响其他实例', () => {
      // Arrange
      startPty({ id: 'con-7' });
      startPty({ id: 'con-8' });

      // Act
      killPty('con-7');

      // Assert
      expect(hasPty('con-7')).toBe(false);
      expect(hasPty('con-8')).toBe(true);
    });

    it('应该允许重用已释放的 ID', () => {
      // Arrange
      startPty({ id: 'con-9' });
      const first = getPty('con-9');
      killPty('con-9');

      // Act
      startPty({ id: 'con-9' });

      // Assert
      expect(getPty('con-9')).not.toBe(first);
    });
  });

  describe('错误处理', () => {
    it('应该在 node-pty 模块加载失败时抛出错误', async () => {
      // Arrange
      setNodePtyFactory(() => {
        throw new Error('native missing');
      });
      await importManager();
      configureSpawnDefault();

      // Act & Assert
      expect(() => startPty({ id: 'err-1' })).toThrow('native missing');
    });

    it('应该在 spawn 抛错时向上传递错误并不缓存记录', () => {
      // Arrange
      spawnMock.mockImplementation(() => {
        throw new Error('spawn fail');
      });

      // Act & Assert
      expect(() => startPty({ id: 'err-2' })).toThrow('spawn fail');
      expect(hasPty('err-2')).toBe(false);
    });

    it('应该在 write 使用未知 id 时视为无效参数', () => {
      // Arrange
      const id = 'err-missing';

      // Act
      writePty(id, 'noop');

      // Assert
      expect(warnMock).toHaveBeenCalledWith('ptyManager:writeMissing', {
        id,
        bytes: 4,
      });
    });

    it('应该在 resize 使用未知 id 时视为无效参数', () => {
      // Arrange
      const id = 'err-resize';

      // Act
      resizePty(id, 1, 1);

      // Assert
      expect(warnMock).toHaveBeenCalledWith('ptyManager:resizeMissing', { id, cols: 1, rows: 1 });
    });

    it('应该在 kill 使用未知 id 时安全返回', () => {
      // Arrange & Act
      expect(() => killPty('err-kill')).not.toThrow();

      // Assert
      expect(hasPty('err-kill')).toBe(false);
    });

    it('应该在传入 NaN 尺寸时仍将值传递到 spawn', () => {
      // Arrange
      startPty({ id: 'err-nan', cols: Number.NaN, rows: Number.NaN });

      // Act & Assert
      expect(Number.isNaN(lastSpawn().options.cols)).toBe(true);
      expect(Number.isNaN(lastSpawn().options.rows)).toBe(true);
    });
  });
});
