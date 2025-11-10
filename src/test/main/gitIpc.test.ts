import { beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (event: unknown, args?: unknown) => Promise<unknown> | unknown;
type ExecOptions = { cwd?: string };
type ExecResult = { stdout?: string; stderr?: string };

const {
  handlers,
  handleMock,
  gitGetStatusMock,
  gitGetFileDiffMock,
  gitStageFileMock,
  gitRevertFileMock,
  execMock,
  execAsyncMock,
  logInfoMock,
  logWarnMock,
  logErrorMock,
  logMock,
} = vi.hoisted(() => {
  const handlers = new Map<string, Handler>();
  const handleMock = vi.fn((channel: string, handler: Handler) => {
    handlers.set(channel, handler);
  });

  const gitGetStatusMock = vi.fn<(workspacePath: string) => Promise<unknown>>();
  const gitGetFileDiffMock = vi.fn<(workspacePath: string, filePath: string) => Promise<string>>();
  const gitStageFileMock = vi.fn<
    (workspacePath: string, filePath: string) => Promise<void>
  >();
  const gitRevertFileMock = vi.fn<
    (workspacePath: string, filePath: string) => Promise<{ action: string }>
  >();

  const execMock = vi.fn();
  const execAsyncMock = vi.fn<
    (command: string, options?: ExecOptions) => Promise<ExecResult>
  >();

  const logInfoMock = vi.fn();
  const logWarnMock = vi.fn();
  const logErrorMock = vi.fn();
  const logMock = {
    debug: vi.fn(),
    info: logInfoMock,
    warn: logWarnMock,
    error: logErrorMock,
  };

  return {
    handlers,
    handleMock,
    gitGetStatusMock,
    gitGetFileDiffMock,
    gitStageFileMock,
    gitRevertFileMock,
    execMock,
    execAsyncMock,
    logInfoMock,
    logWarnMock,
    logErrorMock,
    logMock,
  };
});

vi.mock('electron', () => ({
  ipcMain: {
    handle: handleMock,
  },
}));

vi.mock('../../main/services/GitService', () => ({
  getStatus: gitGetStatusMock,
  getFileDiff: gitGetFileDiffMock,
  stageFile: gitStageFileMock,
  revertFile: gitRevertFileMock,
}));

vi.mock('child_process', () => ({
  exec: execMock,
}));

vi.mock('util', () => ({
  promisify: () => execAsyncMock,
}));

vi.mock('../../main/lib/logger', () => ({
  log: logMock,
}));

// eslint-disable-next-line import/first
import { registerGitIpc } from '../../main/ipc/gitIpc';

function getHandler(channel: string): Handler {
  const handler = handlers.get(channel);
  if (!handler) {
    throw new Error(`Handler for ${channel} not registered`);
  }
  return handler;
}

interface ExecStep {
  command: string | RegExp;
  options?: ExecOptions;
  result?: ExecResult;
  error?: unknown;
  before?: (command: string, options?: ExecOptions) => void;
}

function mockExecSteps(workspacePath: string, steps: ExecStep[], config?: { allowExtra?: boolean }) {
  const queue = [...steps];
  execAsyncMock.mockImplementation(async (command: string, options?: ExecOptions) => {
    if (queue.length === 0) {
      if (config?.allowExtra) {
        return { stdout: '', stderr: '' };
      }
      throw new Error(`Unexpected exec call: ${command}`);
    }

    const step = queue.shift()!;
    if (typeof step.command === 'string') {
      expect(command).toBe(step.command);
    } else {
      expect(command).toMatch(step.command);
    }

    const expectedOptions = step.options ?? { cwd: workspacePath };
    expect(options).toEqual(expectedOptions);

    step.before?.(command, options);

    if (step.error !== undefined) {
      throw step.error;
    }

    return step.result ?? { stdout: '', stderr: '' };
  });
}

function wasCommandInvoked(match: string | RegExp): boolean {
  return execAsyncMock.mock.calls.some(([command]) => {
    if (typeof match === 'string') {
      return command === match;
    }
    return match.test(command);
  });
}

beforeEach(() => {
  handlers.clear();
  handleMock.mockClear();
  gitGetStatusMock.mockReset();
  gitGetFileDiffMock.mockReset();
  gitStageFileMock.mockReset();
  gitRevertFileMock.mockReset();
  execMock.mockReset();
  execAsyncMock.mockReset();
  execAsyncMock.mockResolvedValue({ stdout: '', stderr: '' });
  logInfoMock.mockReset();
  logWarnMock.mockReset();
  logErrorMock.mockReset();
});

describe('git:get-status', () => {
  it('returns file changes successfully', async () => {
    const workspacePath = '/repo/workspace';
    const changes = [{ path: 'file.ts', status: 'M' }];
    gitGetStatusMock.mockResolvedValue(changes);

    registerGitIpc();
    const handler = getHandler('git:get-status');

    const result = (await handler({}, workspacePath)) as { success: boolean; changes?: unknown };

    expect(gitGetStatusMock).toHaveBeenCalledWith(workspacePath);
    expect(result).toEqual({ success: true, changes });
  });

  it('returns the exact changes array from GitService', async () => {
    const workspacePath = '/repo/workspace';
    const changes: Array<{ path: string; status: string }> = [];
    gitGetStatusMock.mockResolvedValue(changes);

    registerGitIpc();
    const handler = getHandler('git:get-status');

    const result = (await handler({}, workspacePath)) as { success: boolean; changes?: unknown };

    expect(result.success).toBe(true);
    expect(result.changes).toBe(changes);
  });

  it('handles service errors gracefully', async () => {
    const workspacePath = '/repo/workspace';
    const error = new Error('status failed');
    gitGetStatusMock.mockRejectedValue(error);

    registerGitIpc();
    const handler = getHandler('git:get-status');

    const result = (await handler({}, workspacePath)) as { success: boolean; error?: unknown };

    expect(result.success).toBe(false);
    expect(result.error).toBe(error);
  });
});

describe('git:get-file-diff', () => {
  it('returns file diff successfully with workspace and file path', async () => {
    const args = { workspacePath: '/repo/workspace', filePath: 'src/main.ts' };
    gitGetFileDiffMock.mockResolvedValue('diff --git');

    registerGitIpc();
    const handler = getHandler('git:get-file-diff');

    const result = (await handler({}, args)) as { success: boolean; diff?: string };

    expect(gitGetFileDiffMock).toHaveBeenCalledWith(args.workspacePath, args.filePath);
    expect(result).toEqual({ success: true, diff: 'diff --git' });
  });

  it('returns diff string from GitService response', async () => {
    const args = { workspacePath: '/repo/workspace', filePath: 'README.md' };
    const diffContent = '--- a/README.md\n+++ b/README.md';
    gitGetFileDiffMock.mockResolvedValue(diffContent);

    registerGitIpc();
    const handler = getHandler('git:get-file-diff');

    const result = (await handler({}, args)) as { success: boolean; diff?: string };

    expect(result.diff).toBe(diffContent);
  });

  it('handles GitService errors for file diff requests', async () => {
    const args = { workspacePath: '/repo/workspace', filePath: 'missing.txt' };
    gitGetFileDiffMock.mockRejectedValue('no diff available');

    registerGitIpc();
    const handler = getHandler('git:get-file-diff');

    const result = (await handler({}, args)) as { success: boolean; error?: unknown };

    expect(result.success).toBe(false);
    expect(result.error).toBe('no diff available');
  });
});

describe('git:stage-file', () => {
  it('stages a file successfully', async () => {
    const args = { workspacePath: '/repo/workspace', filePath: 'src/app.ts' };
    gitStageFileMock.mockResolvedValue();

    registerGitIpc();
    const handler = getHandler('git:stage-file');

    const result = (await handler({}, args)) as { success: boolean };

    expect(gitStageFileMock).toHaveBeenCalledWith(args.workspacePath, args.filePath);
    expect(result).toEqual({ success: true });
  });

  it('logs info messages before and after staging', async () => {
    const args = { workspacePath: '/repo/workspace', filePath: 'src/main.ts' };

    registerGitIpc();
    const handler = getHandler('git:stage-file');
    await handler({}, args);

    expect(logInfoMock).toHaveBeenNthCalledWith(1, 'Staging file:', args);
    expect(logInfoMock).toHaveBeenNthCalledWith(2, 'File staged successfully:', args.filePath);
  });

  it('handles staging errors by returning failure response', async () => {
    const args = { workspacePath: '/repo/workspace', filePath: 'broken.ts' };
    gitStageFileMock.mockRejectedValue(new Error('cannot stage'));

    registerGitIpc();
    const handler = getHandler('git:stage-file');
    const result = (await handler({}, args)) as { success: boolean; error?: string };

    expect(result).toEqual({ success: false, error: 'cannot stage' });
  });

  it('logs errors when staging fails', async () => {
    const args = { workspacePath: '/repo/workspace', filePath: 'broken.ts' };
    const err = new Error('stage blew up');
    gitStageFileMock.mockRejectedValue(err);

    registerGitIpc();
    const handler = getHandler('git:stage-file');
    await handler({}, args);

    expect(logErrorMock).toHaveBeenCalledWith('Failed to stage file:', {
      filePath: args.filePath,
      error: err,
    });
  });
});

describe('git:revert-file', () => {
  it('reverts a file successfully', async () => {
    const args = { workspacePath: '/repo/workspace', filePath: 'src/app.ts' };
    gitRevertFileMock.mockResolvedValue({ action: 'checkout' });

    registerGitIpc();
    const handler = getHandler('git:revert-file');
    const result = (await handler({}, args)) as { success: boolean; action?: string };

    expect(gitRevertFileMock).toHaveBeenCalledWith(args.workspacePath, args.filePath);
    expect(result).toEqual({ success: true, action: 'checkout' });
  });

  it('returns the action reported by GitService', async () => {
    const args = { workspacePath: '/repo/workspace', filePath: 'src/utils.ts' };
    gitRevertFileMock.mockResolvedValue({ action: 'deleted' });

    registerGitIpc();
    const handler = getHandler('git:revert-file');
    const result = (await handler({}, args)) as { success: boolean; action?: string };

    expect(result.action).toBe('deleted');
  });

  it('logs info before and after reverting a file', async () => {
    const args = { workspacePath: '/repo/workspace', filePath: 'src/state.ts' };
    gitRevertFileMock.mockResolvedValue({ action: 'checkout' });

    registerGitIpc();
    const handler = getHandler('git:revert-file');
    await handler({}, args);

    expect(logInfoMock).toHaveBeenNthCalledWith(1, 'Reverting file:', args);
    expect(logInfoMock).toHaveBeenNthCalledWith(2, 'File operation completed:', {
      filePath: args.filePath,
      action: 'checkout',
    });
  });

  it('handles revert errors by returning failure response', async () => {
    const args = { workspacePath: '/repo/workspace', filePath: 'src/state.ts' };
    gitRevertFileMock.mockRejectedValue('oops');

    registerGitIpc();
    const handler = getHandler('git:revert-file');
    const result = (await handler({}, args)) as { success: boolean; error?: string };

    expect(result).toEqual({ success: false, error: 'oops' });
  });

  it('logs errors when revert fails', async () => {
    const args = { workspacePath: '/repo/workspace', filePath: 'src/state.ts' };
    const err = new Error('nope');
    gitRevertFileMock.mockRejectedValue(err);

    registerGitIpc();
    const handler = getHandler('git:revert-file');
    await handler({}, args);

    expect(logErrorMock).toHaveBeenCalledWith('Failed to revert file:', {
      filePath: args.filePath,
      error: err,
    });
  });
});

describe('git:create-pr', () => {
  const workspacePath = '/repo/workspace';

  type CreatePrArgs = {
    workspacePath: string;
    title?: string;
    body?: string;
    base?: string;
    head?: string;
    draft?: boolean;
    web?: boolean;
    fill?: boolean;
  };

  function createArgs(overrides?: Partial<CreatePrArgs>): CreatePrArgs {
    return {
      workspacePath,
      title: 'Ship feature',
      body: 'desc',
      base: 'main',
      head: 'feature/login',
      draft: true,
      web: true,
      fill: true,
      ...overrides,
    };
  }

  it('creates a pull request after staging, committing, pushing, and invoking gh', async () => {
    const args = createArgs();
    mockExecSteps(workspacePath, [
      { command: 'git status --porcelain', result: { stdout: ' M src/app.ts\n' } },
      { command: 'git add -A', result: { stdout: 'files staged\n', stderr: '' } },
      {
        command: 'git commit -m "stagehand: prepare pull request"',
        result: { stdout: 'commit ok\n', stderr: '' },
      },
      { command: 'git push', result: { stdout: '', stderr: '' } },
      {
        command: 'gh repo view --json nameWithOwner -q .nameWithOwner',
        result: { stdout: 'org/project\n' },
      },
      { command: 'git branch --show-current', result: { stdout: 'feature/login\n' } },
      {
        command: 'gh repo view --json defaultBranchRef -q .defaultBranchRef.name',
        result: { stdout: 'main\n' },
      },
      { command: 'git rev-list --count "origin/main"..HEAD', result: { stdout: '2\n' } },
      {
        command:
          'gh pr create --repo "org/project" --title "Ship feature" --body "desc" --base "main" --head "feature/login" --draft --web --fill',
        result: { stdout: 'Created PR https://github.com/org/project/pull/7\n' },
      },
    ]);

    registerGitIpc();
    const handler = getHandler('git:create-pr');
    const result = (await handler({}, args)) as { success: boolean; url?: string; output?: string };

    expect(result.success).toBe(true);
    expect(result.url).toBe('https://github.com/org/project/pull/7');
    expect(result.output).toContain('git push: success');
    expect(wasCommandInvoked('git add -A')).toBe(true);
    expect(wasCommandInvoked('git commit -m "stagehand: prepare pull request"')).toBe(true);
    expect(wasCommandInvoked(/^gh pr create/)).toBe(true);
  });

  it('stages and commits pending changes before creating the PR', async () => {
    const args = createArgs();
    mockExecSteps(workspacePath, [
      { command: 'git status --porcelain', result: { stdout: '?? new-file.ts\n' } },
      { command: 'git add -A', result: { stdout: '', stderr: '' } },
      {
        command: 'git commit -m "stagehand: prepare pull request"',
        error: 'nothing to commit',
      },
      { command: 'git push', result: { stdout: '', stderr: '' } },
      {
        command: 'gh repo view --json nameWithOwner -q .nameWithOwner',
        result: { stdout: 'org/project\n' },
      },
      { command: 'git branch --show-current', result: { stdout: 'feature/login\n' } },
      {
        command: 'gh repo view --json defaultBranchRef -q .defaultBranchRef.name',
        result: { stdout: 'main\n' },
      },
      { command: 'git rev-list --count "origin/main"..HEAD', result: { stdout: '1\n' } },
      {
        command:
          'gh pr create --repo "org/project" --title "Ship feature" --body "desc" --base "main" --head "feature/login" --draft --web --fill',
        result: { stdout: 'Created PR https://github.com/org/project/pull/8\n' },
      },
    ]);

    registerGitIpc();
    const handler = getHandler('git:create-pr');
    const result = (await handler({}, args)) as { success: boolean; output?: string };

    expect(result.success).toBe(true);
    expect(result.output).toContain('git commit: nothing to commit');
    expect(logWarnMock).not.toHaveBeenCalled();
  });

  it('pushes to origin or sets upstream when the first push fails', async () => {
    const args = createArgs();
    mockExecSteps(workspacePath, [
      { command: 'git status --porcelain', result: { stdout: '' } },
      { command: 'git push', error: new Error('push rejected') },
      {
        command: 'git rev-parse --abbrev-ref HEAD',
        result: { stdout: 'feature/login\n' },
      },
      {
        command: 'git push --set-upstream origin "feature/login"',
        result: { stdout: '', stderr: '' },
      },
      {
        command: 'gh repo view --json nameWithOwner -q .nameWithOwner',
        result: { stdout: 'org/project\n' },
      },
      { command: 'git branch --show-current', result: { stdout: 'feature/login\n' } },
      {
        command: 'gh repo view --json defaultBranchRef -q .defaultBranchRef.name',
        result: { stdout: 'main\n' },
      },
      { command: 'git rev-list --count "origin/main"..HEAD', result: { stdout: '1\n' } },
      {
        command:
          'gh pr create --repo "org/project" --title "Ship feature" --body "desc" --base "main" --head "feature/login" --draft --web --fill',
        result: { stdout: 'Created PR https://github.com/org/project/pull/9\n' },
      },
    ]);

    registerGitIpc();
    const handler = getHandler('git:create-pr');
    const result = (await handler({}, args)) as { success: boolean; output?: string };

    expect(result.success).toBe(true);
    expect(result.output).toContain('git push --set-upstream origin feature/login: success');
    expect(logErrorMock).not.toHaveBeenCalledWith(
      'Failed to push branch before PR:',
      expect.anything()
    );
  });

  it('extracts the PR URL from gh output', async () => {
    const args = createArgs({ head: undefined });
    mockExecSteps(workspacePath, [
      { command: 'git status --porcelain', result: { stdout: '' } },
      { command: 'git push', result: { stdout: '', stderr: '' } },
      {
        command: 'gh repo view --json nameWithOwner -q .nameWithOwner',
        result: { stdout: 'org/project\n' },
      },
      { command: 'git branch --show-current', result: { stdout: 'feature/login\n' } },
      {
        command: 'gh repo view --json defaultBranchRef -q .defaultBranchRef.name',
        result: { stdout: 'main\n' },
      },
      { command: 'git rev-list --count "origin/main"..HEAD', result: { stdout: '3\n' } },
      {
        command:
          'gh pr create --repo "org/project" --title "Ship feature" --body "desc" --base "main" --head "org:feature/login" --draft --web --fill',
        result: { stdout: 'Done\nOpen https://github.com/org/project/pull/10\n' },
      },
    ]);

    registerGitIpc();
    const handler = getHandler('git:create-pr');
    const result = (await handler({}, args)) as { success: boolean; url?: string; output?: string };

    expect(result.success).toBe(true);
    expect(result.url).toBe('https://github.com/org/project/pull/10');
    expect(result.output).toContain('Open https://github.com/org/project/pull/10');
    expect(wasCommandInvoked(/--head "org:feature\/login"/)).toBe(true);
  });

  it('returns an error when there are no commits ahead of the base branch', async () => {
    const args = createArgs({ head: undefined, base: undefined });
    mockExecSteps(workspacePath, [
      { command: 'git status --porcelain', result: { stdout: '' } },
      { command: 'git push', result: { stdout: '', stderr: '' } },
      {
        command: 'gh repo view --json nameWithOwner -q .nameWithOwner',
        result: { stdout: 'org/project\n' },
      },
      { command: 'git branch --show-current', result: { stdout: 'feature/login\n' } },
      {
        command: 'gh repo view --json defaultBranchRef -q .defaultBranchRef.name',
        result: { stdout: 'main\n' },
      },
      { command: 'git rev-list --count "origin/main"..HEAD', result: { stdout: '0\n' } },
    ]);

    registerGitIpc();
    const handler = getHandler('git:create-pr');
    const result = (await handler({}, args)) as { success: boolean; error?: string };

    expect(result.success).toBe(false);
    expect(result.error).toContain('No commits to create a PR');
    expect(result.error).toContain("current branch 'feature/login'");
    expect(wasCommandInvoked(/^gh pr create/)).toBe(false);
  });

  it('handles push failures that cannot be recovered', async () => {
    const args = createArgs();
    mockExecSteps(workspacePath, [
      { command: 'git status --porcelain', result: { stdout: '' } },
      { command: 'git push', error: new Error('no remote') },
      {
        command: 'git rev-parse --abbrev-ref HEAD',
        result: { stdout: 'feature/login\n' },
      },
      {
        command: 'git push --set-upstream origin "feature/login"',
        error: new Error('auth failed'),
      },
    ]);

    registerGitIpc();
    const handler = getHandler('git:create-pr');
    const result = (await handler({}, args)) as { success: boolean; error?: string };

    expect(result.success).toBe(false);
    expect(result.error).toBe(
      'Failed to push branch to origin. Please check your Git remotes and authentication.'
    );
    expect(logErrorMock).toHaveBeenCalledWith(
      'Failed to push branch before PR:',
      expect.anything()
    );
  });

  it('handles gh pr create errors by logging and returning failure', async () => {
    const args = createArgs();
    const ghError = new Error('gh pr create failed');
    mockExecSteps(workspacePath, [
      { command: 'git status --porcelain', result: { stdout: '' } },
      { command: 'git push', result: { stdout: '', stderr: '' } },
      {
        command: 'gh repo view --json nameWithOwner -q .nameWithOwner',
        result: { stdout: 'org/project\n' },
      },
      { command: 'git branch --show-current', result: { stdout: 'feature/login\n' } },
      {
        command: 'gh repo view --json defaultBranchRef -q .defaultBranchRef.name',
        result: { stdout: 'main\n' },
      },
      { command: 'git rev-list --count "origin/main"..HEAD', result: { stdout: '2\n' } },
      {
        command:
          'gh pr create --repo "org/project" --title "Ship feature" --body "desc" --base "main" --head "feature/login" --draft --web --fill',
        error: ghError,
      },
    ]);

    registerGitIpc();
    const handler = getHandler('git:create-pr');
    const result = (await handler({}, args)) as { success: boolean; error?: unknown };

    expect(result.success).toBe(false);
    expect(result.error).toBe(ghError);
    expect(logErrorMock).toHaveBeenCalledWith('Failed to create PR:', ghError);
  });

  it('warns when staging fails but still attempts to create the PR', async () => {
    const args = createArgs();
    mockExecSteps(workspacePath, [
      { command: 'git status --porcelain', error: 'stage failed' },
      { command: 'git push', result: { stdout: '', stderr: '' } },
      {
        command: 'gh repo view --json nameWithOwner -q .nameWithOwner',
        result: { stdout: 'org/project\n' },
      },
      { command: 'git branch --show-current', result: { stdout: 'feature/login\n' } },
      {
        command: 'gh repo view --json defaultBranchRef -q .defaultBranchRef.name',
        result: { stdout: 'main\n' },
      },
      { command: 'git rev-list --count "origin/main"..HEAD', result: { stdout: '4\n' } },
      {
        command:
          'gh pr create --repo "org/project" --title "Ship feature" --body "desc" --base "main" --head "feature/login" --draft --web --fill',
        result: { stdout: 'Created PR https://github.com/org/project/pull/11\n' },
      },
    ]);

    registerGitIpc();
    const handler = getHandler('git:create-pr');
    const result = (await handler({}, args)) as { success: boolean; url?: string };

    expect(result.success).toBe(true);
    expect(result.url).toBe('https://github.com/org/project/pull/11');
    expect(logWarnMock).toHaveBeenCalledWith(
      'Failed to stage/commit changes before PR:',
      'stage failed'
    );
  });
});

describe('git:get-pr-status', () => {
  const workspacePath = '/repo/workspace';
  const ghViewCommand =
    'gh pr view --json number,url,state,isDraft,mergeStateStatus,headRefName,baseRefName,title,author -q .';

  it('returns PR data when gh reports an existing pull request', async () => {
    mockExecSteps(workspacePath, [
      { command: 'git rev-parse --is-inside-work-tree', result: { stdout: 'true\n' } },
      {
        command: ghViewCommand,
        result: { stdout: JSON.stringify({ number: 12, title: 'Ready', url: 'https://pr' }) },
      },
    ]);

    registerGitIpc();
    const handler = getHandler('git:get-pr-status');
    const result = (await handler({}, { workspacePath })) as { success: boolean; pr?: unknown };

    expect(result.success).toBe(true);
    expect(result.pr).toEqual({ number: 12, title: 'Ready', url: 'https://pr' });
  });

  it('parses JSON output even when gh returns extra whitespace', async () => {
    const payload = { number: 5, state: 'OPEN', headRefName: 'feature' };
    mockExecSteps(workspacePath, [
      { command: 'git rev-parse --is-inside-work-tree', result: { stdout: 'true\n' } },
      {
        command: ghViewCommand,
        result: { stdout: ` \n ${JSON.stringify(payload)} \n` },
      },
    ]);

    registerGitIpc();
    const handler = getHandler('git:get-pr-status');
    const result = (await handler({}, { workspacePath })) as { success: boolean; pr?: unknown };

    expect(result.pr).toEqual(payload);
  });

  it('returns null PR when gh reports none found', async () => {
    mockExecSteps(workspacePath, [
      { command: 'git rev-parse --is-inside-work-tree', result: { stdout: 'true\n' } },
      { command: ghViewCommand, error: 'no pull requests found for branch' },
    ]);

    registerGitIpc();
    const handler = getHandler('git:get-pr-status');
    const result = (await handler({}, { workspacePath })) as { success: boolean; pr?: unknown };

    expect(result.success).toBe(true);
    expect(result.pr).toBeNull();
  });

  it('returns a useful error when gh returns no JSON payload', async () => {
    mockExecSteps(workspacePath, [
      { command: 'git rev-parse --is-inside-work-tree', result: { stdout: 'true\n' } },
      { command: ghViewCommand, result: { stdout: '' } },
    ]);

    registerGitIpc();
    const handler = getHandler('git:get-pr-status');
    const result = (await handler({}, { workspacePath })) as { success: boolean; error?: string };

    expect(result.success).toBe(false);
    expect(result.error).toBe('No PR data returned');
  });

  it('handles gh command failures by surfacing the error message', async () => {
    mockExecSteps(workspacePath, [
      { command: 'git rev-parse --is-inside-work-tree', result: { stdout: 'true\n' } },
      { command: ghViewCommand, error: new Error('gh boom') },
    ]);

    registerGitIpc();
    const handler = getHandler('git:get-pr-status');
    const result = (await handler({}, { workspacePath })) as { success: boolean; error?: string };

    expect(result.success).toBe(false);
    expect(result.error).toBe('Error: gh boom');
  });

  it('validates that the workspace is a git repository', async () => {
    mockExecSteps(
      workspacePath,
      [{ command: 'git rev-parse --is-inside-work-tree', error: 'fatal: not a git repo' }],
      { allowExtra: true }
    );

    registerGitIpc();
    const handler = getHandler('git:get-pr-status');
    const result = (await handler({}, { workspacePath })) as { success: boolean; error?: string };

    expect(result.success).toBe(false);
    expect(result.error).toBe('fatal: not a git repo');
  });
});

describe('git:commit-and-push', () => {
  const workspacePath = '/repo/workspace';

  it('commits and pushes changes successfully', async () => {
    mockExecSteps(workspacePath, [
      { command: 'git rev-parse --is-inside-work-tree', result: { stdout: 'true\n' } },
      { command: 'git branch --show-current', result: { stdout: 'feature/login\n' } },
      {
        command: 'gh repo view --json defaultBranchRef -q .defaultBranchRef.name',
        result: { stdout: 'main\n' },
      },
      { command: 'git status --porcelain', result: { stdout: ' M src/app.ts\n' } },
      { command: 'git add -A', result: { stdout: '', stderr: '' } },
      { command: 'git reset -q .emdash || true', result: { stdout: '', stderr: '' } },
      { command: 'git reset -q PLANNING.md || true', result: { stdout: '', stderr: '' } },
      { command: 'git reset -q planning.md || true', result: { stdout: '', stderr: '' } },
      {
        command: 'git commit -m "feat: tidy docs"',
        result: { stdout: '1 file changed\n', stderr: '' },
      },
      { command: 'git push', result: { stdout: '', stderr: '' } },
      { command: 'git status -sb', result: { stdout: '## feature/login\n' } },
    ]);

    registerGitIpc();
    const handler = getHandler('git:commit-and-push');
    const result = (await handler({}, {
      workspacePath,
      commitMessage: 'feat: tidy docs',
      createBranchIfOnDefault: false,
    })) as { success: boolean; branch?: string; output?: string };

    expect(result).toEqual({ success: true, branch: 'feature/login', output: '## feature/login' });
  });

  it('creates a feature branch when on the default branch', async () => {
    const dateSpy = vi.spyOn(Date, 'now').mockReturnValue(1234567890);
    mockExecSteps(workspacePath, [
      { command: 'git rev-parse --is-inside-work-tree', result: { stdout: 'true\n' } },
      { command: 'git branch --show-current', result: { stdout: 'main\n' } },
      {
        command: 'gh repo view --json defaultBranchRef -q .defaultBranchRef.name',
        result: { stdout: 'main\n' },
      },
      { command: 'git checkout -b "orch/kf12oi"', result: { stdout: 'Switched\n', stderr: '' } },
      { command: 'git status --porcelain', result: { stdout: '' } },
      { command: 'git push', result: { stdout: '', stderr: '' } },
      { command: 'git status -sb', result: { stdout: '## orch/kf12oi\n' } },
    ]);

    registerGitIpc();
    const handler = getHandler('git:commit-and-push');
    const result = (await handler({}, { workspacePath })) as {
      success: boolean;
      branch?: string;
      output?: string;
    };

    expect(result.branch).toBe('orch/kf12oi');
    expect(result.output).toBe('## orch/kf12oi');
    dateSpy.mockRestore();
  });

  it('uses the provided commit message when committing changes', async () => {
    mockExecSteps(workspacePath, [
      { command: 'git rev-parse --is-inside-work-tree', result: { stdout: 'true\n' } },
      { command: 'git branch --show-current', result: { stdout: 'feature/login\n' } },
      {
        command: 'gh repo view --json defaultBranchRef -q .defaultBranchRef.name',
        result: { stdout: 'main\n' },
      },
      { command: 'git status --porcelain', result: { stdout: ' M src/app.ts\n' } },
      { command: 'git add -A', result: { stdout: '', stderr: '' } },
      { command: 'git reset -q .emdash || true', result: { stdout: '', stderr: '' } },
      { command: 'git reset -q PLANNING.md || true', result: { stdout: '', stderr: '' } },
      { command: 'git reset -q planning.md || true', result: { stdout: '', stderr: '' } },
      {
        command: 'git commit -m "feat: custom message"',
        result: { stdout: '1 file changed\n', stderr: '' },
      },
      { command: 'git push', result: { stdout: '', stderr: '' } },
      { command: 'git status -sb', result: { stdout: '## feature/login\n' } },
    ]);

    registerGitIpc();
    const handler = getHandler('git:commit-and-push');
    await handler({}, {
      workspacePath,
      commitMessage: 'feat: custom message',
      createBranchIfOnDefault: false,
    });

    expect(wasCommandInvoked('git commit -m "feat: custom message"')).toBe(true);
  });

  it('excludes plan mode artifacts before committing', async () => {
    mockExecSteps(workspacePath, [
      { command: 'git rev-parse --is-inside-work-tree', result: { stdout: 'true\n' } },
      { command: 'git branch --show-current', result: { stdout: 'feature/login\n' } },
      {
        command: 'gh repo view --json defaultBranchRef -q .defaultBranchRef.name',
        result: { stdout: 'main\n' },
      },
      { command: 'git status --porcelain', result: { stdout: ' M src/app.ts\n' } },
      { command: 'git add -A', result: { stdout: '', stderr: '' } },
      { command: 'git reset -q .emdash || true', result: { stdout: '', stderr: '' } },
      { command: 'git reset -q PLANNING.md || true', result: { stdout: '', stderr: '' } },
      { command: 'git reset -q planning.md || true', result: { stdout: '', stderr: '' } },
      {
        command: 'git commit -m "feat: tidy docs"',
        result: { stdout: '1 file changed\n', stderr: '' },
      },
      { command: 'git push', result: { stdout: '', stderr: '' } },
      { command: 'git status -sb', result: { stdout: '## feature/login\n' } },
    ]);

    registerGitIpc();
    const handler = getHandler('git:commit-and-push');
    await handler({}, {
      workspacePath,
      commitMessage: 'feat: tidy docs',
      createBranchIfOnDefault: false,
    });

    expect(wasCommandInvoked('git reset -q .emdash || true')).toBe(true);
    expect(wasCommandInvoked('git reset -q PLANNING.md || true')).toBe(true);
    expect(wasCommandInvoked('git reset -q planning.md || true')).toBe(true);
  });

  it('sets upstream when pushing a new branch fails initially', async () => {
    mockExecSteps(workspacePath, [
      { command: 'git rev-parse --is-inside-work-tree', result: { stdout: 'true\n' } },
      { command: 'git branch --show-current', result: { stdout: 'feature/login\n' } },
      {
        command: 'gh repo view --json defaultBranchRef -q .defaultBranchRef.name',
        result: { stdout: 'main\n' },
      },
      { command: 'git status --porcelain', result: { stdout: '' } },
      { command: 'git push', error: new Error('push failed') },
      {
        command: 'git push --set-upstream origin "feature/login"',
        result: { stdout: '', stderr: '' },
      },
      { command: 'git status -sb', result: { stdout: '## feature/login\n' } },
    ]);

    registerGitIpc();
    const handler = getHandler('git:commit-and-push');
    const result = (await handler({}, {
      workspacePath,
      createBranchIfOnDefault: false,
    })) as { success: boolean };

    expect(result.success).toBe(true);
    expect(wasCommandInvoked('git push --set-upstream origin "feature/login"')).toBe(true);
  });

  it('handles the case when no changes are detected', async () => {
    mockExecSteps(workspacePath, [
      { command: 'git rev-parse --is-inside-work-tree', result: { stdout: 'true\n' } },
      { command: 'git branch --show-current', result: { stdout: 'feature/login\n' } },
      {
        command: 'gh repo view --json defaultBranchRef -q .defaultBranchRef.name',
        result: { stdout: 'main\n' },
      },
      { command: 'git status --porcelain', result: { stdout: '' } },
      { command: 'git push', result: { stdout: '', stderr: '' } },
      { command: 'git status -sb', result: { stdout: '## feature/login\n' } },
    ]);

    registerGitIpc();
    const handler = getHandler('git:commit-and-push');
    const result = (await handler({}, {
      workspacePath,
      createBranchIfOnDefault: false,
    })) as { success: boolean };

    expect(result.success).toBe(true);
    expect(wasCommandInvoked('git add -A')).toBe(false);
  });

  it('respects default parameters for commit message and branch prefix', async () => {
    const dateSpy = vi.spyOn(Date, 'now').mockReturnValue(42);
    mockExecSteps(workspacePath, [
      { command: 'git rev-parse --is-inside-work-tree', result: { stdout: 'true\n' } },
      { command: 'git branch --show-current', result: { stdout: '\n' } },
      {
        command: 'gh repo view --json defaultBranchRef -q .defaultBranchRef.name',
        result: { stdout: 'main\n' },
      },
      { command: 'git checkout -b "orch/16"', result: { stdout: 'Switched\n', stderr: '' } },
      { command: 'git status --porcelain', result: { stdout: ' M src/app.ts\n' } },
      { command: 'git add -A', result: { stdout: '', stderr: '' } },
      { command: 'git reset -q .emdash || true', result: { stdout: '', stderr: '' } },
      { command: 'git reset -q PLANNING.md || true', result: { stdout: '', stderr: '' } },
      { command: 'git reset -q planning.md || true', result: { stdout: '', stderr: '' } },
      {
        command: 'git commit -m "chore: apply workspace changes"',
        result: { stdout: '1 file changed\n', stderr: '' },
      },
      { command: 'git push', result: { stdout: '', stderr: '' } },
      { command: 'git status -sb', result: { stdout: '## orch/16\n' } },
    ]);

    registerGitIpc();
    const handler = getHandler('git:commit-and-push');
    const result = (await handler({}, { workspacePath })) as {
      success: boolean;
      branch?: string;
    };

    expect(result.branch).toBe('orch/16');
    expect(wasCommandInvoked('git commit -m "chore: apply workspace changes"')).toBe(true);
    dateSpy.mockRestore();
  });

  it('logs and returns failure when an unexpected error occurs', async () => {
    const fatal = new Error('not a repo');
    mockExecSteps(workspacePath, [{ command: 'git rev-parse --is-inside-work-tree', error: fatal }]);

    registerGitIpc();
    const handler = getHandler('git:commit-and-push');
    const result = (await handler({}, { workspacePath })) as { success: boolean; error?: unknown };

    expect(result.success).toBe(false);
    expect(result.error).toBe(fatal);
    expect(logErrorMock).toHaveBeenCalledWith('Failed to commit and push:', fatal);
  });

  it('warns when staging fails but still pushes changes', async () => {
    mockExecSteps(workspacePath, [
      { command: 'git rev-parse --is-inside-work-tree', result: { stdout: 'true\n' } },
      { command: 'git branch --show-current', result: { stdout: 'feature/login\n' } },
      {
        command: 'gh repo view --json defaultBranchRef -q .defaultBranchRef.name',
        result: { stdout: 'main\n' },
      },
      { command: 'git status --porcelain', error: 'status failure' },
      { command: 'git push', result: { stdout: '', stderr: '' } },
      { command: 'git status -sb', result: { stdout: '## feature/login\n' } },
    ]);

    registerGitIpc();
    const handler = getHandler('git:commit-and-push');
    const result = (await handler({}, {
      workspacePath,
      createBranchIfOnDefault: false,
    })) as { success: boolean };

    expect(result.success).toBe(true);
    expect(logWarnMock).toHaveBeenCalledWith('Stage/commit step issue:', 'status failure');
  });
});

describe('git:get-branch-status', () => {
  const workspacePath = '/repo/workspace';

  it('returns branch status with ahead and behind counts', async () => {
    mockExecSteps(workspacePath, [
      { command: 'git rev-parse --is-inside-work-tree', result: { stdout: 'true\n' } },
      { command: 'git branch --show-current', result: { stdout: 'feature/login\n' } },
      {
        command: 'gh repo view --json defaultBranchRef -q .defaultBranchRef.name',
        result: { stdout: 'main\n' },
      },
      {
        command: 'git rev-list --left-right --count origin/main...HEAD',
        result: { stdout: '3 1\n' },
      },
    ]);

    registerGitIpc();
    const handler = getHandler('git:get-branch-status');
    const result = (await handler({}, { workspacePath })) as {
      success: boolean;
      branch?: string;
      defaultBranch?: string;
      ahead?: number;
      behind?: number;
    };

    expect(result).toEqual({
      success: true,
      branch: 'feature/login',
      defaultBranch: 'main',
      ahead: 1,
      behind: 3,
    });
  });

  it('uses gh to determine the default branch when available', async () => {
    mockExecSteps(workspacePath, [
      { command: 'git rev-parse --is-inside-work-tree', result: { stdout: 'true\n' } },
      { command: 'git branch --show-current', result: { stdout: 'feature/login\n' } },
      {
        command: 'gh repo view --json defaultBranchRef -q .defaultBranchRef.name',
        result: { stdout: 'develop\n' },
      },
      {
        command: 'git rev-list --left-right --count origin/develop...HEAD',
        result: { stdout: '0 0\n' },
      },
    ]);

    registerGitIpc();
    const handler = getHandler('git:get-branch-status');
    const result = (await handler({}, { workspacePath })) as {
      success: boolean;
      defaultBranch?: string;
    };

    expect(result.defaultBranch).toBe('develop');
  });

  it('falls back to git commands when gh queries fail', async () => {
    mockExecSteps(workspacePath, [
      { command: 'git rev-parse --is-inside-work-tree', result: { stdout: 'true\n' } },
      { command: 'git branch --show-current', result: { stdout: 'feature/login\n' } },
      {
        command: 'gh repo view --json defaultBranchRef -q .defaultBranchRef.name',
        error: new Error('gh offline'),
      },
      {
        command: 'git remote show origin | sed -n "/HEAD branch/s/.*: //p"',
        result: { stdout: 'main\n' },
      },
      {
        command: 'git rev-list --left-right --count origin/main...HEAD',
        error: new Error('compare failed'),
      },
      {
        command: 'git status -sb',
        result: { stdout: '## feature/login...ahead 2, behind 5\n' },
      },
    ]);

    registerGitIpc();
    const handler = getHandler('git:get-branch-status');
    const result = (await handler({}, { workspacePath })) as {
      success: boolean;
      ahead?: number;
      behind?: number;
    };

    expect(result.success).toBe(true);
    expect(result.ahead).toBe(2);
    expect(result.behind).toBe(5);
  });

  it('logs and surfaces errors when branch status cannot be determined', async () => {
    const err = new Error('fatal repo');
    mockExecSteps(workspacePath, [{ command: 'git rev-parse --is-inside-work-tree', error: err }]);

    registerGitIpc();
    const handler = getHandler('git:get-branch-status');
    const result = (await handler({}, { workspacePath })) as { success: boolean; error?: unknown };

    expect(result.success).toBe(false);
    expect(result.error).toBe(err);
    expect(logErrorMock).toHaveBeenCalledWith('Failed to get branch status:', err);
  });
});
