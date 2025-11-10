import { beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown> | unknown;

const {
  handlers,
  handleMock,
  linearServiceMock,
  saveTokenMock,
  checkConnectionMock,
  clearTokenMock,
  initialFetchMock,
  searchIssuesMock,
  LinearServiceConstructorMock,
} = vi.hoisted(() => {
  const handlers = new Map<string, Handler>();
  const handleMock = vi.fn((channel: string, handler: Handler) => {
    handlers.set(channel, handler);
  });

  const saveTokenMock = vi.fn();
  const checkConnectionMock = vi.fn();
  const clearTokenMock = vi.fn();
  const initialFetchMock = vi.fn();
  const searchIssuesMock = vi.fn();

  const linearServiceMock = {
    saveToken: saveTokenMock,
    checkConnection: checkConnectionMock,
    clearToken: clearTokenMock,
    initialFetch: initialFetchMock,
    searchIssues: searchIssuesMock,
  };

  const LinearServiceConstructorMock = vi.fn(() => linearServiceMock);

  return {
    handlers,
    handleMock,
    linearServiceMock,
    saveTokenMock,
    checkConnectionMock,
    clearTokenMock,
    initialFetchMock,
    searchIssuesMock,
    LinearServiceConstructorMock,
  };
});

vi.mock('electron', () => ({
  ipcMain: {
    handle: handleMock,
  },
}));

vi.mock('../../main/services/LinearService', () => ({
  default: LinearServiceConstructorMock,
}));

// eslint-disable-next-line import/first
import { registerLinearIpc } from '../../main/ipc/linearIpc';

function getHandler(channel: string): Handler {
  const handler = handlers.get(channel);
  if (!handler) {
    throw new Error(`Handler for ${channel} not registered`);
  }
  return handler;
}

async function callHandler(channel: string, ...args: unknown[]): Promise<unknown> {
  const handler = getHandler(channel);
  return handler({}, ...args);
}

describe('registerLinearIpc', () => {
  beforeEach(() => {
    handlers.clear();
    handleMock.mockClear();
    saveTokenMock.mockReset();
    checkConnectionMock.mockReset();
    clearTokenMock.mockReset();
    initialFetchMock.mockReset();
    searchIssuesMock.mockReset();
    LinearServiceConstructorMock.mockClear();
  });

  describe('linear:saveToken', () => {
    it('should save token and return service result', async () => {
      saveTokenMock.mockResolvedValue({ success: true });
      registerLinearIpc();

      const result = await callHandler('linear:saveToken', 'valid-token-123');

      expect(saveTokenMock).toHaveBeenCalledWith('valid-token-123');
      expect(result).toEqual({ success: true });
    });

    it('should validate token is a non-empty string', async () => {
      registerLinearIpc();

      const result = await callHandler('linear:saveToken', '');

      expect(saveTokenMock).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: false,
        error: 'A Linear API token is required.',
      });
    });

    it('should return error for missing token', async () => {
      registerLinearIpc();

      const result = await callHandler('linear:saveToken', null);

      expect(saveTokenMock).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: false,
        error: 'A Linear API token is required.',
      });
    });

    it('should return error for non-string token', async () => {
      registerLinearIpc();

      const result = await callHandler('linear:saveToken', 12345);

      expect(saveTokenMock).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: false,
        error: 'A Linear API token is required.',
      });
    });

    it('should pass through service errors', async () => {
      saveTokenMock.mockResolvedValue({ success: false, error: 'Keychain error' });
      registerLinearIpc();

      const result = await callHandler('linear:saveToken', 'token');

      expect(result).toEqual({ success: false, error: 'Keychain error' });
    });
  });

  describe('linear:checkConnection', () => {
    it('should call linearService.checkConnection()', async () => {
      checkConnectionMock.mockResolvedValue({ success: true, authenticated: true });
      registerLinearIpc();

      const result = await callHandler('linear:checkConnection');

      expect(checkConnectionMock).toHaveBeenCalled();
      expect(result).toEqual({ success: true, authenticated: true });
    });

    it('should return failure when connection check fails', async () => {
      checkConnectionMock.mockResolvedValue({ success: false, error: 'Not authenticated' });
      registerLinearIpc();

      const result = await callHandler('linear:checkConnection');

      expect(result).toEqual({ success: false, error: 'Not authenticated' });
    });
  });

  describe('linear:clearToken', () => {
    it('should call linearService.clearToken()', async () => {
      clearTokenMock.mockResolvedValue({ success: true });
      registerLinearIpc();

      const result = await callHandler('linear:clearToken');

      expect(clearTokenMock).toHaveBeenCalled();
      expect(result).toEqual({ success: true });
    });

    it('should return service result on failure', async () => {
      clearTokenMock.mockResolvedValue({ success: false, error: 'Failed to clear' });
      registerLinearIpc();

      const result = await callHandler('linear:clearToken');

      expect(result).toEqual({ success: false, error: 'Failed to clear' });
    });
  });

  describe('linear:initialFetch', () => {
    it('should fetch issues without limit parameter', async () => {
      const mockIssues = [{ id: '1', title: 'Issue 1' }];
      initialFetchMock.mockResolvedValue(mockIssues);
      registerLinearIpc();

      const result = await callHandler('linear:initialFetch');

      expect(initialFetchMock).toHaveBeenCalledWith(undefined);
      expect(result).toEqual({ success: true, issues: mockIssues });
    });

    it('should fetch issues with numeric limit', async () => {
      const mockIssues = [{ id: '1', title: 'Issue 1' }];
      initialFetchMock.mockResolvedValue(mockIssues);
      registerLinearIpc();

      const result = await callHandler('linear:initialFetch', 10);

      expect(initialFetchMock).toHaveBeenCalledWith(10);
      expect(result).toEqual({ success: true, issues: mockIssues });
    });

    it('should use undefined limit when limit is not a number', async () => {
      const mockIssues = [];
      initialFetchMock.mockResolvedValue(mockIssues);
      registerLinearIpc();

      const result = await callHandler('linear:initialFetch', 'not-a-number');

      expect(initialFetchMock).toHaveBeenCalledWith(undefined);
      expect(result).toEqual({ success: true, issues: mockIssues });
    });

    it('should use undefined limit when limit is NaN', async () => {
      const mockIssues = [];
      initialFetchMock.mockResolvedValue(mockIssues);
      registerLinearIpc();

      const result = await callHandler('linear:initialFetch', NaN);

      expect(initialFetchMock).toHaveBeenCalledWith(undefined);
      expect(result).toEqual({ success: true, issues: mockIssues });
    });

    it('should use undefined limit when limit is Infinity', async () => {
      const mockIssues = [];
      initialFetchMock.mockResolvedValue(mockIssues);
      registerLinearIpc();

      const result = await callHandler('linear:initialFetch', Infinity);

      expect(initialFetchMock).toHaveBeenCalledWith(undefined);
      expect(result).toEqual({ success: true, issues: mockIssues });
    });

    it('should return success with issues array', async () => {
      const mockIssues = [
        { id: '1', title: 'Issue 1' },
        { id: '2', title: 'Issue 2' },
      ];
      initialFetchMock.mockResolvedValue(mockIssues);
      registerLinearIpc();

      const result = await callHandler('linear:initialFetch', 50);

      expect(result).toEqual({ success: true, issues: mockIssues });
    });

    it('should return error on Error instance', async () => {
      initialFetchMock.mockRejectedValue(new Error('Network error'));
      registerLinearIpc();

      const result = await callHandler('linear:initialFetch');

      expect(result).toEqual({
        success: false,
        error: 'Network error',
      });
    });

    it('should return error on non-Error rejection', async () => {
      initialFetchMock.mockRejectedValue('String error');
      registerLinearIpc();

      const result = await callHandler('linear:initialFetch');

      expect(result).toEqual({
        success: false,
        error: 'Unable to fetch initial Linear issues right now.',
      });
    });
  });

  describe('linear:searchIssues', () => {
    it('should search issues with term and limit', async () => {
      const mockIssues = [{ id: '1', title: 'Search result' }];
      searchIssuesMock.mockResolvedValue(mockIssues);
      registerLinearIpc();

      const result = await callHandler('linear:searchIssues', 'bug', 10);

      expect(searchIssuesMock).toHaveBeenCalledWith('bug', 10);
      expect(result).toEqual({ success: true, issues: mockIssues });
    });

    it('should use default limit of 20 when not provided', async () => {
      const mockIssues = [];
      searchIssuesMock.mockResolvedValue(mockIssues);
      registerLinearIpc();

      const result = await callHandler('linear:searchIssues', 'feature');

      expect(searchIssuesMock).toHaveBeenCalledWith('feature', 20);
      expect(result).toEqual({ success: true, issues: mockIssues });
    });

    it('should validate searchTerm is non-empty string', async () => {
      registerLinearIpc();

      const result = await callHandler('linear:searchIssues', '');

      expect(searchIssuesMock).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: false,
        error: 'Search term is required.',
      });
    });

    it('should return error for missing searchTerm', async () => {
      registerLinearIpc();

      const result = await callHandler('linear:searchIssues', null);

      expect(searchIssuesMock).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: false,
        error: 'Search term is required.',
      });
    });

    it('should return error for non-string searchTerm', async () => {
      registerLinearIpc();

      const result = await callHandler('linear:searchIssues', 123);

      expect(searchIssuesMock).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: false,
        error: 'Search term is required.',
      });
    });

    it('should return success with issues on valid search', async () => {
      const mockIssues = [
        { id: 'PROJ-1', title: 'Bug fix' },
        { id: 'PROJ-2', title: 'Bug report' },
      ];
      searchIssuesMock.mockResolvedValue(mockIssues);
      registerLinearIpc();

      const result = await callHandler('linear:searchIssues', 'bug', 5);

      expect(result).toEqual({ success: true, issues: mockIssues });
    });

    it('should return error on Error instance', async () => {
      searchIssuesMock.mockRejectedValue(new Error('API rate limit'));
      registerLinearIpc();

      const result = await callHandler('linear:searchIssues', 'test');

      expect(result).toEqual({
        success: false,
        error: 'API rate limit',
      });
    });

    it('should return error on non-Error rejection', async () => {
      searchIssuesMock.mockRejectedValue('Unknown failure');
      registerLinearIpc();

      const result = await callHandler('linear:searchIssues', 'test');

      expect(result).toEqual({
        success: false,
        error: 'Unable to search Linear issues right now.',
      });
    });
  });

  it('should register all IPC handlers', () => {
    registerLinearIpc();

    expect(handlers.size).toBe(5);
    expect(handlers.has('linear:saveToken')).toBe(true);
    expect(handlers.has('linear:checkConnection')).toBe(true);
    expect(handlers.has('linear:clearToken')).toBe(true);
    expect(handlers.has('linear:initialFetch')).toBe(true);
    expect(handlers.has('linear:searchIssues')).toBe(true);
  });
});
