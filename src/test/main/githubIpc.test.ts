import { createHash } from 'node:crypto';
import * as nodePath from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorktreeInfo } from '../../main/services/WorktreeService';

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown> | unknown;
type ExecOptions = { cwd?: string };
type ExecResult = { stdout?: string; stderr?: string };

const {
  handlers,
  handleMock,
  appGetPathMock,
  githubAuthenticateMock,
  githubIsAuthenticatedMock,
  githubGetUserInfoMock,
  githubGetRepositoriesMock,
  githubGetStoredTokenMock,
  githubListIssuesMock,
  githubSearchIssuesMock,
  githubGetIssueMock,
  githubGetPullRequestsMock,
  githubEnsurePullRequestBranchMock,
  githubLogoutMock,
  worktreeServiceMock,
  worktreeListWorktreesMock,
  worktreeCreateFromBranchMock,
  execMock,
  execAsyncMock,
  existsSyncMock,
  mkdirSyncMock,
  pathJoinMock,
  pathDirnameMock,
  pathResolveMock,
  logInfoMock,
  logWarnMock,
  logErrorMock,
  logMock,
  GitHubServiceConstructorMock,
} = vi.hoisted(() => {
  const handlers = new Map<string, Handler>();
  const handleMock = vi.fn((channel: string, handler: Handler) => {
    handlers.set(channel, handler);
  });

  const appGetPathMock = vi.fn(() => '/user/data');

  const githubAuthenticateMock = vi.fn();
  const githubIsAuthenticatedMock = vi.fn();
  const githubGetUserInfoMock = vi.fn();
  const githubGetRepositoriesMock = vi.fn();
  const githubGetStoredTokenMock = vi.fn();
  const githubListIssuesMock = vi.fn();
  const githubSearchIssuesMock = vi.fn();
  const githubGetIssueMock = vi.fn();
  const githubGetPullRequestsMock = vi.fn();
  const githubEnsurePullRequestBranchMock = vi.fn();
  const githubLogoutMock = vi.fn();

  const githubServiceMock = {
    authenticate: githubAuthenticateMock,
    isAuthenticated: githubIsAuthenticatedMock,
    getUserInfo: githubGetUserInfoMock,
    getRepositories: githubGetRepositoriesMock,
    listIssues: githubListIssuesMock,
    searchIssues: githubSearchIssuesMock,
    getIssue: githubGetIssueMock,
    getPullRequests: githubGetPullRequestsMock,
    ensurePullRequestBranch: githubEnsurePullRequestBranchMock,
    logout: githubLogoutMock,
    getStoredToken: githubGetStoredTokenMock,
  } as const;

  const GitHubServiceConstructorMock = vi.fn(() => githubServiceMock);

  const worktreeListWorktreesMock = vi.fn();
  const worktreeCreateFromBranchMock = vi.fn();
  const worktreeServiceMock = {
    listWorktrees: worktreeListWorktreesMock,
    createWorktreeFromBranch: worktreeCreateFromBranchMock,
  } as const;

  const execMock = vi.fn();
  const execAsyncMock = vi.fn<(command: string, options?: ExecOptions) => Promise<ExecResult>>();

  const existsSyncMock = vi.fn<(path: string) => boolean>();
  const mkdirSyncMock = vi.fn<(path: string, options?: { recursive?: boolean }) => void>();

  // Simple path operations without external dependency
  const pathJoinMock = vi.fn((...parts: string[]) => parts.filter(Boolean).join('/').replace(/\/+/g, '/'));
  const pathDirnameMock = vi.fn((filePath: string) => filePath.substring(0, filePath.lastIndexOf('/')));
  const pathResolveMock = vi.fn((...parts: string[]) => '/' + parts.filter(Boolean).join('/').replace(/\/+/g, '/'));

  const logInfoMock = vi.fn();
  const logWarnMock = vi.fn();
  const logErrorMock = vi.fn();
  const logMock = {
    debug: vi.fn(),
    info: logInfoMock,
    warn: logWarnMock,
    error: logErrorMock,
  } as const;

  return {
    handlers,
    handleMock,
    appGetPathMock,
    githubAuthenticateMock,
    githubIsAuthenticatedMock,
    githubGetUserInfoMock,
    githubGetRepositoriesMock,
    githubGetStoredTokenMock,
    githubListIssuesMock,
    githubSearchIssuesMock,
    githubGetIssueMock,
    githubGetPullRequestsMock,
    githubEnsurePullRequestBranchMock,
    githubLogoutMock,
    worktreeServiceMock,
    worktreeListWorktreesMock,
    worktreeCreateFromBranchMock,
    execMock,
    execAsyncMock,
    existsSyncMock,
    mkdirSyncMock,
    pathJoinMock,
    pathDirnameMock,
    pathResolveMock,
    logInfoMock,
    logWarnMock,
    logErrorMock,
    logMock,
    GitHubServiceConstructorMock,
  };
});

