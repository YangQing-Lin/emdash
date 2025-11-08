# P2 阶段测试计划

> **阶段**: P2 - IPC层与剩余服务测试
> **开始日期**: 2025-11-11
> **预计完成**: 2025-11-22 (2周)
> **目标覆盖率**: 18% → 35% (+17%)

---

## 📋 目录

- [1. 阶段目标](#1-阶段目标)
- [2. 测试模块清单](#2-测试模块清单)
- [3. 详细测试计划](#3-详细测试计划)
- [4. 时间安排](#4-时间安排)
- [5. 技术挑战与解决方案](#5-技术挑战与解决方案)
- [6. 成功标准](#6-成功标准)

---

## 1. 阶段目标

### 1.1 核心目标

- ✅ **完成所有 IPC 层测试** (14个 IPC 模块)
- ✅ **完成剩余服务层测试** (ProjectPrep, iconService 等)
- ✅ **建立 IPC 测试模式** (可复用的 mock 和测试工具)
- ✅ **覆盖率提升至 35%** (从当前 18%)

### 1.2 质量目标

- **测试稳定性**: 保持 100% 通过率
- **代码质量**: ESLint 0 errors, TypeScript 100% 通过
- **测试速度**: 全量测试 < 20秒
- **文档完善**: 每个模块都有测试文档

### 1.3 技术目标

- 建立 Electron IPC mock 框架
- 实现跨进程通信测试模式
- 验证错误处理和边界条件
- 确保向后兼容性

---

## 2. 测试模块清单

### 2.1 IPC 层 (14个模块，优先级最高)

| 模块 | 文件 | 预计用例 | 难度 | 优先级 | 状态 |
|------|------|---------|------|--------|------|
| **agentIpc** | `src/main/ipc/agentIpc.ts` | 30+ | 🟠 High | P0 | ❌ 待开始 |
| **codexIpc** | `src/main/services/codexIpc.ts` | 40+ | 🟠 High | P0 | ❌ 待开始 |
| **worktreeIpc** | `src/main/services/worktreeIpc.ts` | 35+ | 🟡 Medium | P1 | ❌ 待开始 |
| **dbIpc** | `src/main/ipc/dbIpc.ts` | 40+ | 🟡 Medium | P1 | ❌ 待开始 |
| **gitIpc** | `src/main/ipc/gitIpc.ts` | 40+ | 🟡 Medium | P1 | ❌ 待开始 |
| **githubIpc** | `src/main/ipc/githubIpc.ts` | 30+ | 🟡 Medium | P1 | ❌ 待开始 |
| **connectionsIpc** | `src/main/ipc/connectionsIpc.ts` | 20+ | 🟢 Easy | P2 | ❌ 待开始 |
| **linearIpc** | `src/main/ipc/linearIpc.ts` | 25+ | 🟢 Easy | P2 | ❌ 待开始 |
| **jiraIpc** | `src/main/ipc/jiraIpc.ts` | 25+ | 🟢 Easy | P2 | ❌ 待开始 |
| **settingsIpc** | `src/main/ipc/settingsIpc.ts` | 30+ | 🟡 Medium | P2 | ❌ 待开始 |
| **projectIpc** | `src/main/ipc/projectIpc.ts` | 25+ | 🟡 Medium | P2 | ❌ 待开始 |
| **appIpc** | `src/main/ipc/appIpc.ts` | 20+ | 🟢 Easy | P3 | ❌ 待开始 |
| **debugIpc** | `src/main/ipc/debugIpc.ts` | 15+ | 🟢 Easy | P3 | ❌ 待开始 |
| **telemetryIpc** | `src/main/ipc/telemetryIpc.ts` | 15+ | 🟢 Easy | P3 | ❌ 待开始 |

**小计**: ~390 用例

### 2.2 服务层 (5个模块)

| 模块 | 文件 | 预计用例 | 难度 | 优先级 | 状态 |
|------|------|---------|------|--------|------|
| **ProjectPrep** | `src/main/services/ProjectPrep.ts` | 25+ | 🟡 Medium | P1 | ❌ 待开始 |
| **iconService** | `src/main/services/iconService.ts` | 15+ | 🟢 Easy | P2 | ❌ 待开始 |
| **ptyIpc** | `src/main/services/ptyIpc.ts` | 30+ | 🟠 High | P1 | ❌ 待开始 |
| **fsIpc** | `src/main/services/fsIpc.ts` | 25+ | 🟡 Medium | P2 | ❌ 待开始 |
| **planLockIpc** | `src/main/services/planLockIpc.ts` | 20+ | 🟢 Easy | P3 | ❌ 待开始 |
| **updateIpc** | `src/main/services/updateIpc.ts` | 20+ | 🟡 Medium | P2 | ❌ 待开始 |

**小计**: ~135 用例

### 2.3 总计

- **总模块数**: 20
- **预计总用例数**: ~525
- **预计代码量**: ~8,000 行测试代码

---

## 3. 详细测试计划

### 3.1 Week 1: IPC 核心层 (Nov 11-15)

#### Day 1-2: agentIpc + codexIpc (高优先级)

**agentIpc.test.ts** - Agent 生命周期 IPC
```typescript
describe('agentIpc', () => {
  describe('agent:list', () => {
    it('应该返回所有活动 agents')
    it('应该包含 agent 元数据')
    it('应该处理空列表情况')
  })

  describe('agent:start', () => {
    it('应该启动新 agent')
    it('应该拒绝重复启动')
    it('应该验证必需参数')
    it('应该处理启动失败')
  })

  describe('agent:stop', () => {
    it('应该优雅停止 agent')
    it('应该清理相关资源')
    it('应该处理已停止的 agent')
  })

  describe('agent:status', () => {
    it('应该返回 agent 状态')
    it('应该包含进程信息')
    it('应该处理不存在的 agent')
  })

  describe('错误处理', () => {
    it('应该捕获并返回服务层错误')
    it('应该验证参数类型')
    it('应该处理超时')
  })
})
```

**codexIpc.test.ts** - Codex 流式通信 IPC
```typescript
describe('codexIpc', () => {
  describe('codex:start-stream', () => {
    it('应该初始化流式连接')
    it('应该转发流数据到渲染进程')
    it('应该处理流错误')
    it('应该支持中断流')
  })

  describe('codex:send-message', () => {
    it('应该发送消息到 Codex')
    it('应该验证消息格式')
    it('应该处理发送失败')
  })

  describe('codex:stop', () => {
    it('应该停止 Codex 进程')
    it('应该清理流资源')
  })

  describe('事件转发', () => {
    it('应该转发 codex:stream-data 事件')
    it('应该转发 codex:stream-error 事件')
    it('应该转发 codex:stream-end 事件')
  })
})
```

**预计产出**: 70 用例, ~1,500 行测试代码

---

#### Day 3-4: worktreeIpc + dbIpc + gitIpc

**worktreeIpc.test.ts** - Worktree IPC
```typescript
describe('worktreeIpc', () => {
  describe('worktree:create', () => {
    it('应该创建新 worktree')
    it('应该返回 worktree 路径')
    it('应该处理目录已存在')
    it('应该验证分支名称')
  })

  describe('worktree:list', () => {
    it('应该列出所有 worktrees')
    it('应该包含元数据')
  })

  describe('worktree:remove', () => {
    it('应该删除 worktree')
    it('应该清理分支')
    it('应该处理不存在的 worktree')
  })

  describe('worktree:status', () => {
    it('应该返回 worktree 状态')
    it('应该包含文件变更')
  })
})
```

**dbIpc.test.ts** - 数据库 IPC
```typescript
describe('dbIpc', () => {
  describe('db:query', () => {
    it('应该执行查询')
    it('应该返回结果集')
    it('应该处理查询错误')
  })

  describe('db:workspace-*', () => {
    it('应该创建 workspace')
    it('应该更新 workspace')
    it('应该删除 workspace')
    it('应该列出 workspaces')
  })

  describe('db:conversation-*', () => {
    it('应该创建 conversation')
    it('应该添加 message')
    it('应该查询历史')
  })

  describe('事务处理', () => {
    it('应该支持事务')
    it('应该回滚失败事务')
  })
})
```

**gitIpc.test.ts** - Git 操作 IPC
```typescript
describe('gitIpc', () => {
  describe('git:status', () => {
    it('应该返回 git 状态')
    it('应该包含文件变更')
  })

  describe('git:commit', () => {
    it('应该创建提交')
    it('应该验证消息')
  })

  describe('git:push', () => {
    it('应该推送到远程')
    it('应该处理推送失败')
  })

  describe('git:branch', () => {
    it('应该创建分支')
    it('应该切换分支')
    it('应该删除分支')
  })
})
```

**预计产出**: 105 用例, ~2,000 行测试代码

---

#### Day 5: githubIpc + linearIpc + jiraIpc

**githubIpc.test.ts** - GitHub IPC
```typescript
describe('githubIpc', () => {
  describe('github:auth', () => {
    it('应该检查认证状态')
    it('应该触发登录流程')
  })

  describe('github:pr-create', () => {
    it('应该创建 PR')
    it('应该验证参数')
  })

  describe('github:issue-*', () => {
    it('应该列出 issues')
    it('应该创建 issue')
  })
})
```

**linearIpc.test.ts** - Linear IPC
```typescript
describe('linearIpc', () => {
  describe('linear:auth', () => {
    it('应该保存 token')
    it('应该验证 token')
  })

  describe('linear:issue-*', () => {
    it('应该创建 issue')
    it('应该更新 issue')
    it('应该添加评论')
  })
})
```

**jiraIpc.test.ts** - Jira IPC
```typescript
describe('jiraIpc', () => {
  describe('jira:auth', () => {
    it('应该配置认证')
    it('应该测试连接')
  })

  describe('jira:issue-*', () => {
    it('应该创建 issue')
    it('应该更新状态')
  })
})
```

**预计产出**: 80 用例, ~1,500 行测试代码

---

### 3.2 Week 2: 服务层与低优先级 IPC (Nov 18-22)

#### Day 6-7: ProjectPrep + ptyIpc + fsIpc

**ProjectPrep.test.ts** - 项目准备服务
```typescript
describe('ProjectPrep', () => {
  describe('项目初始化', () => {
    it('应该检测项目类型')
    it('应该初始化 git 仓库')
    it('应该创建配置文件')
  })

  describe('依赖安装', () => {
    it('应该检测包管理器')
    it('应该安装依赖')
    it('应该处理安装失败')
  })

  describe('环境验证', () => {
    it('应该检查 Node 版本')
    it('应该检查必需工具')
  })
})
```

**ptyIpc.test.ts** - 终端 IPC
```typescript
describe('ptyIpc', () => {
  describe('pty:create', () => {
    it('应该创建 PTY')
    it('应该设置正确的环境')
  })

  describe('pty:write', () => {
    it('应该写入数据')
    it('应该处理特殊字符')
  })

  describe('pty:resize', () => {
    it('应该调整终端大小')
  })
})
```

**fsIpc.test.ts** - 文件系统 IPC
```typescript
describe('fsIpc', () => {
  describe('fs:read', () => {
    it('应该读取文件')
    it('应该处理不存在的文件')
  })

  describe('fs:write', () => {
    it('应该写入文件')
    it('应该创建目录')
  })

  describe('fs:watch', () => {
    it('应该监听文件变化')
    it('应该停止监听')
  })
})
```

**预计产出**: 85 用例, ~1,600 行测试代码

---

#### Day 8-9: settingsIpc + projectIpc + connectionsIpc

**settingsIpc.test.ts** - 设置 IPC
```typescript
describe('settingsIpc', () => {
  describe('settings:get', () => {
    it('应该读取设置')
    it('应该返回默认值')
  })

  describe('settings:set', () => {
    it('应该保存设置')
    it('应该验证设置值')
  })

  describe('settings:reset', () => {
    it('应该重置设置')
  })
})
```

**projectIpc.test.ts** - 项目 IPC
```typescript
describe('projectIpc', () => {
  describe('project:list', () => {
    it('应该列出所有项目')
  })

  describe('project:add', () => {
    it('应该添加项目')
    it('应该验证路径')
  })

  describe('project:remove', () => {
    it('应该移除项目')
  })
})
```

**connectionsIpc.test.ts** - 连接检测 IPC
```typescript
describe('connectionsIpc', () => {
  describe('connections:check', () => {
    it('应该检查所有 providers')
    it('应该返回状态')
  })

  describe('connections:refresh', () => {
    it('应该刷新连接状态')
  })
})
```

**预计产出**: 75 用例, ~1,400 行测试代码

---

#### Day 10: iconService + 低优先级 IPC

**iconService.test.ts** - 图标服务
```typescript
describe('iconService', () => {
  describe('getIcon', () => {
    it('应该返回文件图标')
    it('应该支持自定义图标')
  })

  describe('缓存', () => {
    it('应该缓存图标')
    it('应该清理缓存')
  })
})
```

**appIpc.test.ts** - 应用 IPC
```typescript
describe('appIpc', () => {
  describe('app:version', () => {
    it('应该返回版本信息')
  })

  describe('app:quit', () => {
    it('应该退出应用')
  })
})
```

**debugIpc.test.ts / telemetryIpc.test.ts / planLockIpc.test.ts / updateIpc.test.ts**
- 简单的功能测试
- 错误处理
- 边界条件

**预计产出**: 110 用例, ~1,800 行测试代码

---

## 4. 时间安排

### 4.1 每日计划

| 日期 | 任务 | 模块数 | 预计用例 | 累计用例 |
|------|------|--------|---------|---------|
| **Week 1** |
| Nov 11 (Mon) | agentIpc | 1 | 30 | 30 |
| Nov 12 (Tue) | codexIpc | 1 | 40 | 70 |
| Nov 13 (Wed) | worktreeIpc + dbIpc | 2 | 75 | 145 |
| Nov 14 (Thu) | gitIpc | 1 | 40 | 185 |
| Nov 15 (Fri) | githubIpc + linearIpc + jiraIpc | 3 | 80 | 265 |
| **Week 2** |
| Nov 18 (Mon) | ProjectPrep + ptyIpc | 2 | 55 | 320 |
| Nov 19 (Tue) | fsIpc + settingsIpc | 2 | 55 | 375 |
| Nov 20 (Wed) | projectIpc + connectionsIpc | 2 | 45 | 420 |
| Nov 21 (Thu) | iconService + appIpc | 2 | 35 | 455 |
| Nov 22 (Fri) | debugIpc + telemetryIpc + planLockIpc + updateIpc | 4 | 70 | 525 |

### 4.2 里程碑

- **Nov 15**: Week 1 完成，265 用例，覆盖率达到 ~25%
- **Nov 22**: P2 完成，525 用例，覆盖率达到 ~35%

---

## 5. 技术挑战与解决方案

### 5.1 IPC Mock 框架

**挑战**: Electron IPC 需要 mock `ipcMain.handle()` 和事件发送

**解决方案**:
```typescript
// 创建通用 IPC mock 工具
// src/test/utils/ipcMock.ts

import { vi } from 'vitest';

export const createIpcMock = () => {
  const handlers = new Map<string, Function>();
  const events = new Map<string, any[]>();

  const ipcMain = {
    handle: vi.fn((channel: string, handler: Function) => {
      handlers.set(channel, handler);
    }),
    removeHandler: vi.fn((channel: string) => {
      handlers.delete(channel);
    }),
  };

  const mockEvent = {
    sender: {
      send: vi.fn((channel: string, ...args: any[]) => {
        if (!events.has(channel)) {
          events.set(channel, []);
        }
        events.get(channel)!.push(args);
      }),
    },
  };

  const invoke = async (channel: string, ...args: any[]) => {
    const handler = handlers.get(channel);
    if (!handler) {
      throw new Error(`No handler for ${channel}`);
    }
    return handler(mockEvent, ...args);
  };

  const getEvents = (channel: string) => events.get(channel) || [];

  return { ipcMain, mockEvent, invoke, getEvents };
};
```

### 5.2 服务依赖注入

**挑战**: IPC handler 依赖服务实例，需要 mock 服务

**解决方案**:
```typescript
// 每个 IPC 测试文件中
vi.mock('../../services/CodexService', () => ({
  codexService: {
    sendMessageStream: vi.fn(),
    stopMessageStream: vi.fn(),
    getInstallationStatus: vi.fn(),
  },
}));

// 在测试中可以轻松 mock 返回值
import { codexService } from '../../services/CodexService';

(codexService.sendMessageStream as vi.Mock).mockResolvedValue({
  workspaceId: 'test-123',
});
```

### 5.3 事件流测试

**挑战**: 测试从服务到 IPC 再到渲染进程的事件流

**解决方案**:
```typescript
it('应该转发流数据事件到渲染进程', async () => {
  const { invoke, getEvents } = createIpcMock();

  // Mock 服务返回 EventEmitter
  const mockEmitter = new EventEmitter();
  (codexService.sendMessageStream as vi.Mock).mockReturnValue(mockEmitter);

  // 调用 IPC
  const promise = invoke('codex:start-stream', { workspaceId: 'test' });

  // 触发事件
  mockEmitter.emit('data', { type: 'response', content: 'test' });

  // 验证事件被转发
  const sentEvents = getEvents('codex:stream-data');
  expect(sentEvents).toHaveLength(1);
  expect(sentEvents[0][0]).toEqual({ type: 'response', content: 'test' });
});
```

### 5.4 错误传播测试

**挑战**: 验证错误从服务层正确传播到渲染进程

**解决方案**:
```typescript
it('应该捕获服务层错误并返回友好消息', async () => {
  const { invoke } = createIpcMock();

  (codexService.sendMessageStream as vi.Mock).mockRejectedValue(
    new Error('Codex not installed')
  );

  await expect(
    invoke('codex:start-stream', { workspaceId: 'test' })
  ).rejects.toThrow('Codex not installed');
});
```

---

## 6. 成功标准

### 6.1 定量指标

- ✅ **新增用例数**: ≥ 500
- ✅ **测试通过率**: 100%
- ✅ **覆盖率提升**: 18% → 35%
- ✅ **ESLint**: 0 errors
- ✅ **TypeScript**: 100% 通过
- ✅ **测试速度**: < 20秒（全量）

### 6.2 定性指标

- ✅ **代码可维护性**: 测试代码清晰，易于理解和修改
- ✅ **Mock 合理性**: 不过度 mock，保持测试真实性
- ✅ **边界覆盖**: 覆盖错误处理、异常情况、边界值
- ✅ **文档完善**: 每个模块都有测试说明

### 6.3 交付物

1. **测试代码** (~8,000 行)
   - 20 个测试文件
   - 525+ 测试用例
   - 完整的 IPC mock 框架

2. **测试工具**
   - `ipcMock.ts` - IPC mock 工具
   - `serviceHelpers.ts` - 服务 mock 助手
   - `eventTestUtils.ts` - 事件测试工具

3. **文档**
   - P2 阶段总结报告
   - IPC 测试模式文档
   - 常见问题与解决方案

---

## 7. 风险与缓解

### 7.1 风险识别

| 风险 | 影响 | 概率 | 缓解措施 |
|------|------|------|---------|
| IPC mock 复杂度高 | 高 | 中 | 提前设计通用框架，复用代码 |
| 事件流测试不稳定 | 中 | 中 | 使用 fake timers，控制异步 |
| 服务依赖难以 mock | 中 | 低 | 使用 vi.mock，清晰的接口定义 |
| 时间不足 | 高 | 低 | 优先完成高优先级模块 |

### 7.2 降级方案

如果时间紧张，按优先级调整：
1. **必须完成**: agentIpc, codexIpc, worktreeIpc, dbIpc, gitIpc (核心 IPC)
2. **重要**: githubIpc, ProjectPrep, ptyIpc (重要功能)
3. **可延后**: appIpc, debugIpc, telemetryIpc (低优先级)

---

## 8. 后续计划预告

### P3 阶段 (Nov 25 - Dec 6)

**目标**: 渲染进程 Hooks 与组件测试
- React Hooks 测试 (useCodexStream, useFileChanges 等)
- 核心组件测试
- 覆盖率: 35% → 50%

**预计**:
- 10+ Hooks 测试
- 20+ 组件测试
- ~300 用例

---

## 附录: 测试模板

### A.1 IPC 测试模板

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createIpcMock } from '../../utils/ipcMock';

// Mock 服务
vi.mock('../../services/SomeService', () => ({
  someService: {
    method1: vi.fn(),
    method2: vi.fn(),
  },
}));

describe('someIpc', () => {
  let ipcMock: ReturnType<typeof createIpcMock>;

  beforeEach(() => {
    ipcMock = createIpcMock();
    vi.clearAllMocks();

    // 注册 IPC handlers
    registerSomeIpc(ipcMock.ipcMain);
  });

  describe('channel-name', () => {
    it('应该处理正常情况', async () => {
      // Arrange
      (someService.method1 as vi.Mock).mockResolvedValue('result');

      // Act
      const result = await ipcMock.invoke('channel-name', 'arg1');

      // Assert
      expect(result).toBe('result');
      expect(someService.method1).toHaveBeenCalledWith('arg1');
    });

    it('应该处理错误', async () => {
      // Arrange
      (someService.method1 as vi.Mock).mockRejectedValue(
        new Error('test error')
      );

      // Act & Assert
      await expect(
        ipcMock.invoke('channel-name', 'arg1')
      ).rejects.toThrow('test error');
    });
  });
});
```

---

## 9. 相关资源

### 文档
- **[IPC 测试指南](./IPC_TESTING_GUIDE.md)** - 详细的 IPC 测试教程和最佳实践
- [测试进度跟踪](./PROGRESS.md) - 实时进度更新
- [单元测试覆盖计划](../UNIT_TEST_COVERAGE.md) - 整体测试计划

### 代码
- `src/test/utils/ipcMock.ts` - IPC Mock 工具库
- `src/test/main/ContainerIpc.test.ts` - 现有 IPC 测试示例

### 工具
- [Vitest 文档](https://vitest.dev/) - 测试框架
- [Electron IPC 文档](https://www.electronjs.org/docs/latest/api/ipc-main) - Electron IPC API

---

**文档版本**: 1.0
**创建日期**: 2025-11-08
**最后更新**: 2025-11-08
**作者**: Emdash Test Team
