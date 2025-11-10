import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorktreeInfo } from '../../main/services/WorktreeService';

type WorktreeStatusPayload = {
  hasChanges: boolean;
  stagedFiles: string[];
  unstagedFiles: string[];
  untrackedFiles: string[];
};

const {
  handlers,
  handleMock,
  createWorktreeMock,
  listWorktreesMock,
  removeWorktreeMock,
  getWorktreeStatusMock,
  mergeWorktreeChangesMock,
  getWorktreeMock,
  getAllWorktreesMock,
  worktreeServiceMock,
} = vi.hoisted(() => {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>();
  const handleMock = vi.fn(
    (channel: string, handler: (event: unknown, ...args: unknown[]) => Promise<unknown>) => {
      handlers.set(channel, handler);
    }
  );

  const createWorktreeMock = vi.fn<
    (projectPath: string, workspaceName: string, projectId: string) => Promise<WorktreeInfo>
  >();
  const listWorktreesMock = vi.fn<(projectPath: string) => Promise<WorktreeInfo[]>>();
  const removeWorktreeMock = vi.fn<
    (
      projectPath: string,
      worktreeId: string,
      worktreePath?: string,
      branch?: string
    ) => Promise<void>
  >();
  const getWorktreeStatusMock = vi.fn<(worktreePath: string) => Promise<WorktreeStatusPayload>>();
  const mergeWorktreeChangesMock = vi.fn<
    (projectPath: string, worktreeId: string) => Promise<void>
  >();
  const getWorktreeMock = vi.fn<(worktreeId: string) => WorktreeInfo | undefined>();
  const getAllWorktreesMock = vi.fn<() => WorktreeInfo[]>();

  const worktreeServiceMock = {
    createWorktree: createWorktreeMock,
    listWorktrees: listWorktreesMock,
    removeWorktree: removeWorktreeMock,
    getWorktreeStatus: getWorktreeStatusMock,
    mergeWorktreeChanges: mergeWorktreeChangesMock,
    getWorktree: getWorktreeMock,
    getAllWorktrees: getAllWorktreesMock,
  };

  return {
    handlers,
    handleMock,
    createWorktreeMock,
    listWorktreesMock,
    removeWorktreeMock,
    getWorktreeStatusMock,
    mergeWorktreeChangesMock,
    getWorktreeMock,
    getAllWorktreesMock,
    worktreeServiceMock,
  };
});

vi.mock('electron', () => ({
  ipcMain: {
    handle: handleMock,
  },
}));

vi.mock('../../main/services/WorktreeService', () => ({
  get worktreeService() {
    return worktreeServiceMock;
  },
}));

// eslint-disable-next-line import/first
import { registerWorktreeIpc } from '../../main/services/worktreeIpc';

type HandlerResponse<T extends object = Record<string, never>> = {
  success: boolean;
  error?: string;
} & T;

function getHandler(channel: string) {
  const handler = handlers.get(channel);
  if (!handler) {
    throw new Error(`Handler for ${channel} not registered`);
  }
  return handler;
}

async function callHandler<T extends object = Record<string, never>>(
  handler: (event: unknown, ...args: unknown[]) => Promise<unknown>,
  args?: unknown
): Promise<HandlerResponse<T>> {
  return (await handler({}, args)) as HandlerResponse<T>;
}

function createWorktree(overrides?: Partial<WorktreeInfo>): WorktreeInfo {
  const base: WorktreeInfo = {
    id: 'wt-123',
    name: 'Alpha',
    branch: 'agent/alpha',
    path: '/repo/worktrees/alpha',
    projectId: 'proj-1',
    status: 'active',
    createdAt: '2024-01-01T00:00:00.000Z',
    lastActivity: '2024-01-02T00:00:00.000Z',
  };
  return { ...base, ...overrides };
}