vi.mock('electron', () => ({
  ipcMain: {
    handle: handleMock,
  },
  app: {
    getPath: appGetPathMock,
  },
}));

vi.mock('../../main/services/GitHubService', () => ({
  GitHubService: GitHubServiceConstructorMock,
}));

vi.mock('../../main/services/WorktreeService', () => ({
  worktreeService: worktreeServiceMock,
}));

vi.mock('child_process', () => ({
  exec: execMock,
}));

vi.mock('util', () => ({
  promisify: () => execAsyncMock,
}));

vi.mock('fs', () => ({
  existsSync: existsSyncMock,
  mkdirSync: mkdirSyncMock,
}));

vi.mock('path', () => ({
  join: pathJoinMock,
  dirname: pathDirnameMock,
  resolve: pathResolveMock,
}));

vi.mock('../../main/lib/logger', () => ({
  log: logMock,
}));

// eslint-disable-next-line import/first
import { registerGithubIpc } from '../../main/ipc/githubIpc';

function getHandler(channel: string): Handler {
  const handler = handlers.get(channel);
  if (!handler) {
    throw new Error(`Handler for ${channel} not registered`);
  }
  return handler;
}

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  registerGithubIpc();
  const handler = getHandler(channel);
  return (await handler({}, ...args)) as T;
}

function setupFsState(initialPaths: string[] = []) {
  const state = new Set(initialPaths);
  existsSyncMock.mockImplementation((target: string) => state.has(String(target)));
  mkdirSyncMock.mockImplementation((target: string) => {
    state.add(String(target));
  });
  return state;
}

function createWorktree(overrides?: Partial<WorktreeInfo>): WorktreeInfo {
  return {
    id: overrides?.id ?? 'wt-1',
    name: overrides?.name ?? 'pr-worktree',
    branch: overrides?.branch ?? 'pr/42',
    path: overrides?.path ?? '/repo/worktrees/pr-worktree',
    projectId: overrides?.projectId ?? 'proj-123',
    status: overrides?.status ?? 'active',
    createdAt: overrides?.createdAt ?? '2024-01-01T00:00:00.000Z',
    lastActivity: overrides?.lastActivity,
  };
}

const defaultProjectPath = '/repo/project';
const defaultRepoUrl = 'https://github.com/example/repo.git';
const defaultLocalPath = '/tmp/workspaces/repo';
const repoCacheRoot = nodePath.join('/user/data', 'repo-cache');
const repoMirrorHash = createHash('sha1')
  .update('https://github.com/example/repo')
  .digest('hex');
const defaultMirrorPath = nodePath.join(repoCacheRoot, `${repoMirrorHash}.mirror`);
const defaultParentDir = nodePath.dirname(defaultLocalPath);
const quote = (value: string) => JSON.stringify(value);

