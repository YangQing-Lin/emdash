import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RepositoryManager } from '../../main/services/RepositoryManager';

// Mock child_process
vi.mock('child_process', () => {
  const promisifySymbol = Symbol.for('nodejs.util.promisify.custom');
  const exec = vi.fn();
  (exec as any)[promisifySymbol] = (command: string) =>
    new Promise((resolve, reject) => {
      exec(command, (error: Error | null, stdout: string, stderr: string) => {
        if (error) {
          reject(error);
        } else {
          resolve({ stdout, stderr });
        }
      });
    });
  return { exec };
});

const mockExec = async () => {
  const { exec } = await import('child_process');
  return exec as any;
};

describe('RepositoryManager', () => {
  let manager: RepositoryManager;
  let execMock: any;
  type ExecCallback = (error: Error | null, stdout: string, stderr: string) => void;

  beforeEach(async () => {
    manager = new RepositoryManager();
    execMock = await mockExec();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Helper to mock successful exec call
  const mockSuccessfulExec = (stdout: string) => {
    execMock.mockImplementation((cmd: string, callback: ExecCallback) => {
      callback(null, stdout, '');
    });
  };

  // Helper to mock failed exec call
  const mockFailedExec = (error: Error) => {
    execMock.mockImplementation((cmd: string, callback: ExecCallback) => {
      callback(error, '', '');
    });
  };

  describe('scanRepositories', () => {
    it('应该返回空数组（功能未实现）', async () => {
      // Act
      const result = await manager.scanRepositories();

      // Assert
      expect(result).toEqual([]);
    });

    it('应该不调用任何外部命令', async () => {
      // Act
      await manager.scanRepositories();

      // Assert
      expect(execMock).not.toHaveBeenCalled();
    });
  });

  describe('addRepository', () => {
    it('应该成功添加有效的 Git 仓库', async () => {
      // Arrange
      const testPath = '/path/to/repo';

      let callCount = 0;
      execMock.mockImplementation((cmd: string, callback: ExecCallback) => {
        callCount++;
        if (callCount === 1) {
          // git rev-parse --is-inside-work-tree
          callback(null, 'true\n', '');
        } else if (callCount === 2) {
          // git remote get-url origin
          callback(null, 'https://github.com/user/repo.git\n', '');
        } else if (callCount === 3) {
          // git symbolic-ref
          callback(null, 'main\n', '');
        }
      });

      // Act
      const result = await manager.addRepository(testPath);

      // Assert
      expect(result).toBeDefined();
      expect(result.path).toBe(testPath);
      expect(result.origin).toBe('https://github.com/user/repo.git');
      expect(result.defaultBranch).toBe('main');
      expect(result.id).toBeTruthy();
      expect(result.lastActivity).toBeTruthy();
    });

    it('应该在非 Git 仓库时抛出错误', async () => {
      // Arrange
      const testPath = '/path/to/non-repo';
      mockSuccessfulExec('false\n');

      // Act & Assert
      await expect(manager.addRepository(testPath)).rejects.toThrow('Not a git repository');
    });

    it('应该在 git rev-parse 失败时抛出错误', async () => {
      // Arrange
      const testPath = '/path/to/repo';
      mockFailedExec(new Error('fatal: not a git repository'));

      // Act & Assert
      await expect(manager.addRepository(testPath)).rejects.toThrow('Failed to add repository');
    });

    it('应该处理没有 origin 的仓库', async () => {
      // Arrange
      const testPath = '/path/to/repo';

      let callCount = 0;
      execMock.mockImplementation((cmd: string, callback: ExecCallback) => {
        callCount++;
        if (callCount === 1) {
          callback(null, 'true\n', '');
        } else if (callCount === 2) {
          // git remote get-url origin fails
          callback(new Error('fatal: no remote'), '', '');
        } else if (callCount === 3) {
          callback(null, 'main\n', '');
        }
      });

      // Act
      const result = await manager.addRepository(testPath);

      // Assert
      expect(result.origin).toBe('No origin');
    });

    it('应该处理无法确定默认分支的情况', async () => {
      // Arrange
      const testPath = '/path/to/repo';

      let callCount = 0;
      execMock.mockImplementation((cmd: string, callback: ExecCallback) => {
        callCount++;
        if (callCount === 1) {
          callback(null, 'true\n', '');
        } else if (callCount === 2) {
          callback(null, 'https://github.com/user/repo.git\n', '');
        } else if (callCount === 3) {
          // git symbolic-ref fails
          callback(new Error('fatal: no branch'), '', '');
        }
      });

      // Act
      const result = await manager.addRepository(testPath);

      // Assert
      expect(result.defaultBranch).toBe('main'); // Fallback to 'main'
    });

    it('应该生成唯一的 repository ID', async () => {
      // Arrange
      const testPath1 = '/path/to/repo1';
      const testPath2 = '/path/to/repo2';

      execMock.mockImplementation((cmd: string, callback: ExecCallback) => {
        if (cmd.includes('rev-parse')) {
          callback(null, 'true\n', '');
        } else if (cmd.includes('remote get-url')) {
          callback(null, 'https://github.com/user/repo.git\n', '');
        } else if (cmd.includes('symbolic-ref')) {
          callback(null, 'main\n', '');
        }
      });

      // Act
      const repo1 = await manager.addRepository(testPath1);
      const repo2 = await manager.addRepository(testPath2);

      // Assert
      expect(repo1.id).not.toBe(repo2.id);
    });

    it('应该设置 lastActivity 为当前时间', async () => {
      // Arrange
      const testPath = '/path/to/repo';
      const beforeTime = new Date().toISOString();

      execMock.mockImplementation((cmd: string, callback: ExecCallback) => {
        if (cmd.includes('rev-parse')) {
          callback(null, 'true\n', '');
        } else if (cmd.includes('remote get-url')) {
          callback(null, 'https://github.com/user/repo.git\n', '');
        } else if (cmd.includes('symbolic-ref')) {
          callback(null, 'main\n', '');
        }
      });

      // Act
      const result = await manager.addRepository(testPath);
      const afterTime = new Date().toISOString();

      // Assert
      expect(result.lastActivity).toBeDefined();
      expect(result.lastActivity! >= beforeTime).toBe(true);
      expect(result.lastActivity! <= afterTime).toBe(true);
    });
  });

  describe('getOrigin', () => {
    it('应该成功获取 origin URL', async () => {
      // Arrange
      const testPath = '/path/to/repo';
      const originUrl = 'git@github.com:user/repo.git';

      let callCount = 0;
      execMock.mockImplementation((cmd: string, callback: ExecCallback) => {
        callCount++;
        if (callCount === 1) {
          callback(null, 'true\n', '');
        } else if (callCount === 2) {
          callback(null, `${originUrl}\n`, '');
        } else {
          callback(null, 'main\n', '');
        }
      });

      // Act
      const result = await manager.addRepository(testPath);

      // Assert
      expect(result.origin).toBe(originUrl);
    });

    it('应该 trim origin URL 的空格和换行符', async () => {
      // Arrange
      const testPath = '/path/to/repo';
      const originUrl = 'https://github.com/user/repo.git';

      let callCount = 0;
      execMock.mockImplementation((cmd: string, callback: ExecCallback) => {
        callCount++;
        if (callCount === 1) {
          callback(null, 'true\n', '');
        } else if (callCount === 2) {
          callback(null, `  ${originUrl}  \n`, '');
        } else {
          callback(null, 'main\n', '');
        }
      });

      // Act
      const result = await manager.addRepository(testPath);

      // Assert
      expect(result.origin).toBe(originUrl);
    });

    it('应该在 get-url origin 失败时返回 "No origin"', async () => {
      // Arrange
      const testPath = '/path/to/repo';

      let callCount = 0;
      execMock.mockImplementation((cmd: string, callback: ExecCallback) => {
        callCount++;
        if (callCount === 1) {
          callback(null, 'true\n', '');
        } else if (callCount === 2) {
          callback(new Error('fatal: no such remote'), '', '');
        } else {
          callback(null, 'main\n', '');
        }
      });

      // Act
      const result = await manager.addRepository(testPath);

      // Assert
      expect(result.origin).toBe('No origin');
    });
  });

  describe('getDefaultBranch', () => {
    it('应该成功获取默认分支', async () => {
      // Arrange
      const testPath = '/path/to/repo';

      let callCount = 0;
      execMock.mockImplementation((cmd: string, callback: ExecCallback) => {
        callCount++;
        if (callCount === 1) {
          callback(null, 'true\n', '');
        } else if (callCount === 2) {
          callback(null, 'https://github.com/user/repo.git\n', '');
        } else {
          callback(null, 'develop\n', '');
        }
      });

      // Act
      const result = await manager.addRepository(testPath);

      // Assert
      expect(result.defaultBranch).toBe('develop');
    });

    it('应该处理空的 symbolic-ref 输出', async () => {
      // Arrange
      const testPath = '/path/to/repo';

      let callCount = 0;
      execMock.mockImplementation((cmd: string, callback: ExecCallback) => {
        callCount++;
        if (callCount === 1) {
          callback(null, 'true\n', '');
        } else if (callCount === 2) {
          callback(null, 'https://github.com/user/repo.git\n', '');
        } else {
          callback(null, '\n', '');
        }
      });

      // Act
      const result = await manager.addRepository(testPath);

      // Assert
      expect(result.defaultBranch).toBe('main'); // Fallback
    });

    it('应该在 symbolic-ref 失败时返回 "main"', async () => {
      // Arrange
      const testPath = '/path/to/repo';

      let callCount = 0;
      execMock.mockImplementation((cmd: string, callback: ExecCallback) => {
        callCount++;
        if (callCount === 1) {
          callback(null, 'true\n', '');
        } else if (callCount === 2) {
          callback(null, 'https://github.com/user/repo.git\n', '');
        } else {
          callback(new Error('fatal: ref does not exist'), '', '');
        }
      });

      // Act
      const result = await manager.addRepository(testPath);

      // Assert
      expect(result.defaultBranch).toBe('main');
    });
  });

  describe('getRepository', () => {
    it('应该成功获取已添加的 repository', async () => {
      // Arrange
      const testPath = '/path/to/repo';

      execMock.mockImplementation((cmd: string, callback: ExecCallback) => {
        if (cmd.includes('rev-parse')) {
          callback(null, 'true\n', '');
        } else if (cmd.includes('remote get-url')) {
          callback(null, 'https://github.com/user/repo.git\n', '');
        } else if (cmd.includes('symbolic-ref')) {
          callback(null, 'main\n', '');
        }
      });

      const added = await manager.addRepository(testPath);

      // Act
      const result = manager.getRepository(added.id);

      // Assert
      expect(result).toBeDefined();
      expect(result?.id).toBe(added.id);
      expect(result?.path).toBe(testPath);
    });

    it('应该在 ID 不存在时返回 undefined', () => {
      // Act
      const result = manager.getRepository('non-existent-id');

      // Assert
      expect(result).toBeUndefined();
    });
  });

  describe('getAllRepositories', () => {
    it('应该返回所有已添加的 repositories', async () => {
      // Arrange
      let callCount = 0;
      execMock.mockImplementation((cmd: string, callback: ExecCallback) => {
        callCount++;
        const callIndex = (callCount - 1) % 3;
        if (callIndex === 0) {
          callback(null, 'true\n', '');
        } else if (callIndex === 1) {
          callback(null, 'https://github.com/user/repo.git\n', '');
        } else {
          callback(null, 'main\n', '');
        }
      });

      await manager.addRepository('/path/to/repo1');
      await manager.addRepository('/path/to/repo2');
      await manager.addRepository('/path/to/repo3');

      // Act
      const result = manager.getAllRepositories();

      // Assert
      expect(result).toHaveLength(3);
      expect(result.every((r) => r.id && r.path && r.origin)).toBe(true);
    });

    it('应该在没有 repository 时返回空数组', () => {
      // Act
      const result = manager.getAllRepositories();

      // Assert
      expect(result).toEqual([]);
    });
  });

  describe('generateId', () => {
    const mockSuccessfulGitCommands = () => {
      execMock.mockImplementation((cmd: string, callback: ExecCallback) => {
        if (cmd.includes('rev-parse')) {
          callback(null, 'true\n', '');
        } else if (cmd.includes('remote get-url')) {
          callback(null, 'https://github.com/user/repo.git\n', '');
        } else if (cmd.includes('symbolic-ref')) {
          callback(null, 'main\n', '');
        }
      });
    };

    it('应该生成不同的 ID', async () => {
      // Arrange
      const testPath = '/path/to/repo';
      mockSuccessfulGitCommands();

      const repos = await Promise.all([
        manager.addRepository(testPath),
        manager.addRepository(testPath),
        manager.addRepository(testPath),
      ]);

      // Act
      const ids = repos.map((r) => r.id);

      // Assert
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(3);
    });

    it('应该生成字符串格式的 ID', async () => {
      // Arrange
      const testPath = '/path/to/repo';
      mockSuccessfulGitCommands();

      // Act
      const repo = await manager.addRepository(testPath);

      // Assert
      expect(typeof repo.id).toBe('string');
      expect(repo.id.length).toBeGreaterThan(0);
    });
  });

  describe('错误处理', () => {
    it('应该在路径包含空格时正确处理', async () => {
      // Arrange
      const testPath = '/path/with spaces/to/repo';

      let callCount = 0;
      execMock.mockImplementation((cmd: string, callback: ExecCallback) => {
        callCount++;
        const callIndex = (callCount - 1) % 3;

        // Verify that path is properly quoted in commands
        if (cmd.includes(testPath)) {
          expect(cmd).toContain(`"${testPath}"`);
        }

        if (callIndex === 0) {
          callback(null, 'true\n', '');
        } else if (callIndex === 1) {
          callback(null, 'https://github.com/user/repo.git\n', '');
        } else {
          callback(null, 'main\n', '');
        }
      });

      // Act
      const result = await manager.addRepository(testPath);

      // Assert
      expect(result.path).toBe(testPath);
    });

    it('应该在 Git 命令完全失败时抛出描述性错误', async () => {
      // Arrange
      const testPath = '/path/to/repo';
      mockFailedExec(new Error('git: command not found'));

      // Act & Assert
      await expect(manager.addRepository(testPath)).rejects.toThrow('Failed to add repository');
    });

    it('应该处理并发添加多个 repository', async () => {
      // Arrange
      execMock.mockImplementation((cmd: string, callback: ExecCallback) => {
        if (cmd.includes('rev-parse')) {
          callback(null, 'true\n', '');
        } else if (cmd.includes('remote get-url')) {
          callback(null, 'https://github.com/user/repo.git\n', '');
        } else if (cmd.includes('symbolic-ref')) {
          callback(null, 'main\n', '');
        }
      });

      // Act
      const results = await Promise.all([
        manager.addRepository('/path/to/repo1'),
        manager.addRepository('/path/to/repo2'),
        manager.addRepository('/path/to/repo3'),
      ]);

      // Assert
      expect(results).toHaveLength(3);
      expect(results.every((r) => r.id && r.path)).toBe(true);
      expect(manager.getAllRepositories()).toHaveLength(3);
    });
  });
});
