# 单元测试覆盖文档 (Unit Test Coverage)

> **文档版本**: 1.0
> **最后更新**: 2025-11-07
> **项目版本**: 0.3.28
> **测试框架**: Vitest 3.2.4

---

## 目录

- [1. 概述](#1-概述)
- [2. 当前测试覆盖情况](#2-当前测试覆盖情况)
- [3. 主进程 (Main Process) 测试计划](#3-主进程-main-process-测试计划)
- [4. 渲染进程 (Renderer Process) 测试计划](#4-渲染进程-renderer-process-测试计划)
- [5. 共享模块 (Shared) 测试计划](#5-共享模块-shared-测试计划)
- [6. 测试优先级矩阵](#6-测试优先级矩阵)
- [7. 测试编写指南](#7-测试编写指南)
- [8. Mock策略](#8-mock策略)

---

## 1. 概述

### 1.1 目标

- **短期目标** (2周): 将测试覆盖率从 **3.5%** 提升至 **50%**
- **中期目标** (1个月): 达到 **70%** 覆盖率
- **长期目标** (3个月): 核心模块 **100%** 覆盖，整体 **80%+**

### 1.2 测试原则

**Linus准则**: "测试最容易出bug的地方，而不是最容易测的地方"

1. **风险驱动**: 优先测试高风险模块（长生命周期进程、文件系统操作、跨平台兼容）
2. **核心优先**: CodexService > WorktreeService > DatabaseService > 其他
3. **边界条件**: 特别关注错误处理、异常路径、边界情况
4. **集成点**: 重点测试模块间的接口和数据流
5. **无mock陷阱**: 避免过度mock导致测试脱离现实

### 1.3 统计数据

| 类型 | 文件数 | 代码行数 | 已测试文件 | 已测试行数 | 覆盖率 |
|------|--------|----------|-----------|-----------|--------|
| **Main Process** | 22 | ~15,000 | 10 | ~5,000 | **33%** ⬆️ |
| **Renderer** | 111 | ~16,000 | 1 | ~150 | **1%** |
| **Shared** | 5 | ~1,800 | 3 | ~500 | **28%** |
| **总计** | 138 | ~32,800 | 14 | ~5,650 | **~15%** ⬆️ |

---

## 2. 当前测试覆盖情况

### 2.1 已有测试 ✅

#### Main Process (10/22 = 45%)
- ✅ `GitHubService.test.ts` - GitHub CLI集成测试 (2600行)
- ✅ `TerminalSnapshotService.test.ts` - 终端快照服务测试 (2285行)
- ✅ `CodexService.test.ts` - CodexService进程与流解析测试 (618行, 25用例, ~75%覆盖)
- ✅ `DatabaseService.test.ts` - 数据库服务完整测试 (P0 完成)
- ✅ `GitService.test.ts` - Git操作完整测试 (P0 完成)
- ✅ `WorktreeService.test.ts` - Git worktree管理测试 (P0 完成)
- ✅ `ptyManager.test.ts` - 跨平台终端管理测试 (P0 完成)
- ✅ `AgentService.test.ts` - **Agent编排服务测试 (1242行, 43用例, ~90%覆盖)** 🆕

#### Renderer (1/111 = 1%)
- `containerRuns.test.ts` - 容器运行状态管理测试 (4516行)

#### Shared (3/5 = 60%)
- `container/config.test.ts` - 容器配置解析
- `container/mockRunner.test.ts` - Mock运行器
- `container/portManager.test.ts` - 端口分配管理

#### Container System (完整覆盖 ✅)
- `ContainerConfigService.test.ts` - 配置加载服务
- `ContainerIpc.test.ts` - IPC通信层
- `ContainerRunnerService.test.ts` - 运行器服务

### 2.2 缺失测试 ❌ (优先级排序)

#### ✅ P0 - 关键核心 (100% 完成！)

| 模块 | 文件 | 状态 | 测试量 | 覆盖率 |
|------|------|------|--------|--------|
| ✅ **CodexService** | `CodexService.ts` | **完成** | 25 用例 | ~75% |
| ✅ **WorktreeService** | `WorktreeService.ts` | **完成** | 156 用例 | ~95% |
| ✅ **DatabaseService** | `DatabaseService.ts` | **完成** | 100+ 用例 | ~95% |
| ✅ **GitService** | `GitService.ts` | **完成** | 83 用例 | ~90% |
| ✅ **ptyManager** | `ptyManager.ts` | **完成** | 60+ 用例 | ~85% |
| ✅ **AgentService** | `AgentService.ts` | **完成** 🆕 | 43 用例 | ~90% |

#### P1 - 重要服务 (2周内完成，进行中 3/7)

| 模块 | 文件 | 状态 | 风险等级 | 预计测试量 |
|------|------|------|---------|-----------|
| ✅ **AgentService** | `AgentService.ts` | **完成** 🆕 | 🟠 High | 43 用例 |
| ✅ **GitHubService** | `GitHubService.ts` | **完成** | 🟡 Medium | 已完成 |
| ✅ **TerminalSnapshotService** | `TerminalSnapshotService.ts` | **完成** | 🟡 Medium | 已完成 |
| ❌ **LinearService** | `LinearService.ts` | 待开始 | 🟡 Medium | 40+ |
| ❌ **JiraService** | `JiraService.ts` | 待开始 | 🟡 Medium | 40+ |
| ❌ **ConnectionsService** | `ConnectionsService.ts` | 待开始 | 🟡 Medium | 30+ |
| ❌ **RepositoryManager** | `RepositoryManager.ts` | 待开始 | 🟡 Medium | 30+ |

#### P2 - IPC层 (3周内完成)

| 模块 | 文件 | 风险等级 | 预计测试量 |
|------|------|---------|-----------|
| **codexIpc** | `codexIpc.ts` | 🟠 High | 50+ |
| **worktreeIpc** | `worktreeIpc.ts` | 🟡 Medium | 30+ |
| **dbIpc** | `dbIpc.ts` | 🟡 Medium | 40+ |
| **gitIpc** | `gitIpc.ts` | 🟡 Medium | 40+ |
| **githubIpc** | `githubIpc.ts` | 🟡 Medium | 30+ |

#### P3 - 渲染进程Hooks (4周内完成)

| 模块 | 文件 | 风险等级 | 预计测试量 |
|------|------|---------|-----------|
| **useCodexStream** | `useCodexStream.ts` | 🟠 High | 40+ |
| **useFileChanges** | `useFileChanges.ts` | 🟡 Medium | 30+ |
| **useGithubAuth** | `useGithubAuth.ts` | 🟡 Medium | 20+ |
| **useWorkspaceChanges** | `useWorkspaceChanges.ts` | 🟡 Medium | 30+ |

---

## 3. 主进程 (Main Process) 测试计划

### 3.1 CodexService (P0 - 最高优先级)

**文件**: `src/main/services/CodexService.ts`
**复杂度**: 🔴 极高 (~500行，长生命周期进程管理)
**当前覆盖**: ~75% (25 用例)
**目标覆盖**: 90%+

#### 3.1.1 核心功能测试

```typescript
// 测试文件: src/test/main/CodexService.test.ts

describe('CodexService', () => {
  describe('进程管理', () => {
    it('应该成功启动Codex进程')
    it('应该正确传递环境变量和工作目录')
    it('应该处理进程启动失败')
    it('应该在进程退出时清理资源')
    it('应该支持进程取消/终止')
    it('应该防止同一workspace重复启动')
  });

  describe('流日志处理', () => {
    it('应该创建日志文件在userData目录')
    it('应该追加写入多次运行的日志')
    it('应该处理日志写入失败')
    it('应该在进程结束后关闭日志流')
    it('应该忽略codex-stream.log在git status中')
  });

  describe('流解析', () => {
    it('应该正确解析reasoning标记')
    it('应该正确解析codex标记')
    it('应该处理不完整的流数据')
    it('应该处理流中的特殊字符和emoji')
    it('应该支持多行reasoning内容')
  });

  describe('参数构建', () => {
    it('应该默认使用workspace-write sandbox')
    it('应该支持CODEX_SANDBOX_MODE环境变量')
    it('应该支持CODEX_APPROVAL_POLICY环境变量')
    it('应该支持dangerously-bypass标志')
    it('应该正确转义消息中的特殊字符')
  });

  describe('会话管理', () => {
    it('应该关联workspace和conversation')
    it('应该在新消息时更新conversation')
    it('应该处理会话取消')
    it('应该清理取消的会话状态')
  });

  describe('错误处理', () => {
    it('应该处理Codex CLI不存在')
    it('应该处理工作目录不存在')
    it('应该处理进程spawn错误')
    it('应该处理进程意外退出')
    it('应该处理日志写入权限错误')
  });

  describe('跨平台兼容性', () => {
    it('应该在Windows上正确查找codex.cmd')
    it('应该在macOS上正确查找codex')
    it('应该在Linux上正确查找codex')
  });

  describe('竞态条件', () => {
    it('应该处理快速连续的启动/取消')
    it('应该处理进程退出时的并发写入')
    it('应该防止日志流被多次关闭')
  });
});
```

#### 3.1.2 Mock策略

```typescript
// Mock策略
vi.mock('child_process', () => ({
  spawn: vi.fn(), // Mock进程spawn
  exec: vi.fn(),
}));

vi.mock('fs', () => ({
  createWriteStream: vi.fn(), // Mock日志写入
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/test-userdata'),
  },
}));

// 保持真实：不mock DatabaseService，使用内存数据库测试
```

#### 3.1.3 测试数据

```typescript
// 测试fixture
const mockCodexOutput = `
<reasoning>
Analyzing the request...
</reasoning>

<codex>
Here is the implementation:
\`\`\`typescript
function test() {}
\`\`\`
</codex>
`;

const mockWorkspaceConfig = {
  id: 'ws-test-123',
  path: '/tmp/test-workspace',
  branch: 'feature/test',
};
```

---

### 3.2 WorktreeService (P0)

**文件**: `src/main/services/WorktreeService.ts`
**复杂度**: 🔴 高 (~400行，文件系统操作)
**当前覆盖**: 0%
**目标覆盖**: 85%+

#### 3.2.1 核心功能测试

```typescript
// 测试文件: src/test/main/WorktreeService.test.ts

describe('WorktreeService', () => {
  describe('创建Worktree', () => {
    it('应该在../worktrees目录创建worktree')
    it('应该复用已存在的worktree')
    it('应该处理分支不存在的情况')
    it('应该处理目录权限不足')
    it('应该处理磁盘空间不足')
    it('应该清理创建失败的残留文件')
  });

  describe('列出Worktrees', () => {
    it('应该正确解析git worktree list输出')
    it('应该处理空worktree列表')
    it('应该处理损坏的worktree')
  });

  describe('删除Worktree', () => {
    it('应该调用git worktree remove')
    it('应该在权限错误时尝试chmod (Unix)')
    it('应该在权限错误时尝试attrib (Windows)')
    it('应该处理worktree正在使用的情况')
    it('应该清理残留的.git/worktrees条目')
  });

  describe('Worktree验证', () => {
    it('应该检测有效的worktree')
    it('应该检测损坏的worktree')
    it('应该检测.git/worktrees与实际目录不同步')
  });

  describe('路径处理', () => {
    it('应该正确计算相对路径')
    it('应该处理包含空格的路径')
    it('应该处理包含特殊字符的路径')
    it('应该在Windows上使用反斜杠')
  });

  describe('Git配置', () => {
    it('应该在worktree中排除codex-stream.log')
    it('应该继承主repo的git config')
    it('应该处理.git/info/exclude文件不存在')
  });

  describe('清理操作', () => {
    it('应该执行git worktree prune')
    it('应该删除孤立的worktree目录')
    it('应该处理清理过程中的错误')
  });

  describe('并发安全', () => {
    it('应该处理并发创建同名worktree')
    it('应该防止删除正在使用的worktree')
  });
});
```

#### 3.2.2 集成测试 (需要真实Git环境)

```typescript
describe('WorktreeService (Integration)', () => {
  let testRepo: string;

  beforeEach(async () => {
    // 创建临时Git仓库
    testRepo = await createTempGitRepo();
  });

  afterEach(async () => {
    // 清理测试仓库
    await cleanupTempRepo(testRepo);
  });

  it('端到端：创建->使用->删除 worktree', async () => {
    const service = new WorktreeService();

    // 创建
    const worktreePath = await service.ensureWorktree(
      testRepo,
      'test-feature',
      'feature/test'
    );
    expect(existsSync(worktreePath)).toBe(true);

    // 验证
    const worktrees = await service.listWorktrees(testRepo);
    expect(worktrees).toContainEqual(
      expect.objectContaining({ branch: 'feature/test' })
    );

    // 删除
    await service.removeWorktree(testRepo, worktreePath);
    expect(existsSync(worktreePath)).toBe(false);
  });
});
```

---

### 3.3 DatabaseService (P0)

**文件**: `src/main/services/DatabaseService.ts`
**复杂度**: 🟠 中 (~300行，CRUD + 迁移)
**当前覆盖**: 0%
**目标覆盖**: 95%+

#### 3.3.1 核心功能测试

```typescript
// 测试文件: src/test/main/DatabaseService.test.ts

describe('DatabaseService', () => {
  let db: DatabaseService;

  beforeEach(async () => {
    // 使用内存数据库
    process.env.EMDASH_DISABLE_NATIVE_DB = 'true';
    db = new DatabaseService();
    await db.initialize();
  });

  describe('Projects', () => {
    it('应该创建项目')
    it('应该获取所有项目')
    it('应该通过ID获取项目')
    it('应该更新项目')
    it('应该删除项目')
    it('应该处理重复路径')
    it('应该级联删除关联的workspaces')
  });

  describe('Workspaces', () => {
    it('应该创建workspace')
    it('应该获取项目的所有workspaces')
    it('应该更新workspace状态')
    it('应该删除workspace')
    it('应该处理无效的projectId外键')
  });

  describe('Conversations', () => {
    it('应该创建conversation')
    it('应该获取workspace的conversations')
    it('应该删除conversation')
    it('应该级联删除关联的messages')
  });

  describe('Messages', () => {
    it('应该创建message')
    it('应该获取conversation的messages')
    it('应该按时间排序messages')
    it('应该处理大文本content (>1MB)')
  });

  describe('Connections', () => {
    it('应该存储连接配置')
    it('应该获取连接配置')
    it('应该更新连接配置')
    it('应该删除连接配置')
  });

  describe('Schema迁移', () => {
    it('应该从空数据库成功迁移')
    it('应该跳过已执行的迁移')
    it('应该处理迁移失败回滚')
    it('应该记录迁移历史')
  });

  describe('事务', () => {
    it('应该支持事务提交')
    it('应该支持事务回滚')
    it('应该处理嵌套事务')
  });

  describe('错误处理', () => {
    it('应该处理数据库文件损坏')
    it('应该处理磁盘满')
    it('应该处理约束违反')
    it('应该处理并发写入冲突')
  });

  describe('性能', () => {
    it('应该批量插入1000条messages < 1秒')
    it('应该查询大表 (10000+ rows) < 100ms')
  });
});
```

---

### 3.4 GitService (P0)

**文件**: `src/main/services/GitService.ts`
**复杂度**: 🟡 中 (~250行)
**当前覆盖**: 0%
**目标覆盖**: 80%+

#### 3.4.1 核心功能测试

```typescript
describe('GitService', () => {
  describe('getStatus', () => {
    it('应该解析git status --porcelain输出')
    it('应该识别added/modified/deleted/renamed文件')
    it('应该区分staged和unstaged changes')
    it('应该排除codex-stream.log')
    it('应该处理包含空格的文件名')
    it('应该处理包含特殊字符的文件名')
    it('应该处理非Git仓库返回空数组')
  });

  describe('getDiff', () => {
    it('应该获取文件的diff内容')
    it('应该处理二进制文件')
    it('应该处理文件被删除')
    it('应该处理文件新增')
  });

  describe('numstat解析', () => {
    it('应该正确计算additions和deletions')
    it('应该处理二进制文件 (- -)标记')
    it('应该聚合多次diff的统计')
  });

  describe('stageFile', () => {
    it('应该执行git add')
    it('应该处理文件不存在')
    it('应该处理.gitignore的文件')
  });

  describe('commitChanges', () => {
    it('应该创建commit')
    it('应该处理空message')
    it('应该处理没有staged changes')
  });

  describe('getCurrentBranch', () => {
    it('应该返回当前分支名')
    it('应该处理detached HEAD')
  });

  describe('错误处理', () => {
    it('应该处理git命令不存在')
    it('应该处理git命令超时')
    it('应该处理merge冲突')
  });
});
```

---

### 3.5 ptyManager (P0)

**文件**: `src/main/services/ptyManager.ts`
**复杂度**: 🟠 中 (~150行，跨平台)
**当前覆盖**: 0%
**目标覆盖**: 75%+

#### 3.5.1 核心功能测试

```typescript
describe('ptyManager', () => {
  describe('startPty', () => {
    it('应该spawn PTY进程')
    it('应该设置正确的cwd')
    it('应该传递环境变量')
    it('应该设置终端大小 (cols x rows)')
  });

  describe('Shell选择', () => {
    it('应该在Windows上默认使用cmd.exe')
    it('应该在macOS上使用$SHELL')
    it('应该在Linux上使用$SHELL')
    it('应该fallback到/bin/bash')
  });

  describe('Shell参数', () => {
    it('应该为zsh添加-il参数')
    it('应该为bash添加--noprofile --norc -i')
    it('应该为codex/claude CLI不添加参数')
  });

  describe('Windows特殊处理', () => {
    it('应该用where命令查找CLI')
    it('应该优先查找.cmd文件')
    it('应该处理npm全局CLI')
    it('应该确保可执行文件有正确后缀')
  });

  describe('writePty', () => {
    it('应该写入数据到PTY')
    it('应该处理PTY不存在')
    it('应该处理write失败')
  });

  describe('resizePty', () => {
    it('应该调整终端大小')
    it('应该处理PTY已退出')
    it('应该处理EBADF错误')
  });

  describe('killPty', () => {
    it('应该终止进程')
    it('应该清理Map中的记录')
    it('应该处理进程已退出')
  });

  describe('并发管理', () => {
    it('应该支持多个PTY同时运行')
    it('应该使用唯一ID隔离PTY')
  });
});
```

---

### 3.6 其他服务 (P1-P2)

#### LinearService / JiraService / ConnectionsService

```typescript
describe('LinearService', () => {
  it('应该验证API key有效性')
  it('应该获取issues列表')
  it('应该获取单个issue详情')
  it('应该处理API限流')
  it('应该处理网络错误')
  it('应该处理无效凭证')
});

describe('JiraService', () => {
  // 类似测试结构
});

describe('ConnectionsService', () => {
  it('应该加密存储凭证')
  it('应该正确检索凭证')
  it('应该使用keytar安全存储')
  it('应该处理keytar不可用')
});
```

#### AgentService / ProjectPrep / RepositoryManager

```typescript
// ✅ AgentService - 已完成 (43 测试用例，~90% 覆盖)
// 测试文件: src/test/main/AgentService.test.ts (1242行)
//
// 覆盖功能:
// - ✅ Provider安装检测 (codex, claude) - 6用例
// - ✅ Codex集成 (代理到CodexService) - 2用例
// - ✅ Claude CLI模式完整流程 - 13用例
//   - 进程启动与参数配置
//   - 流解析 (stream_event, assistant, result)
//   - 错误处理 (stderr, error事件)
//   - 进程管理和资源清理
//   - SDK fallback机制
// - ✅ 进程生命周期管理 - 5用例
//   - 跨provider进程隔离
//   - 同workspace互斥
//   - 终止失败处理
// - ✅ 日志管理 - 7用例
// - ✅ 停止流操作 - 6用例
//
// 跳过测试: Claude SDK模式 (10个 - 技术限制：动态require无法mock)

describe('AgentService', () => {
  describe('isInstalled()', () => {
    it('codex provider 代理到 codexService')
    it('claude provider 检查 CLI 版本')
    it('未知 provider 直接返回 false')
  });

  describe('startStream() codex provider', () => {
    it('直接调用 codexService.sendMessageStream')
    it('传递 conversationId')
  });

  describe('startStream() claude 进程管理', () => {
    it('新建流时会终止相同 provider 的旧进程')
    it('会同时终止同 workspace 的其他 provider 进程')
    it('终止旧进程失败时继续执行')
    it('启动时写入日志头信息')
  });

  describe('startStream() claude CLI 模式', () => {
    it('使用固定参数启动 claude CLI')
    it('stream_event JSON 输出会触发事件')
    it('close 事件写入 COMPLETE 并发送 agent:complete')
    it('CLI 进程会被记录到 processes 映射')
    // ... 其他 10 个测试用例
  });

  describe('stopStream()', () => {
    it('codex provider 代理到 codexService.stopMessageStream')
    it('claude CLI 进程会发送 SIGTERM 并关闭 writer')
    it('kill 抛错时返回 false')
    // ... 其他 3 个测试用例
  });
});

describe('ProjectPrep', () => {
  it('应该检测package.json')
  it('应该运行npm install')
  it('应该处理安装失败')
});

describe('RepositoryManager', () => {
  it('应该克隆GitHub仓库')
  it('应该更新本地仓库')
  it('应该处理认证失败')
});
```

---

## 4. 渲染进程 (Renderer Process) 测试计划

### 4.1 Custom Hooks (P3)

**测试框架**: `@testing-library/react-hooks` + Vitest

#### useCodexStream

```typescript
// src/test/renderer/useCodexStream.test.ts

describe('useCodexStream', () => {
  it('应该初始化为空状态')
  it('应该解析reasoning标记')
  it('应该解析codex标记')
  it('应该处理流式更新')
  it('应该在unmount时清理')
  it('应该处理IPC连接断开')
});
```

#### useFileChanges

```typescript
describe('useFileChanges', () => {
  it('应该轮询Git status')
  it('应该更新文件列表')
  it('应该处理文件diff')
  it('应该处理Git操作失败')
});
```

#### useGithubAuth

```typescript
describe('useGithubAuth', () => {
  it('应该检测gh CLI认证状态')
  it('应该触发gh auth login')
  it('应该处理认证成功')
  it('应该处理认证失败')
});
```

### 4.2 组件测试 (P4 - 可选)

**测试框架**: `@testing-library/react` + Vitest

由于组件测试成本高、收益低（UI变化频繁），**暂缓**。优先覆盖业务逻辑层。

可选关键组件：
- `ChatInterface` - 核心聊天界面
- `WorkspaceModal` - 工作空间创建
- `TerminalPane` - xterm.js集成

---

## 5. 共享模块 (Shared) 测试计划

### 5.1 已完成 ✅

- `container/config.ts` ✅
- `container/portManager.ts` ✅
- `container/mockRunner.ts` ✅

### 5.2 待补充

无，共享模块测试已完善。

---

## 6. 测试优先级矩阵

### 6.1 风险 vs 复杂度矩阵

```
高风险
  │
  │  [CodexService]     [WorktreeService]
  │       🔴                 🔴
  │
  │  [DatabaseService]  [ptyManager]
  │       🔴                🟠
  │
  │  [GitService]       [AgentService]
  │       🟠                🟠
  │
  │  [LinearService]    [IPC Handlers]
  │       🟡                🟡
低风险
  └────────────────────────────────── 复杂度 ──→
       低                           高
```

### 6.2 执行顺序 (按周)

**✅ 第1周** (P0 - 已完成):
1. ✅ CodexService
2. ✅ WorktreeService
3. ✅ DatabaseService
4. ✅ GitService
5. ✅ ptyManager
6. ✅ AgentService (提前完成)

**第2周** (P1 - 进行中):
7. LinearService (待开始)
8. JiraService (待开始)
9. ConnectionsService (待开始)
10. RepositoryManager (待开始)

**第3周** (P2):
11. IPC层 (codexIpc, worktreeIpc, dbIpc, gitIpc, githubIpc)
12. 剩余IPC handlers

**第4周** (P3):
13. Renderer hooks (useCodexStream, useFileChanges, useGithubAuth等)
14. 集成测试

---

## 7. 测试编写指南

### 7.1 文件组织

```
src/test/
├── main/
│   ├── CodexService.test.ts          # 主服务测试
│   ├── WorktreeService.test.ts
│   ├── DatabaseService.test.ts
│   └── ...
├── renderer/
│   ├── useCodexStream.test.ts        # Hook测试
│   ├── useFileChanges.test.ts
│   └── ...
├── integration/                       # 集成测试 (新建)
│   ├── worktree-e2e.test.ts
│   └── database-migration.test.ts
└── fixtures/                          # 测试数据 (新建)
    ├── mockGitOutput.ts
    ├── mockCodexStream.ts
    └── ...
```

### 7.2 命名规范

```typescript
// ✅ 好的命名
describe('CodexService', () => {
  describe('进程管理', () => {
    it('应该成功启动Codex进程')
    it('应该在进程退出时清理资源')
  });
});

// ❌ 糟糕的命名
describe('CodexService', () => {
  it('test1')
  it('works')
});
```

### 7.3 AAA模式 (Arrange-Act-Assert)

```typescript
it('应该正确解析reasoning标记', () => {
  // Arrange - 准备
  const service = new CodexService();
  const input = '<reasoning>test</reasoning>';

  // Act - 执行
  const result = service.parseStream(input);

  // Assert - 断言
  expect(result.reasoning).toBe('test');
  expect(result.response).toBeUndefined();
});
```

### 7.4 Mock最小化原则

```typescript
// ✅ 只mock外部依赖
vi.mock('child_process'); // 外部系统
vi.mock('fs');            // 文件系统

// ❌ 避免mock内部逻辑
// 不要mock DatabaseService，用内存数据库
// 不要mock GitService，用测试仓库
```

### 7.5 测试隔离

```typescript
describe('DatabaseService', () => {
  let db: DatabaseService;

  beforeEach(async () => {
    // 每个测试独立的数据库
    db = new DatabaseService(':memory:');
    await db.initialize();
  });

  afterEach(async () => {
    // 清理
    await db.close();
  });

  it('...', () => {
    // 测试不会互相影响
  });
});
```

### 7.6 错误路径优先

```typescript
describe('CodexService', () => {
  // ✅ 优先测试错误情况
  it('应该处理进程spawn失败', () => { ... });
  it('应该处理工作目录不存在', () => { ... });
  it('应该处理进程意外退出', () => { ... });

  // 然后测试成功路径
  it('应该成功启动进程', () => { ... });
});
```

---

## 8. Mock策略

### 8.1 外部依赖Mock

#### child_process

```typescript
vi.mock('child_process', () => ({
  spawn: vi.fn((cmd, args, options) => {
    const mockProcess = new EventEmitter();
    mockProcess.stdout = new EventEmitter();
    mockProcess.stderr = new EventEmitter();
    mockProcess.kill = vi.fn();

    // 模拟异步输出
    setTimeout(() => {
      mockProcess.stdout.emit('data', 'mock output');
      mockProcess.emit('exit', 0);
    }, 10);

    return mockProcess;
  }),

  execFile: vi.fn((cmd, args, options, callback) => {
    callback(null, 'mock stdout', '');
  }),
}));
```

#### fs

```typescript
vi.mock('fs', () => ({
  existsSync: vi.fn(() => true),
  mkdirSync: vi.fn(),
  createWriteStream: vi.fn(() => ({
    write: vi.fn(),
    end: vi.fn(),
    on: vi.fn(),
  })),
}));
```

#### electron

```typescript
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name) => {
      if (name === 'userData') return '/tmp/test-userdata';
      return '/tmp';
    }),
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
  },
}));
```

### 8.2 真实测试优先

对于以下场景，**不要mock**，使用真实环境：

- DatabaseService → 用SQLite内存数据库 (`:memory:`)
- GitService → 用临时Git仓库 (`/tmp/test-repo-*`)
- WorktreeService → 用真实Git worktree操作

```typescript
// ✅ 真实数据库测试
const db = new DatabaseService(':memory:');
await db.initialize();

// ✅ 真实Git测试
const testRepo = await createTempGitRepo();
const service = new WorktreeService();
await service.ensureWorktree(testRepo, 'test', 'main');
```

---

## 附录

### A. 测试工具链

- **Vitest 3.2.4**: 测试运行器
- **@testing-library/react**: React组件测试 (可选)
- **@testing-library/react-hooks**: Hook测试
- **@vitest/ui**: 测试结果可视化
- **@vitest/coverage-v8**: 覆盖率报告

### B. 运行命令

```bash
# 运行所有测试
npm test                    # 或 npx vitest run

# 监听模式
npm run test:watch          # 或 npx vitest watch

# 覆盖率报告
npm run test:coverage       # 或 npx vitest run --coverage

# 指定文件
npx vitest run CodexService.test.ts

# UI模式
npx vitest --ui
```

### C. CI集成

详见 `CI_TEST_COVERAGE.md`

---

**下一步**: 开始实现 `CodexService.test.ts`