beforeEach(() => {
  handlers.clear();
  handleMock.mockClear();
  appGetPathMock.mockReset();
  appGetPathMock.mockReturnValue('/user/data');

  execMock.mockReset();
  execAsyncMock.mockReset();
  execAsyncMock.mockResolvedValue({ stdout: '', stderr: '' });

  existsSyncMock.mockReset();
  existsSyncMock.mockReturnValue(false);
  mkdirSyncMock.mockReset();
  mkdirSyncMock.mockImplementation(() => {});

  pathJoinMock.mockClear();
  pathDirnameMock.mockClear();
  pathResolveMock.mockClear();

  logInfoMock.mockReset();
  logWarnMock.mockReset();
  logErrorMock.mockReset();

  githubAuthenticateMock.mockReset();
  githubAuthenticateMock.mockResolvedValue({ success: true });
  githubIsAuthenticatedMock.mockReset();
  githubIsAuthenticatedMock.mockResolvedValue(false);
  githubGetUserInfoMock.mockReset();
  githubGetRepositoriesMock.mockReset();
  githubGetRepositoriesMock.mockResolvedValue([]);
  githubGetStoredTokenMock.mockReset();
  githubGetStoredTokenMock.mockResolvedValue(undefined);
  githubListIssuesMock.mockReset();
  githubListIssuesMock.mockResolvedValue([]);
  githubSearchIssuesMock.mockReset();
  githubSearchIssuesMock.mockResolvedValue([]);
  githubGetIssueMock.mockReset();
  githubGetIssueMock.mockResolvedValue(null);
  githubGetPullRequestsMock.mockReset();
  githubGetPullRequestsMock.mockResolvedValue([]);
  githubEnsurePullRequestBranchMock.mockReset();
  githubLogoutMock.mockReset();

  worktreeListWorktreesMock.mockReset();
  worktreeListWorktreesMock.mockResolvedValue([]);
  worktreeCreateFromBranchMock.mockReset();

  GitHubServiceConstructorMock.mockClear();

  process.env.EMDASH_DISABLE_CLONE_CACHE = undefined;
});

describe('github:connect', () => {
  it('connects successfully when authenticated', async () => {
    githubIsAuthenticatedMock.mockResolvedValue(true);
    const repoInfo = { nameWithOwner: 'org/repo', defaultBranchRef: { name: 'main' } };
    execAsyncMock.mockResolvedValueOnce({ stdout: JSON.stringify(repoInfo) });

    const result = await invoke<{ success: boolean; repository?: string; branch?: string }>(
      'github:connect',
      defaultProjectPath
    );

    expect(result).toEqual({ success: true, repository: 'org/repo', branch: 'main' });
    expect(execAsyncMock).toHaveBeenCalledWith(
      'gh repo view --json name,nameWithOwner,defaultBranchRef',
      { cwd: defaultProjectPath }
    );
  });

  it('returns repository info from gh CLI response', async () => {
    githubIsAuthenticatedMock.mockResolvedValue(true);
    execAsyncMock.mockResolvedValueOnce(
      { stdout: JSON.stringify({ nameWithOwner: 'org/repo', defaultBranchRef: { name: 'dev' } }) }
    );

    const result = await invoke<{ branch?: string; repository?: string }>(
      'github:connect',
      defaultProjectPath
    );

    expect(result.repository).toBe('org/repo');
    expect(result.branch).toBe('dev');
  });

  it('handles gh CLI not authenticated state', async () => {
    githubIsAuthenticatedMock.mockResolvedValue(false);

    const result = await invoke<{ success: boolean; error?: string }>(
      'github:connect',
      defaultProjectPath
    );

    expect(result).toEqual({ success: false, error: 'GitHub CLI not authenticated' });
    expect(execAsyncMock).not.toHaveBeenCalled();
  });

  it('handles repository not found errors', async () => {
    githubIsAuthenticatedMock.mockResolvedValue(true);
    execAsyncMock.mockRejectedValueOnce(new Error('not found'));

    const result = await invoke<{ success: boolean; error?: string }>(
      'github:connect',
      defaultProjectPath
    );

    expect(result).toEqual({
      success: false,
      error: 'Repository not found on GitHub or not connected to GitHub CLI',
    });
  });
});

