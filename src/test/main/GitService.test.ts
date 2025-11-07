import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync, ExecFileSyncOptions } from 'node:child_process';
import {
  getStatus,
  getFileDiff,
  revertFile,
  stageFile,
  type GitChange,
} from '../../main/services/GitService';

type TempRepo = {
  path: string;
  git: (args: string[], options?: ExecFileSyncOptions) => string;
  writeFile: (relativePath: string, content: string | Buffer) => void;
  appendFile: (relativePath: string, content: string) => void;
  readFile: (relativePath: string) => string;
  touchAndCommit: (relativePath: string, content: string) => void;
};

const tempDirs: string[] = [];
const ORIGINAL_PATH = process.env.PATH ?? '';

const ensureDirectoryForFile = (filePath: string) => {
  const dir = path.dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
};

const createTempGitRepo = (options?: { commitInitial?: boolean; initialFiles?: Record<string, string> }): TempRepo => {
  const repoRoot = mkdtempSync(path.join(os.tmpdir(), 'gitservice-tests-'));
  tempDirs.push(repoRoot);

  const git = (args: string[], extraOptions?: ExecFileSyncOptions) =>
    execFileSync('git', args, {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: 'pipe',
      ...extraOptions,
    }).toString();

  git(['init']);
  git(['config', 'user.email', 'gitservice@test.dev']);
  git(['config', 'user.name', 'Git Service Tester']);

  const writeFile = (relativePath: string, content: string | Buffer) => {
    const fullPath = path.join(repoRoot, relativePath);
    ensureDirectoryForFile(fullPath);
    writeFileSync(fullPath, content);
  };

  const appendFile = (relativePath: string, content: string) => {
    const fullPath = path.join(repoRoot, relativePath);
    ensureDirectoryForFile(fullPath);
    appendFileSync(fullPath, content);
  };

  const readFile = (relativePath: string) => {
    return readFileSync(path.join(repoRoot, relativePath), 'utf8');
  };

  if (options?.initialFiles) {
    for (const [relativePath, content] of Object.entries(options.initialFiles)) {
      writeFile(relativePath, content);
    }
  }

  if (options?.commitInitial !== false) {
    git(['add', '--all']);
    git(['commit', '--allow-empty', '-m', 'initial commit']);
  }

  const touchAndCommit = (relativePath: string, content: string) => {
    writeFile(relativePath, content);
    git(['add', relativePath]);
    git(['commit', '-m', `add ${relativePath}`]);
  };

  return { path: repoRoot, git, writeFile, appendFile, readFile, touchAndCommit };
};

const getChangeByPath = (changes: GitChange[], targetPath: string) => {
  return changes.find((change) => {
    const normalized = change.path.replace(/^"|"$/g, '');
    return change.path === targetPath || normalized === targetPath;
  });
};

