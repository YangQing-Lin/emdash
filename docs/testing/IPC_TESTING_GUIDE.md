# IPC 测试指南

> **目标读者**: 开发 P2 阶段 IPC 测试的工程师
> **前置知识**: Vitest, Electron IPC, TypeScript
> **相关文档**: [P2_PLAN.md](./P2_PLAN.md)

---

## 目录

- [1. IPC 测试概述](#1-ipc-测试概述)
- [2. 快速开始](#2-快速开始)
- [3. IPC Mock 工具使用](#3-ipc-mock-工具使用)
- [4. 测试模式](#4-测试模式)
- [5. 最佳实践](#5-最佳实践)
- [6. 常见问题](#6-常见问题)

---

## 1. IPC 测试概述

### 1.1 什么是 IPC 测试？

IPC (Inter-Process Communication) 测试用于验证 Electron 主进程和渲染进程之间的通信逻辑。

**测试范围**:
- ✅ IPC handler 注册是否正确
- ✅ 参数传递和验证
- ✅ 服务层调用是否正确
- ✅ 错误处理和传播
- ✅ 事件发送到渲染进程

**不测试**:
- ❌ Electron 框架本身（假设框架工作正常）
- ❌ 端到端通信（由 E2E 测试覆盖）

### 1.2 测试架构

```
┌─────────────────┐
│  Renderer       │
│  (不测试)        │
└────────┬────────┘
         │ IPC
         ↓
┌─────────────────┐
│  IPC Handler    │ ← 我们测试这一层
│  (agentIpc.ts)  │
└────────┬────────┘
         │
         ↓
┌─────────────────┐
│  Service Layer  │
│  (Mock)         │ ← 用 mock 替代
└─────────────────┘
```

---

## 2. 快速开始

### 2.1 创建测试文件

```bash
# 在 src/test/main/ipc/ 目录下创建
touch src/test/main/ipc/agentIpc.test.ts
```

### 2.2 基础测试模板

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createIpcMock } from '../../utils/ipcMock';

// 1. Mock 依赖的服务
vi.mock('../../../main/services/AgentService', () => ({
  agentService: {
    listAgents: vi.fn(),
    startAgent: vi.fn(),
    stopAgent: vi.fn(),
  },
}));

// 2. 导入要测试的 IPC 注册函数和 mock 的服务
import { registerAgentIpc } from '../../../main/ipc/agentIpc';
import { agentService } from '../../../main/services/AgentService';

describe('agentIpc', () => {
  let ipcMock: ReturnType<typeof createIpcMock>;

  beforeEach(() => {
    // 3. 创建 IPC mock
    ipcMock = createIpcMock();
    vi.clearAllMocks();

    // 4. 注册 IPC handlers
    registerAgentIpc(ipcMock.ipcMain as any);
  });

  describe('agent:list', () => {
    it('应该返回所有 agents', async () => {
      // 5. 设置 mock 返回值
      const mockAgents = [
        { id: '1', name: 'Agent 1', status: 'running' },
        { id: '2', name: 'Agent 2', status: 'stopped' },
      ];
      (agentService.listAgents as vi.Mock).mockResolvedValue(mockAgents);

      // 6. 调用 IPC handler
      const result = await ipcMock.invoke('agent:list');

      // 7. 验证结果
      expect(result).toEqual(mockAgents);
      expect(agentService.listAgents).toHaveBeenCalledTimes(1);
    });

    it('应该处理错误', async () => {
      // Mock 错误
      (agentService.listAgents as vi.Mock).mockRejectedValue(
        new Error('Failed to list agents')
      );

      // 验证错误被正确抛出
      await expect(
        ipcMock.invoke('agent:list')
      ).rejects.toThrow('Failed to list agents');
    });
  });
});
```

---

## 3. IPC Mock 工具使用

### 3.1 基础 API

#### `createIpcMock()`

创建一个 IPC mock 实例。

```typescript
const ipcMock = createIpcMock();

// 可用属性：
ipcMock.ipcMain          // Mock 的 ipcMain 对象
ipcMock.mockEvent        // Mock 的 IPC 事件对象
ipcMock.invoke()         // 调用已注册的 handler
ipcMock.getEvents()      // 获取发送的事件
ipcMock.clearEvents()    // 清除事件记录
ipcMock.clearHandlers()  // 清除所有 handlers
ipcMock.getRegisteredChannels() // 获取已注册频道
```

#### `invoke(channel, ...args)`

调用已注册的 IPC handler。

```typescript
// 无参数
const result = await ipcMock.invoke('agent:list');

// 带参数
const agent = await ipcMock.invoke('agent:start', {
  workspaceId: 'workspace-123',
  message: 'Hello',
});

// 错误处理
await expect(
  ipcMock.invoke('agent:invalid')
).rejects.toThrow('No handler registered');
```

#### `getEvents(channel)`

获取发送到渲染进程的事件。

```typescript
// 触发一些操作导致事件发送
await ipcMock.invoke('codex:start-stream', { workspaceId: 'test' });

// 获取事件
const events = ipcMock.getEvents('codex:stream-data');

expect(events).toHaveLength(3);
expect(events[0]).toEqual([{ type: 'reasoning', content: '...' }]);
expect(events[1]).toEqual([{ type: 'response', content: '...' }]);
```

### 3.2 高级 API

#### `expectHandlerRegistered(ipcMock, channel)`

验证 handler 是否已注册。

```typescript
import { expectHandlerRegistered } from '../../utils/ipcMock';

it('应该注册所有必需的 handlers', () => {
  expectHandlerRegistered(ipcMock, 'agent:list');
  expectHandlerRegistered(ipcMock, 'agent:start');
  expectHandlerRegistered(ipcMock, 'agent:stop');
});
```

#### `expectEventSent(ipcMock, channel, count?)`

验证事件是否被发送。

```typescript
import { expectEventSent } from '../../utils/ipcMock';

it('应该发送进度事件', async () => {
  await ipcMock.invoke('codex:start-stream', { workspaceId: 'test' });

  // 验证至少发送了一个事件
  expectEventSent(ipcMock, 'codex:stream-data');

  // 验证发送了精确数量的事件
  expectEventSent(ipcMock, 'codex:stream-data', 3);
});
```

#### `waitForEvent(ipcMock, channel, options?)`

等待异步事件（用于测试异步流）。

```typescript
import { waitForEvent } from '../../utils/ipcMock';

it('应该处理异步流', async () => {
  // 启动异步操作
  const promise = ipcMock.invoke('codex:start-stream', {
    workspaceId: 'test'
  });

  // 等待事件
  const events = await waitForEvent(ipcMock, 'codex:stream-data', {
    timeout: 5000,
    count: 3,
  });

  expect(events).toHaveLength(3);

  await promise;
});
```

---

## 4. 测试模式

### 4.1 简单请求-响应模式

适用于：大多数 IPC handlers

```typescript
describe('agent:start', () => {
  it('应该启动 agent', async () => {
    // Mock 服务返回
    (agentService.startAgent as vi.Mock).mockResolvedValue({
      agentId: 'agent-123',
      workspaceId: 'workspace-123',
    });

    // 调用 IPC
    const result = await ipcMock.invoke('agent:start', {
      workspaceId: 'workspace-123',
      message: 'Hello',
    });

    // 验证
    expect(result.agentId).toBe('agent-123');
    expect(agentService.startAgent).toHaveBeenCalledWith({
      workspaceId: 'workspace-123',
      message: 'Hello',
    });
  });
});
```

### 4.2 事件流模式

适用于：流式数据传输（如 Codex stream）

```typescript
describe('codex:start-stream', () => {
  it('应该转发流数据事件', async () => {
    // Mock 服务返回 EventEmitter
    const mockEmitter = new EventEmitter();
    (codexService.sendMessageStream as vi.Mock).mockReturnValue(mockEmitter);

    // 启动流
    const promise = ipcMock.invoke('codex:start-stream', {
      workspaceId: 'test',
      message: 'Hello',
    });

    // 模拟流数据
    mockEmitter.emit('data', { type: 'reasoning', content: 'Thinking...' });
    mockEmitter.emit('data', { type: 'response', content: 'Answer' });
    mockEmitter.emit('end');

    await promise;

    // 验证事件被转发
    const events = ipcMock.getEvents('codex:stream-data');
    expect(events).toHaveLength(2);
    expect(events[0][0]).toEqual({ type: 'reasoning', content: 'Thinking...' });
    expect(events[1][0]).toEqual({ type: 'response', content: 'Answer' });
  });
});
```

### 4.3 错误处理模式

适用于：所有 IPC handlers

```typescript
describe('错误处理', () => {
  it('应该处理服务层抛出的错误', async () => {
    (agentService.startAgent as vi.Mock).mockRejectedValue(
      new Error('Codex not installed')
    );

    await expect(
      ipcMock.invoke('agent:start', { workspaceId: 'test' })
    ).rejects.toThrow('Codex not installed');
  });

  it('应该验证参数', async () => {
    await expect(
      ipcMock.invoke('agent:start', {})
    ).rejects.toThrow(/workspace.*required/i);
  });

  it('应该处理意外错误', async () => {
    (agentService.startAgent as vi.Mock).mockImplementation(() => {
      throw new Error('Unexpected error');
    });

    await expect(
      ipcMock.invoke('agent:start', { workspaceId: 'test' })
    ).rejects.toThrow('Unexpected error');
  });
});
```

### 4.4 参数验证模式

适用于：需要严格参数验证的 handlers

```typescript
describe('参数验证', () => {
  it('应该验证必需参数', async () => {
    await expect(
      ipcMock.invoke('agent:start', {})
    ).rejects.toThrow('workspaceId is required');
  });

  it('应该验证参数类型', async () => {
    await expect(
      ipcMock.invoke('agent:start', { workspaceId: 123 })
    ).rejects.toThrow('workspaceId must be a string');
  });

  it('应该验证参数格式', async () => {
    await expect(
      ipcMock.invoke('agent:start', { workspaceId: '' })
    ).rejects.toThrow('workspaceId cannot be empty');
  });

  it('应该允许可选参数', async () => {
    (agentService.startAgent as vi.Mock).mockResolvedValue({});

    await expect(
      ipcMock.invoke('agent:start', {
        workspaceId: 'test',
        // options 是可选的
      })
    ).resolves.toBeDefined();
  });
});
```

---

## 5. 最佳实践

### 5.1 组织测试

```typescript
describe('agentIpc', () => {
  // 1. 按功能分组
  describe('agent:list', () => {
    it('正常情况')
    it('空列表')
    it('错误处理')
  })

  describe('agent:start', () => {
    it('正常启动')
    it('参数验证')
    it('重复启动')
    it('错误处理')
  })

  // 2. 通用测试放最后
  describe('错误处理', () => {
    it('未注册的 handler')
    it('服务层错误传播')
  })
})
```

### 5.2 Mock 服务

```typescript
// ✅ 好的做法：为每个服务方法都提供 mock
vi.mock('../../../main/services/AgentService', () => ({
  agentService: {
    listAgents: vi.fn(),
    startAgent: vi.fn(),
    stopAgent: vi.fn(),
    getAgentStatus: vi.fn(),
  },
}));

// ❌ 坏的做法：只 mock 部分方法
vi.mock('../../../main/services/AgentService', () => ({
  agentService: {
    startAgent: vi.fn(),
    // 缺少其他方法
  },
}));
```

### 5.3 清理状态

```typescript
describe('agentIpc', () => {
  let ipcMock: ReturnType<typeof createIpcMock>;

  beforeEach(() => {
    ipcMock = createIpcMock();
    vi.clearAllMocks(); // ✅ 清理所有 mock 调用记录
    registerAgentIpc(ipcMock.ipcMain as any);
  });

  afterEach(() => {
    ipcMock.clearEvents(); // ✅ 清理事件记录
    ipcMock.clearHandlers(); // ✅ 清理 handlers
  });
});
```

### 5.4 测试命名

```typescript
// ✅ 好的命名：描述行为和预期结果
it('应该在 workspaceId 缺失时抛出错误')
it('应该返回包含 id 和 status 的 agent 列表')
it('应该在 agent 已运行时拒绝重复启动')

// ❌ 坏的命名：不清楚测试什么
it('测试 agent:start')
it('错误情况')
it('works')
```

### 5.5 断言要具体

```typescript
// ✅ 好的断言：具体的预期值
expect(result).toEqual({
  agentId: 'agent-123',
  status: 'running',
  workspaceId: 'workspace-123',
});

// ❌ 坏的断言：过于宽泛
expect(result).toBeDefined();
expect(result).toBeTruthy();
```

---

## 6. 常见问题

### 6.1 "No handler registered for channel"

**问题**: 调用 `invoke()` 时报错 handler 未注册

**原因**: IPC 注册函数未被调用或频道名错误

**解决**:
```typescript
beforeEach(() => {
  ipcMock = createIpcMock();
  // 确保调用注册函数
  registerAgentIpc(ipcMock.ipcMain as any);
});

// 验证 handler 已注册
it('should register handlers', () => {
  const channels = ipcMock.getRegisteredChannels();
  expect(channels).toContain('agent:list');
});
```

### 6.2 Mock 没有生效

**问题**: 服务方法被实际调用，而不是 mock

**原因**:
1. Mock 定义在 import 之后
2. Mock 路径错误
3. 没有清理 mock

**解决**:
```typescript
// ✅ Mock 必须在 import 之前
vi.mock('../../../main/services/AgentService', () => ({
  agentService: { startAgent: vi.fn() },
}));

// 然后才 import
import { registerAgentIpc } from '../../../main/ipc/agentIpc';
import { agentService } from '../../../main/services/AgentService';

// 验证 mock
it('test', () => {
  expect(vi.isMockFunction(agentService.startAgent)).toBe(true);
});
```

### 6.3 事件未被发送

**问题**: `getEvents()` 返回空数组

**原因**:
1. 事件频道名错误
2. 异步事件未等待
3. 服务未触发事件

**解决**:
```typescript
// 1. 检查频道名
const events = ipcMock.getEvents('codex:stream-data'); // 正确的频道

// 2. 等待异步事件
await waitForEvent(ipcMock, 'codex:stream-data', { timeout: 1000 });

// 3. 验证服务被调用
expect(codexService.sendMessageStream).toHaveBeenCalled();
```

### 6.4 异步测试不稳定

**问题**: 测试偶尔失败，特别是涉及异步操作

**原因**: 竞态条件，事件顺序不确定

**解决**:
```typescript
// ✅ 使用 waitForEvent 等待异步事件
it('应该处理异步流', async () => {
  const promise = ipcMock.invoke('codex:start-stream', {
    workspaceId: 'test'
  });

  // 等待事件而不是固定延迟
  await waitForEvent(ipcMock, 'codex:stream-data', {
    timeout: 5000,
    count: 3,
  });

  await promise;
});

// ❌ 不要使用固定延迟
it('bad test', async () => {
  ipcMock.invoke('codex:start-stream', { workspaceId: 'test' });
  await new Promise(resolve => setTimeout(resolve, 100)); // 不稳定
});
```

### 6.5 TypeScript 类型错误

**问题**: `ipcMock.ipcMain` 类型不匹配

**原因**: 我们的 mock 不是完整的 `IpcMain` 类型

**解决**:
```typescript
// 使用类型断言
registerAgentIpc(ipcMock.ipcMain as any);

// 或者扩展 mock 类型
import type { IpcMain } from 'electron';
registerAgentIpc(ipcMock.ipcMain as unknown as IpcMain);
```

---

## 7. 示例代码仓库

完整的测试示例请参考：

- `src/test/main/ContainerIpc.test.ts` - 容器 IPC 测试（现有示例）
- `src/test/utils/ipcMock.ts` - IPC Mock 工具实现

---

## 8. 检查清单

在提交测试前，确保：

- [ ] 所有测试都通过（`npm test`）
- [ ] TypeScript 类型检查通过（`npm run type-check`）
- [ ] ESLint 无错误（`npx eslint 'src/test/**/*.test.ts'`）
- [ ] 测试覆盖了正常情况和错误情况
- [ ] 测试命名清晰，描述行为
- [ ] Mock 正确清理（beforeEach/afterEach）
- [ ] 没有硬编码的延迟（使用 waitForEvent）
- [ ] 断言具体，不过于宽泛

---

**文档版本**: 1.0
**创建日期**: 2025-11-08
**维护者**: Emdash Test Team
