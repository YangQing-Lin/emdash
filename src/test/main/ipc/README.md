# IPC 测试目录

这个目录包含所有 Electron IPC 层的单元测试。

## 📋 P2 阶段测试清单

### 高优先级 (Week 1: Nov 11-15)

- [ ] `agentIpc.test.ts` - Agent 生命周期 IPC (30+ 用例)
- [ ] `codexIpc.test.ts` - Codex 流式通信 IPC (40+ 用例)
- [ ] `worktreeIpc.test.ts` - Worktree 管理 IPC (35+ 用例)
- [ ] `dbIpc.test.ts` - 数据库操作 IPC (40+ 用例)
- [ ] `gitIpc.test.ts` - Git 操作 IPC (40+ 用例)
- [ ] `githubIpc.test.ts` - GitHub 集成 IPC (30+ 用例)
- [ ] `linearIpc.test.ts` - Linear 集成 IPC (25+ 用例)
- [ ] `jiraIpc.test.ts` - Jira 集成 IPC (25+ 用例)

### 中优先级 (Week 2: Nov 18-22)

- [ ] `connectionsIpc.test.ts` - CLI Provider 检测 IPC (20+ 用例)
- [ ] `settingsIpc.test.ts` - 设置管理 IPC (30+ 用例)
- [ ] `projectIpc.test.ts` - 项目管理 IPC (25+ 用例)

### 低优先级 (Week 2: Nov 18-22)

- [ ] `appIpc.test.ts` - 应用级别 IPC (20+ 用例)
- [ ] `debugIpc.test.ts` - 调试工具 IPC (15+ 用例)
- [ ] `telemetryIpc.test.ts` - 遥测数据 IPC (15+ 用例)

## 🛠️ 使用工具

所有 IPC 测试都应该使用统一的 mock 工具：

```typescript
import { createIpcMock } from '../../utils/ipcMock';
```

详细使用方法请参考：
- [IPC 测试指南](../../../../docs/testing/IPC_TESTING_GUIDE.md)
- [P2 阶段计划](../../../../docs/testing/P2_PLAN.md)

## 📖 测试模板

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createIpcMock } from '../../utils/ipcMock';

// Mock 服务
vi.mock('../../../main/services/SomeService', () => ({
  someService: {
    method1: vi.fn(),
    method2: vi.fn(),
  },
}));

import { registerSomeIpc } from '../../../main/ipc/someIpc';
import { someService } from '../../../main/services/SomeService';

describe('someIpc', () => {
  let ipcMock: ReturnType<typeof createIpcMock>;

  beforeEach(() => {
    ipcMock = createIpcMock();
    vi.clearAllMocks();
    registerSomeIpc(ipcMock.ipcMain as any);
  });

  describe('channel-name', () => {
    it('应该处理正常情况', async () => {
      (someService.method1 as vi.Mock).mockResolvedValue('result');
      const result = await ipcMock.invoke('channel-name', 'arg');
      expect(result).toBe('result');
    });

    it('应该处理错误', async () => {
      (someService.method1 as vi.Mock).mockRejectedValue(new Error('test'));
      await expect(ipcMock.invoke('channel-name', 'arg')).rejects.toThrow('test');
    });
  });
});
```

## 🎯 目标

- **总用例数**: ~390
- **代码覆盖率**: 90%+
- **测试稳定性**: 100% 通过率
- **完成时间**: 2025-11-22

## 📊 进度跟踪

实时进度更新请查看 [PROGRESS.md](../../../../docs/testing/PROGRESS.md)