describe('github:auth', () => {
  it('authenticates successfully via service', async () => {
    const authResult = { success: true, token: 'token' };
    githubAuthenticateMock.mockResolvedValue(authResult);

    const result = await invoke('github:auth');

    expect(result).toBe(authResult);
    expect(githubAuthenticateMock).toHaveBeenCalled();
  });

  it('handles authentication failures', async () => {
    const error = new Error('auth failed');
    githubAuthenticateMock.mockRejectedValue(error);

    const result = await invoke<{ success: boolean; error?: string }>('github:auth');

    expect(result).toEqual({ success: false, error: 'Authentication failed' });
    expect(logErrorMock).toHaveBeenCalledWith('GitHub authentication failed:', error);
  });
});

describe('github:isAuthenticated', () => {
  it('returns true when service confirms authentication', async () => {
    githubIsAuthenticatedMock.mockResolvedValue(true);

    const result = await invoke<boolean>('github:isAuthenticated');

    expect(result).toBe(true);
  });

  it('returns false when service reports unauthenticated', async () => {
    githubIsAuthenticatedMock.mockResolvedValue(false);

    const result = await invoke<boolean>('github:isAuthenticated');

    expect(result).toBe(false);
  });

  it('returns false on service errors', async () => {
    const error = new Error('boom');
    githubIsAuthenticatedMock.mockRejectedValue(error);

    const result = await invoke<boolean>('github:isAuthenticated');

    expect(result).toBe(false);
    expect(logErrorMock).toHaveBeenCalledWith('GitHub authentication check failed:', error);
  });
});

describe('github:getStatus', () => {
  it('returns installed and authenticated true with user data', async () => {
    const user = { login: 'codex' };
    execAsyncMock
      .mockResolvedValueOnce({ stdout: 'gh version' })
      .mockResolvedValueOnce({ stdout: JSON.stringify(user) });

    const result = await invoke<{ installed: boolean; authenticated: boolean; user?: unknown }>(
      'github:getStatus'
    );

    expect(result).toEqual({ installed: true, authenticated: true, user });
  });

  it('marks gh as not installed when version command fails', async () => {
    execAsyncMock.mockRejectedValueOnce(new Error('missing'));

    const result = await invoke<{ installed: boolean; authenticated: boolean; user?: unknown }>(
      'github:getStatus'
    );

    expect(result).toEqual({ installed: false, authenticated: false, user: null });
  });

  it('marks user unauthenticated when user lookup fails', async () => {
    execAsyncMock
      .mockResolvedValueOnce({ stdout: 'gh version' })
      .mockRejectedValueOnce(new Error('not auth'));

    const result = await invoke<{ installed: boolean; authenticated: boolean; user?: unknown }>(
      'github:getStatus'
    );

    expect(result).toEqual({ installed: true, authenticated: false, user: null });
  });

  it('handles invalid gh user output gracefully', async () => {
    execAsyncMock
      .mockResolvedValueOnce({ stdout: 'gh version' })
      .mockResolvedValueOnce({ stdout: 'invalid json' });

    const result = await invoke<{ installed: boolean; authenticated: boolean; user?: unknown }>(
      'github:getStatus'
    );

    expect(result).toEqual({ installed: true, authenticated: false, user: null });
  });
});

