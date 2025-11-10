import { beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown> | unknown;

const {
  handlers,
  handleMock,
  jiraServiceMock,
  saveCredentialsMock,
  checkConnectionMock,
  clearCredentialsMock,
  initialFetchMock,
  smartSearchIssuesMock,
  JiraServiceConstructorMock,
} = vi.hoisted(() => {
  const handlers = new Map<string, Handler>();
  const handleMock = vi.fn((channel: string, handler: Handler) => {
    handlers.set(channel, handler);
  });

  const saveCredentialsMock = vi.fn();
  const checkConnectionMock = vi.fn();
  const clearCredentialsMock = vi.fn();
  const initialFetchMock = vi.fn();
  const smartSearchIssuesMock = vi.fn();

  const jiraServiceMock = {
    saveCredentials: saveCredentialsMock,
    checkConnection: checkConnectionMock,
    clearCredentials: clearCredentialsMock,
    initialFetch: initialFetchMock,
    smartSearchIssues: smartSearchIssuesMock,
  };

  const JiraServiceConstructorMock = vi.fn(() => jiraServiceMock);

  return {
    handlers,
    handleMock,
    jiraServiceMock,
    saveCredentialsMock,
    checkConnectionMock,
    clearCredentialsMock,
    initialFetchMock,
    smartSearchIssuesMock,
    JiraServiceConstructorMock,
  };
});

vi.mock('electron', () => ({
  ipcMain: {
    handle: handleMock,
  },
}));

vi.mock('../../main/services/JiraService', () => ({
  default: JiraServiceConstructorMock,
}));

// eslint-disable-next-line import/first
import { registerJiraIpc } from '../../main/ipc/jiraIpc';

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

describe('registerJiraIpc', () => {
  beforeEach(() => {
    handlers.clear();
    handleMock.mockClear();
    saveCredentialsMock.mockReset();
    checkConnectionMock.mockReset();
    clearCredentialsMock.mockReset();
    initialFetchMock.mockReset();
    smartSearchIssuesMock.mockReset();
    JiraServiceConstructorMock.mockClear();
  });

  describe('jira:saveCredentials', () => {
    it('should save credentials and return service result', async () => {
      saveCredentialsMock.mockResolvedValue({ success: true });
      registerJiraIpc();

      const result = await callHandler('jira:saveCredentials', {
        siteUrl: 'https://example.atlassian.net',
        email: 'user@example.com',
        token: 'valid-token-123',
      });

      expect(saveCredentialsMock).toHaveBeenCalledWith(
        'https://example.atlassian.net',
        'user@example.com',
        'valid-token-123'
      );
      expect(result).toEqual({ success: true });
    });

    it('should validate siteUrl is a non-empty string', async () => {
      registerJiraIpc();

      const result = await callHandler('jira:saveCredentials', {
        siteUrl: '',
        email: 'user@example.com',
        token: 'token',
      });

      expect(saveCredentialsMock).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: false,
        error: 'Site URL, email, and API token are required.',
      });
    });

    it('should validate email is a non-empty string', async () => {
      registerJiraIpc();

      const result = await callHandler('jira:saveCredentials', {
        siteUrl: 'https://example.atlassian.net',
        email: '',
        token: 'token',
      });

      expect(saveCredentialsMock).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: false,
        error: 'Site URL, email, and API token are required.',
      });
    });

    it('should validate token is a non-empty string', async () => {
      registerJiraIpc();

      const result = await callHandler('jira:saveCredentials', {
        siteUrl: 'https://example.atlassian.net',
        email: 'user@example.com',
        token: '',
      });

      expect(saveCredentialsMock).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: false,
        error: 'Site URL, email, and API token are required.',
      });
    });

    it('should return error for missing siteUrl', async () => {
      registerJiraIpc();

      const result = await callHandler('jira:saveCredentials', {
        email: 'user@example.com',
        token: 'token',
      });

      expect(saveCredentialsMock).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: false,
        error: 'Site URL, email, and API token are required.',
      });
    });

    it('should return error for missing email', async () => {
      registerJiraIpc();

      const result = await callHandler('jira:saveCredentials', {
        siteUrl: 'https://example.atlassian.net',
        token: 'token',
      });

      expect(saveCredentialsMock).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: false,
        error: 'Site URL, email, and API token are required.',
      });
    });

    it('should return error for missing token', async () => {
      registerJiraIpc();

      const result = await callHandler('jira:saveCredentials', {
        siteUrl: 'https://example.atlassian.net',
        email: 'user@example.com',
      });

      expect(saveCredentialsMock).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: false,
        error: 'Site URL, email, and API token are required.',
      });
    });

    it('should trim whitespace from all fields', async () => {
      saveCredentialsMock.mockResolvedValue({ success: true });
      registerJiraIpc();

      const result = await callHandler('jira:saveCredentials', {
        siteUrl: '  https://example.atlassian.net  ',
        email: '  user@example.com  ',
        token: '  token-123  ',
      });

      expect(saveCredentialsMock).toHaveBeenCalledWith(
        'https://example.atlassian.net',
        'user@example.com',
        'token-123'
      );
      expect(result).toEqual({ success: true });
    });

    it('should pass through service errors', async () => {
      saveCredentialsMock.mockResolvedValue({ success: false, error: 'Keychain error' });
      registerJiraIpc();

      const result = await callHandler('jira:saveCredentials', {
        siteUrl: 'https://example.atlassian.net',
        email: 'user@example.com',
        token: 'token',
      });

      expect(result).toEqual({ success: false, error: 'Keychain error' });
    });
  });

  describe('jira:clearCredentials', () => {
    it('should call jiraService.clearCredentials()', async () => {
      clearCredentialsMock.mockResolvedValue({ success: true });
      registerJiraIpc();

      const result = await callHandler('jira:clearCredentials');

      expect(clearCredentialsMock).toHaveBeenCalled();
      expect(result).toEqual({ success: true });
    });

    it('should return service result on failure', async () => {
      clearCredentialsMock.mockResolvedValue({ success: false, error: 'Failed to clear' });
      registerJiraIpc();

      const result = await callHandler('jira:clearCredentials');

      expect(result).toEqual({ success: false, error: 'Failed to clear' });
    });
  });

  describe('jira:checkConnection', () => {
    it('should call jiraService.checkConnection()', async () => {
      checkConnectionMock.mockResolvedValue({ success: true, authenticated: true });
      registerJiraIpc();

      const result = await callHandler('jira:checkConnection');

      expect(checkConnectionMock).toHaveBeenCalled();
      expect(result).toEqual({ success: true, authenticated: true });
    });

    it('should return failure when connection check fails', async () => {
      checkConnectionMock.mockResolvedValue({ success: false, error: 'Not authenticated' });
      registerJiraIpc();

      const result = await callHandler('jira:checkConnection');

      expect(result).toEqual({ success: false, error: 'Not authenticated' });
    });
  });

  describe('jira:initialFetch', () => {
    it('should fetch issues with default limit of 50', async () => {
      const mockIssues = [{ id: '1', key: 'PROJ-1', summary: 'Issue 1' }];
      initialFetchMock.mockResolvedValue(mockIssues);
      registerJiraIpc();

      const result = await callHandler('jira:initialFetch');

      expect(initialFetchMock).toHaveBeenCalledWith(50);
      expect(result).toEqual({ success: true, issues: mockIssues });
    });

    it('should fetch issues with numeric limit', async () => {
      const mockIssues = [{ id: '1', key: 'PROJ-1', summary: 'Issue 1' }];
      initialFetchMock.mockResolvedValue(mockIssues);
      registerJiraIpc();

      const result = await callHandler('jira:initialFetch', 10);

      expect(initialFetchMock).toHaveBeenCalledWith(10);
      expect(result).toEqual({ success: true, issues: mockIssues });
    });

    it('should use default limit when limit is not a number', async () => {
      const mockIssues = [];
      initialFetchMock.mockResolvedValue(mockIssues);
      registerJiraIpc();

      const result = await callHandler('jira:initialFetch', 'not-a-number');

      expect(initialFetchMock).toHaveBeenCalledWith(50);
      expect(result).toEqual({ success: true, issues: mockIssues });
    });

    it('should use default limit when limit is NaN', async () => {
      const mockIssues = [];
      initialFetchMock.mockResolvedValue(mockIssues);
      registerJiraIpc();

      const result = await callHandler('jira:initialFetch', NaN);

      expect(initialFetchMock).toHaveBeenCalledWith(50);
      expect(result).toEqual({ success: true, issues: mockIssues });
    });

    it('should use default limit when limit is Infinity', async () => {
      const mockIssues = [];
      initialFetchMock.mockResolvedValue(mockIssues);
      registerJiraIpc();

      const result = await callHandler('jira:initialFetch', Infinity);

      expect(initialFetchMock).toHaveBeenCalledWith(50);
      expect(result).toEqual({ success: true, issues: mockIssues });
    });

    it('should return success with issues array', async () => {
      const mockIssues = [
        { id: '1', key: 'PROJ-1', summary: 'Issue 1' },
        { id: '2', key: 'PROJ-2', summary: 'Issue 2' },
      ];
      initialFetchMock.mockResolvedValue(mockIssues);
      registerJiraIpc();

      const result = await callHandler('jira:initialFetch', 100);

      expect(result).toEqual({ success: true, issues: mockIssues });
    });

    it('should return error on Error instance', async () => {
      initialFetchMock.mockRejectedValue(new Error('Network error'));
      registerJiraIpc();

      const result = await callHandler('jira:initialFetch');

      expect(result).toEqual({
        success: false,
        error: 'Network error',
      });
    });

    it('should return error on non-Error rejection', async () => {
      initialFetchMock.mockRejectedValue('String error');
      registerJiraIpc();

      const result = await callHandler('jira:initialFetch');

      expect(result).toEqual({
        success: false,
        error: 'String error',
      });
    });
  });

  describe('jira:searchIssues', () => {
    it('should search issues with term and default limit of 20', async () => {
      const mockIssues = [{ id: '1', key: 'PROJ-1', summary: 'Search result' }];
      smartSearchIssuesMock.mockResolvedValue(mockIssues);
      registerJiraIpc();

      const result = await callHandler('jira:searchIssues', 'bug');

      expect(smartSearchIssuesMock).toHaveBeenCalledWith('bug', 20);
      expect(result).toEqual({ success: true, issues: mockIssues });
    });

    it('should search issues with term and custom limit', async () => {
      const mockIssues = [{ id: '1', key: 'PROJ-1', summary: 'Search result' }];
      smartSearchIssuesMock.mockResolvedValue(mockIssues);
      registerJiraIpc();

      const result = await callHandler('jira:searchIssues', 'feature', 10);

      expect(smartSearchIssuesMock).toHaveBeenCalledWith('feature', 10);
      expect(result).toEqual({ success: true, issues: mockIssues });
    });

    it('should return success with issues on valid search', async () => {
      const mockIssues = [
        { id: '1', key: 'PROJ-1', summary: 'Bug fix' },
        { id: '2', key: 'PROJ-2', summary: 'Bug report' },
      ];
      smartSearchIssuesMock.mockResolvedValue(mockIssues);
      registerJiraIpc();

      const result = await callHandler('jira:searchIssues', 'bug', 5);

      expect(result).toEqual({ success: true, issues: mockIssues });
    });

    it('should return error on Error instance', async () => {
      smartSearchIssuesMock.mockRejectedValue(new Error('API error'));
      registerJiraIpc();

      const result = await callHandler('jira:searchIssues', 'test');

      expect(result).toEqual({
        success: false,
        error: 'API error',
      });
    });

    it('should return error on non-Error rejection', async () => {
      smartSearchIssuesMock.mockRejectedValue('Unknown failure');
      registerJiraIpc();

      const result = await callHandler('jira:searchIssues', 'test');

      expect(result).toEqual({
        success: false,
        error: 'Unknown failure',
      });
    });
  });

  it('should register all IPC handlers', () => {
    registerJiraIpc();

    expect(handlers.size).toBe(5);
    expect(handlers.has('jira:saveCredentials')).toBe(true);
    expect(handlers.has('jira:clearCredentials')).toBe(true);
    expect(handlers.has('jira:checkConnection')).toBe(true);
    expect(handlers.has('jira:initialFetch')).toBe(true);
    expect(handlers.has('jira:searchIssues')).toBe(true);
  });
});