describe('registerWorktreeIpc', () => {
  beforeEach(() => {
    handlers.clear();
    handleMock.mockClear();
    createWorktreeMock.mockReset();
    listWorktreesMock.mockReset();
    removeWorktreeMock.mockReset();
    getWorktreeStatusMock.mockReset();
    mergeWorktreeChangesMock.mockReset();
    getWorktreeMock.mockReset();
    getAllWorktreesMock.mockReset();
  });

  describe('worktree:create', () => {
    it('creates a worktree with required arguments', async () => {
      const worktree = createWorktree();
      createWorktreeMock.mockResolvedValue(worktree);
      registerWorktreeIpc();
      const handler = getHandler('worktree:create');

      const args = {
        projectPath: '/repo/project',
        workspaceName: 'Alpha',
        projectId: 'proj-1',
      };
      const result = await callHandler<{ worktree: WorktreeInfo }>(handler, args);

      expect(createWorktreeMock).toHaveBeenCalledWith(
        '/repo/project',
        'Alpha',
        'proj-1'
      );
      expect(result).toEqual({ success: true, worktree });
    });

    it('returns worktree details from the service response', async () => {
      const worktree = createWorktree({
        id: 'wt-999',
        branch: 'agent/feature-branch',
        status: 'completed',
      });
      createWorktreeMock.mockResolvedValue(worktree);
      registerWorktreeIpc();
      const handler = getHandler('worktree:create');

      const result = await callHandler<{ worktree: WorktreeInfo }>(handler, {
        projectPath: '/repo/project',
        workspaceName: 'Feature Workspace',
        projectId: 'proj-9',
      });

      expect(result.success).toBe(true);
      expect(result.worktree).toBe(worktree);
      expect(result.worktree?.branch).toBe('agent/feature-branch');
      expect(result.worktree?.status).toBe('completed');
    });

    it('handles service errors such as invalid projectPath', async () => {
      createWorktreeMock.mockRejectedValue(new Error('Invalid project path'));
      registerWorktreeIpc();
      const handler = getHandler('worktree:create');

      const result = await callHandler(handler, {
        projectPath: 'not-a-repo',
        workspaceName: 'Alpha',
        projectId: 'proj-1',
      });

      expect(result).toEqual({ success: false, error: 'Invalid project path' });
    });

    it('handles git errors propagated from the service', async () => {
      createWorktreeMock.mockRejectedValue(new Error('git worktree add failed'));
      registerWorktreeIpc();
      const handler = getHandler('worktree:create');

      const result = await callHandler(
        handler,
        { projectPath: '/repo', workspaceName: 'WS', projectId: 'proj-1' }
      );

      expect(result).toEqual({ success: false, error: 'git worktree add failed' });
    });

    it('handles non-Error rejection values with message field', async () => {
      createWorktreeMock.mockRejectedValue({ message: 'Permission denied' });
      registerWorktreeIpc();
      const handler = getHandler('worktree:create');

      const result = await callHandler(
        handler,
        { projectPath: '/repo', workspaceName: 'WS', projectId: 'proj-1' }
      );

      expect(result).toEqual({ success: false, error: 'Permission denied' });
    });

    it('validates that arguments object exists', async () => {
      registerWorktreeIpc();
      const handler = getHandler('worktree:create');

      const result = await callHandler(handler, undefined as unknown);

      expect(result.success).toBe(false);
      expect(result.error).toContain('projectPath');
      expect(createWorktreeMock).not.toHaveBeenCalled();
    });

    it('validates projectPath before invoking the service', async () => {
      createWorktreeMock.mockImplementation(
        async (projectPath: string, workspaceName: string, projectId: string) => {
          if (!projectPath) {
            throw new Error('projectPath is required');
          }
          return createWorktree({ name: workspaceName, projectId });
        }
      );
      registerWorktreeIpc();
      const handler = getHandler('worktree:create');

      const result = await callHandler(
        handler,
        {
          workspaceName: 'Alpha',
          projectId: 'proj-1',
        } as unknown
      );

      expect(createWorktreeMock).toHaveBeenCalledWith(
        undefined,
        'Alpha',
        'proj-1'
      );
      expect(result).toEqual({ success: false, error: 'projectPath is required' });
    });

    it('validates workspaceName values via service feedback', async () => {
      createWorktreeMock.mockImplementation(
        async (projectPath: string, workspaceName: string, projectId: string) => {
          if (!workspaceName) {
            throw new Error('workspaceName is required');
          }
          return createWorktree({ path: `${projectPath}/worktrees/${workspaceName}`, projectId });
        }
      );
      registerWorktreeIpc();
      const handler = getHandler('worktree:create');

      const result = await callHandler(
        handler,
        {
          projectPath: '/repo',
          projectId: 'proj-1',
        } as unknown
      );

      expect(createWorktreeMock).toHaveBeenCalledWith('/repo', undefined, 'proj-1');
      expect(result).toEqual({ success: false, error: 'workspaceName is required' });
    });

    it('validates projectId values via service feedback', async () => {
      createWorktreeMock.mockImplementation(
        async (projectPath: string, workspaceName: string, projectId: string) => {
          if (!projectId) {
            throw new Error('projectId is required');
          }
          return createWorktree({ projectId, name: workspaceName, path: projectPath });
        }
      );
      registerWorktreeIpc();
      const handler = getHandler('worktree:create');

      const result = await callHandler(
        handler,
        {
          projectPath: '/repo',
          workspaceName: 'Alpha',
        } as unknown
      );

      expect(createWorktreeMock).toHaveBeenCalledWith('/repo', 'Alpha', undefined);
      expect(result).toEqual({ success: false, error: 'projectId is required' });
    });
  });

  describe('worktree:list', () => {
    it('lists worktrees for the provided project', async () => {
      const worktrees = [createWorktree({ id: 'wt-1' }), createWorktree({ id: 'wt-2' })];
      listWorktreesMock.mockResolvedValue(worktrees);
      registerWorktreeIpc();
      const handler = getHandler('worktree:list');

      const result = await callHandler<{ worktrees: WorktreeInfo[] }>(
        handler,
        { projectPath: '/repo/project' }
      );

      expect(listWorktreesMock).toHaveBeenCalledWith('/repo/project');
      expect(result).toEqual({ success: true, worktrees });
    });

    it('returns empty arrays when no worktrees are found', async () => {
      listWorktreesMock.mockResolvedValue([]);
      registerWorktreeIpc();
      const handler = getHandler('worktree:list');

      const result = await callHandler<{ worktrees: WorktreeInfo[] }>(
        handler,
        { projectPath: '/repo/project' }
      );

      expect(result).toEqual({ success: true, worktrees: [] });
    });

    it('handles service errors during listing', async () => {
      listWorktreesMock.mockRejectedValue(new Error('cannot list worktrees'));
      registerWorktreeIpc();
      const handler = getHandler('worktree:list');

      const result = await callHandler(handler, { projectPath: '/repo/project' });

      expect(result).toEqual({ success: false, error: 'cannot list worktrees' });
    });

    it('validates that args are provided for list requests', async () => {
      registerWorktreeIpc();
      const handler = getHandler('worktree:list');

      const result = await callHandler(handler, undefined as unknown);

      expect(result.success).toBe(false);
      expect(result.error).toContain('projectPath');
      expect(listWorktreesMock).not.toHaveBeenCalled();
    });

    it('validates projectPath when listing worktrees', async () => {
      listWorktreesMock.mockImplementation(async (projectPath: string) => {
        if (!projectPath) {
          throw new Error('projectPath is required');
        }
        return [];
      });
      registerWorktreeIpc();
      const handler = getHandler('worktree:list');

      const result = await callHandler(handler, {} as unknown);

      expect(listWorktreesMock).toHaveBeenCalledWith(undefined);
      expect(result).toEqual({ success: false, error: 'projectPath is required' });
    });
  });

  describe('worktree:remove', () => {
    it('removes a worktree with required arguments', async () => {
      removeWorktreeMock.mockResolvedValue();
      registerWorktreeIpc();
      const handler = getHandler('worktree:remove');

      const result = await callHandler(handler, {
        projectPath: '/repo',
        worktreeId: 'wt-1',
      });

      expect(removeWorktreeMock).toHaveBeenCalledWith('/repo', 'wt-1', undefined, undefined);
      expect(result).toEqual({ success: true });
    });

    it('supports optional worktreePath parameter', async () => {
      removeWorktreeMock.mockResolvedValue();
      registerWorktreeIpc();
      const handler = getHandler('worktree:remove');

      await handler({}, { projectPath: '/repo', worktreeId: 'wt-1', worktreePath: '/tmp/wt' });

      expect(removeWorktreeMock).toHaveBeenCalledWith('/repo', 'wt-1', '/tmp/wt', undefined);
    });

    it('supports optional branch parameter', async () => {
      removeWorktreeMock.mockResolvedValue();
      registerWorktreeIpc();
      const handler = getHandler('worktree:remove');

      await handler(
        {},
        { projectPath: '/repo', worktreeId: 'wt-1', branch: 'agent/alpha' }
      );

      expect(removeWorktreeMock).toHaveBeenCalledWith('/repo', 'wt-1', undefined, 'agent/alpha');
    });

    it('handles service errors such as worktree not found', async () => {
      removeWorktreeMock.mockRejectedValue(new Error('worktree not found'));
      registerWorktreeIpc();
      const handler = getHandler('worktree:remove');

      const result = await callHandler(handler, { projectPath: '/repo', worktreeId: 'wt-404' });

      expect(result).toEqual({ success: false, error: 'worktree not found' });
    });

    it('validates that args exist before removal', async () => {
      registerWorktreeIpc();
      const handler = getHandler('worktree:remove');

      const result = await callHandler(handler, undefined as unknown);

      expect(result.success).toBe(false);
      expect(result.error).toContain('projectPath');
      expect(removeWorktreeMock).not.toHaveBeenCalled();
    });

    it('validates projectPath before attempting removal', async () => {
      removeWorktreeMock.mockImplementation(
        async (projectPath: string, worktreeId: string) => {
          if (!projectPath) {
            throw new Error('projectPath is required');
          }
          if (!worktreeId) {
            throw new Error('worktreeId is required');
          }
        }
      );
      registerWorktreeIpc();
      const handler = getHandler('worktree:remove');

      const result = await callHandler(handler, { worktreeId: 'wt-1' } as unknown);

      expect(removeWorktreeMock).toHaveBeenCalledWith(undefined, 'wt-1', undefined, undefined);
      expect(result).toEqual({ success: false, error: 'projectPath is required' });
    });

    it('validates worktreeId before attempting removal', async () => {
      removeWorktreeMock.mockImplementation(
        async (projectPath: string, worktreeId: string) => {
          if (!worktreeId) {
            throw new Error('worktreeId is required');
          }
          if (!projectPath) {
            throw new Error('projectPath is required');
          }
        }
      );
      registerWorktreeIpc();
      const handler = getHandler('worktree:remove');

      const result = await callHandler(handler, { projectPath: '/repo' } as unknown);

      expect(removeWorktreeMock).toHaveBeenCalledWith('/repo', undefined, undefined, undefined);
      expect(result).toEqual({ success: false, error: 'worktreeId is required' });
    });
  });

  describe('worktree:status', () => {
    it('returns the worktree status successfully', async () => {
      const status: WorktreeStatusPayload = {
        hasChanges: true,
        stagedFiles: ['file1.ts'],
        unstagedFiles: [],
        untrackedFiles: [],
      };
      getWorktreeStatusMock.mockResolvedValue(status);
      registerWorktreeIpc();
      const handler = getHandler('worktree:status');

      const result = await callHandler<{ status: WorktreeStatusPayload }>(
        handler,
        { worktreePath: '/repo/worktrees/alpha' }
      );

      expect(getWorktreeStatusMock).toHaveBeenCalledWith('/repo/worktrees/alpha');
      expect(result).toEqual({ success: true, status });
    });

    it('includes file change arrays in the response', async () => {
      const status: WorktreeStatusPayload = {
        hasChanges: true,
        stagedFiles: ['added.ts'],
        unstagedFiles: ['modified.ts'],
        untrackedFiles: ['new.ts'],
      };
      getWorktreeStatusMock.mockResolvedValue(status);
      registerWorktreeIpc();
      const handler = getHandler('worktree:status');

      const result = await callHandler<{ status: WorktreeStatusPayload }>(
        handler,
        { worktreePath: '/repo/worktrees/alpha' }
      );

      expect(result.status?.stagedFiles).toEqual(['added.ts']);
      expect(result.status?.unstagedFiles).toEqual(['modified.ts']);
      expect(result.status?.untrackedFiles).toEqual(['new.ts']);
    });

    it('handles service errors when retrieving status', async () => {
      getWorktreeStatusMock.mockRejectedValue(new Error('worktree not found'));
      registerWorktreeIpc();
      const handler = getHandler('worktree:status');

      const result = await callHandler(handler, { worktreePath: '/missing/path' });

      expect(result).toEqual({ success: false, error: 'worktree not found' });
    });

    it('validates that args are provided for status', async () => {
      registerWorktreeIpc();
      const handler = getHandler('worktree:status');

      const result = await callHandler(handler, undefined as unknown);

      expect(result.success).toBe(false);
      expect(result.error).toContain('worktreePath');
      expect(getWorktreeStatusMock).not.toHaveBeenCalled();
    });

    it('validates worktreePath via service feedback', async () => {
      getWorktreeStatusMock.mockImplementation(async (worktreePath: string) => {
        if (!worktreePath) {
          throw new Error('worktreePath is required');
        }
        return {
          hasChanges: false,
          stagedFiles: [],
          unstagedFiles: [],
          untrackedFiles: [],
        };
      });
      registerWorktreeIpc();
      const handler = getHandler('worktree:status');

      const result = await callHandler(handler, { worktreePath: '' } as unknown);

      expect(getWorktreeStatusMock).toHaveBeenCalledWith('');
      expect(result).toEqual({ success: false, error: 'worktreePath is required' });
    });
  });

  describe('worktree:merge', () => {
    it('merges worktree changes successfully', async () => {
      mergeWorktreeChangesMock.mockResolvedValue();
      registerWorktreeIpc();
      const handler = getHandler('worktree:merge');

      const result = await callHandler(handler, { projectPath: '/repo', worktreeId: 'wt-1' });

      expect(mergeWorktreeChangesMock).toHaveBeenCalledWith('/repo', 'wt-1');
      expect(result).toEqual({ success: true });
    });

    it('handles merge conflicts reported by the service', async () => {
      mergeWorktreeChangesMock.mockRejectedValue(new Error('Merge conflict'));
      registerWorktreeIpc();
      const handler = getHandler('worktree:merge');

      const result = await callHandler(handler, { projectPath: '/repo', worktreeId: 'wt-1' });

      expect(result).toEqual({ success: false, error: 'Merge conflict' });
    });

    it('handles other merge failures', async () => {
      mergeWorktreeChangesMock.mockRejectedValue(new Error('Failed to merge due to git issue'));
      registerWorktreeIpc();
      const handler = getHandler('worktree:merge');

      const result = await callHandler(handler, { projectPath: '/repo', worktreeId: 'wt-2' });

      expect(result).toEqual({
        success: false,
        error: 'Failed to merge due to git issue',
      });
    });

    it('handles non-Error rejection values for merge', async () => {
      mergeWorktreeChangesMock.mockRejectedValue({ message: 'Permission denied' });
      registerWorktreeIpc();
      const handler = getHandler('worktree:merge');

      const result = await callHandler(handler, { projectPath: '/repo', worktreeId: 'wt-3' });

      expect(result).toEqual({ success: false, error: 'Permission denied' });
    });

    it('validates that arguments exist for merge operations', async () => {
      registerWorktreeIpc();
      const handler = getHandler('worktree:merge');

      const result = await callHandler(handler, undefined as unknown);

      expect(result.success).toBe(false);
      expect(result.error).toContain('projectPath');
      expect(mergeWorktreeChangesMock).not.toHaveBeenCalled();
    });

    it('validates projectPath before merging', async () => {
      mergeWorktreeChangesMock.mockImplementation(async (projectPath: string, worktreeId: string) => {
        if (!projectPath) {
          throw new Error('projectPath is required');
        }
        if (!worktreeId) {
          throw new Error('worktreeId is required');
        }
      });
      registerWorktreeIpc();
      const handler = getHandler('worktree:merge');

      const result = await callHandler(handler, { worktreeId: 'wt-1' } as unknown);

      expect(mergeWorktreeChangesMock).toHaveBeenCalledWith(undefined, 'wt-1');
      expect(result).toEqual({ success: false, error: 'projectPath is required' });
    });

    it('validates worktreeId before merging', async () => {
      mergeWorktreeChangesMock.mockImplementation(async (projectPath: string, worktreeId: string) => {
        if (!worktreeId) {
          throw new Error('worktreeId is required');
        }
        if (!projectPath) {
          throw new Error('projectPath is required');
        }
      });
      registerWorktreeIpc();
      const handler = getHandler('worktree:merge');

      const result = await callHandler(handler, { projectPath: '/repo' } as unknown);

      expect(mergeWorktreeChangesMock).toHaveBeenCalledWith('/repo', undefined);
      expect(result).toEqual({ success: false, error: 'worktreeId is required' });
    });
  });

  describe('worktree:get', () => {
    it('returns a worktree by id', async () => {
      const worktree = createWorktree({ id: 'wt-5' });
      getWorktreeMock.mockReturnValue(worktree);
      registerWorktreeIpc();
      const handler = getHandler('worktree:get');

      const result = await callHandler<{ worktree: WorktreeInfo }>(handler, {
        worktreeId: 'wt-5',
      });

      expect(getWorktreeMock).toHaveBeenCalledWith('wt-5');
      expect(result).toEqual({ success: true, worktree });
    });

    it('returns undefined worktree when not found', async () => {
      getWorktreeMock.mockReturnValue(undefined);
      registerWorktreeIpc();
      const handler = getHandler('worktree:get');

      const result = await callHandler(handler, { worktreeId: 'wt-missing' });

      expect(result).toEqual({ success: true, worktree: undefined });
    });

    it('handles synchronous errors when getting worktree', async () => {
      getWorktreeMock.mockImplementation(() => {
        throw new Error('database unavailable');
      });
      registerWorktreeIpc();
      const handler = getHandler('worktree:get');

      const result = await callHandler(handler, { worktreeId: 'wt-err' });

      expect(result).toEqual({ success: false, error: 'database unavailable' });
    });

    it('validates that worktreeId is provided', async () => {
      registerWorktreeIpc();
      const handler = getHandler('worktree:get');

      const result = await callHandler(handler, undefined as unknown);

      expect(result.success).toBe(false);
      expect(result.error).toContain('worktreeId');
      expect(getWorktreeMock).not.toHaveBeenCalled();
    });
  });

  describe('worktree:getAll', () => {
    it('returns all tracked worktrees', async () => {
      const worktrees = [createWorktree({ id: 'wt-1' }), createWorktree({ id: 'wt-2' })];
      getAllWorktreesMock.mockReturnValue(worktrees);
      registerWorktreeIpc();
      const handler = getHandler('worktree:getAll');

      const result = await callHandler<{ worktrees: WorktreeInfo[] }>(handler);

      expect(getAllWorktreesMock).toHaveBeenCalled();
      expect(result).toEqual({ success: true, worktrees });
    });

    it('returns empty array when there are no entries', async () => {
      getAllWorktreesMock.mockReturnValue([]);
      registerWorktreeIpc();
      const handler = getHandler('worktree:getAll');

      const result = await callHandler<{ worktrees: WorktreeInfo[] }>(handler);

      expect(result).toEqual({ success: true, worktrees: [] });
    });

    it('handles errors thrown while retrieving all worktrees', async () => {
      getAllWorktreesMock.mockImplementation(() => {
        throw new Error('storage offline');
      });
      registerWorktreeIpc();
      const handler = getHandler('worktree:getAll');

      const result = await callHandler(handler);

      expect(result).toEqual({ success: false, error: 'storage offline' });
    });
  });
});
