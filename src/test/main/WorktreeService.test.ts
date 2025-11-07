import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const commonFs = require('fs');
import fs, {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  chmodSync,
} from 'node:fs';
import { execFileSync, type ExecFileSyncOptions } from 'node:child_process';
import { WorktreeService, type WorktreeInfo } from '../../main/services/WorktreeService';
import * as appSettingsModule from '../../main/settings';

vi.mock('electron', () => ({
  app: {
    getPath: () => path.join(os.tmpdir(), 'electron-mock'),
  },
}));
type TestAppSettings = {
  repository: {
    branchTemplate: string;
    pushOnCreate: boolean;
  };
  projectPrep: {
    autoInstallOnOpenInEditor: boolean;
  };
};

const { defaultSettings, settingsStore } = vi.hoisted(() => {
  const defaults: TestAppSettings = {
    repository: {
      branchTemplate: 'agent/{slug}-{timestamp}',
      pushOnCreate: false,
    },
    projectPrep: {
      autoInstallOnOpenInEditor: true,
    },
  };
  return {
    defaultSettings: defaults,
    settingsStore: {
      current: JSON.parse(JSON.stringify(defaults)) as TestAppSettings,
    },
  };
});

type TempRepo = {
  root: string;
  git: (args: string[], options?: ExecFileSyncOptions) => string;
  defaultBranch: string;
  remote?: string;
};

type MutableFsPromises = typeof fs.promises & {
  rm: typeof fs.promises.rm;
};

const tempPaths: Set<string> = new Set();

const registerPath = (p: string) => {
  tempPaths.add(p);
  return p;
};

const ensureDir = (dir: string) => {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
};

const createTempRepo = (options?: {
  defaultBranch?: string;
  createRemote?: boolean;
  initialFiles?: Record<string, string>;
  pushInitialToRemote?: boolean;
}): TempRepo => {
  const tempRoot = registerPath(mkdtempSync(path.join(os.tmpdir(), 'worktree-service-repo-')));
  const root = fs.realpathSync(tempRoot);
  if (root !== tempRoot) {
    registerPath(root);
  }
  const git = (args: string[], extra?: ExecFileSyncOptions) =>
    execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: 'pipe',
      ...extra,
    }).toString();

  git(['init']);
  git(['config', 'user.email', 'worktree@test.dev']);
  git(['config', 'user.name', 'Worktree Tester']);

  const baseFiles = options?.initialFiles ?? { 'README.md': '# seed\n' };
  for (const [rel, content] of Object.entries(baseFiles)) {
    const target = path.join(root, rel);
    ensureDir(path.dirname(target));
    writeFileSync(target, content);
  }

  git(['add', '--all']);
  git(['commit', '--allow-empty', '-m', 'initial commit']);

  const defaultBranch = options?.defaultBranch ?? 'main';
  git(['branch', '-M', defaultBranch]);

  let remotePath: string | undefined;
  if (options?.createRemote) {
    remotePath = registerPath(mkdtempSync(path.join(os.tmpdir(), 'worktree-service-remote-')));
    execFileSync('git', ['init', '--bare'], { cwd: remotePath, stdio: 'ignore' });
    execFileSync('git', ['symbolic-ref', 'HEAD', `refs/heads/${defaultBranch}`], {
      cwd: remotePath,
      stdio: 'ignore',
    });
    git(['remote', 'add', 'origin', remotePath]);
    if (options?.pushInitialToRemote !== false) {
      git(['push', '-u', 'origin', defaultBranch]);
    }
  }

  const siblingWorktrees = path.join(path.dirname(root), 'worktrees');
  registerPath(siblingWorktrees);

  return {
    root,
    git,
    defaultBranch,
    remote: remotePath,
  };
};

const resetSettings = (overrides?: Partial<TestAppSettings['repository']>) => {
  settingsStore.current = {
    repository: {
      ...defaultSettings.repository,
      ...(overrides ?? {}),
    },
    projectPrep: { ...defaultSettings.projectPrep },
  };
};