describe('github:getUser', () => {
  it('returns user info when stored token exists', async () => {
    const token = 'token-123';
    const user = { login: 'codex' };
    githubGetStoredTokenMock.mockResolvedValue(token);
    githubGetUserInfoMock.mockResolvedValue(user);

    const result = await invoke<typeof user | null>('github:getUser');

    expect(result).toBe(user);
    expect(githubGetUserInfoMock).toHaveBeenCalledWith(token);
  });

  it('returns null when no stored token', async () => {
    githubGetStoredTokenMock.mockResolvedValue(null);

    const result = await invoke<null>('github:getUser');

    expect(result).toBeNull();
    expect(githubGetUserInfoMock).not.toHaveBeenCalled();
  });

  it('returns null when service throws', async () => {
    const error = new Error('user fail');
    githubGetStoredTokenMock.mockResolvedValue('token');
    githubGetUserInfoMock.mockRejectedValue(error);

    const result = await invoke<null>('github:getUser');

    expect(result).toBeNull();
    expect(logErrorMock).toHaveBeenCalledWith('Failed to get user info:', error);
  });
});

describe('github:getRepositories', () => {
  it('returns repositories when token exists', async () => {
    const repos = [{ id: 1 }];
    githubGetStoredTokenMock.mockResolvedValue('token');
    githubGetRepositoriesMock.mockResolvedValue(repos);

    const result = await invoke<unknown[]>('github:getRepositories');

    expect(result).toBe(repos);
    expect(githubGetRepositoriesMock).toHaveBeenCalledWith('token');
  });

  it('returns empty array when not authenticated', async () => {
    githubGetStoredTokenMock.mockResolvedValue(undefined);

    const result = await invoke<unknown[]>('github:getRepositories');

    expect(result).toEqual([]);
    expect(logErrorMock).toHaveBeenCalledWith('Failed to get repositories:', expect.any(Error));
  });

  it('handles service errors by returning empty array', async () => {
    const error = new Error('api fail');
    githubGetStoredTokenMock.mockResolvedValue('token');
    githubGetRepositoriesMock.mockRejectedValue(error);

    const result = await invoke<unknown[]>('github:getRepositories');

    expect(result).toEqual([]);
    expect(logErrorMock).toHaveBeenCalledWith('Failed to get repositories:', error);
  });
});

describe('github:cloneRepository', () => {
  it('clones repository using cache mirror', async () => {
    githubIsAuthenticatedMock.mockResolvedValue(true);
    setupFsState([defaultParentDir]);

    const result = await invoke<{ success: boolean }>(
      'github:cloneRepository',
      defaultRepoUrl,
      defaultLocalPath
    );

    expect(result).toEqual({ success: true });
    expect(execAsyncMock).toHaveBeenCalledTimes(2);
    expect(execAsyncMock).toHaveBeenNthCalledWith(
      1,
      `git clone --mirror --filter=blob:none ${quote(defaultRepoUrl)} ${quote(defaultMirrorPath)}`
    );
    expect(execAsyncMock).toHaveBeenNthCalledWith(
      2,
      `git clone --reference-if-able ${quote(defaultMirrorPath)} --dissociate ${quote(defaultRepoUrl)} ${quote(defaultLocalPath)}`
    );
  });

  it('creates cache directory when missing', async () => {
    const state = setupFsState([defaultParentDir]);
    state.delete(repoCacheRoot);

    await invoke('github:cloneRepository', defaultRepoUrl, defaultLocalPath);

    expect(mkdirSyncMock).toHaveBeenCalledWith(repoCacheRoot, { recursive: true });
  });

  it('reuses existing mirror and refreshes it', async () => {
    setupFsState([defaultParentDir, repoCacheRoot, defaultMirrorPath]);

    await invoke('github:cloneRepository', defaultRepoUrl, defaultLocalPath);

    expect(execAsyncMock).toHaveBeenNthCalledWith(
      1,
      `git -C ${quote(defaultMirrorPath)} remote set-url origin ${quote(defaultRepoUrl)}`
    );
    expect(execAsyncMock).toHaveBeenNthCalledWith(
      2,
      `git -C ${quote(defaultMirrorPath)} remote update --prune`
    );
    expect(execAsyncMock).toHaveBeenNthCalledWith(
      3,
      `git clone --reference-if-able ${quote(defaultMirrorPath)} --dissociate ${quote(defaultRepoUrl)} ${quote(defaultLocalPath)}`
    );
  });

  it('falls back to direct clone when cache clone fails', async () => {
    setupFsState([defaultParentDir]);
    const cacheError = new Error('cache fail');
    execAsyncMock.mockRejectedValueOnce(cacheError).mockResolvedValue({ stdout: '' });

    const result = await invoke<{ success: boolean }>(
      'github:cloneRepository',
      defaultRepoUrl,
      defaultLocalPath
    );

    expect(result).toEqual({ success: true });
    expect(logErrorMock).toHaveBeenCalledWith('Failed to clone repository via cache:', cacheError);
    const fallbackCommand = `git clone ${quote(defaultRepoUrl)} ${quote(defaultLocalPath)}`;
    expect(execAsyncMock).toHaveBeenLastCalledWith(fallbackCommand);
  });

  it('honors EMDASH_DISABLE_CLONE_CACHE flag', async () => {
    process.env.EMDASH_DISABLE_CLONE_CACHE = '1';

    const result = await invoke<{ success: boolean }>(
      'github:cloneRepository',
      defaultRepoUrl,
      defaultLocalPath
    );

    expect(result).toEqual({ success: true });
    expect(execAsyncMock).toHaveBeenCalledTimes(1);
    expect(execAsyncMock).toHaveBeenCalledWith(
      `git clone ${quote(defaultRepoUrl)} ${quote(defaultLocalPath)}`
    );
    expect(existsSyncMock).not.toHaveBeenCalled();
  });
});

