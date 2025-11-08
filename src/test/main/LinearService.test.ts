import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LinearService } from '../../main/services/LinearService';
import type { IncomingMessage } from 'node:http';
import { EventEmitter } from 'node:events';

// Mock node:https
vi.mock('node:https', () => ({
  request: vi.fn(),
}));

// Mock keytar
vi.mock('keytar', () => ({
  setPassword: vi.fn(),
  getPassword: vi.fn(),
  deletePassword: vi.fn(),
}));

const mockKeytar = async () => await import('keytar');
const mockHttps = async () => await import('node:https');
type RequestCallback = (res: IncomingMessage) => void;

describe('LinearService', () => {
  let service: LinearService;
  let mockRequest: any;

  beforeEach(async () => {
    service = new LinearService();
    const https = await mockHttps();
    mockRequest = https.request as any;

    // Reset all mocks
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Helper function to create mock HTTP response
  const createMockResponse = (data: any, statusCode = 200) => {
    mockRequest.mockImplementation((options: any, callback: RequestCallback) => {
      const mockRes = new EventEmitter() as IncomingMessage;
      (mockRes as any).statusCode = statusCode;

      const mockReq = new EventEmitter();
      (mockReq as any).write = vi.fn();
      (mockReq as any).end = vi.fn(() => {
        callback(mockRes);
        setTimeout(() => {
          const payload = typeof data === 'string' ? data : JSON.stringify(data);
          mockRes.emit('data', payload);
          mockRes.emit('end');
        }, 10);
      });
      (mockReq as any).on = vi.fn((event, handler) => {
        mockReq.addListener(event, handler);
        return mockReq;
      });

      return mockReq;
    });
  };

  describe('Token 管理', () => {
    it('应该成功保存有效的 Linear token', async () => {
      // Arrange
      const token = 'lin_api_valid_token_123';
      const mockViewerData = {
        data: {
          viewer: {
            name: 'Test User',
            displayName: 'Test User',
            organization: { name: 'Test Org' },
          },
        },
      };

      createMockResponse(mockViewerData);

      const keytar = await mockKeytar();
      (keytar.setPassword as any).mockResolvedValue(undefined);

      // Act
      const result = await service.saveToken(token);

      // Assert
      expect(result.success).toBe(true);
      expect(result.workspaceName).toBe('Test Org');
      expect(keytar.setPassword).toHaveBeenCalledWith('emdash-linear', 'api-token', token);
    });

    it('应该在保存 token 时验证并获取 viewer 信息', async () => {
      // Arrange
      const token = 'lin_api_test';
      const mockViewerData = {
        data: {
          viewer: {
            name: 'John Doe',
            displayName: 'John',
            organization: { name: 'My Company' },
          },
        },
      };

      createMockResponse(mockViewerData);

      const keytar = await mockKeytar();
      (keytar.setPassword as any).mockResolvedValue(undefined);

      // Act
      const result = await service.saveToken(token);

      // Assert
      expect(result.success).toBe(true);
      expect(result.workspaceName).toBe('My Company');
    });

    it('应该在保存 token 失败时返回错误', async () => {
      // Arrange
      const token = 'invalid_token';

      mockRequest.mockImplementation((options: any, callback: RequestCallback) => {
        const mockReq = new EventEmitter();
        (mockReq as any).write = vi.fn();
        (mockReq as any).end = vi.fn();
        (mockReq as any).on = vi.fn((event, handler) => {
          if (event === 'error') {
            setTimeout(() => handler(new Error('Network error')), 10);
          }
        });
        return mockReq;
      });

      // Act
      const result = await service.saveToken(token);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it('应该成功清除已保存的 token', async () => {
      // Arrange
      const keytar = await mockKeytar();
      (keytar.deletePassword as any).mockResolvedValue(true);

      // Act
      const result = await service.clearToken();

      // Assert
      expect(result.success).toBe(true);
      expect(keytar.deletePassword).toHaveBeenCalledWith('emdash-linear', 'api-token');
    });

    it('应该处理清除 token 时的错误', async () => {
      // Arrange
      const keytar = await mockKeytar();
      (keytar.deletePassword as any).mockRejectedValue(new Error('Keychain error'));

      // Act
      const result = await service.clearToken();

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBe('Unable to remove Linear token from keychain.');
    });

    it('应该处理 keytar 不可用的情况', async () => {
      // Arrange
      const keytar = await mockKeytar();
      (keytar.deletePassword as any).mockRejectedValue(new Error('Module not found'));

      // Act
      const result = await service.clearToken();

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });
  });

  describe('连接状态检查', () => {
    it('应该在 token 存在且有效时返回 connected: true', async () => {
      // Arrange
      const keytar = await mockKeytar();
      (keytar.getPassword as any).mockResolvedValue('valid_token');

      const mockViewerData = {
        data: {
          viewer: {
            name: 'Test User',
            displayName: 'Test',
            organization: { name: 'Test Org' },
          },
        },
      };

      createMockResponse(mockViewerData);

      // Act
      const result = await service.checkConnection();

      // Assert
      expect(result.connected).toBe(true);
      expect(result.workspaceName).toBe('Test Org');
      expect(result.viewer).toBeDefined();
    });

    it('应该在 token 不存在时返回 connected: false', async () => {
      // Arrange
      const keytar = await mockKeytar();
      (keytar.getPassword as any).mockResolvedValue(null);

      // Act
      const result = await service.checkConnection();

      // Assert
      expect(result.connected).toBe(false);
      expect(result.workspaceName).toBeUndefined();
    });

    it('应该在 token 无效时返回错误信息', async () => {
      // Arrange
      const keytar = await mockKeytar();
      (keytar.getPassword as any).mockResolvedValue('invalid_token');

      mockRequest.mockImplementation((options: any, callback: RequestCallback) => {
        const mockReq = new EventEmitter();
        (mockReq as any).write = vi.fn();
        (mockReq as any).end = vi.fn();
        (mockReq as any).on = vi.fn((event, handler) => {
          if (event === 'error') {
            setTimeout(() => handler(new Error('Unauthorized')), 10);
          }
        });
        return mockReq;
      });

      // Act
      const result = await service.checkConnection();

      // Assert
      expect(result.connected).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it('应该返回正确的 workspace 名称（organization.name 优先）', async () => {
      // Arrange
      const keytar = await mockKeytar();
      (keytar.getPassword as any).mockResolvedValue('token');

      const mockViewerData = {
        data: {
          viewer: {
            name: 'User',
            displayName: 'Display Name',
            organization: { name: 'Org Name' },
          },
        },
      };

      createMockResponse(mockViewerData);

      // Act
      const result = await service.checkConnection();

      // Assert
      expect(result.workspaceName).toBe('Org Name');
    });

    it('应该在没有 organization 时使用 displayName', async () => {
      // Arrange
      const keytar = await mockKeytar();
      (keytar.getPassword as any).mockResolvedValue('token');

      const mockViewerData = {
        data: {
          viewer: {
            name: 'User',
            displayName: 'Display Name',
            organization: null,
          },
        },
      };

      createMockResponse(mockViewerData);

      // Act
      const result = await service.checkConnection();

      // Assert
      expect(result.workspaceName).toBe('Display Name');
    });

    it('应该处理 GraphQL API 错误', async () => {
      // Arrange
      const keytar = await mockKeytar();
      (keytar.getPassword as any).mockResolvedValue('token');

      const mockErrorData = {
        errors: [{ message: 'GraphQL Error: Invalid token' }],
      };

      createMockResponse(mockErrorData);

      // Act
      const result = await service.checkConnection();

      // Assert
      expect(result.connected).toBe(false);
      expect(result.error).toContain('GraphQL Error');
    });
  });

  describe('Issue 获取 (initialFetch)', () => {
    beforeEach(async () => {
      const keytar = await mockKeytar();
      (keytar.getPassword as any).mockResolvedValue('valid_token');
    });

    it('应该成功获取前 50 条 issues', async () => {
      // Arrange
      const mockIssuesData = {
        data: {
          issues: {
            nodes: Array.from({ length: 50 }, (_, i) => ({
              id: `issue-${i}`,
              identifier: `TEST-${i}`,
              title: `Issue ${i}`,
              state: { name: 'In Progress', type: 'started' },
            })),
          },
        },
      };

      createMockResponse(mockIssuesData);

      // Act
      const result = await service.initialFetch(50);

      // Assert
      expect(result).toHaveLength(50);
      expect(result[0].identifier).toBe('TEST-0');
    });

    it('应该过滤掉已完成的 issues (type: completed)', async () => {
      // Arrange
      const mockIssuesData = {
        data: {
          issues: {
            nodes: [
              { id: '1', identifier: 'TEST-1', title: 'Issue 1', state: { name: 'Done', type: 'completed' } },
              { id: '2', identifier: 'TEST-2', title: 'Issue 2', state: { name: 'In Progress', type: 'started' } },
              { id: '3', identifier: 'TEST-3', title: 'Issue 3', state: { name: 'Completed', type: 'completed' } },
            ],
          },
        },
      };

      createMockResponse(mockIssuesData);

      // Act
      const result = await service.initialFetch();

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0].identifier).toBe('TEST-2');
    });

    it('应该过滤掉已取消的 issues (type: canceled)', async () => {
      // Arrange
      const mockIssuesData = {
        data: {
          issues: {
            nodes: [
              { id: '1', identifier: 'TEST-1', title: 'Issue 1', state: { name: 'Canceled', type: 'canceled' } },
              { id: '2', identifier: 'TEST-2', title: 'Issue 2', state: { name: 'Active', type: 'started' } },
            ],
          },
        },
      };

      createMockResponse(mockIssuesData);

      // Act
      const result = await service.initialFetch();

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0].identifier).toBe('TEST-2');
    });

    it('应该过滤掉状态名为 done/completed 的 issues', async () => {
      // Arrange
      const mockIssuesData = {
        data: {
          issues: {
            nodes: [
              { id: '1', identifier: 'TEST-1', title: 'Issue 1', state: { name: 'done', type: 'other' } },
              { id: '2', identifier: 'TEST-2', title: 'Issue 2', state: { name: 'completed', type: 'other' } },
              { id: '3', identifier: 'TEST-3', title: 'Issue 3', state: { name: 'Active', type: 'started' } },
            ],
          },
        },
      };

      createMockResponse(mockIssuesData);

      // Act
      const result = await service.initialFetch();

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0].identifier).toBe('TEST-3');
    });

    it('应该限制最大获取数量为 200', async () => {
      // Arrange
      let requestedLimit = 0;

      mockRequest.mockImplementation((options: any, callback: RequestCallback) => {
        const mockReq = new EventEmitter();
        (mockReq as any).write = vi.fn((data: string) => {
          const payload = JSON.parse(data);
          requestedLimit = payload.variables.limit;
        });
        (mockReq as any).end = vi.fn(() => {
          const mockRes = new EventEmitter() as IncomingMessage;
          (mockRes as any).statusCode = 200;
          callback(mockRes);
          setTimeout(() => {
            mockRes.emit('data', JSON.stringify({ data: { issues: { nodes: [] } } }));
            mockRes.emit('end');
          }, 10);
        });
        return mockReq;
      });

      // Act
      await service.initialFetch(500); // Request 500 but should be capped at 200

      // Assert
      expect(requestedLimit).toBe(200);
    });

    it('应该在 token 不存在时抛出错误', async () => {
      // Arrange
      const keytar = await mockKeytar();
      (keytar.getPassword as any).mockResolvedValue(null);

      // Act & Assert
      await expect(service.initialFetch()).rejects.toThrow('Linear token not set');
    });

    it('应该处理 GraphQL 响应为空的情况', async () => {
      // Arrange
      createMockResponse({ data: null });

      // Act & Assert
      await expect(service.initialFetch()).rejects.toThrow('Linear API returned no data');
    });

    it('应该处理 issues.nodes 为 undefined 的情况', async () => {
      // Arrange
      createMockResponse({ data: { issues: {} } });

      // Act
      const result = await service.initialFetch();

      // Assert
      expect(result).toEqual([]);
    });
  });

  describe('Issue 搜索 (searchIssues)', () => {
    beforeEach(async () => {
      const keytar = await mockKeytar();
      (keytar.getPassword as any).mockResolvedValue('valid_token');
    });

    it('应该支持按 identifier 搜索', async () => {
      // Arrange
      const mockIssuesData = {
        data: {
          issues: {
            nodes: [
              { id: '1', identifier: 'TEST-123', title: 'Some issue', state: { name: 'Active', type: 'started' } },
              { id: '2', identifier: 'TEST-456', title: 'Another issue', state: { name: 'Active', type: 'started' } },
            ],
          },
        },
      };

      createMockResponse(mockIssuesData);

      // Act
      const result = await service.searchIssues('TEST-123');

      // Assert
      expect(result.some((issue) => issue.identifier === 'TEST-123')).toBe(true);
    });

    it('应该支持按 title 搜索', async () => {
      // Arrange
      const mockIssuesData = {
        data: {
          issues: {
            nodes: [
              { id: '1', identifier: 'TEST-1', title: 'Fix login bug', state: { name: 'Active', type: 'started' } },
              { id: '2', identifier: 'TEST-2', title: 'Add feature', state: { name: 'Active', type: 'started' } },
            ],
          },
        },
      };

      createMockResponse(mockIssuesData);

      // Act
      const result = await service.searchIssues('login');

      // Assert
      expect(result.some((issue) => issue.title.includes('login'))).toBe(true);
    });

    it('应该支持按 assignee 名称搜索', async () => {
      // Arrange
      const mockIssuesData = {
        data: {
          issues: {
            nodes: [
              {
                id: '1',
                identifier: 'TEST-1',
                title: 'Issue 1',
                state: { name: 'Active', type: 'started' },
                assignee: { name: 'john', displayName: 'John Doe' },
              },
            ],
          },
        },
      };

      createMockResponse(mockIssuesData);

      // Act
      const result = await service.searchIssues('john');

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0].assignee.name).toBe('john');
    });

    it('应该在搜索词为空时返回空数组', async () => {
      // Act
      const result = await service.searchIssues('');

      // Assert
      expect(result).toEqual([]);
    });

    it('应该在搜索词为空格时返回空数组', async () => {
      // Act
      const result = await service.searchIssues('   ');

      // Assert
      expect(result).toEqual([]);
    });

    it('应该限制搜索结果数量', async () => {
      // Arrange
      const mockIssuesData = {
        data: {
          issues: {
            nodes: Array.from({ length: 100 }, (_, i) => ({
              id: `${i}`,
              identifier: `TEST-${i}`,
              title: `Issue ${i}`,
              state: { name: 'Active', type: 'started' },
            })),
          },
        },
      };

      createMockResponse(mockIssuesData);

      // Act
      const result = await service.searchIssues('TEST', 10);

      // Assert
      expect(result.length).toBeLessThanOrEqual(10);
    });

    it('应该在搜索失败时返回空数组（不抛错）', async () => {
      // Arrange
      mockRequest.mockImplementation(() => {
        const mockReq = new EventEmitter();
        (mockReq as any).write = vi.fn();
        (mockReq as any).end = vi.fn();
        (mockReq as any).on = vi.fn((event, handler) => {
          if (event === 'error') {
            setTimeout(() => handler(new Error('Network error')), 10);
          }
        });
        return mockReq;
      });

      // Act
      const result = await service.searchIssues('test');

      // Assert
      expect(result).toEqual([]);
    });

    it('应该过滤掉已完成/取消的 issues', async () => {
      // Arrange
      const mockIssuesData = {
        data: {
          issues: {
            nodes: [
              { id: '1', identifier: 'TEST-1', title: 'Issue 1', state: { name: 'Done', type: 'completed' } },
              { id: '2', identifier: 'TEST-2', title: 'Issue 2', state: { name: 'Active', type: 'started' } },
              { id: '3', identifier: 'TEST-3', title: 'Issue 3', state: { name: 'Canceled', type: 'canceled' } },
            ],
          },
        },
      };

      createMockResponse(mockIssuesData);

      // Act
      const result = await service.searchIssues('TEST');

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0].identifier).toBe('TEST-2');
    });
  });

  describe('GraphQL 请求处理', () => {
    it('应该发送正确的 Authorization header', async () => {
      // Arrange
      const keytar = await mockKeytar();
      (keytar.getPassword as any).mockResolvedValue('test_token');

      let capturedHeaders: any = {};

      mockRequest.mockImplementation((options: any, callback: RequestCallback) => {
        capturedHeaders = options.headers;
        const mockReq = new EventEmitter();
        (mockReq as any).write = vi.fn();
        (mockReq as any).end = vi.fn(() => {
          const mockRes = new EventEmitter() as IncomingMessage;
          (mockRes as any).statusCode = 200;
          callback(mockRes);
          setTimeout(() => {
            mockRes.emit('data', JSON.stringify({ data: { issues: { nodes: [] } } }));
            mockRes.emit('end');
          }, 10);
        });
        return mockReq;
      });

      // Act
      await service.initialFetch();

      // Assert
      expect(capturedHeaders.Authorization).toBe('test_token');
    });

    it('应该发送 Content-Type: application/json', async () => {
      // Arrange
      const keytar = await mockKeytar();
      (keytar.getPassword as any).mockResolvedValue('token');

      let capturedHeaders: any = {};

      mockRequest.mockImplementation((options: any, callback: RequestCallback) => {
        capturedHeaders = options.headers;
        const mockReq = new EventEmitter();
        (mockReq as any).write = vi.fn();
        (mockReq as any).end = vi.fn(() => {
          const mockRes = new EventEmitter() as IncomingMessage;
          (mockRes as any).statusCode = 200;
          callback(mockRes);
          setTimeout(() => {
            mockRes.emit('data', JSON.stringify({ data: { issues: { nodes: [] } } }));
            mockRes.emit('end');
          }, 10);
        });
        return mockReq;
      });

      // Act
      await service.initialFetch();

      // Assert
      expect(capturedHeaders['Content-Type']).toBe('application/json');
    });

    it('应该处理 GraphQL errors 数组', async () => {
      // Arrange
      const keytar = await mockKeytar();
      (keytar.getPassword as any).mockResolvedValue('token');

      const mockErrorData = {
        errors: [{ message: 'Error 1' }, { message: 'Error 2' }],
      };

      createMockResponse(mockErrorData);

      // Act & Assert
      await expect(service.initialFetch()).rejects.toThrow('Error 1\nError 2');
    });

    it('应该处理响应无 data 的情况', async () => {
      // Arrange
      const keytar = await mockKeytar();
      (keytar.getPassword as any).mockResolvedValue('token');

      createMockResponse({ errors: null, data: null });

      // Act & Assert
      await expect(service.initialFetch()).rejects.toThrow('Linear API returned no data');
    });

    it('应该处理网络请求失败', async () => {
      // Arrange
      const keytar = await mockKeytar();
      (keytar.getPassword as any).mockResolvedValue('token');

      mockRequest.mockImplementation(() => {
        const mockReq = new EventEmitter();
        (mockReq as any).write = vi.fn();
        (mockReq as any).end = vi.fn();
        (mockReq as any).on = vi.fn((event, handler) => {
          if (event === 'error') {
            setTimeout(() => handler(new Error('ECONNREFUSED')), 10);
          }
        });
        return mockReq;
      });

      // Act & Assert
      await expect(service.initialFetch()).rejects.toThrow('ECONNREFUSED');
    });

    it('应该正确传递 variables', async () => {
      // Arrange
      const keytar = await mockKeytar();
      (keytar.getPassword as any).mockResolvedValue('token');

      let capturedVariables: any = {};

      mockRequest.mockImplementation((options: any, callback: RequestCallback) => {
        const mockReq = new EventEmitter();
        (mockReq as any).write = vi.fn((data: string) => {
          const payload = JSON.parse(data);
          capturedVariables = payload.variables;
        });
        (mockReq as any).end = vi.fn(() => {
          const mockRes = new EventEmitter() as IncomingMessage;
          (mockRes as any).statusCode = 200;
          callback(mockRes);
          setTimeout(() => {
            mockRes.emit('data', JSON.stringify({ data: { issues: { nodes: [] } } }));
            mockRes.emit('end');
          }, 10);
        });
        return mockReq;
      });

      // Act
      await service.initialFetch(25);

      // Assert
      expect(capturedVariables.limit).toBe(25);
    });
  });

  describe('错误处理', () => {
    it('应该处理无效的 JSON 响应', async () => {
      // Arrange
      const keytar = await mockKeytar();
      (keytar.getPassword as any).mockResolvedValue('token');

      mockRequest.mockImplementation((options: any, callback: RequestCallback) => {
        const mockReq = new EventEmitter();
        (mockReq as any).write = vi.fn();
        (mockReq as any).end = vi.fn(() => {
          const mockRes = new EventEmitter() as IncomingMessage;
          (mockRes as any).statusCode = 200;
          callback(mockRes);
          setTimeout(() => {
            mockRes.emit('data', 'Invalid JSON{');
            mockRes.emit('end');
          }, 10);
        });
        return mockReq;
      });

      // Act & Assert
      await expect(service.initialFetch()).rejects.toThrow();
    });

    it('应该处理 HTTPS 连接错误', async () => {
      // Arrange
      const keytar = await mockKeytar();
      (keytar.getPassword as any).mockResolvedValue('token');

      mockRequest.mockImplementation(() => {
        const mockReq = new EventEmitter();
        (mockReq as any).write = vi.fn();
        (mockReq as any).end = vi.fn();
        (mockReq as any).on = vi.fn((event, handler) => {
          if (event === 'error') {
            setTimeout(() => handler(new Error('ETIMEDOUT')), 10);
          }
        });
        return mockReq;
      });

      // Act & Assert
      await expect(service.initialFetch()).rejects.toThrow('ETIMEDOUT');
    });

    it('应该处理空 token 存储尝试', async () => {
      // Arrange
      const keytar = await mockKeytar();
      (keytar.setPassword as any).mockResolvedValue(undefined);

      const mockViewerData = {
        data: {
          viewer: {
            name: 'Test',
            displayName: 'Test',
            organization: { name: 'Test Org' },
          },
        },
      };

      createMockResponse(mockViewerData);

      // Act
      const result = await service.saveToken('   ');

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it('应该处理 viewer 信息缺失', async () => {
      // Arrange
      const keytar = await mockKeytar();
      (keytar.getPassword as any).mockResolvedValue('token');

      createMockResponse({ data: { viewer: null } });

      // Act
      const result = await service.checkConnection();

      // Assert
      expect(result.connected).toBe(false);
      expect(result.error).toBeTruthy();
    });
  });
});
