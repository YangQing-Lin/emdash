# P2 阶段快速启动指南

> **阅读时间**: 5 分钟
> **目标**: 快速开始 P2 阶段 IPC 测试开发

---

## 🚀 30秒快速开始

```bash
# 1. 查看详细计划
open docs/testing/P2_PLAN.md

# 2. 学习 IPC 测试
open docs/testing/IPC_TESTING_GUIDE.md

# 3. 创建第一个测试
mkdir -p src/test/main/ipc
cat > src/test/main/ipc/agentIpc.test.ts << 'EOF'
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createIpcMock } from '../../utils/ipcMock';

vi.mock('../../../main/services/AgentService', () => ({
  agentService: {
    listAgents: vi.fn(),
  },
}));

import { registerAgentIpc } from '../../../main/ipc/agentIpc';
import { agentService } from '../../../main/services/AgentService';

describe('agentIpc', () => {
  let ipcMock: ReturnType<typeof createIpcMock>;

  beforeEach(() => {
    ipcMock = createIpcMock();
    vi.clearAllMocks();
    registerAgentIpc(ipcMock.ipcMain as any);
  });

  describe('agent:list', () => {
    it('应该返回所有 agents', async () => {
      const mockAgents = [{ id: '1', name: 'Test' }];
      (agentService.listAgents as vi.Mock).mockResolvedValue(mockAgents);

      const result = await ipcMock.invoke('agent:list');

      expect(result).toEqual(mockAgents);
    });
  });
});
EOF

# 4. 运行测试
npm test
```

---

## 📚 核心资源

### 必读文档

1. **[P2_PLAN.md](./P2_PLAN.md)** (10 分钟)
   - P2 阶段目标和范围
   - 20 个待测模块清单
   - 时间表和里程碑
   - 成功标准

2. **[IPC_TESTING_GUIDE.md](./IPC_TESTING_GUIDE.md)** (20 分钟)
   - IPC Mock 工具详细教程
   - 4 种常见测试模式
   - 最佳实践和常见问题
   - 完整代码示例

3. **[PROGRESS.md](./PROGRESS.md)** (5 分钟)
   - 实时进度跟踪
   - 已完成模块列表
   - 下一步行动

### 代码资源

- `src/test/utils/ipcMock.ts` - IPC Mock 工具实现
- `src/test/main/ContainerIpc.test.ts` - 现有 IPC 测试示例
- `src/test/main/AgentService.test.ts` - 服务层测试示例

---

## 🎯 P2 阶段概览

### 目标

- 完成 **20 个模块**的测试
- 新增 **~525 测试用例**
- 覆盖率提升 **18% → 35%**
- 时间：**2 周** (Nov 11-22)

### Week 1 计划 (Nov 11-15)

| 日期 | 模块 | 用例数 |
|------|------|--------|
| Mon 11 | agentIpc | 30 |
| Tue 12 | codexIpc | 40 |
| Wed 13 | worktreeIpc + dbIpc | 75 |
| Thu 14 | gitIpc | 40 |
| Fri 15 | githubIpc + linearIpc + jiraIpc | 80 |

**Week 1 目标**: 265 用例，覆盖率达到 25%

### Week 2 计划 (Nov 18-22)

| 日期 | 模块 | 用例数 |
|------|------|--------|
| Mon 18 | ProjectPrep + ptyIpc | 55 |
| Tue 19 | fsIpc + settingsIpc | 55 |
| Wed 20 | projectIpc + connectionsIpc | 45 |
| Thu 21 | iconService + appIpc | 35 |
| Fri 22 | debugIpc + telemetryIpc + 其他 | 70 |

**Week 2 目标**: 260 用例，覆盖率达到 35%

---

## 🛠️ IPC Mock 工具速查

### 基础用法

```typescript
import { createIpcMock } from '../../utils/ipcMock';

const ipcMock = createIpcMock();

// 注册 handlers
registerMyIpc(ipcMock.ipcMain as any);

// 调用 handler
const result = await ipcMock.invoke('channel-name', arg1, arg2);

// 检查发送的事件
const events = ipcMock.getEvents('event-channel');
```

### 常用 API

```typescript
// 验证 handler 已注册
expectHandlerRegistered(ipcMock, 'my-channel');

// 验证事件被发送
expectEventSent(ipcMock, 'my-event', 1);

// 等待异步事件
await waitForEvent(ipcMock, 'my-event', { timeout: 5000 });

// 清理
ipcMock.clearEvents();
ipcMock.clearHandlers();
```

---

## ✅ 测试检查清单

提交前确保：

- [ ] 测试通过: `npm test`
- [ ] 类型检查: `npm run type-check`
- [ ] ESLint: `npx eslint 'src/test/**/*.test.ts'`
- [ ] 覆盖正常和错误情况
- [ ] Mock 正确清理（beforeEach/afterEach）
- [ ] 测试命名清晰
- [ ] 断言具体

---

## 🤔 遇到问题？

### 常见问题

**Q: "No handler registered for channel"**
```typescript
// 确保调用了注册函数
beforeEach(() => {
  ipcMock = createIpcMock();
  registerAgentIpc(ipcMock.ipcMain as any); // ← 这一行
});
```

**Q: Mock 没有生效**
```typescript
// Mock 必须在 import 之前
vi.mock('../../../main/services/AgentService', () => ({
  agentService: { startAgent: vi.fn() },
}));

// 然后才 import
import { agentService } from '../../../main/services/AgentService';
```

**Q: 事件未被发送**
```typescript
// 等待异步事件
await waitForEvent(ipcMock, 'codex:stream-data', { timeout: 1000 });
```

### 获取帮助

- 查看 [IPC_TESTING_GUIDE.md](./IPC_TESTING_GUIDE.md) 第 6 节
- 参考 `src/test/main/ContainerIpc.test.ts` 示例
- 在 GitHub Issues 提问

---

## 📊 进度跟踪

每天结束时：

1. 更新 `src/test/main/ipc/README.md` 中的复选框
2. 运行 `npm test` 验证所有测试通过
3. 更新 [PROGRESS.md](./PROGRESS.md) 中的统计数据

---

## 🎉 开始吧！

选择一个模块，创建测试文件，开始编写！

**推荐起点**: `agentIpc.test.ts` (最简单，有明确的业务逻辑)

```bash
# 创建测试文件
touch src/test/main/ipc/agentIpc.test.ts

# 打开编辑器
code src/test/main/ipc/agentIpc.test.ts

# 参考模板：docs/testing/IPC_TESTING_GUIDE.md 第 2.2 节
```

Good luck! 🚀

---

**文档版本**: 1.0
**创建日期**: 2025-11-08