const cleanupPaths = () => {
  for (const dir of Array.from(tempPaths.values()).sort((a, b) => b.length - a.length)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
  tempPaths.clear();
};

const createFile = (repo: TempRepo, relativePath: string, content: string) => {
  const target = path.join(repo.root, relativePath);
  ensureDir(path.dirname(target));
  writeFileSync(target, content);
};

const commitAll = (repo: TempRepo, message: string) => {
  repo.git(['add', '--all']);
  repo.git(['commit', '-m', message]);
};

const setupFeatureBranch = (repo: TempRepo, branch: string, fileName: string) => {
  repo.git(['checkout', '-b', branch]);
  createFile(repo, fileName, `content for ${branch}\n`);
  commitAll(repo, `feat: ${branch}`);
  repo.git(['checkout', repo.defaultBranch]);
};

const readExcludeFilePath = (worktreePath: string) => {
  const gitMeta = path.join(worktreePath, '.git');
  if (existsSync(gitMeta) && statSync(gitMeta).isFile()) {
    const content = readFileSync(gitMeta, 'utf8');
    const match = content.match(/gitdir:\s*(.*)\s*$/i);
    if (match?.[1]) {
      const raw = match[1].trim();
      const resolved = path.isAbsolute(raw) ? raw : path.resolve(worktreePath, raw);
      return path.join(resolved, 'info', 'exclude');
    }
  }
  return path.join(gitMeta, 'info', 'exclude');
};

type WorktreeServicePrivateAPI = {
  slugify: (name: string) => string;
  sanitizeBranchName: (name: string) => string;
  renderBranchNameTemplate: (template: string, ctx: { slug: string; timestamp: string }) => string;
  stableIdFromPath: (worktreePath: string) => string;
  extractTemplatePrefix: (template?: string) => string | null;
  ensureCodexLogIgnored: (worktreePath: string) => void;
};
type WorktreeServicePrivateMethod = keyof WorktreeServicePrivateAPI;
type WorktreeServicePrivateParams<M extends WorktreeServicePrivateMethod> =
  WorktreeServicePrivateAPI[M] extends (...args: infer P) => unknown ? P : never;
type WorktreeServicePrivateReturn<M extends WorktreeServicePrivateMethod> =
  WorktreeServicePrivateAPI[M] extends (...args: never[]) => infer R ? R : never;

const getPrivateAPI = (instance: WorktreeService): WorktreeServicePrivateAPI =>
  instance as unknown as WorktreeServicePrivateAPI;

const callHelper = <M extends WorktreeServicePrivateMethod>(
  instance: WorktreeService,
  method: M,
  ...args: WorktreeServicePrivateParams<M>
): WorktreeServicePrivateReturn<M> => {
  const api = getPrivateAPI(instance);
  const fn = api[method] as unknown as (
    ...innerArgs: WorktreeServicePrivateParams<M>
  ) => WorktreeServicePrivateReturn<M>;
  return fn.apply(api, args as WorktreeServicePrivateParams<M>);
};

type WorktreeServiceInternals = {
  worktrees: Map<string, WorktreeInfo>;
};

const getWorktreeStore = (instance: WorktreeService): Map<string, WorktreeInfo> =>
  (instance as unknown as WorktreeServiceInternals).worktrees;

const trackWorktreeInfo = (info: WorktreeInfo) => {
  registerPath(info.path);
  return info;
};

const normalizePath = (input: string) => {
  const resolved = path.resolve(input);
  try {
    return fs.realpathSync(resolved);
  } catch {
    if (resolved.startsWith('/var/')) {
      return resolved.replace(/^\/var\//, '/private/var/');
    }
    return resolved;
  }
};

const hasFileMatch = (files: string[], expected: string) => {
  const trimmed = expected.slice(1);
  return files.some(
    (file) => file === expected || file.endsWith(expected) || (trimmed && file.endsWith(trimmed)) || file.includes(expected)
  );
};

const gitInPath = (cwd: string, args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).toString();

describe.sequential('WorktreeService', () => {
  let service: WorktreeService;

  beforeEach(() => {
    service = new WorktreeService();
    resetSettings();
    vi.spyOn(appSettingsModule, 'getAppSettings').mockImplementation(() => settingsStore.current);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    cleanupPaths();
  });

  describe('helper methods', () => {
    const slugCases = [
      { name: 'Alpha Workspace', expected: 'alpha-workspace' },
      { name: 'Feature__Name', expected: 'feature-name' },
      { name: 'Long   Spaces', expected: 'long-spaces' },
      { name: 'MIXEDCase', expected: 'mixedcase' },
      { name: '中文 名称', expected: '' },
      { name: 'dash-name', expected: 'dash-name' },
      { name: 'trim-', expected: 'trim' },
      { name: '--leading trailing--', expected: 'leading-trailing' },
      { name: 'special!@#chars', expected: 'special-chars' },
      { name: 'numbers123', expected: 'numbers123' },
      { name: 'multi---dash', expected: 'multi-dash' },
      { name: ' spaces ', expected: 'spaces' },
      { name: 'nu/xi', expected: 'nu-xi' },
      { name: 'omicron.name', expected: 'omicron-name' },
      { name: 'Pi_PI', expected: 'pi-pi' },
      { name: 'rho\tvalue', expected: 'rho-value' },
      { name: 'sigma😊sigma', expected: 'sigma-sigma' },
      { name: 'tau__--__tau', expected: 'tau-tau' },
    ];

    describe.each(slugCases)('slugify', ({ name, expected }) => {
      it(`应该将"${name}"转为"${expected}"`, () => {
        // Arrange
        const instance = service;

        // Act
        const result = callHelper(instance, 'slugify', name);

        // Assert
        expect(result).toBe(expected);
      });
    });

    const sanitizeCases = [
      { input: 'Feature Branch', expected: 'Feature-Branch' },
      { input: 'agent/child', expected: 'agent/child' },
      { input: 'bad?branch', expected: 'bad-branch' },
      { input: 'multi  spaces', expected: 'multi-spaces' },
      { input: 'HEAD', expectedPrefix: 'agent/workspace-' },
      { input: './leading', expected: 'leading' },
      { input: 'trailing/.', expected: 'trailing' },
      { input: 'invalid*chars', expected: 'invalid-chars' },
      { input: 'slash//collapse', expected: 'slash/collapse' },
      { input: 'underscore_ok', expected: 'underscore_ok' },
      { input: '__trim__', expected: '__trim__' },
      { input: 'dot.name', expected: 'dot.name' },
      { input: 'refs/heads/test', expected: 'refs/heads/test' },
      { input: '...lead', expected: 'lead' },
      { input: '////multi////', expected: 'multi' },
      { input: 'branch.name.with.dots', expected: 'branch.name.with.dots' },
    ];

    describe.each(sanitizeCases)('sanitizeBranchName', (scenario) => {
      it(`应该规范化分支 "${scenario.input}"`, () => {
        // Arrange
        const instance = service;

        // Act
        const result = callHelper(instance, 'sanitizeBranchName', scenario.input);

        // Assert
        if (scenario.expected) {
          expect(result).toBe(scenario.expected);
        } else if (scenario.expectedPrefix) {
          expect(result.startsWith(scenario.expectedPrefix)).toBe(true);
        }
      });
    });

    const renderCases = [
      {
        template: 'agent/{slug}-{timestamp}',
        slug: 'feature',
        pattern: /^agent\/feature-\d+$/,
      },
      {
        template: 'orch/{timestamp}/{slug}',
        slug: 'task',
        pattern: /^orch\/\d+\/task$/,
      },
      {
        template: 'prefix-static',
        slug: 'task',
        pattern: /^prefix-static$/,
      },
      {
        template: 'team/{slug}/slot/{timestamp}/end',
        slug: 'alpha',
        pattern: /^team\/alpha\/slot\/\d+\/end$/,
      },
      {
        template: 'spaces {slug}',
        slug: 'beta',
        pattern: /^spaces-beta$/,
      },
      {
        template: '{slug}-{slug}-{timestamp}',
        slug: 'combo',
        pattern: /^combo-combo-\d+$/,
      },
      {
        template: 'prefix/{slug}/suffix',
        slug: 'omega',
        pattern: /^prefix\/omega\/suffix$/,
      },
    ];

    describe.each(renderCases)('renderBranchNameTemplate', ({ template, slug, pattern }) => {
      it(`应该根据模板 "${template}" 渲染`, () => {
        // Arrange
        const instance = service;
        const timestamp = String(Date.now());

        // Act
      const branch = callHelper(instance, 'renderBranchNameTemplate', template, {
          slug,
          timestamp,
        });

        // Assert
        expect(branch).toMatch(pattern);
      });
    });

    it('stableIdFromPath 应该对相同路径生成一致 ID', () => {
      // Arrange
      const instance = service;
      const first = '/tmp/path-one';
      const second = '/tmp/path-one';

      // Act
      const id1 = callHelper(instance, 'stableIdFromPath', first);
      const id2 = callHelper(instance, 'stableIdFromPath', second);

      // Assert
      expect(id1).toBe(id2);
    });

    it('stableIdFromPath 应该区分不同路径', () => {
      // Arrange
      const instance = service;

      // Act
      const id1 = callHelper(instance, 'stableIdFromPath', '/tmp/a');
      const id2 = callHelper(instance, 'stableIdFromPath', '/tmp/b');

      // Assert
      expect(id1).not.toBe(id2);
    });

    const templatePrefixCases = [
      { template: 'agent/{slug}-{timestamp}', expected: 'agent' },
      { template: 'pr/{slug}', expected: 'pr' },
      { template: 'orch/{timestamp}', expected: 'orch' },
      { template: ' custom /{slug}', expected: 'custom' },
      { template: '{slug}-{timestamp}', expected: null },
      { template: '', expected: null },
      { template: undefined, expected: null },
      { template: 'prefix.with.dots/{slug}', expected: 'prefix.with.dots' },
      { template: 'mainprefix', expected: 'mainprefix' },
      { template: './agent/{slug}', expected: null },
      { template: 'custom-prefix/{slug}/{timestamp}', expected: 'custom-prefix' },
      { template: 'complex/path/value/{slug}', expected: 'complex' },
    ];

    describe.each(templatePrefixCases)('extractTemplatePrefix', ({ template, expected }) => {
      it(`模板 "${template ?? 'undefined'}" 应该得到 ${expected}`, () => {
        // Arrange
        const instance = service;

        // Act
        const prefix = callHelper(instance, 'extractTemplatePrefix', template);

        // Assert
        expect(prefix).toBe(expected);
      });
    });

    it('ensureCodexLogIgnored 应该在标准 .git 目录添加配置', () => {
      // Arrange
      const repoDir = registerPath(mkdtempSync(path.join(os.tmpdir(), 'worktree-helper-git-')));
      const gitDir = path.join(repoDir, '.git');
      ensureDir(path.join(gitDir, 'info'));

      // Act
      callHelper(service, 'ensureCodexLogIgnored', repoDir);

      // Assert
      const excludePath = path.join(gitDir, 'info', 'exclude');
      const content = readFileSync(excludePath, 'utf8');
      expect(content.includes('codex-stream.log')).toBe(true);
    });

    it('ensureCodexLogIgnored 应该处理 worktree gitdir 文件', () => {
      // Arrange
      const worktreeDir = registerPath(mkdtempSync(path.join(os.tmpdir(), 'worktree-helper-wt-')));
      const actualGitDir = registerPath(mkdtempSync(path.join(os.tmpdir(), 'worktree-helper-actual-')));
      ensureDir(path.join(actualGitDir, 'info'));
      writeFileSync(path.join(worktreeDir, '.git'), `gitdir: ${actualGitDir}\n`);

      // Act
      callHelper(service, 'ensureCodexLogIgnored', worktreeDir);

      // Assert
      const excludePath = path.join(actualGitDir, 'info', 'exclude');
      const content = readFileSync(excludePath, 'utf8');
      expect(content.trim()).toBe('codex-stream.log');
    });

    it('ensureCodexLogIgnored 不应重复追加条目', () => {
      // Arrange
      const repoDir = registerPath(mkdtempSync(path.join(os.tmpdir(), 'worktree-helper-dupe-')));
      const gitDir = path.join(repoDir, '.git');
      ensureDir(path.join(gitDir, 'info'));
      const excludePath = path.join(gitDir, 'info', 'exclude');
      writeFileSync(excludePath, 'codex-stream.log\n');

      // Act
      callHelper(service, 'ensureCodexLogIgnored', repoDir);

      // Assert
      const content = readFileSync(excludePath, 'utf8');
      const occurrences = content.split('codex-stream.log').length - 1;
      expect(occurrences).toBe(1);
    });
  });

  describe('createWorktree', () => {
    const workspaceCases = [
      { name: 'Alpha Space', slug: 'alpha-space' },
      { name: 'Beta__Value', slug: 'beta-value' },
      { name: 'Gamma-Feature', slug: 'gamma-feature' },
      { name: 'Delta ✨', slug: '' },
      { name: 'epsilon', slug: 'epsilon' },
      { name: 'ZETA MIX', slug: 'zeta-mix' },
      { name: 'eta/new', slug: 'eta-new' },
      { name: 'theta.special', slug: 'theta-special' },
      { name: 'iota test', slug: 'iota-test' },
      { name: 'kappa!!!!!', slug: 'kappa' },
      { name: 'lam-bda', slug: 'lam-bda' },
      { name: 'mu??mu', slug: 'mu-mu' },
      { name: 'nu workspace', slug: 'nu-workspace' },
      { name: 'xi_workspace', slug: 'xi-workspace' },
      { name: 'omicron.om', slug: 'omicron-om' },
      { name: 'pi/branch', slug: 'pi-branch' },
    ];

    describe.each(workspaceCases)('路径与Slug校验', ({ name, slug }) => {
      it(`应该创建 ${name} 的工作树`, async () => {
        // Arrange
        const repo = createTempRepo();

        // Act
        const info = trackWorktreeInfo(await service.createWorktree(repo.root, name, 'proj-1'));

        // Assert
        const worktreesRoot = path.join(path.dirname(repo.root), 'worktrees');
        expect(info.path.startsWith(worktreesRoot)).toBe(true);
        if (slug) {
          expect(path.basename(info.path).startsWith(`${slug}-`)).toBe(true);
        }
        expect(existsSync(info.path)).toBe(true);
      });
    });

    const templateCases = [
      { template: 'agent/{slug}-{timestamp}', matcher: /^agent\/.+-\d+$/ },
      { template: 'pr/{timestamp}-{slug}', matcher: /^pr\/\d+-[a-z0-9-]+$/ },
      { template: 'orch/{slug}', matcher: /^orch\/[a-z0-9-]+$/ },
      { template: 'team.alpha/{slug}/{timestamp}', matcher: /^team.alpha\/[a-z0-9-]+\/\d+$/ },
      { template: 'prefix-only', matcher: /^prefix-only$/ },
      { template: 'combo_{slug}_{timestamp}', matcher: /^combo_[a-z0-9-]+_\d+$/ },
    ];

    describe.each(templateCases)('分支模板', ({ template, matcher }) => {
      it(`应该根据模板 ${template} 生成分支`, async () => {
        // Arrange
        const repo = createTempRepo();
        resetSettings({ branchTemplate: template });

        // Act
        const info = trackWorktreeInfo(await service.createWorktree(repo.root, 'Template Name', 'proj-2'));

        // Assert
        expect(info.branch).toMatch(matcher);
      });
    });

    it('应该在工作树中忽略 codex-stream.log', async () => {
      // Arrange
      const repo = createTempRepo();

      // Act
      const info = trackWorktreeInfo(await service.createWorktree(repo.root, 'Ignore Log', 'proj-3'));

      // Assert
      const excludePath = readExcludeFilePath(info.path);
      const content = readFileSync(excludePath, 'utf8');
      expect(content.includes('codex-stream.log')).toBe(true);
    });

    it('目录已存在时应该抛错', async () => {
      // Arrange
      const repo = createTempRepo();
      vi.useFakeTimers();
      const fixed = new Date('2024-01-01T00:00:00Z');
      vi.setSystemTime(fixed);
      const slug = callHelper(service, 'slugify', 'Existing Dir');
      const existingPath = path.join(path.dirname(repo.root), 'worktrees', `${slug}-${fixed.getTime()}`);
      ensureDir(existingPath);
      registerPath(existingPath);

      // Act & Assert
      await expect(service.createWorktree(repo.root, 'Existing Dir', 'proj-4')).rejects.toThrow(
        /Worktree directory already exists/
      );
      vi.useRealTimers();
    });

    it('权限不足时应该抛出失败', async () => {
      // Arrange
      const repo = createTempRepo();
      const parent = path.join(path.dirname(repo.root), 'worktrees');
      ensureDir(parent);
      chmodSync(parent, 0o400);

      try {
        // Act & Assert
        await expect(service.createWorktree(repo.root, 'No Perm', 'proj-5')).rejects.toThrow(
          /Failed to create worktree/
        );
      } finally {
        chmodSync(parent, 0o700);
      }
    });

    it('pushOnCreate=true 时应该推送到 origin', async () => {
      // Arrange
      const repo = createTempRepo({ createRemote: true });
      resetSettings({ pushOnCreate: true });

      // Act
      const info = trackWorktreeInfo(await service.createWorktree(repo.root, 'Need Push', 'proj-6'));

      // Assert
      const refs = repo.git(['ls-remote', '--heads', 'origin', info.branch]).trim();
      expect(refs.endsWith(info.branch)).toBe(true);
    });

    it('push 失败时不应该中断创建', async () => {
      // Arrange
      const repo = createTempRepo();
      repo.git(['remote', 'add', 'origin', '/non/existing/path']);
      resetSettings({ pushOnCreate: true });

      // Act
      const info = trackWorktreeInfo(await service.createWorktree(repo.root, 'Push Fail', 'proj-7'));

      // Assert
      expect(info.branch.length).toBeGreaterThan(0);
    });

    it('应该注册 Worktree 信息到内存', async () => {
      // Arrange
      const repo = createTempRepo();

      // Act
      const info = trackWorktreeInfo(await service.createWorktree(repo.root, 'Memory Entry', 'proj-8'));

      // Assert
      expect(service.getWorktree(info.id)).toMatchObject({
        id: info.id,
        branch: info.branch,
        path: info.path,
      });
    });

    it('并发创建相同名称应该生成不同目录', async () => {
      // Arrange
      const repo = createTempRepo();
      const baseTime = Date.now();
      const nowSpy = vi
        .spyOn(Date, 'now')
        .mockImplementationOnce(() => baseTime)
        .mockImplementationOnce(() => baseTime + 1);

      // Act
      const [first, second] = await Promise.all([
        service.createWorktree(repo.root, 'Concurrent', 'proj-9').then(trackWorktreeInfo),
        service.createWorktree(repo.root, 'Concurrent', 'proj-9').then(trackWorktreeInfo),
      ]);

      // Assert
      expect(first.path).not.toBe(second.path);
      expect(first.branch).not.toBe(second.branch);
      nowSpy.mockRestore();
    });

    it('应该在 slug 为空时仍创建目录', async () => {
      // Arrange
      const repo = createTempRepo();

      // Act
      const info = trackWorktreeInfo(await service.createWorktree(repo.root, '!!!@@@###', 'proj-10'));

      // Assert
      expect(path.basename(info.path)).toMatch(/^-\d+$/);
    });
  });

  describe('createWorktreeFromBranch', () => {
    const branchCases = [
      { branch: 'feature/alpha', workspace: 'Alpha Branch' },
      { branch: 'feature/beta', workspace: 'Beta Workspace' },
      { branch: 'feature/gamma', workspace: 'Gamma Tasks' },
      { branch: 'feature/delta', workspace: 'DeltaCase' },
      { branch: 'hotfix/epsilon', workspace: 'Epsilon Fix' },
      { branch: 'bugfix/zeta', workspace: 'Zeta Bug' },
      { branch: 'release/eta', workspace: 'Eta Release' },
      { branch: 'experiment/theta', workspace: 'Theta Experiment' },
      { branch: 'feature/iota', workspace: 'Iota Steps' },
      { branch: 'feature/kappa', workspace: 'Kappa Tests' },
      { branch: 'long/name/with/slash', workspace: 'Long Slash' },
      { branch: 'capsLOCK', workspace: 'Caps Lock' },
      { branch: 'release/lambda', workspace: 'Lambda Release' },
      { branch: 'hotfix/mu', workspace: 'Mu Hotfix' },
      { branch: 'topic/nu', workspace: 'Nu Topic' },
      { branch: 'experiment/xi', workspace: 'Xi Experiment' },
    ];

    describe.each(branchCases)('创建指定分支的工作树', ({ branch, workspace }) => {
      it(`应该基于 ${branch} 创建工作树`, async () => {
        // Arrange
        const repo = createTempRepo();
        setupFeatureBranch(repo, branch, `${branch.replace(/\//g, '_')}.txt`);

        // Act
        const info = trackWorktreeInfo(
          await service.createWorktreeFromBranch(repo.root, workspace, branch, 'proj-branch')
        );

        // Assert
        expect(info.branch).toBe(branch);
        expect(info.name).toBe(workspace);
        expect(existsSync(info.path)).toBe(true);
      });
    });

    it('应该允许自定义工作树路径', async () => {
      // Arrange
      const repo = createTempRepo();
      setupFeatureBranch(repo, 'feature/custom-path', 'custom.txt');
      const customPath = registerPath(path.join(os.tmpdir(), `custom-worktree-${Date.now()}`));

      // Act
      const info = await service.createWorktreeFromBranch(
        repo.root,
        'Custom Path',
        'feature/custom-path',
        'proj-custom',
        { worktreePath: customPath }
      );

      // Assert
      expect(info.path).toBe(path.resolve(customPath));
      expect(existsSync(customPath)).toBe(true);
    });

    it('workspaceName 为空时应该回退到分支名', async () => {
      // Arrange
      const repo = createTempRepo();
      setupFeatureBranch(repo, 'feature/fallback', 'fallback.txt');

      // Act
      const info = trackWorktreeInfo(
        await service.createWorktreeFromBranch(repo.root, '', 'feature/fallback', 'proj-empty')
      );

      // Assert
      expect(info.name).toContain('feature-fallback');
    });

    it('目标目录已存在时应该抛错', async () => {
      // Arrange
      const repo = createTempRepo();
      setupFeatureBranch(repo, 'feature/exist', 'exist.txt');
      const existing = registerPath(path.join(os.tmpdir(), `existing-${Date.now()}`));
      ensureDir(existing);

      // Act & Assert
      await expect(
        service.createWorktreeFromBranch(repo.root, 'Existing', 'feature/exist', 'proj-exist', {
          worktreePath: existing,
        })
      ).rejects.toThrow(/already exists/);
    });

    it('分支不存在时应该抛错', async () => {
      // Arrange
      const repo = createTempRepo();

      // Act & Assert
      await expect(
        service.createWorktreeFromBranch(repo.root, 'Missing Branch', 'feature/missing', 'proj-missing')
      ).rejects.toThrow(/Failed to create worktree/);
    });

    it('应该忽略 codex 日志文件', async () => {
      // Arrange
      const repo = createTempRepo();
      setupFeatureBranch(repo, 'feature/log', 'log.txt');

      // Act
      const info = trackWorktreeInfo(
        await service.createWorktreeFromBranch(repo.root, 'Ensure Log', 'feature/log', 'proj-log')
      );

      // Assert
      const excludePath = readExcludeFilePath(info.path);
      const content = readFileSync(excludePath, 'utf8');
      expect(content.includes('codex-stream.log')).toBe(true);
    });

    it('应该注册在 WorktreeService 内存中', async () => {
      // Arrange
      const repo = createTempRepo();
      setupFeatureBranch(repo, 'feature/register', 'register.txt');

      // Act
      const info = trackWorktreeInfo(
        await service.createWorktreeFromBranch(repo.root, 'Register', 'feature/register', 'proj-register')
      );

      // Assert
      expect(service.getAllWorktrees().map((wt) => wt.id)).toContain(info.id);
    });

    it('应该返回稳定的 worktree id', async () => {
      // Arrange
      const repo = createTempRepo();
      setupFeatureBranch(repo, 'feature/stable', 'stable.txt');

      // Act
      const info = trackWorktreeInfo(
        await service.createWorktreeFromBranch(repo.root, 'Stable', 'feature/stable', 'proj-stable')
      );
      const second = callHelper(service, 'stableIdFromPath', info.path);

      // Assert
      expect(info.id).toBe(second);
    });

    it('应该创建分支包含斜杠的工作树', async () => {
      // Arrange
      const repo = createTempRepo();
      setupFeatureBranch(repo, 'feature/with/slash', 'with-slash.txt');

      // Act
      const info = trackWorktreeInfo(
        await service.createWorktreeFromBranch(
          repo.root,
          'Slash Branch',
          'feature/with/slash',
          'proj-slash'
        )
      );

      // Assert
      expect(info.branch).toBe('feature/with/slash');
      expect(existsSync(info.path)).toBe(true);
    });
  });

  describe('listWorktrees', () => {
    it('没有额外工作树时应该返回空数组', async () => {
      // Arrange
      const repo = createTempRepo();

      // Act
      const worktrees = await service.listWorktrees(repo.root);

      // Assert
      expect(worktrees).toEqual([]);
    });

    it('应该列出通过 createWorktree 创建的工作树', async () => {
      // Arrange
      const repo = createTempRepo();
      const first = trackWorktreeInfo(await service.createWorktree(repo.root, 'List One', 'proj-list'));
      const second = trackWorktreeInfo(await service.createWorktree(repo.root, 'List Two', 'proj-list'));

      // Act
      const worktrees = await service.listWorktrees(repo.root);

      // Assert
      expect(worktrees.map((wt) => normalizePath(wt.path))).toEqual(
        expect.arrayContaining([normalizePath(first.path), normalizePath(second.path)])
      );
    });

    it('应该根据模板前缀过滤 managed 分支', async () => {
      // Arrange
      const repo = createTempRepo();
      resetSettings({ branchTemplate: 'orch/{slug}-{timestamp}' });
      const info = trackWorktreeInfo(await service.createWorktree(repo.root, 'Orch Case', 'proj-list2'));

      // Act
      const worktrees = await service.listWorktrees(repo.root);

      // Assert
      expect(worktrees.some((wt) => wt.branch.startsWith('orch/'))).toBe(true);
      expect(worktrees.some((wt) => normalizePath(wt.path) === normalizePath(info.path))).toBe(true);
    });

    it('未被跟踪且非 managed 分支应该被忽略', async () => {
      // Arrange
      const repo = createTempRepo();
      registerPath(path.join(path.dirname(repo.root), 'external-worktree'));

      // Act
      const worktrees = await service.listWorktrees(repo.root);

      // Assert
      expect(worktrees).toEqual([]);
    });

    it('手动创建的 managed 分支也应该被列出', async () => {
      // Arrange
      const repo = createTempRepo();
      const managedPath = registerPath(path.join(path.dirname(repo.root), 'worktrees', `agent-manual-${Date.now()}`));
      ensureDir(path.dirname(managedPath));
      repo.git(['worktree', 'add', '-b', 'agent/manual-case', managedPath]);

      // Act
      const worktrees = await service.listWorktrees(repo.root);

      // Assert
      expect(worktrees.some((wt) => wt.branch === 'agent/manual-case')).toBe(true);
    });

    it('非 managed 但已跟踪的工作树应该被保留', async () => {
      // Arrange
      const repo = createTempRepo();
      const externalPath = registerPath(path.join(path.dirname(repo.root), 'external-wt'));
      repo.git(['branch', 'manual/external', repo.defaultBranch]);
      repo.git(['worktree', 'add', externalPath, 'manual/external']);
      const info: WorktreeInfo = {
        id: callHelper(service, 'stableIdFromPath', externalPath),
        name: 'External',
        branch: 'manual/external',
        path: externalPath,
        projectId: 'proj-external',
        status: 'active',
        createdAt: new Date().toISOString(),
      };
      getWorktreeStore(service).set(info.id, info);

      // Act
      const worktrees = await service.listWorktrees(repo.root);

      // Assert
      expect(worktrees.some((wt) => normalizePath(wt.path) === normalizePath(externalPath))).toBe(true);
    });

    it('损坏的工作树目录也应该被返回', async () => {
      // Arrange
      const repo = createTempRepo();
      const info = trackWorktreeInfo(await service.createWorktree(repo.root, 'Broken Entry', 'proj-broken'));
      rmSync(info.path, { recursive: true, force: true });

      // Act
      const worktrees = await service.listWorktrees(repo.root);

      // Assert
      expect(worktrees.some((wt) => normalizePath(wt.path) === normalizePath(info.path))).toBe(true);
    });

    it('listWorktrees 应该重用现有的 WorktreeInfo 引用', async () => {
      // Arrange
      const repo = createTempRepo();
      const info = trackWorktreeInfo(await service.createWorktree(repo.root, 'Reuse Entry', 'proj-reuse'));

      // Act
      const [firstCall, secondCall] = await Promise.all([
        service.listWorktrees(repo.root),
        service.listWorktrees(repo.root),
      ]);

      // Assert
      const entryA = firstCall.find((wt) => normalizePath(wt.path) === normalizePath(info.path));
      const entryB = secondCall.find((wt) => normalizePath(wt.path) === normalizePath(info.path));
      expect(entryA?.id).toBe(entryB?.id);
    });

    it('应该正确解析多个 worktree 输出', async () => {
      // Arrange
      const repo = createTempRepo();
      trackWorktreeInfo(await service.createWorktree(repo.root, 'Multi One', 'proj-multi'));
      trackWorktreeInfo(await service.createWorktree(repo.root, 'Multi Two', 'proj-multi'));
      trackWorktreeInfo(await service.createWorktree(repo.root, 'Multi Three', 'proj-multi'));

      // Act
      const worktrees = await service.listWorktrees(repo.root);

      // Assert
      expect(worktrees.length).toBeGreaterThanOrEqual(3);
    });

    it('extractTemplatePrefix 应该与默认前缀合并 dedupe', async () => {
      // Arrange
      const repo = createTempRepo();
      resetSettings({ branchTemplate: 'agent/{slug}-{timestamp}' });
      const info = trackWorktreeInfo(await service.createWorktree(repo.root, 'Dedup', 'proj-dedup'));

      // Act
      const worktrees = await service.listWorktrees(repo.root);

      // Assert
      expect(worktrees.some((wt) => normalizePath(wt.path) === normalizePath(info.path))).toBe(true);
    });
  });

  describe('removeWorktree', () => {
    it('应该删除工作树目录并移除分支', async () => {
      // Arrange
      const repo = createTempRepo();
      const info = trackWorktreeInfo(await service.createWorktree(repo.root, 'Remove Target', 'proj-remove'));

      // Act
      await service.removeWorktree(repo.root, info.id);

      // Assert
      expect(existsSync(info.path)).toBe(false);
      const branches = repo.git(['branch', '--list', info.branch]).trim();
      expect(branches).toBe('');
    });

    it('应该从内存中移除 worktree 记录', async () => {
      // Arrange
      const repo = createTempRepo();
      const info = trackWorktreeInfo(await service.createWorktree(repo.root, 'Remove Map', 'proj-remove-map'));

      // Act
      await service.removeWorktree(repo.root, info.id);

      // Assert
      expect(service.getWorktree(info.id)).toBeUndefined();
    });

    it('工作树目录已被手动删除时也应继续', async () => {
      // Arrange
      const repo = createTempRepo();
      const info = trackWorktreeInfo(await service.createWorktree(repo.root, 'Removed Early', 'proj-removed'));
      rmSync(info.path, { recursive: true, force: true });

      // Act
      await service.removeWorktree(repo.root, info.id);

      // Assert
      expect(existsSync(info.path)).toBe(false);
    });

    it('提供路径和分支信息时应能删除未跟踪工作树', async () => {
      // Arrange
      const repo = createTempRepo();
      const manualPath = registerPath(path.join(path.dirname(repo.root), 'manual-remove'));
      repo.git(['worktree', 'add', '-b', 'agent/manual-remove', manualPath]);

      // Act
      await service.removeWorktree(repo.root, 'manual-id', manualPath, 'agent/manual-remove');

      // Assert
      expect(existsSync(manualPath)).toBe(false);
      const branch = repo.git(['branch', '--list', 'agent/manual-remove']).trim();
      expect(branch).toBe('');
    });

    it('缺少路径信息时应该抛出错误', async () => {
      // Arrange
      const repo = createTempRepo();

      // Act & Assert
      await expect(service.removeWorktree(repo.root, 'unknown-id')).rejects.toThrow('Worktree path not provided');
    });

    it('当 rm 遇到权限错误时应该重试', async () => {
      // Arrange
      const repo = createTempRepo();
      const manualPath = registerPath(path.join(path.dirname(repo.root), 'manual-perm'));
      ensureDir(manualPath);
      const descriptor = Object.getOwnPropertyDescriptor(commonFs, 'promises');
      const promisesInstance: MutableFsPromises =
        (descriptor?.get?.call(commonFs) as MutableFsPromises | undefined) ??
        (commonFs.promises as MutableFsPromises);
      const realRm = promisesInstance.rm.bind(promisesInstance);
      const rmMock = vi
        .fn<MutableFsPromises['rm']>()
        .mockImplementationOnce(async () => {
          const err = new Error('permission denied') as NodeJS.ErrnoException;
          err.code = 'EACCES';
          throw err;
        })
        .mockImplementationOnce((...args) => realRm(...args))
        .mockImplementation((...args) => realRm(...args));
      promisesInstance.rm = rmMock;
      Object.defineProperty(commonFs, 'promises', {
        configurable: true,
        enumerable: true,
        get: () => promisesInstance,
      });

      try {
        // Act
        await service.removeWorktree(repo.root, 'manual-perm-id', manualPath, 'manual/remove');
      } finally {
        Object.defineProperty(commonFs, 'promises', descriptor ?? { value: promisesInstance });
        promisesInstance.rm = realRm;
      }

      // Assert
      expect(rmMock).toHaveBeenCalledTimes(2);
      expect(existsSync(manualPath)).toBe(false);
    });

    it('git worktree remove 失败时仍应清理目录', async () => {
      // Arrange
      const repo = createTempRepo();
      const info = trackWorktreeInfo(await service.createWorktree(repo.root, 'Fallback Remove', 'proj-fallback'));
      const otherRepo = createTempRepo();

      // Act
      await service.removeWorktree(otherRepo.root, info.id, info.path, info.branch);

      // Assert
      expect(existsSync(info.path)).toBe(false);
    });

    it('连续删除多个工作树应该成功', async () => {
      // Arrange
      const repo = createTempRepo();
      const infos = await Promise.all([
        service.createWorktree(repo.root, 'Batch One', 'proj-batch').then(trackWorktreeInfo),
        service.createWorktree(repo.root, 'Batch Two', 'proj-batch').then(trackWorktreeInfo),
        service.createWorktree(repo.root, 'Batch Three', 'proj-batch').then(trackWorktreeInfo),
      ]);

      // Act
      for (const wt of infos) {
        await service.removeWorktree(repo.root, wt.id);
      }

      // Assert
      expect(service.getAllWorktrees()).toEqual([]);
    });

    it('重复删除同一工作树不应抛错', async () => {
      // Arrange
      const repo = createTempRepo();
      const info = trackWorktreeInfo(await service.createWorktree(repo.root, 'Remove Twice', 'proj-remove-twice'));
      await service.removeWorktree(repo.root, info.id);

      // Act
      await service.removeWorktree(repo.root, info.id, info.path, info.branch);

      // Assert
      expect(existsSync(info.path)).toBe(false);
    });

    it('应该删除通过 createWorktreeFromBranch 创建的工作树', async () => {
      // Arrange
      const repo = createTempRepo();
      setupFeatureBranch(repo, 'feature/remove', 'remove.txt');
      const info = trackWorktreeInfo(
        await service.createWorktreeFromBranch(repo.root, 'Remove Branch', 'feature/remove', 'proj-remove-branch')
      );

      // Act
      await service.removeWorktree(repo.root, info.id);

      // Assert
      expect(existsSync(info.path)).toBe(false);
    });
  });

  describe('getWorktreeStatus', () => {
    it('应该检测已暂存的文件', async () => {
      // Arrange
      const repo = createTempRepo();
      const info = trackWorktreeInfo(await service.createWorktree(repo.root, 'Status Staged', 'proj-status'));
      const target = path.join(info.path, 'staged.txt');
      writeFileSync(target, 'one');
      gitInPath(info.path, ['add', 'staged.txt']);

      // Act
      const status = await service.getWorktreeStatus(info.path);

      // Assert
      expect(hasFileMatch(status.stagedFiles, 'staged.txt')).toBe(true);
      expect(status.hasChanges).toBe(true);
    });

    it('应该检测未暂存的修改', async () => {
      // Arrange
      const repo = createTempRepo();
      const info = trackWorktreeInfo(await service.createWorktree(repo.root, 'Status Dirty', 'proj-status2'));
      const target = path.join(info.path, 'dirty.txt');
      writeFileSync(target, 'one');
      gitInPath(info.path, ['add', 'dirty.txt']);
      gitInPath(info.path, ['commit', '-m', 'add dirty']);
      appendFileSync(target, 'two');

      // Act
      const status = await service.getWorktreeStatus(info.path);

      // Assert
      expect(hasFileMatch(status.unstagedFiles, 'dirty.txt')).toBe(true);
      expect(status.hasChanges).toBe(true);
    });

    it('应该检测未跟踪的文件', async () => {
      // Arrange
      const repo = createTempRepo();
      const info = trackWorktreeInfo(await service.createWorktree(repo.root, 'Status Untracked', 'proj-status3'));
      const target = path.join(info.path, 'untracked.txt');
      writeFileSync(target, 'hello');

      // Act
      const status = await service.getWorktreeStatus(info.path);

      // Assert
      expect(hasFileMatch(status.untrackedFiles, 'untracked.txt')).toBe(true);
      expect(status.hasChanges).toBe(true);
    });

    it('无改动时 hasChanges 应为 false', async () => {
      // Arrange
      const repo = createTempRepo();
      const info = trackWorktreeInfo(await service.createWorktree(repo.root, 'Status Clean', 'proj-status4'));

      // Act
      const status = await service.getWorktreeStatus(info.path);

      // Assert
      expect(status.hasChanges).toBe(false);
      expect(status.stagedFiles).toEqual([]);
      expect(status.unstagedFiles).toEqual([]);
      expect(status.untrackedFiles).toEqual([]);
    });

    it('删除文件应该同时出现在 staged 与 unstaged', async () => {
      // Arrange
      const repo = createTempRepo();
      const info = trackWorktreeInfo(await service.createWorktree(repo.root, 'Status Delete', 'proj-status5'));
      const target = path.join(info.path, 'delete.txt');
      writeFileSync(target, 'bye');
      gitInPath(info.path, ['add', 'delete.txt']);
      gitInPath(info.path, ['commit', '-m', 'add delete']);
      rmSync(target);

      // Act
      const status = await service.getWorktreeStatus(info.path);

      // Assert
      expect(hasFileMatch(status.unstagedFiles, 'delete.txt')).toBe(true);
      expect(status.hasChanges).toBe(true);
    });

    it('再次修改已暂存文件应该在两个列表中出现', async () => {
      // Arrange
      const repo = createTempRepo();
      const info = trackWorktreeInfo(await service.createWorktree(repo.root, 'Status Mixed', 'proj-status6'));
      const target = path.join(info.path, 'mixed.txt');
      writeFileSync(target, 'base');
      gitInPath(info.path, ['add', 'mixed.txt']);
      gitInPath(info.path, ['commit', '-m', 'add mixed']);
      writeFileSync(target, 'new');
      gitInPath(info.path, ['add', 'mixed.txt']);
      appendFileSync(target, 'more');

      // Act
      const status = await service.getWorktreeStatus(info.path);

      // Assert
      expect(hasFileMatch(status.stagedFiles, 'mixed.txt')).toBe(true);
      expect(hasFileMatch(status.unstagedFiles, 'mixed.txt')).toBe(true);
    });

    it('包含空格的文件路径应该被正确解析', async () => {
      // Arrange
      const repo = createTempRepo();
      const info = trackWorktreeInfo(await service.createWorktree(repo.root, 'Status Space', 'proj-status7'));
      const relative = 'dir/space file.txt';
      const target = path.join(info.path, relative);
      ensureDir(path.dirname(target));
      writeFileSync(target, 'space');
      gitInPath(info.path, ['add', relative]);

      // Act
      const status = await service.getWorktreeStatus(info.path);

      // Assert
      expect(hasFileMatch(status.stagedFiles, 'space file.txt')).toBe(true);
    });

    it('嵌套目录中的变更应该被返回', async () => {
      // Arrange
      const repo = createTempRepo();
      const info = trackWorktreeInfo(await service.createWorktree(repo.root, 'Status Nested', 'proj-status8'));
      const relative = 'nested/deeper/file.ts';
      const target = path.join(info.path, relative);
      ensureDir(path.dirname(target));
      writeFileSync(target, 'nested');

      // Act
      const status = await service.getWorktreeStatus(info.path);

      // Assert
      expect(hasFileMatch(status.untrackedFiles, 'nested/')).toBe(true);
    });

    it('应该同时报告已暂存和未跟踪的文件', async () => {
      // Arrange
      const repo = createTempRepo();
      const info = trackWorktreeInfo(await service.createWorktree(repo.root, 'Status Combo', 'proj-status9'));
      const stagedFile = path.join(info.path, 'combo-staged.txt');
      const extraFile = path.join(info.path, 'combo/untracked.txt');
      ensureDir(path.dirname(extraFile));
      writeFileSync(stagedFile, 'combo-one');
      gitInPath(info.path, ['add', 'combo-staged.txt']);
      gitInPath(info.path, ['commit', '-m', 'combo base']);
      writeFileSync(stagedFile, 'combo-two');
      gitInPath(info.path, ['add', 'combo-staged.txt']);
      writeFileSync(extraFile, 'combo extra');

      // Act
      const status = await service.getWorktreeStatus(info.path);

      // Assert
      expect(hasFileMatch(status.stagedFiles, 'combo-staged.txt')).toBe(true);
      expect(hasFileMatch(status.untrackedFiles, 'combo/')).toBe(true);
      expect(status.hasChanges).toBe(true);
    });

    it('非 git 目录应该返回默认值', async () => {
      // Arrange
      const fakeDir = registerPath(mkdtempSync(path.join(os.tmpdir(), 'status-fake-')));

      // Act
      const status = await service.getWorktreeStatus(fakeDir);

      // Assert
      expect(status.hasChanges).toBe(false);
      expect(status.stagedFiles).toEqual([]);
    });
  });

  describe('mergeWorktreeChanges', () => {
    it('应该将工作树提交合并回默认分支', async () => {
      // Arrange
      const repo = createTempRepo();
      const info = trackWorktreeInfo(await service.createWorktree(repo.root, 'Merge Flow', 'proj-merge'));
      const target = path.join(info.path, 'merge.txt');
      writeFileSync(target, 'merge');
      gitInPath(info.path, ['add', 'merge.txt']);
      gitInPath(info.path, ['commit', '-m', 'add merge file']);

      // Act
      await service.mergeWorktreeChanges(repo.root, info.id);

      // Assert
      expect(existsSync(target)).toBe(false);
      const content = readFileSync(path.join(repo.root, 'merge.txt'), 'utf8');
      expect(content).toBe('merge');
      const branches = repo.git(['branch', '--list', info.branch]).trim();
      expect(branches).toBe('');
    });

    it('默认分支为 master 时应该正确 checkout', async () => {
      // Arrange
      const repo = createTempRepo({ defaultBranch: 'master', createRemote: true });
      const info = trackWorktreeInfo(await service.createWorktree(repo.root, 'Merge Master', 'proj-merge2'));
      const target = path.join(info.path, 'master.txt');
      writeFileSync(target, 'master');
      gitInPath(info.path, ['add', 'master.txt']);
      gitInPath(info.path, ['commit', '-m', 'master changes']);

      // Act
      await service.mergeWorktreeChanges(repo.root, info.id);

      // Assert
      const merged = readFileSync(path.join(repo.root, 'master.txt'), 'utf8');
      expect(merged).toBe('master');
    });

    it('不存在的工作树应该抛错', async () => {
      // Arrange
      const repo = createTempRepo();

      // Act & Assert
      await expect(service.mergeWorktreeChanges(repo.root, 'missing-id')).rejects.toThrow('Worktree not found');
    });

    it('合并后应该清空内存记录', async () => {
      // Arrange
      const repo = createTempRepo();
      const info = trackWorktreeInfo(await service.createWorktree(repo.root, 'Merge Cleanup', 'proj-merge3'));
      const target = path.join(info.path, 'cleanup.txt');
      writeFileSync(target, 'cleanup');
      gitInPath(info.path, ['add', 'cleanup.txt']);
      gitInPath(info.path, ['commit', '-m', 'cleanup merge']);

      // Act
      await service.mergeWorktreeChanges(repo.root, info.id);

      // Assert
      expect(service.getWorktree(info.id)).toBeUndefined();
    });

    it('发生冲突时应该抛出错误', async () => {
      // Arrange
      const repo = createTempRepo();
      const baseFile = path.join(repo.root, 'conflict.txt');
      writeFileSync(baseFile, 'base');
      repo.git(['add', 'conflict.txt']);
      repo.git(['commit', '-m', 'add conflict']);
      const info = trackWorktreeInfo(await service.createWorktree(repo.root, 'Merge Conflict', 'proj-merge4'));
      writeFileSync(path.join(info.path, 'conflict.txt'), 'worktree change');
      gitInPath(info.path, ['add', 'conflict.txt']);
      gitInPath(info.path, ['commit', '-m', 'wt change']);
      writeFileSync(baseFile, 'main change');
      repo.git(['add', 'conflict.txt']);
      repo.git(['commit', '-m', 'main change']);

      // Act & Assert
      await expect(service.mergeWorktreeChanges(repo.root, info.id)).rejects.toThrow();
    });

    it('多个工作树依次合并后应该保留所有文件', async () => {
      // Arrange
      const repo = createTempRepo();
      const [first, second] = await Promise.all([
        service.createWorktree(repo.root, 'Merge One', 'proj-merge5').then(trackWorktreeInfo),
        service.createWorktree(repo.root, 'Merge Two', 'proj-merge5').then(trackWorktreeInfo),
      ]);
      writeFileSync(path.join(first.path, 'one.txt'), 'one');
      gitInPath(first.path, ['add', 'one.txt']);
      gitInPath(first.path, ['commit', '-m', 'one']);
      writeFileSync(path.join(second.path, 'two.txt'), 'two');
      gitInPath(second.path, ['add', 'two.txt']);
      gitInPath(second.path, ['commit', '-m', 'two']);

      // Act
      await service.mergeWorktreeChanges(repo.root, first.id);
      await service.mergeWorktreeChanges(repo.root, second.id);

      // Assert
      expect(readFileSync(path.join(repo.root, 'one.txt'), 'utf8')).toBe('one');
      expect(readFileSync(path.join(repo.root, 'two.txt'), 'utf8')).toBe('two');
    });

    it('没有 remote 时应该回退到 main', async () => {
      // Arrange
      const repo = createTempRepo();
      const info = trackWorktreeInfo(await service.createWorktree(repo.root, 'Merge Fallback', 'proj-merge6'));
      writeFileSync(path.join(info.path, 'fallback.txt'), 'fallback');
      gitInPath(info.path, ['add', 'fallback.txt']);
      gitInPath(info.path, ['commit', '-m', 'fallback change']);

      // Act
      await service.mergeWorktreeChanges(repo.root, info.id);

      // Assert
      expect(readFileSync(path.join(repo.root, 'fallback.txt'), 'utf8')).toBe('fallback');
    });

    it('合并后应该删除工作树目录', async () => {
      // Arrange
      const repo = createTempRepo();
      const info = trackWorktreeInfo(await service.createWorktree(repo.root, 'Merge Remove Dir', 'proj-merge7'));
      writeFileSync(path.join(info.path, 'dir.txt'), 'dir');
      gitInPath(info.path, ['add', 'dir.txt']);
      gitInPath(info.path, ['commit', '-m', 'dir']);

      // Act
      await service.mergeWorktreeChanges(repo.root, info.id);

      // Assert
      expect(existsSync(info.path)).toBe(false);
    });

    it('合并后应该仍处于默认分支', async () => {
      // Arrange
      const repo = createTempRepo();
      const info = trackWorktreeInfo(await service.createWorktree(repo.root, 'Merge Stay', 'proj-merge8'));
      writeFileSync(path.join(info.path, 'stay.txt'), 'stay');
      gitInPath(info.path, ['add', 'stay.txt']);
      gitInPath(info.path, ['commit', '-m', 'stay']);

      // Act
      await service.mergeWorktreeChanges(repo.root, info.id);

      // Assert
      const branch = repo.git(['rev-parse', '--abbrev-ref', 'HEAD']).trim();
      expect(branch).toBe(repo.defaultBranch);
    });

    it('应该合并包含多个文件的提交', async () => {
      // Arrange
      const repo = createTempRepo();
      const info = trackWorktreeInfo(await service.createWorktree(repo.root, 'Merge Multi File', 'proj-merge9'));
      writeFileSync(path.join(info.path, 'a.txt'), 'a');
      writeFileSync(path.join(info.path, 'b.txt'), 'b');
      gitInPath(info.path, ['add', '.']);
      gitInPath(info.path, ['commit', '-m', 'multi files']);

      // Act
      await service.mergeWorktreeChanges(repo.root, info.id);

      // Assert
      expect(readFileSync(path.join(repo.root, 'a.txt'), 'utf8')).toBe('a');
      expect(readFileSync(path.join(repo.root, 'b.txt'), 'utf8')).toBe('b');
    });
  });

  describe('getWorktree / getAllWorktrees', () => {
    it('应该返回已注册的工作树', async () => {
      // Arrange
      const repo = createTempRepo();
      const info = trackWorktreeInfo(await service.createWorktree(repo.root, 'Accessor', 'proj-access'));

      // Act
      const found = service.getWorktree(info.id);

      // Assert
      expect(found).toMatchObject({ id: info.id, branch: info.branch });
    });

    it('getAllWorktrees 应该返回所有记录', async () => {
      // Arrange
      const repo = createTempRepo();
      const infos = await Promise.all([
        service.createWorktree(repo.root, 'Accessor 1', 'proj-access').then(trackWorktreeInfo),
        service.createWorktree(repo.root, 'Accessor 2', 'proj-access').then(trackWorktreeInfo),
      ]);

      // Act
      const list = service.getAllWorktrees();

      // Assert
      expect(list.map((wt) => wt.id)).toEqual(expect.arrayContaining([infos[0].id, infos[1].id]));
    });
  });

  describe('integration flows', () => {
    it('端到端：创建 -> 列出 -> 状态 -> 删除', async () => {
      // Arrange
      const repo = createTempRepo();
      const info = trackWorktreeInfo(await service.createWorktree(repo.root, 'Integration Flow', 'proj-int'));
      writeFileSync(path.join(info.path, 'flow.txt'), 'flow');

      // Act
      const listed = await service.listWorktrees(repo.root);
      const status = await service.getWorktreeStatus(info.path);
      await service.removeWorktree(repo.root, info.id);

      // Assert
      expect(listed.some((wt) => normalizePath(wt.path) === normalizePath(info.path))).toBe(true);
      expect(hasFileMatch(status.untrackedFiles, 'flow.txt')).toBe(true);
      expect(existsSync(info.path)).toBe(false);
    });

    it('多工作树并发管理', async () => {
      // Arrange
      const repo = createTempRepo();
      const infos = await Promise.all(
        Array.from({ length: 3 }).map((_, idx) =>
          service.createWorktree(repo.root, `Integration ${idx}`, 'proj-int').then(trackWorktreeInfo)
        )
      );
      for (const info of infos) {
        writeFileSync(path.join(info.path, `file-${info.id}.txt`), info.id);
      }

      // Act
      const listed = await service.listWorktrees(repo.root);
      const statuses = await Promise.all(infos.map((info) => service.getWorktreeStatus(info.path)));

      // Assert
      expect(listed.length).toBeGreaterThanOrEqual(3);
      statuses.forEach((status, index) => {
        expect(hasFileMatch(status.untrackedFiles, `file-${infos[index].id}.txt`)).toBe(true);
      });

      // Cleanup
      for (const info of infos) {
        await service.removeWorktree(repo.root, info.id);
      }
    });
  });
});