describe('github:logout', () => {
  it('logs out successfully', async () => {
    await invoke('github:logout');

    expect(githubLogoutMock).toHaveBeenCalled();
  });

  it('swallows logout errors after logging', async () => {
    const error = new Error('logout fail');
    githubLogoutMock.mockRejectedValue(error);

    await invoke('github:logout');

    expect(logErrorMock).toHaveBeenCalledWith('Failed to logout:', error);
  });
});

describe('github:issues:list', () => {
  it('lists issues successfully', async () => {
    const issues = [{ number: 1 }];
    githubListIssuesMock.mockResolvedValue(issues);

    const result = await invoke<{ success: boolean; issues?: unknown[] }>(
      'github:issues:list',
      defaultProjectPath,
      10
    );

    expect(result).toEqual({ success: true, issues });
    expect(githubListIssuesMock).toHaveBeenCalledWith(defaultProjectPath, 10);
  });

  it('validates projectPath parameter', async () => {
    const result = await invoke<{ success: boolean; error?: string }>(
      'github:issues:list',
      ''
    );

    expect(result).toEqual({ success: false, error: 'Project path is required' });
    expect(githubListIssuesMock).not.toHaveBeenCalled();
  });

  it('uses default limit of 50', async () => {
    await invoke('github:issues:list', defaultProjectPath);

    expect(githubListIssuesMock).toHaveBeenCalledWith(defaultProjectPath, 50);
  });

  it('handles service errors', async () => {
    const error = new Error('list fail');
    githubListIssuesMock.mockRejectedValue(error);

    const result = await invoke<{ success: boolean; error?: string }>(
      'github:issues:list',
      defaultProjectPath
    );

    expect(result).toEqual({ success: false, error: 'list fail' });
  });
});