afterEach(() => {
  process.env.PATH = ORIGINAL_PATH;
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe.sequential('GitService', () => {
  beforeEach(() => {
    process.env.PATH = ORIGINAL_PATH;
  });

  describe('revertFile', () => {
    it('应该对已暂存的文件执行unstage并返回动作', async () => {
      // Arrange
      const repo = createTempGitRepo();
      repo.touchAndCommit('staged.txt', 'one\n');
      repo.appendFile('staged.txt', 'two\n');
      await stageFile(repo.path, 'staged.txt');

      // Act
      const result = await revertFile(repo.path, 'staged.txt');

      // Assert
      expect(result.action).toBe('unstaged');
      const status = repo.git(['status', '--short', '--', 'staged.txt']);
      expect(status.startsWith(' ')).toBe(true);
    });

    it('应该回滚未暂存的文件并返回reverted', async () => {
      // Arrange
      const repo = createTempGitRepo();
      repo.touchAndCommit('dirty.txt', 'clean\n');
      repo.appendFile('dirty.txt', 'dirty\n');

      // Act
      const result = await revertFile(repo.path, 'dirty.txt');

      // Assert
      expect(result.action).toBe('reverted');
      const status = repo.git(['status', '--short', '--', 'dirty.txt']).trim();
      expect(status).toBe('');
      expect(repo.readFile('dirty.txt')).toBe('clean\n');
    });

    it('应该处理包含空格的文件路径', async () => {
      // Arrange
      const repo = createTempGitRepo();
      repo.touchAndCommit('dir/file name.txt', 'one\n');
      repo.appendFile('dir/file name.txt', 'two\n');

      // Act
      const result = await revertFile(repo.path, 'dir/file name.txt');

      // Assert
      expect(result.action).toBe('reverted');
      const status = repo.git(['status', '--short', '--', 'dir/file name.txt']).trim();
      expect(status).toBe('');
    });

    it('应该处理子目录文件', async () => {
      // Arrange
      const repo = createTempGitRepo();
      repo.touchAndCommit('nested/inner.txt', 'base\n');
      repo.appendFile('nested/inner.txt', 'change\n');

      // Act
      const result = await revertFile(repo.path, 'nested/inner.txt');

      // Assert
      expect(result.action).toBe('reverted');
      const status = repo.git(['status', '--short', '--', 'nested/inner.txt']).trim();
      expect(status).toBe('');
    });

    it('应该恢复被删除的文件', async () => {
      // Arrange
      const repo = createTempGitRepo();
      repo.touchAndCommit('delete-me.txt', 'keep\n');
      rmSync(path.join(repo.path, 'delete-me.txt'));

      // Act
      const result = await revertFile(repo.path, 'delete-me.txt');

      // Assert
      expect(result.action).toBe('reverted');
      expect(existsSync(path.join(repo.path, 'delete-me.txt'))).toBe(true);
    });

    it('未跟踪文件应该抛出错误', async () => {
      // Arrange
      const repo = createTempGitRepo();
      repo.writeFile('new.txt', 'data\n');

      // Act & Assert
      await expect(revertFile(repo.path, 'new.txt')).rejects.toThrow();
    });

    it('不存在的文件应该抛出错误', async () => {
      // Arrange
      const repo = createTempGitRepo();

      // Act & Assert
      await expect(revertFile(repo.path, 'absent.txt')).rejects.toThrow();
    });

    it('同时存在staged和unstaged更改时应该先unstage', async () => {
      // Arrange
      const repo = createTempGitRepo();
      repo.touchAndCommit('combo.txt', 'L1\nL2\n');
      repo.writeFile('combo.txt', 'L1-mod\nL2\n');
      await stageFile(repo.path, 'combo.txt');
      repo.appendFile('combo.txt', 'L3\n');

      // Act
      const result = await revertFile(repo.path, 'combo.txt');

      // Assert
      expect(result.action).toBe('unstaged');
      const status = repo.git(['status', '--short', '--', 'combo.txt']);
      expect(status.startsWith(' ')).toBe(true);
    });

    it('应该支持二进制文件的回滚', async () => {
      // Arrange
      const repo = createTempGitRepo();
      repo.writeFile('bin.bin', Buffer.from([0, 1, 2, 3]));
      await stageFile(repo.path, 'bin.bin');
      repo.git(['commit', '-m', 'bin']);
      repo.writeFile('bin.bin', Buffer.from([5, 6, 7, 8]));

      // Act
      const result = await revertFile(repo.path, 'bin.bin');

      // Assert
      expect(result.action).toBe('reverted');
      const content = readFileSync(path.join(repo.path, 'bin.bin'));
      expect(content.equals(Buffer.from([0, 1, 2, 3]))).toBe(true);
    });

    it('多次回滚同一文件应该保持幂等', async () => {
      // Arrange
      const repo = createTempGitRepo();
      repo.touchAndCommit('idem.txt', 'a\n');
      repo.appendFile('idem.txt', 'b\n');

      // Act
      const first = await revertFile(repo.path, 'idem.txt');
      const second = await revertFile(repo.path, 'idem.txt');

      // Assert
      expect(first.action).toBe('reverted');
      expect(second.action).toBe('reverted');
    });

    it('git命令缺失时应该抛出错误', async () => {
      // Arrange
      const repo = createTempGitRepo();
      repo.touchAndCommit('gitless.txt', 'one\n');
      repo.appendFile('gitless.txt', 'two\n');
      const original = process.env.PATH;
      process.env.PATH = '';

      try {
        // Act & Assert
        await expect(revertFile(repo.path, 'gitless.txt')).rejects.toThrow();
      } finally {
        process.env.PATH = original;
      }
    });

    it('恢复后工作区应该干净', async () => {
      // Arrange
      const repo = createTempGitRepo();
      repo.touchAndCommit('clean.txt', 'v1\n');
      repo.appendFile('clean.txt', 'v2\n');

      // Act
      await revertFile(repo.path, 'clean.txt');
      const status = repo.git(['status', '--short']);

      // Assert
      expect(status.trim()).toBe('');
    });

    it('暂存的删除操作应该只执行unstage', async () => {
      // Arrange
      const repo = createTempGitRepo();
      repo.touchAndCommit('victim.txt', 'exists\n');
      rmSync(path.join(repo.path, 'victim.txt'));
      await stageFile(repo.path, 'victim.txt');

      // Act
      const result = await revertFile(repo.path, 'victim.txt');

      // Assert
      expect(result.action).toBe('unstaged');
      expect(existsSync(path.join(repo.path, 'victim.txt'))).toBe(false);
    });
  });

  describe('getFileDiff', () => {
    it('应该返回修改文件的diff', async () => {
      // Arrange
      const repo = createTempGitRepo();
      repo.touchAndCommit('diff.txt', 'a\nb\nc\n');
      repo.writeFile('diff.txt', 'a\nb2\nc\n');

      // Act
      const diff = await getFileDiff(repo.path, 'diff.txt');

      // Assert
      expect(diff.lines.some((line) => line.type === 'del')).toBe(true);
      expect(diff.lines.some((line) => line.type === 'add')).toBe(true);
    });

    it('应该返回新增文件的diff', async () => {
      // Arrange
      const repo = createTempGitRepo();
      repo.writeFile('new.txt', 'line1\nline2\n');

      // Act
      const diff = await getFileDiff(repo.path, 'new.txt');

      // Assert
      expect(diff.lines.length).toBeGreaterThan(0);
      expect(diff.lines.every((line) => line.type === 'add')).toBe(true);
    });

    it('应该返回删除文件的diff', async () => {
      // Arrange
      const repo = createTempGitRepo();
      repo.touchAndCommit('remove.txt', 'to delete\n');
      rmSync(path.join(repo.path, 'remove.txt'));

      // Act
      const diff = await getFileDiff(repo.path, 'remove.txt');

      // Assert
      expect(diff.lines.some((line) => line.type === 'del')).toBe(true);
    });

    it.each([
      ['包含空格的文件', 'path with space/file name.txt'],
      ['包含特殊字符的文件', 'strange/[chars]!file.ts'],
    ])('应该处理%s diff', async (_title, filePath) => {
      // Arrange
      const repo = createTempGitRepo();
      repo.touchAndCommit(filePath, 'base\n');
      repo.writeFile(filePath, 'base\nnext\n');

      // Act
      const diff = await getFileDiff(repo.path, filePath);

      // Assert
      expect(diff.lines.some((line) => line.type === 'add')).toBe(true);
    });

    it('应该处理二进制文件diff', async () => {
      // Arrange
      const repo = createTempGitRepo();
      repo.writeFile('bin.bin', Buffer.from([0, 1, 2, 3]));
      await stageFile(repo.path, 'bin.bin');
      repo.git(['commit', '-m', 'bin']);
      repo.writeFile('bin.bin', Buffer.from([0, 1, 2, 3, 4]));

      // Act
      const diff = await getFileDiff(repo.path, 'bin.bin');

      // Assert
      expect(diff.lines.some((line) => line.left?.includes('Binary files'))).toBe(true);
    });

    it('应该包含上下文行', async () => {
      // Arrange
      const repo = createTempGitRepo();
      repo.touchAndCommit('context.txt', 'a\nb\nc\nd\n');
      repo.writeFile('context.txt', 'a\nbb\nc\nd\n');

      // Act
      const diff = await getFileDiff(repo.path, 'context.txt');

      // Assert
      expect(diff.lines.some((line) => line.type === 'context')).toBe(true);
    });

    it('没有diff时应该读取当前文件内容', async () => {
      // Arrange
      const repo = createTempGitRepo();
      repo.writeFile('empty-new.txt', '');

      // Act
      const diff = await getFileDiff(repo.path, 'empty-new.txt');

      // Assert
      expect(diff.lines).toEqual([{ right: '', type: 'add' }]);
    });

    it('删除空文件时应该回退到HEAD内容', async () => {
      // Arrange
      const repo = createTempGitRepo();
      repo.writeFile('empty.txt', '');
      await stageFile(repo.path, 'empty.txt');
      repo.git(['commit', '-m', 'add empty']);
      rmSync(path.join(repo.path, 'empty.txt'));

      // Act
      const diff = await getFileDiff(repo.path, 'empty.txt');

      // Assert
      expect(diff.lines.length).toBeGreaterThan(0);
      expect(diff.lines.some((line) => line.type === 'context' && line.left?.includes('deleted file mode'))).toBe(
        true
      );
    });

    it('缺失文件且HEAD也没有时返回空数组', async () => {
      // Arrange
      const repo = createTempGitRepo();

      // Act
      const diff = await getFileDiff(repo.path, 'ghost.txt');

      // Assert
      expect(diff.lines).toEqual([]);
    });

    it('非Git目录应该直接读取文件内容', async () => {
      // Arrange
      const dir = mkdtempSync(path.join(os.tmpdir(), 'gitservice-nongit-'));
      tempDirs.push(dir);
      writeFileSync(path.join(dir, 'plain.txt'), 'a\nb\n');

      // Act
      const diff = await getFileDiff(dir, 'plain.txt');

      // Assert
      expect(diff.lines).toEqual([
        { right: 'a', type: 'add' },
        { right: 'b', type: 'add' },
        { right: '', type: 'add' },
      ]);
    });

    it('应该处理较大的diff输出', async () => {
      // Arrange
      const repo = createTempGitRepo();
      const base = Array.from({ length: 200 }, (_, idx) => `line-${idx}`).join('\n');
      repo.touchAndCommit('big.txt', `${base}\n`);
      const updated = Array.from({ length: 200 }, (_, idx) => `line-${idx + 1}`).join('\n');
      repo.writeFile('big.txt', `${updated}\n`);

      // Act
      const diff = await getFileDiff(repo.path, 'big.txt');

      // Assert
      const contextCount = diff.lines.filter((line) => line.type === 'context').length;
      expect(diff.lines.length).toBeGreaterThan(100);
      expect(contextCount).toBeGreaterThan(100);
      expect(diff.lines.filter((line) => line.type === 'add').length).toBeGreaterThan(0);
      expect(diff.lines.filter((line) => line.type === 'del').length).toBeGreaterThan(0);
    });

    it('重命名后的文件应该能获取diff', async () => {
      // Arrange
      const repo = createTempGitRepo();
      repo.touchAndCommit('old-name.txt', 'first\n');
      repo.git(['mv', 'old-name.txt', 'new-name.txt']);
      repo.appendFile('new-name.txt', 'second\n');

      // Act
      const diff = await getFileDiff(repo.path, 'new-name.txt');

      // Assert
      expect(diff.lines.length).toBeGreaterThan(0);
    });

    it('多块diff应该全部解析', async () => {
      // Arrange
      const repo = createTempGitRepo();
      repo.touchAndCommit('multi.txt', 'a\nb\nc\nd\ne\n');
      repo.writeFile('multi.txt', 'aa\nb\nc\nd\nee\n');

      // Act
      const diff = await getFileDiff(repo.path, 'multi.txt');

      // Assert
      const addLines = diff.lines.filter((line) => line.type === 'add');
      const delLines = diff.lines.filter((line) => line.type === 'del');
      expect(addLines.length).toBeGreaterThan(0);
      expect(delLines.length).toBeGreaterThan(0);
    });

    it('未跟踪文件应该标记为新增行', async () => {
      // Arrange
      const repo = createTempGitRepo();
      repo.writeFile('unstaged.txt', 'one\n');

      // Act
      const diff = await getFileDiff(repo.path, 'unstaged.txt');

      // Assert
      expect(diff.lines.every((line) => line.type === 'add')).toBe(true);
    });

    it('git命令缺失时应该读取工作区文件', async () => {
      // Arrange
      const repo = createTempGitRepo();
      repo.writeFile('nop.txt', 'content\n');
      const original = process.env.PATH;
      process.env.PATH = '';

      try {
        // Act
        const diff = await getFileDiff(repo.path, 'nop.txt');

        // Assert
        expect(diff.lines[0]).toEqual({ right: 'content', type: 'add' });
      } finally {
        process.env.PATH = original;
      }
    });

    it('暂存和未暂存的修改都应该体现在diff中', async () => {
      // Arrange
      const repo = createTempGitRepo();
      repo.touchAndCommit('mix.txt', 'a\nb\nc\n');
      repo.writeFile('mix.txt', 'a1\nb\nc\n');
      await stageFile(repo.path, 'mix.txt');
      repo.writeFile('mix.txt', 'a1\nb\nc2\n');

      // Act
      const diff = await getFileDiff(repo.path, 'mix.txt');

      // Assert
      const addLines = diff.lines.filter((line) => line.type === 'add');
      expect(addLines.map((line) => line.right)).toContain('a1');
      expect(addLines.map((line) => line.right)).toContain('c2');
    });

    it('二进制新增文件应该以文本形式回退', async () => {
      // Arrange
      const repo = createTempGitRepo();
      const buffer = Buffer.from([1, 2, 3, 4]);
      repo.writeFile('binary-add.bin', buffer);

      // Act
      const diff = await getFileDiff(repo.path, 'binary-add.bin');

      // Assert
      expect(diff.lines.length).toBeGreaterThan(0);
    });

    it('删除后立即重新创建的文件应该展示最新diff', async () => {
      // Arrange
      const repo = createTempGitRepo();
      repo.touchAndCommit('recreate.txt', 'old\n');
      rmSync(path.join(repo.path, 'recreate.txt'));
      repo.writeFile('recreate.txt', 'new\n');

      // Act
      const diff = await getFileDiff(repo.path, 'recreate.txt');

      // Assert
      expect(diff.lines.some((line) => line.type === 'add')).toBe(true);
    });

    it('文件不存在但提交历史存在时应该返回删除内容', async () => {
      // Arrange
      const repo = createTempGitRepo();
      repo.touchAndCommit('history.txt', 'one\n');
      rmSync(path.join(repo.path, 'history.txt'));

      // Act
      const diff = await getFileDiff(repo.path, 'history.txt');

      // Assert
      expect(diff.lines.some((line) => line.type === 'del')).toBe(true);
    });
  });

  describe('错误处理', () => {
    it('getStatus传入不存在的路径应该返回空数组', async () => {
      // Arrange
      const missingPath = path.join(os.tmpdir(), `gitservice-missing-${Date.now()}`);

      // Act
      const result = await getStatus(missingPath);

      // Assert
      expect(result).toEqual([]);
    });

    it('stageFile在非Git目录应抛错', async () => {
      // Arrange
      const dir = mkdtempSync(path.join(os.tmpdir(), 'gitservice-nongit-stage-'));
      tempDirs.push(dir);
      writeFileSync(path.join(dir, 'file.txt'), 'data\n');

      // Act & Assert
      await expect(stageFile(dir, 'file.txt')).rejects.toThrow();
    });

    it('revertFile在非Git目录应抛错', async () => {
      // Arrange
      const dir = mkdtempSync(path.join(os.tmpdir(), 'gitservice-nongit-revert-'));
      tempDirs.push(dir);
      writeFileSync(path.join(dir, 'file.txt'), 'data\n');

      // Act & Assert
      await expect(revertFile(dir, 'file.txt')).rejects.toThrow();
    });

    it('getFileDiff在非Git目录且文件缺失时返回空数组', async () => {
      // Arrange
      const dir = mkdtempSync(path.join(os.tmpdir(), 'gitservice-nongit-diff-'));
      tempDirs.push(dir);

      // Act
      const diff = await getFileDiff(dir, 'ghost.txt');

      // Assert
      expect(diff.lines).toEqual([]);
    });

    it('移除.git目录后getStatus应该返回空数组', async () => {
      // Arrange
      const repo = createTempGitRepo();
      rmSync(path.join(repo.path, '.git'), { recursive: true, force: true });

      // Act
      const result = await getStatus(repo.path);

      // Assert
      expect(result).toEqual([]);
    });

    it('移除.git目录后stageFile应该抛错', async () => {
      // Arrange
      const repo = createTempGitRepo();
      repo.writeFile('lost.txt', 'data\n');
      rmSync(path.join(repo.path, '.git'), { recursive: true, force: true });

      // Act & Assert
      await expect(stageFile(repo.path, 'lost.txt')).rejects.toThrow();
    });

    it('移除.git目录后revertFile应该抛错', async () => {
      // Arrange
      const repo = createTempGitRepo();
      repo.touchAndCommit('lost.txt', 'data\n');
      repo.appendFile('lost.txt', 'change\n');
      rmSync(path.join(repo.path, '.git'), { recursive: true, force: true });

      // Act & Assert
      await expect(revertFile(repo.path, 'lost.txt')).rejects.toThrow();
    });

    it('移除.git目录后getFileDiff应该读取工作区文件', async () => {
      // Arrange
      const repo = createTempGitRepo();
      repo.touchAndCommit('lost.txt', 'data\n');
      repo.appendFile('lost.txt', 'change\n');
      rmSync(path.join(repo.path, '.git'), { recursive: true, force: true });

      // Act
      const diff = await getFileDiff(repo.path, 'lost.txt');

      // Assert
      expect(diff.lines.length).toBeGreaterThan(0);
      expect(diff.lines[0].type).toBe('add');
    });
  });

  describe('stageFile', () => {
    it('应该暂存已修改的文件', async () => {
      // Arrange
      const repo = createTempGitRepo();
      repo.touchAndCommit('stage.txt', 'one\n');
      repo.appendFile('stage.txt', 'two\n');

      // Act
      await stageFile(repo.path, 'stage.txt');

      // Assert
      const status = repo.git(['status', '--short', '--', 'stage.txt']).trim();
      expect(status.startsWith('M')).toBe(true);
    });

    it('应该暂存新创建的文件', async () => {
      // Arrange
      const repo = createTempGitRepo();
      repo.writeFile('fresh.txt', 'fresh\n');

      // Act
      await stageFile(repo.path, 'fresh.txt');

      // Assert
      const status = repo.git(['status', '--short', '--', 'fresh.txt']).trim();
      expect(status.startsWith('A')).toBe(true);
    });

    it('应该暂存子目录里的文件', async () => {
      // Arrange
      const repo = createTempGitRepo();
      repo.writeFile('sub/dir/file.txt', 'data\n');

      // Act
      await stageFile(repo.path, 'sub/dir/file.txt');

      // Assert
      const status = repo.git(['status', '--short', '--', 'sub/dir/file.txt']).trim();
      expect(status.startsWith('A')).toBe(true);
    });

    it.each([
      ['包含空格的路径', 'weird path/file name.txt'],
      ['包含特殊字符的路径', 'strange/[file]name?.md'],
      ['包含括号的路径', 'nested/(demo)/file!.ts'],
    ])('应该暂存%s', async (_title, relative) => {
      // Arrange
      const repo = createTempGitRepo();
      repo.writeFile(relative, 'value\n');

      // Act
      await stageFile(repo.path, relative);

      // Assert
      const status = repo.git(['status', '--short', '--', relative]).trim();
      expect(status.startsWith('A')).toBe(true);
    });

    it('应该暂存删除操作', async () => {
      // Arrange
      const repo = createTempGitRepo();
      repo.touchAndCommit('remove.txt', 'to remove\n');
      rmSync(path.join(repo.path, 'remove.txt'));

      // Act
      await stageFile(repo.path, 'remove.txt');

      // Assert
      const status = repo.git(['status', '--short', '--', 'remove.txt']).trim();
      expect(status.startsWith('D')).toBe(true);
    });

    it('文件不存在时应该抛出错误', async () => {
      // Arrange
      const repo = createTempGitRepo();

      // Act & Assert
      await expect(stageFile(repo.path, 'missing.txt')).rejects.toThrow();
    });

    it('.gitignore忽略的文件应该抛出错误', async () => {
      // Arrange
      const repo = createTempGitRepo();
      repo.writeFile('.gitignore', 'ignored.txt\n');
      await stageFile(repo.path, '.gitignore');
      repo.git(['commit', '-m', 'add ignore']);
      repo.writeFile('ignored.txt', 'secret\n');

      // Act & Assert
      await expect(stageFile(repo.path, 'ignored.txt')).rejects.toThrow();
    });

    it('禁止暂存仓库外的文件', async () => {
      // Arrange
      const repo = createTempGitRepo();
      const outside = path.join(repo.path, '..', 'outside.txt');
      writeFileSync(outside, 'outside\n');

      // Act & Assert
      await expect(stageFile(repo.path, '../outside.txt')).rejects.toThrow();

      rmSync(outside, { force: true });
    });

    it('重复暂存应该保持幂等', async () => {
      // Arrange
      const repo = createTempGitRepo();
      repo.writeFile('repeat.txt', 'one\n');

      // Act
      await stageFile(repo.path, 'repeat.txt');
      await stageFile(repo.path, 'repeat.txt');

      // Assert
      const status = repo.git(['status', '--short', '--', 'repeat.txt']).trim();
      expect(status.startsWith('A')).toBe(true);
    });

    it('应该处理大文件暂存', async () => {
      // Arrange
      const repo = createTempGitRepo();
      const bigContent = Array.from({ length: 1500 })
        .map((_, idx) => `line-${idx}`)
        .join('\n');
      repo.writeFile('big.txt', `${bigContent}\n`);

      // Act
      await stageFile(repo.path, 'big.txt');

      // Assert
      const status = repo.git(['status', '--short', '--', 'big.txt']).trim();
      expect(status.startsWith('A')).toBe(true);
    });

    it('stageFile后应该在getStatus中显示为staged', async () => {
      // Arrange
      const repo = createTempGitRepo();
      repo.touchAndCommit('combo.txt', 'one\n');
      repo.appendFile('combo.txt', 'two\n');

      // Act
      await stageFile(repo.path, 'combo.txt');
      const changes = await getStatus(repo.path);

      // Assert
      const change = getChangeByPath(changes, 'combo.txt');
      expect(change?.isStaged).toBe(true);
    });

    it('在提交后再次暂存更新应该成功', async () => {
      // Arrange
      const repo = createTempGitRepo();
      repo.writeFile('loop.txt', 'v1\n');
      await stageFile(repo.path, 'loop.txt');
      repo.git(['commit', '-m', 'add loop']);
      repo.appendFile('loop.txt', 'v2\n');

      // Act
      await stageFile(repo.path, 'loop.txt');

      // Assert
      const status = repo.git(['status', '--short', '--', 'loop.txt']).trim();
      expect(status.startsWith('M')).toBe(true);
    });
  });

  describe('getStatus', () => {
    it('应该在空仓库时返回空数组', async () => {
      // Arrange
      const repo = createTempGitRepo();

      // Act
      const changes = await getStatus(repo.path);

      // Assert
      expect(changes).toEqual([]);
    });

    it('非Git目录应该返回空数组', async () => {
      // Arrange
      const nonRepo = mkdtempSync(path.join(os.tmpdir(), 'gitservice-nonrepo-'));
      tempDirs.push(nonRepo);

      // Act
      const changes = await getStatus(nonRepo);

      // Assert
      expect(changes).toEqual([]);
    });

    it('应该检测未暂存的修改文件', async () => {
      // Arrange
      const repo = createTempGitRepo();
      repo.touchAndCommit('file.txt', 'line1\n');
      repo.appendFile('file.txt', 'line2\n');

      // Act
      const changes = await getStatus(repo.path);

      // Assert
      const change = getChangeByPath(changes, 'file.txt');
      expect(change?.status).toBe('modified');
      expect(change?.isStaged).toBe(false);
    });

    it('应该检测已暂存的修改文件', async () => {
      // Arrange
      const repo = createTempGitRepo();
      repo.touchAndCommit('file.txt', 'line1\n');
      repo.writeFile('file.txt', 'line1\nline2\n');
      repo.git(['add', 'file.txt']);

      // Act
      const changes = await getStatus(repo.path);

      // Assert
      const change = getChangeByPath(changes, 'file.txt');
      expect(change?.status).toBe('modified');
      expect(change?.isStaged).toBe(true);
    });

    it('应该识别新增且已暂存的文件', async () => {
      // Arrange
      const repo = createTempGitRepo();
      repo.writeFile('new-file.txt', 'hello\nworld\n');
      repo.git(['add', 'new-file.txt']);

      // Act
      const changes = await getStatus(repo.path);

      // Assert
      const change = getChangeByPath(changes, 'new-file.txt');
      expect(change?.status).toBe('added');
      expect(change?.isStaged).toBe(true);
      expect(change?.additions).toBeGreaterThan(0);
    });

    it('应该识别未跟踪的新文件并通过换行统计新增行', async () => {
      // Arrange
      const repo = createTempGitRepo();
      repo.writeFile('untracked.txt', 'a\nb\nc\n');

      // Act
      const changes = await getStatus(repo.path);

      // Assert
      const change = getChangeByPath(changes, 'untracked.txt');
      expect(change?.status).toBe('added');
      expect(change?.isStaged).toBe(false);
      expect(change?.additions).toBe(3);
    });

    it('应该识别被删除的文件', async () => {
      // Arrange
      const repo = createTempGitRepo();
      repo.touchAndCommit('to-delete.txt', 'data\n');
      repo.git(['rm', 'to-delete.txt']);

      // Act
      const changes = await getStatus(repo.path);

      // Assert
      const change = getChangeByPath(changes, 'to-delete.txt');
      expect(change?.status).toBe('deleted');
      expect(change?.isStaged).toBe(true);
    });

    it('应该识别被重命名的文件', async () => {
      // Arrange
      const repo = createTempGitRepo();
      repo.touchAndCommit('old.txt', 'value\n');
      repo.git(['mv', 'old.txt', 'new-name.txt']);

      // Act
      const changes = await getStatus(repo.path);

      // Assert
      const change = getChangeByPath(changes, 'new-name.txt');
      expect(change?.status).toBe('renamed');
    });

    it('应该忽略codex-stream.log', async () => {
      // Arrange
      const repo = createTempGitRepo();
      repo.writeFile('codex-stream.log', 'logs\n');
      repo.writeFile('keep.txt', '1\n');
      repo.git(['add', 'keep.txt']);
      repo.appendFile('keep.txt', '2\n');

      // Act
      const changes = await getStatus(repo.path);

      // Assert
      expect(getChangeByPath(changes, 'codex-stream.log')).toBeUndefined();
      expect(getChangeByPath(changes, 'keep.txt')).toBeDefined();
    });

    it.each([
      ['包含空格的文件名', 'folder/file name.txt'],
      ['包含特殊字符的文件名', 'folder/[test]-file?.txt'],
      ['深层嵌套文件名', 'deep/nested path/inner+file.txt'],
    ])('应该正确处理%s', async (_title, fileName) => {
      // Arrange
      const repo = createTempGitRepo();
      repo.touchAndCommit('base.txt', 'base\n');
      repo.writeFile(fileName, 'first\nsecond\n');
      repo.git(['add', '--', fileName]);
      repo.appendFile(fileName, 'third\n');

      // Act
      const changes = await getStatus(repo.path);

      // Assert
      const change = getChangeByPath(changes, fileName);
      expect(change?.status).toBeDefined();
      expect(change && change.path.replace(/^"|"$/g, '')).toBe(fileName);
    });

    it('应该合并staged与unstaged的行数统计', async () => {
      // Arrange
      const repo = createTempGitRepo();
      repo.touchAndCommit('stats.txt', 'line1\nline2\nline3\n');
      repo.writeFile('stats.txt', 'line1\nline2-2\nline3\nline4\n');
      repo.git(['add', 'stats.txt']);
      repo.appendFile('stats.txt', 'line5\n');

      // Act
      const changes = await getStatus(repo.path);

      // Assert
      const change = getChangeByPath(changes, 'stats.txt');
      expect(change?.additions).toBe(3);
      expect(change?.deletions).toBe(1);
    });

    it('应该在二进制文件上保持零行统计', async () => {
      // Arrange
      const repo = createTempGitRepo();
      repo.writeFile('binary.bin', Buffer.from([0, 1, 2, 3]));
      repo.git(['add', 'binary.bin']);
      repo.git(['commit', '-m', 'add binary']);
      repo.writeFile('binary.bin', Buffer.from([0, 1, 2, 3, 4, 5]));

      // Act
      const changes = await getStatus(repo.path);

      // Assert
      const change = getChangeByPath(changes, 'binary.bin');
      expect(change?.additions).toBe(0);
      expect(change?.deletions).toBe(0);
    });

    it('应该返回所有更改的有序列表', async () => {
      // Arrange
      const repo = createTempGitRepo();
      repo.touchAndCommit('a.txt', '1\n');
      repo.touchAndCommit('b.txt', '1\n');
      repo.touchAndCommit('c.txt', '1\n');
      repo.appendFile('a.txt', '2\n');
      repo.appendFile('b.txt', '2\n');
      repo.appendFile('c.txt', '2\n');

      // Act
      const changes = await getStatus(repo.path);

      // Assert
      expect(changes).toHaveLength(3);
      expect(changes.map((c) => c.path).sort()).toEqual(['a.txt', 'b.txt', 'c.txt']);
    });

    it('应该保留子目录的相对路径', async () => {
      // Arrange
      const repo = createTempGitRepo();
      repo.touchAndCommit('nested/file.txt', '1\n');
      repo.appendFile('nested/file.txt', '2\n');

      // Act
      const changes = await getStatus(repo.path);

      // Assert
      const change = getChangeByPath(changes, 'nested/file.txt');
      expect(change).toBeDefined();
    });

    it('AM状态的文件应该被视为staged', async () => {
      // Arrange
      const repo = createTempGitRepo();
      repo.writeFile('combo.txt', 'first\n');
      repo.git(['add', 'combo.txt']);
      repo.appendFile('combo.txt', 'second\n');

      // Act
      const changes = await getStatus(repo.path);

      // Assert
      const change = getChangeByPath(changes, 'combo.txt');
      expect(change?.isStaged).toBe(true);
      expect(change?.status).toBe('added');
    });

    it('??状态的文件应该标记为未暂存', async () => {
      // Arrange
      const repo = createTempGitRepo();
      repo.writeFile('question.txt', 'a\nb\n');

      // Act
      const changes = await getStatus(repo.path);

      // Assert
      const change = getChangeByPath(changes, 'question.txt');
      expect(change?.isStaged).toBe(false);
      expect(change?.status).toBe('added');
    });

    it('git diff失败时仍应返回已有信息', async () => {
      // Arrange
      const repo = createTempGitRepo();
      repo.touchAndCommit('broken.txt', '1\n');
      repo.appendFile('broken.txt', '2\n');
      const gitDir = path.join(repo.path, '.git');
      const hooksDir = path.join(gitDir, 'hooks');
      mkdirSync(hooksDir, { recursive: true });
      writeFileSync(path.join(hooksDir, 'diff'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
      repo.git(['config', 'diff.external', path.join(hooksDir, 'diff')]);

      // Act
      const changes = await getStatus(repo.path);

      // Assert
      const change = getChangeByPath(changes, 'broken.txt');
      expect(change?.status).toBe('modified');
    });

    it('git命令缺失时应该返回空数组', async () => {
      // Arrange
      const repo = createTempGitRepo();
      repo.appendFile('missing.txt', '1\n');
      const originalPath = process.env.PATH;
      process.env.PATH = '';

      try {
        // Act
        const changes = await getStatus(repo.path);

        // Assert
        expect(changes).toEqual([]);
      } finally {
        process.env.PATH = originalPath;
      }
    });
  });

  describe('端到端流程', () => {
    it('新增文件从创建到暂存再回滚', async () => {
      // Arrange
      const repo = createTempGitRepo();
      repo.writeFile('flow/new-file.txt', 'hello\n');

      // Act
      const initialStatus = await getStatus(repo.path);
      await stageFile(repo.path, 'flow/new-file.txt');
      const stagedStatus = await getStatus(repo.path);
      const revertResult = await revertFile(repo.path, 'flow/new-file.txt');
      const finalStatus = await getStatus(repo.path);
      const diff = await getFileDiff(repo.path, 'flow/new-file.txt');

      // Assert
      const initialChange =
        getChangeByPath(initialStatus, 'flow/new-file.txt') ?? getChangeByPath(initialStatus, 'flow/');
      expect(initialChange?.isStaged).toBe(false);
      expect(getChangeByPath(stagedStatus, 'flow/new-file.txt')?.isStaged).toBe(true);
      expect(revertResult.action).toBe('unstaged');
      const finalChange =
        getChangeByPath(finalStatus, 'flow/new-file.txt') ?? getChangeByPath(finalStatus, 'flow/');
      expect(finalChange?.isStaged).toBe(false);
      expect(diff.lines.every((line) => line.type === 'add')).toBe(true);
    });

    it('修改文件的暂存与双阶段回滚', async () => {
      // Arrange
      const repo = createTempGitRepo();
      repo.touchAndCommit('flow/edit.txt', 'v1\n');
      repo.writeFile('flow/edit.txt', 'v1\nv2\n');

      // Act
      await stageFile(repo.path, 'flow/edit.txt');
      const stagedDiff = await getFileDiff(repo.path, 'flow/edit.txt');
      const firstRevert = await revertFile(repo.path, 'flow/edit.txt');
      const midStatus = await getStatus(repo.path);
      const secondRevert = await revertFile(repo.path, 'flow/edit.txt');
      const finalStatus = await getStatus(repo.path);

      // Assert
      expect(stagedDiff.lines.some((line) => line.type === 'add')).toBe(true);
      expect(firstRevert.action).toBe('unstaged');
      expect(getChangeByPath(midStatus, 'flow/edit.txt')?.isStaged).toBe(false);
      expect(secondRevert.action).toBe('reverted');
      expect(finalStatus).toEqual([]);
    });

    it('删除文件后暂存并恢复', async () => {
      // Arrange
      const repo = createTempGitRepo();
      repo.touchAndCommit('flow/remove.txt', 'keep\n');
      rmSync(path.join(repo.path, 'flow/remove.txt'));

      // Act
      await stageFile(repo.path, 'flow/remove.txt');
      const statusAfterStage = await getStatus(repo.path);
      const revertStage = await revertFile(repo.path, 'flow/remove.txt');
      const revertWorking = await revertFile(repo.path, 'flow/remove.txt');
      const finalStatus = await getStatus(repo.path);
      const diff = await getFileDiff(repo.path, 'flow/remove.txt');

      // Assert
      expect(getChangeByPath(statusAfterStage, 'flow/remove.txt')?.status).toBe('deleted');
      expect(revertStage.action).toBe('unstaged');
      expect(revertWorking.action).toBe('reverted');
      expect(finalStatus).toEqual([]);
      expect(diff.lines.length).toBeGreaterThan(0);
      expect(diff.lines.every((line) => line.type === 'add')).toBe(true);
    });

    it('多文件场景中正确区分staged与unstaged', async () => {
      // Arrange
      const repo = createTempGitRepo();
      repo.touchAndCommit('flow/a.txt', '1\n');
      repo.touchAndCommit('flow/b.txt', 'x\n');
      repo.appendFile('flow/a.txt', '2\n');
      repo.appendFile('flow/b.txt', 'y\n');

      // Act
      await stageFile(repo.path, 'flow/a.txt');
      const status = await getStatus(repo.path);
      const diffA = await getFileDiff(repo.path, 'flow/a.txt');
      const diffB = await getFileDiff(repo.path, 'flow/b.txt');

      // Assert
      expect(getChangeByPath(status, 'flow/a.txt')?.isStaged).toBe(true);
      expect(getChangeByPath(status, 'flow/b.txt')?.isStaged).toBe(false);
      expect(diffA.lines.some((line) => line.type === 'add')).toBe(true);
      expect(diffB.lines.some((line) => line.type === 'add')).toBe(true);
    });

    it('重命名文件时保持diff和状态一致', async () => {
      // Arrange
      const repo = createTempGitRepo();
      repo.touchAndCommit('flow/old.txt', 'name\n');
      repo.git(['mv', 'flow/old.txt', 'flow/new.txt']);

      // Act
      const status = await getStatus(repo.path);
      const diff = await getFileDiff(repo.path, 'flow/new.txt');
      const revert = await revertFile(repo.path, 'flow/new.txt');

      // Assert
      expect(getChangeByPath(status, 'flow/new.txt')?.status).toBe('renamed');
      expect(diff.lines.length).toBeGreaterThan(0);
      expect(revert.action).toBe('unstaged');
    });

    it('二进制文件的修改流程', async () => {
      // Arrange
      const repo = createTempGitRepo();
      repo.writeFile('flow/image.bin', Buffer.from([1, 2, 3]));
      await stageFile(repo.path, 'flow/image.bin');
      repo.git(['commit', '-m', 'add bin']);
      repo.writeFile('flow/image.bin', Buffer.from([1, 2, 3, 4]));

      // Act
      const status = await getStatus(repo.path);
      const diff = await getFileDiff(repo.path, 'flow/image.bin');
      const revert = await revertFile(repo.path, 'flow/image.bin');

      // Assert
      expect(getChangeByPath(status, 'flow/image.bin')?.status).toBe('modified');
      expect(diff.lines.length).toBeGreaterThan(0);
      expect(revert.action).toBe('reverted');
    });

    it('新增修改删除组合流程', async () => {
      // Arrange
      const repo = createTempGitRepo();
      repo.touchAndCommit('flow/base.txt', 'base\n');
      repo.writeFile('flow/new.txt', 'n1\n');
      repo.appendFile('flow/base.txt', 'base-2\n');
      repo.touchAndCommit('flow/delete.txt', 'gone\n');
      rmSync(path.join(repo.path, 'flow/delete.txt'));

      // Act
      const statusBeforeStage = await getStatus(repo.path);
      await stageFile(repo.path, 'flow/base.txt');
      await stageFile(repo.path, 'flow/delete.txt');
      const statusAfterStage = await getStatus(repo.path);
      const diffNew = await getFileDiff(repo.path, 'flow/new.txt');
      const diffBase = await getFileDiff(repo.path, 'flow/base.txt');

      // Assert
      expect(getChangeByPath(statusBeforeStage, 'flow/new.txt')?.isStaged).toBe(false);
      expect(getChangeByPath(statusAfterStage, 'flow/base.txt')?.isStaged).toBe(true);
      expect(getChangeByPath(statusAfterStage, 'flow/delete.txt')?.status).toBe('deleted');
      expect(diffNew.lines.every((line) => line.type === 'add')).toBe(true);
      expect(diffBase.lines.some((line) => line.type === 'add')).toBe(true);
    });

    it('在暂存与回滚之间切换保持一致状态', async () => {
      // Arrange
      const repo = createTempGitRepo();
      repo.touchAndCommit('flow/toggle.txt', 'value\n');
      repo.appendFile('flow/toggle.txt', 'change1\n');

      // Act
      await stageFile(repo.path, 'flow/toggle.txt');
      await revertFile(repo.path, 'flow/toggle.txt');
      await stageFile(repo.path, 'flow/toggle.txt');
      repo.appendFile('flow/toggle.txt', 'change2\n');
      const status = await getStatus(repo.path);
      const diff = await getFileDiff(repo.path, 'flow/toggle.txt');

      // Assert
      expect(getChangeByPath(status, 'flow/toggle.txt')?.isStaged).toBe(true);
      expect(diff.lines.some((line) => line.type === 'add')).toBe(true);
    });
  });
});
