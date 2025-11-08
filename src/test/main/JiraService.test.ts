import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import JiraService from '../../main/services/JiraService';
import type { IncomingMessage } from 'node:http';
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';

// Mock electron app
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => {
      if (name === 'userData') return '/tmp/emdash-test-jira';
      return '/tmp';
    }),
  },
}));

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

// Mock fs for config file management
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    unlinkSync: vi.fn(),
  };
});

const mockKeytar = async () => await import('keytar');
const mockHttps = async () => await import('node:https');
const mockFs = () => ({
  existsSync: existsSync as any,
  readFileSync: readFileSync as any,
  writeFileSync: writeFileSync as any,
  unlinkSync: unlinkSync as any,
});
type RequestCallback = (res: IncomingMessage) => void;

describe('JiraService', () => {
  let service: JiraService;
  let mockRequest: any;

  beforeEach(async () => {
    service = new JiraService();
    const https = await mockHttps();
    mockRequest = https.request as any;

    // Reset all mocks
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Helper function to create mock HTTP response
  const createMockResponse = (data: unknown, statusCode = 200) => {
    mockRequest.mockImplementation((options: unknown, callback: RequestCallback) => {
      const mockRes = new EventEmitter() as IncomingMessage;
      (mockRes as IncomingMessage & { statusCode: number }).statusCode = statusCode;

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

  describe('凭证管理', () => {
    it('应该成功保存有效的 Jira 凭证', async () => {
      // Arrange
      const siteUrl = 'https://example.atlassian.net';
      const email = 'test@example.com';
      const token = 'jira_api_token_123';

      const mockMyselfData = {
        accountId: 'account-123',
        displayName: 'Test User',
        emailAddress: email,
      };

      createMockResponse(mockMyselfData);

      const keytar = await mockKeytar();
      (keytar.setPassword as any).mockResolvedValue(undefined);

      const fs = mockFs();
      fs.writeFileSync.mockReturnValue(undefined);

      // Act
      const result = await service.saveCredentials(siteUrl, email, token);

      // Assert
      expect(result.success).toBe(true);
      expect(result.displayName).toBe('Test User');
      expect(keytar.setPassword).toHaveBeenCalledWith('emdash-jira', 'api-token', token);
      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('应该在凭证验证失败时返回错误', async () => {
      // Arrange
      const siteUrl = 'https://example.atlassian.net';
      const email = 'test@example.com';
      const token = 'invalid_token';

      mockRequest.mockImplementation((options: any, callback: RequestCallback) => {
        const mockReq = new EventEmitter();
        (mockReq as any).write = vi.fn();
        (mockReq as any).end = vi.fn(() => {
          const mockRes = new EventEmitter() as IncomingMessage;
          (mockRes as any).statusCode = 401;
          callback(mockRes);
          setTimeout(() => {
            mockRes.emit('data', JSON.stringify({ errorMessages: ['Unauthorized'] }));
            mockRes.emit('end');
          }, 10);
        });
        (mockReq as any).on = vi.fn((event, handler) => mockReq);
        return mockReq;
      });

      // Act
      const result = await service.saveCredentials(siteUrl, email, token);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it('应该成功清除凭证', async () => {
      // Arrange
      const keytar = await mockKeytar();
      (keytar.deletePassword as any).mockResolvedValue(true);

      const fs = mockFs();
      fs.existsSync.mockReturnValue(true);
      fs.unlinkSync.mockReturnValue(undefined);

      // Act
      const result = await service.clearCredentials();

      // Assert
      expect(result.success).toBe(true);
      expect(keytar.deletePassword).toHaveBeenCalledWith('emdash-jira', 'api-token');
    });

    it('应该处理清除不存在的凭证', async () => {
      // Arrange
      const keytar = await mockKeytar();
      (keytar.deletePassword as any).mockRejectedValue(new Error('Not found'));

      const fs = mockFs();
      fs.existsSync.mockReturnValue(false);

      // Act
      const result = await service.clearCredentials();

      // Assert
      expect(result.success).toBe(true); // Should still succeed
    });

    it('应该处理清除凭证时的错误（内部错误被忽略）', async () => {
      // Arrange
      const keytar = await mockKeytar();
      (keytar.deletePassword as any).mockRejectedValue(new Error('Keychain error'));

      const fs = mockFs();
      fs.existsSync.mockReturnValue(true);
      fs.unlinkSync.mockImplementation(() => {
        throw new Error('File delete error');
      });

      // Act
      const result = await service.clearCredentials();

      // Assert
      // clearCredentials 吞掉内部错误，仍返回 success: true
      expect(result.success).toBe(true);
    });
  });

  describe('配置文件管理', () => {
    it('应该正确写入配置文件', async () => {
      // Arrange
      const siteUrl = 'https://test.atlassian.net';
      const email = 'user@test.com';
      const token = 'token';

      createMockResponse({
        accountId: '123',
        displayName: 'User',
      });

      const keytar = await mockKeytar();
      (keytar.setPassword as any).mockResolvedValue(undefined);

      const fs = mockFs();
      let writtenData: any;
      fs.writeFileSync.mockImplementation((path: string, data: string) => {
        writtenData = JSON.parse(data);
      });

      // Act
      await service.saveCredentials(siteUrl, email, token);

      // Assert
      expect(writtenData.siteUrl).toBe(siteUrl);
      expect(writtenData.email).toBe(email);
    });

    it('应该正确读取配置文件', async () => {
      // Arrange
      const fs = mockFs();
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(
        JSON.stringify({
          siteUrl: 'https://test.atlassian.net',
          email: 'test@example.com',
        })
      );

      const keytar = await mockKeytar();
      (keytar.getPassword as any).mockResolvedValue('token');

      createMockResponse({
        accountId: '123',
        displayName: 'Test User',
      });

      // Act
      const result = await service.checkConnection();

      // Assert
      expect(result.connected).toBe(true);
      expect(result.siteUrl).toBe('https://test.atlassian.net');
    });

    it('应该处理配置文件不存在', async () => {
      // Arrange
      const fs = mockFs();
      fs.existsSync.mockReturnValue(false);

      // Act
      const result = await service.checkConnection();

      // Assert
      expect(result.connected).toBe(false);
    });

    it('应该处理配置文件格式错误', async () => {
      // Arrange
      const fs = mockFs();
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue('invalid json{');

      // Act
      const result = await service.checkConnection();

      // Assert
      expect(result.connected).toBe(false);
    });
  });

  describe('连接状态检查', () => {
    it('应该在凭证存在且有效时返回 connected: true', async () => {
      // Arrange
      const fs = mockFs();
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(
        JSON.stringify({
          siteUrl: 'https://test.atlassian.net',
          email: 'test@example.com',
        })
      );

      const keytar = await mockKeytar();
      (keytar.getPassword as any).mockResolvedValue('valid_token');

      createMockResponse({
        accountId: 'acc-123',
        displayName: 'Test User',
        emailAddress: 'test@example.com',
      });

      // Act
      const result = await service.checkConnection();

      // Assert
      expect(result.connected).toBe(true);
      expect(result.accountId).toBe('acc-123');
      expect(result.displayName).toBe('Test User');
    });

    it('应该在凭证不存在时返回 connected: false', async () => {
      // Arrange
      const fs = mockFs();
      fs.existsSync.mockReturnValue(false);

      // Act
      const result = await service.checkConnection();

      // Assert
      expect(result.connected).toBe(false);
    });

    it('应该在 token 无效时返回错误信息', async () => {
      // Arrange
      const fs = mockFs();
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(
        JSON.stringify({
          siteUrl: 'https://test.atlassian.net',
          email: 'test@example.com',
        })
      );

      const keytar = await mockKeytar();
      (keytar.getPassword as any).mockResolvedValue('invalid');

      mockRequest.mockImplementation((options: any, callback: RequestCallback) => {
        const mockReq = new EventEmitter();
        (mockReq as any).write = vi.fn();
        (mockReq as any).end = vi.fn(() => {
          const mockRes = new EventEmitter() as IncomingMessage;
          (mockRes as any).statusCode = 403;
          callback(mockRes);
          setTimeout(() => {
            mockRes.emit('data', JSON.stringify({ errorMessages: ['Forbidden'] }));
            mockRes.emit('end');
          }, 10);
        });
        (mockReq as any).on = vi.fn((event, handler) => mockReq);
        return mockReq;
      });

      // Act
      const result = await service.checkConnection();

      // Assert
      expect(result.connected).toBe(false);
      expect(result.error).toBeTruthy();
    });
  });

  describe('Issue 获取 (initialFetch)', () => {
    beforeEach(() => {
      const fs = mockFs();
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(
        JSON.stringify({
          siteUrl: 'https://test.atlassian.net',
          email: 'test@example.com',
        })
      );
    });

    it('应该成功获取 issues (assignee = currentUser)', async () => {
      // Arrange
      const keytar = await mockKeytar();
      (keytar.getPassword as any).mockResolvedValue('token');

      const mockIssuesData = {
        issues: [
          {
            id: '1',
            key: 'TEST-1',
            fields: {
              summary: 'Test Issue 1',
              updated: '2024-01-01',
              project: { key: 'TEST', name: 'Test Project' },
              status: { name: 'In Progress' },
              assignee: { displayName: 'Test User', name: 'testuser' },
            },
          },
        ],
      };

      createMockResponse(mockIssuesData);

      // Act
      const result = await service.initialFetch(50);

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0].key).toBe('TEST-1');
      expect(result[0].summary).toBe('Test Issue 1');
    });

    it('应该尝试多个 JQL 查询直到成功', async () => {
      // Arrange
      const keytar = await mockKeytar();
      (keytar.getPassword as any).mockResolvedValue('token');

      let callCount = 0;
      mockRequest.mockImplementation((options: any, callback: RequestCallback) => {
        const mockReq = new EventEmitter();
        (mockReq as any).write = vi.fn();
        (mockReq as any).end = vi.fn(() => {
          const mockRes = new EventEmitter() as IncomingMessage;
          callCount++;

          if (callCount === 1) {
            // First call fails
            (mockRes as any).statusCode = 403;
            callback(mockRes);
            setTimeout(() => {
              mockRes.emit('data', JSON.stringify({ errorMessages: ['Forbidden'] }));
              mockRes.emit('end');
            }, 10);
          } else {
            // Second call succeeds
            (mockRes as any).statusCode = 200;
            callback(mockRes);
            setTimeout(() => {
              mockRes.emit(
                'data',
                JSON.stringify({
                  issues: [{ id: '1', key: 'TEST-1', fields: { summary: 'Issue' } }],
                })
              );
              mockRes.emit('end');
            }, 10);
          }
        });
        (mockReq as any).on = vi.fn((event, handler) => mockReq);
        return mockReq;
      });

      // Act
      const result = await service.initialFetch();

      // Assert
      expect(result).toHaveLength(1);
      expect(callCount).toBeGreaterThan(1); // Multiple attempts
    });

    it('应该在所有 JQL 查询失败时使用 issue picker fallback', async () => {
      // Arrange
      const keytar = await mockKeytar();
      (keytar.getPassword as any).mockResolvedValue('token');

      let callCount = 0;
      mockRequest.mockImplementation((options: any, callback: RequestCallback) => {
        const mockReq = new EventEmitter();
        (mockReq as any).write = vi.fn();
        (mockReq as any).end = vi.fn(() => {
          const mockRes = new EventEmitter() as IncomingMessage;
          callCount++;
          (mockRes as any).statusCode = 200;
          callback(mockRes);

          setTimeout(() => {
            if (options.path.includes('/search')) {
              // Search calls fail
              mockRes.emit('data', JSON.stringify({ issues: [] }));
            } else if (options.path.includes('/picker')) {
              // Picker succeeds
              mockRes.emit(
                'data',
                JSON.stringify({
                  sections: [{ issues: [{ key: 'TEST-1' }] }],
                })
              );
            } else if (options.path.includes('/issue/')) {
              // Issue GET succeeds
              mockRes.emit(
                'data',
                JSON.stringify({
                  id: '1',
                  key: 'TEST-1',
                  fields: { summary: 'Fallback Issue' },
                })
              );
            }
            mockRes.emit('end');
          }, 10);
        });
        (mockReq as any).on = vi.fn((event, handler) => mockReq);
        return mockReq;
      });

      // Act
      const result = await service.initialFetch();

      // Assert
      expect(result.length).toBeGreaterThan(0);
    });

    it('应该在所有方法失败时返回空数组', async () => {
      // Arrange
      const keytar = await mockKeytar();
      (keytar.getPassword as any).mockResolvedValue('token');

      mockRequest.mockImplementation((options: any, callback: RequestCallback) => {
        const mockReq = new EventEmitter();
        (mockReq as any).write = vi.fn();
        (mockReq as any).end = vi.fn(() => {
          const mockRes = new EventEmitter() as IncomingMessage;
          (mockRes as any).statusCode = 403;
          callback(mockRes);
          setTimeout(() => {
            mockRes.emit('data', JSON.stringify({ errorMessages: ['Forbidden'] }));
            mockRes.emit('end');
          }, 10);
        });
        (mockReq as any).on = vi.fn((event, handler) => mockReq);
        return mockReq;
      });

      // Act
      const result = await service.initialFetch();

      // Assert
      expect(result).toEqual([]);
    });

    it('应该在凭证不存在时抛出错误', async () => {
      // Arrange
      const fs = mockFs();
      fs.existsSync.mockReturnValue(false);

      // Act & Assert
      await expect(service.initialFetch()).rejects.toThrow('Jira credentials not set');
    });
  });

  describe('Issue 搜索 (searchIssues)', () => {
    beforeEach(() => {
      const fs = mockFs();
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(
        JSON.stringify({
          siteUrl: 'https://test.atlassian.net',
          email: 'test@example.com',
        })
      );
    });

    it('应该支持文本搜索', async () => {
      // Arrange
      const keytar = await mockKeytar();
      (keytar.getPassword as any).mockResolvedValue('token');

      const mockIssuesData = {
        issues: [
          {
            id: '1',
            key: 'TEST-123',
            fields: {
              summary: 'Fix login bug',
              project: { key: 'TEST', name: 'Test' },
            },
          },
        ],
      };

      createMockResponse(mockIssuesData);

      // Act
      const result = await service.searchIssues('login');

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0].summary).toBe('Fix login bug');
    });

    it('应该支持按 issue key 搜索', async () => {
      // Arrange
      const keytar = await mockKeytar();
      (keytar.getPassword as any).mockResolvedValue('token');

      const mockIssuesData = {
        issues: [
          {
            id: '1',
            key: 'TEST-123',
            fields: { summary: 'Issue 123' },
          },
        ],
      };

      createMockResponse(mockIssuesData);

      // Act
      const result = await service.searchIssues('TEST-123');

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0].key).toBe('TEST-123');
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

    it('应该正确转义搜索词中的引号', async () => {
      // Arrange
      const keytar = await mockKeytar();
      (keytar.getPassword as any).mockResolvedValue('token');

      let capturedJQL = '';
      mockRequest.mockImplementation((options: any, callback: RequestCallback) => {
        const mockReq = new EventEmitter();
        (mockReq as any).write = vi.fn((data: string) => {
          const payload = JSON.parse(data);
          capturedJQL = payload.jql;
        });
        (mockReq as any).end = vi.fn(() => {
          const mockRes = new EventEmitter() as IncomingMessage;
          (mockRes as any).statusCode = 200;
          callback(mockRes);
          setTimeout(() => {
            mockRes.emit('data', JSON.stringify({ issues: [] }));
            mockRes.emit('end');
          }, 10);
        });
        (mockReq as any).on = vi.fn((event, handler) => mockReq);
        return mockReq;
      });

      // Act
      await service.searchIssues('test "quoted" term');

      // Assert
      expect(capturedJQL).toContain('\\"quoted\\"');
    });
  });

  describe('Smart Search (smartSearchIssues)', () => {
    beforeEach(() => {
      const fs = mockFs();
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(
        JSON.stringify({
          siteUrl: 'https://test.atlassian.net',
          email: 'test@example.com',
        })
      );
    });

    it('应该识别 issue key 格式并直接获取', async () => {
      // Arrange
      const keytar = await mockKeytar();
      (keytar.getPassword as any).mockResolvedValue('token');

      const mockIssueData = {
        id: '1',
        key: 'TEST-123',
        fields: {
          summary: 'Direct issue fetch',
          project: { key: 'TEST', name: 'Test' },
        },
      };

      createMockResponse(mockIssueData);

      // Act
      const result = await service.smartSearchIssues('TEST-123');

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0].key).toBe('TEST-123');
    });

    it('应该在直接获取失败时回退到 JQL 搜索', async () => {
      // Arrange
      const keytar = await mockKeytar();
      (keytar.getPassword as any).mockResolvedValue('token');

      let callCount = 0;
      mockRequest.mockImplementation((options: any, callback: RequestCallback) => {
        const mockReq = new EventEmitter();
        (mockReq as any).write = vi.fn();
        (mockReq as any).end = vi.fn(() => {
          const mockRes = new EventEmitter() as IncomingMessage;
          callCount++;

          if (callCount === 1 && options.path.includes('/issue/')) {
            // Direct fetch fails (404)
            (mockRes as any).statusCode = 404;
            callback(mockRes);
            setTimeout(() => {
              mockRes.emit('data', JSON.stringify({ errorMessages: ['Not found'] }));
              mockRes.emit('end');
            }, 10);
          } else {
            // JQL search succeeds
            (mockRes as any).statusCode = 200;
            callback(mockRes);
            setTimeout(() => {
              mockRes.emit(
                'data',
                JSON.stringify({
                  issues: [{ id: '1', key: 'TEST-123', fields: { summary: 'Found via JQL' } }],
                })
              );
              mockRes.emit('end');
            }, 10);
          }
        });
        (mockReq as any).on = vi.fn((event, handler) => mockReq);
        return mockReq;
      });

      // Act
      const result = await service.smartSearchIssues('TEST-123');

      // Assert
      expect(result.length).toBeGreaterThan(0);
    });

    it('应该在搜索词为空时返回空数组', async () => {
      // Act
      const result = await service.smartSearchIssues('');

      // Assert
      expect(result).toEqual([]);
    });
  });

  describe('API 请求处理', () => {
    it('应该发送 Basic Auth header', async () => {
      // Arrange
      const fs = mockFs();
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(
        JSON.stringify({
          siteUrl: 'https://test.atlassian.net',
          email: 'test@example.com',
        })
      );

      const keytar = await mockKeytar();
      (keytar.getPassword as any).mockResolvedValue('test_token');

      let capturedAuth = '';
      mockRequest.mockImplementation((options: any, callback: RequestCallback) => {
        capturedAuth = options.headers.Authorization;
        const mockReq = new EventEmitter();
        (mockReq as any).write = vi.fn();
        (mockReq as any).end = vi.fn(() => {
          const mockRes = new EventEmitter() as IncomingMessage;
          (mockRes as any).statusCode = 200;
          callback(mockRes);
          setTimeout(() => {
            mockRes.emit('data', JSON.stringify({ issues: [] }));
            mockRes.emit('end');
          }, 10);
        });
        (mockReq as any).on = vi.fn((event, handler) => mockReq);
        return mockReq;
      });

      // Act
      await service.initialFetch();

      // Assert
      expect(capturedAuth).toContain('Basic ');
    });

    it('应该处理 HTTP 错误状态码', async () => {
      // Arrange
      const fs = mockFs();
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(
        JSON.stringify({
          siteUrl: 'https://test.atlassian.net',
          email: 'test@example.com',
        })
      );

      const keytar = await mockKeytar();
      (keytar.getPassword as any).mockResolvedValue('token');

      mockRequest.mockImplementation((options: any, callback: RequestCallback) => {
        const mockReq = new EventEmitter();
        (mockReq as any).write = vi.fn();
        (mockReq as any).end = vi.fn(() => {
          const mockRes = new EventEmitter() as IncomingMessage;
          (mockRes as any).statusCode = 500;
          callback(mockRes);
          setTimeout(() => {
            mockRes.emit('data', JSON.stringify({ errorMessages: ['Server error'] }));
            mockRes.emit('end');
          }, 10);
        });
        (mockReq as any).on = vi.fn((event, handler) => mockReq);
        return mockReq;
      });

      // Act
      const result = await service.initialFetch();

      // Assert
      expect(result).toEqual([]); // Should gracefully handle errors
    });

    it('应该正确编码 email 和 token 为 Base64', async () => {
      // Arrange
      const email = 'test@example.com';
      const token = 'secret123';

      createMockResponse({
        accountId: '123',
        displayName: 'User',
      });

      const keytar = await mockKeytar();
      (keytar.setPassword as any).mockResolvedValue(undefined);

      const fs = mockFs();
      fs.writeFileSync.mockReturnValue(undefined);

      let capturedAuth = '';
      mockRequest.mockImplementation((options: any, callback: RequestCallback) => {
        capturedAuth = options.headers.Authorization;
        const mockReq = new EventEmitter();
        (mockReq as any).write = vi.fn();
        (mockReq as any).end = vi.fn(() => {
          const mockRes = new EventEmitter() as IncomingMessage;
          (mockRes as any).statusCode = 200;
          callback(mockRes);
          setTimeout(() => {
            mockRes.emit('data', JSON.stringify({ accountId: '123', displayName: 'User' }));
            mockRes.emit('end');
          }, 10);
        });
        (mockReq as any).on = vi.fn((event, handler) => mockReq);
        return mockReq;
      });

      // Act
      await service.saveCredentials('https://test.atlassian.net', email, token);

      // Assert
      const expectedAuth = `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;
      expect(capturedAuth).toBe(expectedAuth);
    });
  });

  describe('Issue 规范化 (normalizeIssues)', () => {
    beforeEach(() => {
      const fs = mockFs();
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(
        JSON.stringify({
          siteUrl: 'https://test.atlassian.net',
          email: 'test@example.com',
        })
      );
    });

    it('应该生成正确的 browse URL', async () => {
      // Arrange
      const keytar = await mockKeytar();
      (keytar.getPassword as any).mockResolvedValue('token');

      const mockIssuesData = {
        issues: [
          {
            id: '1',
            key: 'TEST-123',
            fields: { summary: 'Test' },
          },
        ],
      };

      createMockResponse(mockIssuesData);

      // Act
      const result = await service.initialFetch();

      // Assert
      expect(result[0].url).toBe('https://test.atlassian.net/browse/TEST-123');
    });

    it('应该处理缺失的字段', async () => {
      // Arrange
      const keytar = await mockKeytar();
      (keytar.getPassword as any).mockResolvedValue('token');

      const mockIssuesData = {
        issues: [
          {
            id: '1',
            key: 'TEST-1',
            fields: {}, // All fields missing
          },
        ],
      };

      createMockResponse(mockIssuesData);

      // Act
      const result = await service.initialFetch();

      // Assert
      expect(result[0].summary).toBe('');
      expect(result[0].status).toBeNull();
      expect(result[0].project).toBeNull();
      expect(result[0].assignee).toBeNull();
    });
  });

  describe('错误处理', () => {
    it('应该处理网络错误', async () => {
      // Arrange
      const fs = mockFs();
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(
        JSON.stringify({
          siteUrl: 'https://test.atlassian.net',
          email: 'test@example.com',
        })
      );

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
          return mockReq;
        });
        return mockReq;
      });

      // Act
      const result = await service.initialFetch();

      // Assert
      expect(result).toEqual([]);
    });

    it('应该处理无效的 JSON 响应', async () => {
      // Arrange
      const fs = mockFs();
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(
        JSON.stringify({
          siteUrl: 'https://test.atlassian.net',
          email: 'test@example.com',
        })
      );

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
        (mockReq as any).on = vi.fn((event, handler) => mockReq);
        return mockReq;
      });

      // Act
      const result = await service.initialFetch();

      // Assert
      expect(result).toEqual([]);
    });
  });
});