describe('github:issues:search', () => {
  it('searches issues successfully', async () => {
    const issues = [{ number: 2 }];
    githubSearchIssuesMock.mockResolvedValue(issues);

    const result = await invoke<{ success: boolean; issues?: unknown[] }>(
      'github:issues:search',
      defaultProjectPath,
      'bug',
      5
    );

    expect(result).toEqual({ success: true, issues });
    expect(githubSearchIssuesMock).toHaveBeenCalledWith(defaultProjectPath, 'bug', 5);
  });

  it('validates projectPath and searchTerm', async () => {
    const noPath = await invoke<{ success: boolean; error?: string }>(
      'github:issues:search',
      '',
      'term'
    );
    expect(noPath).toEqual({ success: false, error: 'Project path is required' });

    registerGithubIpc();
    const handler = getHandler('github:issues:search');
    const noTerm = (await handler({}, defaultProjectPath, '')) as { success: boolean; error?: string };
    expect(noTerm).toEqual({ success: false, error: 'Search term is required' });
  });

  it('uses default limit of 20', async () => {
    await invoke('github:issues:search', defaultProjectPath, 'query');

    expect(githubSearchIssuesMock).toHaveBeenCalledWith(defaultProjectPath, 'query', 20);
  });

  it('handles service errors', async () => {
    const error = new Error('search fail');
    githubSearchIssuesMock.mockRejectedValue(error);

    const result = await invoke<{ success: boolean; error?: string }>(
      'github:issues:search',
      defaultProjectPath,
      'query'
    );

    expect(result).toEqual({ success: false, error: 'search fail' });
  });
});

describe('github:issues:get', () => {
  it('gets issue by number', async () => {
    const issue = { number: 10 };
    githubGetIssueMock.mockResolvedValue(issue);

    const result = await invoke<{ success: boolean; issue?: unknown }>(
      'github:issues:get',
      defaultProjectPath,
      10
    );

    expect(result).toEqual({ success: true, issue });
  });

  it('validates projectPath and number', async () => {
    const missingPath = await invoke<{ success: boolean; error?: string }>(
      'github:issues:get',
      '',
      1
    );
    expect(missingPath).toEqual({ success: false, error: 'Project path is required' });

    registerGithubIpc();
    const handler = getHandler('github:issues:get');
    const invalidNumber = (await handler({}, defaultProjectPath, Number.NaN)) as {
      success: boolean;
      error?: string;
    };
    expect(invalidNumber).toEqual({ success: false, error: 'Issue number is required' });
  });

  it('handles missing issue', async () => {
    githubGetIssueMock.mockResolvedValue(null);

    const result = await invoke<{ success: boolean; issue?: unknown }>(
      'github:issues:get',
      defaultProjectPath,
      55
    );

    expect(result).toEqual({ success: false, issue: undefined });
  });

  it('handles service errors', async () => {
    const error = new Error('get fail');
    githubGetIssueMock.mockRejectedValue(error);

    const result = await invoke<{ success: boolean; error?: string }>(
      'github:issues:get',
      defaultProjectPath,
      2
    );

    expect(result).toEqual({ success: false, error: 'get fail' });
  });
});

describe('github:listPullRequests', () => {
  it('lists pull requests successfully', async () => {
    const prs = [{ number: 1 }];
    githubGetPullRequestsMock.mockResolvedValue(prs);

    const result = await invoke<{ success: boolean; prs?: unknown[] }>('github:listPullRequests', {
      projectPath: defaultProjectPath,
    });

    expect(result).toEqual({ success: true, prs });
    expect(githubGetPullRequestsMock).toHaveBeenCalledWith(defaultProjectPath);
  });

  it('requires project path argument', async () => {
    const result = await invoke<{ success: boolean; error?: string }>('github:listPullRequests', {});

    expect(result).toEqual({ success: false, error: 'Project path is required' });
  });

  it('handles service errors gracefully', async () => {
    const error = new Error('prs fail');
    githubGetPullRequestsMock.mockRejectedValue(error);

    const result = await invoke<{ success: boolean; error?: string }>('github:listPullRequests', {
      projectPath: defaultProjectPath,
    });

    expect(result).toEqual({ success: false, error: 'prs fail' });
    expect(logErrorMock).toHaveBeenCalledWith('Failed to list pull requests:', error);
  });
});

describe('github:createPullRequestWorktree', () => {
  const handlerName = 'github:createPullRequestWorktree';

  function buildArgs(overrides?: Partial<{
    projectPath: string;
    projectId: string;
    prNumber: number;
    prTitle?: string;
    workspaceName?: string;
    branchName?: string;
  }>) {
    return {
      projectPath: defaultProjectPath,
      projectId: 'proj-123',
      prNumber: 42,
      prTitle: 'Refactor Auth',
      ...overrides,
    };
  }

  it('creates worktree for pull request', async () => {
    const worktree = createWorktree({ name: 'pr-42-refactor-auth', branch: 'pr/42' });
    worktreeCreateFromBranchMock.mockResolvedValue(worktree);
    setupFsState();

    const result = await invoke<{ success: boolean; worktree?: WorktreeInfo; workspaceName?: string }>(
      handlerName,
      buildArgs()
    );

    const worktreesDir = nodePath.resolve(defaultProjectPath, '..', 'worktrees');
    const expectedWorktreePath = nodePath.join(worktreesDir, 'pr-42-refactor-auth');

    expect(githubEnsurePullRequestBranchMock).toHaveBeenCalledWith(
      defaultProjectPath,
      42,
      'pr/42'
    );
    expect(worktreeCreateFromBranchMock).toHaveBeenCalledWith(
      defaultProjectPath,
      'pr-42-refactor-auth',
      'pr/42',
      'proj-123',
      { worktreePath: expectedWorktreePath }
    );
    expect(result).toEqual({
      success: true,
      worktree,
      branchName: 'pr/42',
      workspaceName: 'pr-42-refactor-auth',
    });
  });

  it('uses existing worktree if branch already exists', async () => {
    const existing = createWorktree({ branch: 'pr/42', name: 'existing' });
    worktreeListWorktreesMock.mockResolvedValue([existing]);

    const result = await invoke<{ success: boolean; worktree?: WorktreeInfo; workspaceName?: string }>(
      handlerName,
      buildArgs()
    );

    expect(result).toEqual({
      success: true,
      worktree: existing,
      branchName: 'pr/42',
      workspaceName: 'existing',
    });
    expect(worktreeCreateFromBranchMock).not.toHaveBeenCalled();
    expect(githubEnsurePullRequestBranchMock).not.toHaveBeenCalled();
  });

  it('slugifies workspace name when building worktree path', async () => {
    const worktree = createWorktree({ name: 'My Fancy Workspace', branch: 'pr/7' });
    worktreeCreateFromBranchMock.mockResolvedValue(worktree);
    setupFsState();

    const result = await invoke<{ success: boolean; workspaceName?: string }>(handlerName, {
      projectPath: defaultProjectPath,
      projectId: 'proj-111',
      prNumber: 7,
      workspaceName: '  My Fancy Workspace  ',
    });

    const worktreesDir = nodePath.resolve(defaultProjectPath, '..', 'worktrees');
    const expectedWorktreePath = nodePath.join(worktreesDir, 'my-fancy-workspace');

    expect(worktreeCreateFromBranchMock).toHaveBeenCalledWith(
      defaultProjectPath,
      'My Fancy Workspace',
      'pr/7',
      'proj-111',
      { worktreePath: expectedWorktreePath }
    );
    expect(result.workspaceName).toBe('My Fancy Workspace');
  });

  it('requires mandatory parameters', async () => {
    const result = await invoke<{ success: boolean; error?: string }>(handlerName, {
      projectPath: '',
      projectId: '',
      prNumber: 0,
    });

    expect(result).toEqual({ success: false, error: 'Missing required parameters' });
    expect(worktreeCreateFromBranchMock).not.toHaveBeenCalled();
  });

  it('handles worktree creation errors', async () => {
    const error = new Error('create fail');
    worktreeCreateFromBranchMock.mockRejectedValue(error);
    setupFsState();

    const result = await invoke<{ success: boolean; error?: string }>(handlerName, buildArgs());

    expect(result).toEqual({ success: false, error: 'create fail' });
    expect(logErrorMock).toHaveBeenCalledWith('Failed to create PR worktree:', error);
  });
});
