# Emdash 远程服务端架构设计

> **版本**: v2.0 (Golang + gRPC)
> **创建日期**: 2025-11-10
> **最后更新**: 2025-11-10
> **状态**: 规划阶段
> **作者**: Luke
>
> **⚠️ 技术栈更新**：本文档已从 Node.js + JSON-RPC 方案更新为 **Golang + gRPC + WebSocket** 混合方案，以获得更好的性能和类型安全

---

## 目录

1. [背景和动机](#背景和动机)
2. [架构设计](#架构设计)
3. [技术栈选型](#技术栈选型)
4. [核心模块设计](#核心模块设计)
5. [通信协议](#通信协议)
6. [接口定义](#接口定义)
7. [实施路线图](#实施路线图)
8. [部署方案](#部署方案)
9. [安全设计](#安全设计)
10. [测试策略](#测试策略)
11. [FAQ](#faq)

---

## 背景和动机

### 问题陈述

当前 Emdash 是一个纯客户端应用（Electron），所有操作（Git worktree、PTY、Agent 进程管理）都在本地执行。这导致：

1. **多系统适配复杂**：需要在客户端适配 Windows/macOS/Linux 的差异（尤其是 Windows 的路径、shell、native modules）
2. **远程开发不便**：无法在远程服务器上运行 agents，限制了云端开发场景
3. **Fork 仓库维护困难**：大量平台特定代码增加了与上游同步的冲突

### 解决方案

引入 **客户端-服务端架构**：

- **客户端（Electron）**：保持纯 UI 层，负责渲染、用户交互、本地数据库
- **服务端（Golang）**：运行在远程 Linux 服务器，负责 Git 操作、PTY 管理、Agent 进程管理
- **双模式支持**：保持本地模式（当前逻辑），新增远程模式（通过网络连接服务端）
- **混合通信协议**：gRPC（请求-响应）+ WebSocket（实时推送）

### 核心目标

1. ✅ **不破坏现有功能**：本地模式完全保持原样
2. ✅ **最小化代码改动**：通过抽象层实现，降低 fork 合并冲突
3. ✅ **架构清晰**：客户端、服务端职责分离
4. ✅ **性能可接受**：远程 PTY 延迟 < 100ms，Agent 流式输出流畅
5. ✅ **易于部署**：Docker 镜像、systemd service、一键安装脚本

---

## 架构设计

### 整体架构

```
┌──────────────────────────────────────────────────────────────┐
│                    Electron Client (UI)                      │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Renderer Process (React)                            │   │
│  │  - Chat Interface                                     │   │
│  │  - Terminal (xterm.js)                               │   │
│  │  - Workspace Management                               │   │
│  └──────────────────────────────────────────────────────┘   │
│                            │                                  │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Main Process (Electron)                             │   │
│  │  - IPC Handlers                                       │   │
│  │  - SQLite Database (metadata)                        │   │
│  │  - Service Factory ◄───────────── Mode: local/remote │   │
│  └──────────────────────────────────────────────────────┘   │
│              │                             │                  │
│              │                             │                  │
│    ┌─────────▼──────────┐      ┌─────────▼─────────┐        │
│    │  Local Services    │      │  Remote Services  │        │
│    │  (current logic)   │      │  (proxy to server)│        │
│    └─────────┬──────────┘      └─────────┬─────────┘        │
│              │                             │                  │
└──────────────┼─────────────────────────────┼──────────────────┘
               │                             │
               │                             │ gRPC + WebSocket
               │                             │ (grpc://server:50051 + wss://server:8080)
               ▼                             │
        ┌─────────────┐                     │
        │ Local FS    │                     │
        │ Local Git   │                     ▼
        │ Local PTY   │          ┌────────────────────────────┐
        └─────────────┘          │   Remote Server (Golang)   │
                                 │  ┌──────────────────────┐  │
                                 │  │  gRPC Server         │  │
                                 │  │  (port 50051)        │  │
                                 │  │  - Worktree RPCs     │  │
                                 │  │  - Git RPCs          │  │
                                 │  └──────────────────────┘  │
                                 │  ┌──────────────────────┐  │
                                 │  │  WebSocket Server    │  │
                                 │  │  (port 8080)         │  │
                                 │  │  - PTY streams       │  │
                                 │  │  - Agent streams     │  │
                                 │  └───────────┬──────────┘  │
                                 │              │              │
                                 │  ┌───────────▼──────────┐  │
                                 │  │  Service Layer       │  │
                                 │  │  - WorktreeService   │  │
                                 │  │  - CodexService      │  │
                                 │  │  - PtyService        │  │
                                 │  │  - GitService        │  │
                                 │  └───────────┬──────────┘  │
                                 │              │              │
                                 │  ┌───────────▼──────────┐  │
                                 │  │  Filesystem          │  │
                                 │  │  - Git repositories  │  │
                                 │  │  - Worktrees         │  │
                                 │  │  - Agent logs        │  │
                                 │  └──────────────────────┘  │
                                 └────────────────────────────┘
```

### 数据流向

#### 1. 用户创建 Workspace（远程模式）

```
User (UI)
  │
  ├─► Click "New Workspace"
  │
  ├─► Renderer sends IPC: workspace:create
  │
  ├─► Main Process receives IPC
  │
  ├─► ServiceFactory.getWorktreeService()
  │   └─► Returns RemoteWorktreeService (because mode=remote)
  │
  ├─► RemoteWorktreeService.createWorktree()
  │   └─► RemoteClient.request('worktree.create', { ... })
  │       └─► WebSocket sends JSON-RPC request
  │
  ├─► Server receives request
  │   └─► ServerWorktreeService.createWorktree()
  │       └─► execFile('git', ['worktree', 'add', ...])
  │       └─► Returns worktree info
  │
  ├─► Server sends JSON-RPC response
  │
  ├─► Client receives response
  │
  ├─► Update local SQLite (cache metadata)
  │
  └─► UI updates, shows new workspace
```

#### 2. PTY 数据流（双向实时）

```
User types in terminal
  │
  ├─► xterm.js onData event
  │
  ├─► Renderer sends IPC: pty:input
  │
  ├─► Main Process: RemotePtyManager.write(id, data)
  │   └─► RemoteClient sends: { method: 'pty.write', params: { id, data } }
  │
  ├─► Server receives, writes to local PTY
  │   └─► pty.write(data)
  │
  └─► PTY outputs data
      └─► pty.onData(output)
          └─► Server pushes: { type: 'pty:data', id, data: output }
              └─► Client receives push
                  └─► Emit IPC: pty:data:<id>
                      └─► Renderer receives, writes to xterm.js
                          └─► User sees output
```

#### 3. Agent 流式输出（单向推送）

```
User sends message to agent
  │
  ├─► Renderer: sendMessage(workspaceId, message)
  │
  ├─► Main: RemoteCodexService.sendMessageStream(...)
  │   └─► RemoteClient.request('agent.start', { ... })
  │
  ├─► Server: spawn('codex', args)
  │   └─► child.stdout.on('data', chunk => {
  │         wss.broadcast({ type: 'agent:output', workspaceId, chunk });
  │       })
  │
  ├─► Client receives push: { type: 'agent:output', ... }
  │   └─► Emit IPC: codex:output
  │
  └─► Renderer: append chunk to UI
      └─► User sees agent response in real-time
```

---

## 技术栈选型

### 服务端

| 组件 | 技术选型 | 理由 |
|-----|---------|------|
| **运行时** | Golang 1.21+ | 高性能、并发友好、单二进制部署 |
| **RPC 框架** | gRPC + Protocol Buffers | 强类型、高性能、流式支持 |
| **WebSocket** | `gorilla/websocket` | 成熟的 Go WebSocket 库 |
| **PTY** | `creack/pty` | 纯 Go PTY 库，跨平台支持 |
| **子进程管理** | `os/exec` 标准库 | 原生 API，性能优秀 |
| **日志** | `zap` 或 `zerolog` | 高性能结构化日志 |
| **配置管理** | `viper` | 支持多格式配置文件 |
| **认证** | JWT (`golang-jwt/jwt`) | 无状态，易扩展多用户 |
| **Git 操作** | `go-git` 或 shell 调用 | 纯 Go 实现或命令行 |

### 客户端改动

| 改动项 | 实现方式 |
|-------|---------|
| **Service 抽象** | 提取接口（TypeScript interface） |
| **服务工厂** | `ServiceFactory` 根据配置返回 Local 或 Remote 实现 |
| **gRPC 客户端** | `@grpc/grpc-js` + 生成的 TypeScript 代码 |
| **WebSocket 客户端** | `ws` 库，处理 PTY/Agent 流式数据 |
| **配置管理** | 新增 `connections` 表存储服务器连接信息 |
| **UI 改动** | 设置页面新增 "Remote Server" 配置项 |

### 通信协议

**混合方案：gRPC + WebSocket**

#### 协议选择原则

| 场景 | 协议 | 原因 |
|-----|------|------|
| **请求-响应**（worktree、git 操作） | gRPC | 强类型、高性能、自动生成代码 |
| **实时流式推送**（PTY 输出、Agent 输出） | WebSocket | 低延迟、双向通信、服务端主动推送 |
| **认证** | gRPC Metadata + WebSocket Header | 统一 JWT Token 认证 |
| **错误处理** | gRPC Status Codes | 标准化错误码 |

#### gRPC 优势

- 强类型 Protocol Buffers，自动生成 TypeScript 和 Go 代码
- 二进制序列化，性能优于 JSON
- 原生支持流式通信
- 内置负载均衡和重试机制

#### WebSocket 优势

- 毫秒级延迟，适合实时 PTY 输出
- 服务端可主动推送数据
- 一个长连接复用所有流式数据

---

## 核心模块设计

### 1. 客户端：Service 抽象层

#### 设计目标

通过接口抽象实现本地/远程模式无缝切换，客户端代码无需关心底层是本地调用还是 gRPC 调用。

#### 关键接口

**IWorktreeService**
- `createWorktree()` - 创建 Git worktree
- `listWorktrees()` - 列出所有 worktrees
- `removeWorktree()` - 删除指定 worktree
- `getWorktreeStatus()` - 获取 worktree Git 状态

**IPtyService**
- `startPty()` - 启动 PTY 会话
- `writePty()` - 写入数据到 PTY
- `resizePty()` - 调整 PTY 尺寸
- `killPty()` - 关闭 PTY

**ICodexService**
- `createAgent()` - 创建 Agent 实例
- `sendMessageStream()` - 发送消息并接收流式响应
- `stopMessageStream()` - 停止 Agent 执行
- `getAgentStatus()` - 查询 Agent 状态

#### 实现类

- **本地实现**：`LocalWorktreeService`、`LocalPtyService`、`LocalCodexService`（重构现有代码）
- **远程实现**：`RemoteWorktreeService`、`RemotePtyService`、`RemoteCodexService`（通过 gRPC/WebSocket 调用服务端）

#### ServiceFactory 模式

运行时根据配置 `mode: 'local' | 'remote'` 返回对应实现，所有 IPC 处理器通过工厂获取服务实例。

### 2. 客户端：RemoteClient

#### 职责

管理与服务端的双通道连接（gRPC + WebSocket），提供统一的调用接口。

#### 关键功能

- **连接管理**：同时建立 gRPC 和 WebSocket 连接
- **认证**：gRPC Metadata 和 WebSocket Header 携带 JWT Token
- **自动重连**：WebSocket 断线后自动重连（5秒间隔）
- **事件分发**：将 WebSocket 推送消息转换为 EventEmitter 事件
- **客户端获取**：提供 `getWorktreeClient()`、`getGitClient()` 等方法返回 gRPC 客户端

#### WebSocket 消息类型

- `pty.data` - PTY 输出数据
- `pty.exit` - PTY 退出
- `agent.output` - Agent 标准输出
- `agent.error` - Agent 错误输出
- `agent.complete` - Agent 执行完成

### 3. 服务端：主程序架构

#### 入口职责

- **加载配置**：从环境变量或配置文件读取端口、路径、认证 Token
- **初始化日志**：使用 `zap` 结构化日志
- **启动双服务**：
  - gRPC 服务器（端口 50051）：处理 Worktree、Git 等 RPC 请求
  - WebSocket 服务器（端口 8080）：处理 PTY、Agent 流式推送
- **注册服务**：`WorktreeService`、`GitService`、`PtyService`、`CodexService`
- **优雅关闭**：接收 SIGINT/SIGTERM 信号，等待所有请求完成后退出

#### 关键组件

- **gRPC Interceptor**：验证每个请求的 JWT Token
- **WebSocket Handler**：验证连接时的 Authorization Header
- **Health Check**：`/health` 端点返回服务状态

### 4. 服务端：Service 层功能

#### WorktreeService

实现 gRPC `WorktreeService` 接口，通过 `os/exec` 调用 Git 命令。

**核心方法**：
- `CreateWorktree` - 执行 `git worktree add -b <branch> <path>`
- `ListWorktrees` - 执行 `git worktree list --porcelain` 并解析输出
- `RemoveWorktree` - 执行 `git worktree remove <path>`
- `GetWorktreeStatus` - 执行 `git status --porcelain` 并解析

#### PtyService

管理 PTY 会话，使用 `creack/pty` 库。

**核心功能**：
- 启动 PTY 进程（bash/zsh/powershell）
- 双向数据转发（客户端 ↔ PTY）
- 会话管理（存储 Map，防止泄漏）
- 输出推送至 WebSocket

#### CodexService

管理 Agent 子进程（codex、claude 等 CLI），流式输出处理。

**核心功能**：
- 启动 Agent CLI 进程
- 解析流式输出（stdout/stderr）
- 通过 WebSocket 推送输出到客户端
- 进程生命周期管理（停止、清理）

#### GitService

封装常见 Git 操作。

**核心方法**：
- `GetStatus` - `git status`
- `GetDiff` - `git diff`
- `GetLog` - `git log`

### 5. 服务端：WebSocket 管理

#### 职责

管理 WebSocket 连接，处理实时流式数据推送（PTY 输出、Agent 输出）。

#### 核心功能

- **连接管理**：使用 `gorilla/websocket` 处理连接升级和生命周期
- **认证**：验证 `Authorization` Header 中的 JWT Token
- **会话跟踪**：记录每个连接的 PTY 会话和 Agent 会话
- **消息路由**：根据消息类型（`pty.*`、`agent.*`）分发到对应 Service
- **广播机制**：Service 产生输出时，通过 WebSocket 推送给客户端
- **清理**：连接断开时，终止所有关联的 PTY 和 Agent 进程

---

## 通信协议

### gRPC + WebSocket 混合方案

#### gRPC 用于请求-响应

通过 Protocol Buffers 定义服务接口，自动生成 Go 和 TypeScript 代码。

**核心服务**：
- `WorktreeService` - Worktree 创建、列表、删除、状态查询
- `GitService` - Git 操作（status、diff、log）

#### WebSocket 用于实时推送

PTY 和 Agent 的流式输出通过 WebSocket 推送。

**消息类型**（JSON 格式）：
- `pty.data` - PTY 输出数据
- `pty.exit` - PTY 退出事件
- `agent.output` - Agent 标准输出
- `agent.error` - Agent 错误输出
- `agent.complete` - Agent 执行完成

---

## 接口定义

### Protobuf 定义（gRPC）

#### WorktreeService

```protobuf
// proto/worktree.proto
syntax = "proto3";
package emdash.v1;
option go_package = "github.com/yourusername/emdash-server/pb;pb";

service WorktreeService {
  rpc CreateWorktree(CreateWorktreeRequest) returns (WorktreeInfo);
  rpc ListWorktrees(ListWorktreesRequest) returns (ListWorktreesResponse);
  rpc RemoveWorktree(RemoveWorktreeRequest) returns (RemoveWorktreeResponse);
  rpc GetWorktreeStatus(GetWorktreeStatusRequest) returns (WorktreeStatus);
}

message CreateWorktreeRequest {
  string project_path = 1;
  string workspace_name = 2;
  string project_id = 3;
}

message WorktreeInfo {
  string id = 1;
  string name = 2;
  string branch = 3;
  string path = 4;
  string project_id = 5;
  string status = 6;  // "active" | "paused" | "completed" | "error"
  string created_at = 7;
  string last_activity = 8;
}

message ListWorktreesRequest {
  string project_path = 1;
}

message ListWorktreesResponse {
  repeated WorktreeInfo worktrees = 1;
}

message RemoveWorktreeRequest {
  string project_path = 1;
  string worktree_id = 2;
  string worktree_path = 3;
  string branch = 4;
}

message RemoveWorktreeResponse {
  bool success = 1;
}

message GetWorktreeStatusRequest {
  string worktree_path = 1;
}

message WorktreeStatus {
  bool has_changes = 1;
  repeated string staged_files = 2;
  repeated string unstaged_files = 3;
  repeated string untracked_files = 4;
}
```

#### GitService

```protobuf
// proto/git.proto
syntax = "proto3";
package emdash.v1;
option go_package = "github.com/yourusername/emdash-server/pb;pb";

service GitService {
  rpc GetStatus(GetStatusRequest) returns (GetStatusResponse);
  rpc GetDiff(GetDiffRequest) returns (GetDiffResponse);
  rpc GetLog(GetLogRequest) returns (GetLogResponse);
}

message GetStatusRequest {
  string project_path = 1;
}

message GetStatusResponse {
  string output = 1;
}

message GetDiffRequest {
  string project_path = 1;
  bool staged = 2;
}

message GetDiffResponse {
  string output = 1;
}

message GetLogRequest {
  string project_path = 1;
  int32 limit = 2;
}

message GetLogResponse {
  string output = 1;
}
```

### WebSocket 消息定义

#### PTY 消息

```json
// PTY 输出（服务端 → 客户端）
{
  "type": "pty.data",
  "id": "pty-abc123",
  "data": "$ ls -la\ntotal 48\n..."
}

// PTY 退出（服务端 → 客户端）
{
  "type": "pty.exit",
  "id": "pty-abc123",
  "exitCode": 0
}

// PTY 写入（客户端 → 服务端）
{
  "type": "pty.write",
  "id": "pty-abc123",
  "data": "echo hello\n"
}
```

#### Agent 消息

```json
// Agent 输出（服务端 → 客户端）
{
  "type": "agent.output",
  "workspaceId": "ws-xyz",
  "chunk": "Analyzing codebase...\n"
}

// Agent 错误（服务端 → 客户端）
{
  "type": "agent.error",
  "workspaceId": "ws-xyz",
  "error": "Failed to execute command"
}

// Agent 完成（服务端 → 客户端）
{
  "type": "agent.complete",
  "workspaceId": "ws-xyz",
  "exitCode": 0
}
```

### 数据库 Schema 更新

```typescript
// src/main/db/schema.ts
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

// 新增表：Remote Servers
export const remoteServers = sqliteTable('remote_servers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  url: text('url').notNull(), // wss://host:port
  token: text('token').notNull(), // Encrypted
  createdAt: text('created_at').notNull(),
  lastUsed: text('last_used'),
});

// 更新 projects 表：增加 mode 字段
export const projects = sqliteTable('projects', {
  // ... 现有字段
  mode: text('mode').default('local'), // 'local' | 'remote'
  remoteServerId: text('remote_server_id').references(() => remoteServers.id),
});
```

---

## 实施路线图

### Phase 1: 基础架构（2-3 周）

**Week 1**: 客户端抽象层 - 定义 Service 接口，重构现有代码为 `LocalService`，实现 `ServiceFactory`
**Week 2**: Golang 服务端基础 - 初始化项目，实现 gRPC + WebSocket 双服务，定义 Protobuf
**Week 3**: 远程 PTY - 服务端 PTY 管理，客户端 `RemotePtyService`，验证延迟 < 200ms

### Phase 2: 完整功能（3-4 周）

**Week 4**: 远程 Agent 管理 - 服务端 `CodexService`，流式输出推送，客户端 `RemoteCodexService`
**Week 5**: 配置管理 + UI - 设置页面，连接状态指示器，本地缓存元数据
**Week 6**: 性能优化 - PTY buffer 聚合，WebSocket 压缩，断线重连
**Week 7**: 安全认证 - JWT Token，TLS/WSS，审计日志

### Phase 3: 生产就绪（2-3 周）

**Week 8**: 部署方案 - Docker 镜像，Docker Compose，Systemd service，一键安装脚本
**Week 9**: 文档编写 - 用户指南，API 文档，部署文档，故障排查，Nginx 配置示例
**Week 10**: 测试修复 - E2E 测试，性能测试，兼容性测试，安全审计，Bug 修复

---

## 部署方案

### Docker 部署（推荐）

**Dockerfile（Golang 版本）**：
- 基于 `golang:1.21-alpine`
- 多阶段构建：编译阶段 + 运行阶段
- 安装系统依赖：git, openssh-client
- 编译生成单二进制文件
- 暴露端口：50051（gRPC）、8080（WebSocket）

**Docker Compose**：
- 服务端容器：emdash-server
- 可选 Nginx 反向代理（TLS 终止）
- 数据卷：projects、worktrees、logs
- 环境变量：AUTH_TOKEN, GRPC_PORT, WS_PORT, PROJECTS_ROOT, WORKTREES_ROOT

**启动命令**：
```bash
# 生成认证 Token
export AUTH_TOKEN=$(openssl rand -hex 32)

# 启动服务
docker-compose up -d

# 查看日志
docker-compose logs -f
```

### Systemd Service 部署

**安装脚本**：一键安装到 `/opt/emdash-server`，创建专用用户，生成 Token，注册 systemd service

**Service 文件**：`/etc/systemd/system/emdash-server.service`，支持自动重启、资源限制、安全沙箱

**管理命令**：
```bash
sudo systemctl start emdash-server
sudo systemctl status emdash-server
sudo journalctl -u emdash-server -f
```

### Nginx 反向代理

支持 TLS/WSS，配置 WebSocket 升级头，超时设置 3600s，健康检查端点。

---

## 安全设计

### 认证机制

**Phase 1 - Bearer Token（MVP）**：
- 服务端启动时生成随机 Token（`openssl rand -hex 32`）
- 所有 gRPC 和 WebSocket 连接验证 `Authorization: Bearer <token>` Header

**Phase 2 - JWT（多用户）**：
- 用户登录获得 JWT，包含 userId 和权限
- 服务端根据 JWT 隔离用户资源（projects、worktrees）

### 资源隔离

- 用户数据存储在独立目录：`/data/projects/<userId>/`、`/data/worktrees/<userId>/`
- 路径遍历攻击防护：验证所有路径在用户根目录内
- 进程隔离：每个用户的 PTY 和 Agent 进程独立管理

### 速率限制

使用 `rate-limiter-flexible` 库，默认限制：100 请求/分钟/客户端

### 审计日志

记录所有敏感操作：worktree 创建/删除、Agent 启动/停止、认证失败

---

## 测试策略

### 单元测试

- **服务端**：WorktreeService、PtyService、CodexService、GitService
- **框架**：Golang testing 包
- **覆盖率目标**：>80%

### 集成测试

- gRPC 调用测试：创建测试客户端，调用各个 RPC 方法
- WebSocket 测试：模拟连接，验证消息推送

### 端到端测试

- 客户端 ServiceFactory 测试：验证本地/远程模式切换
- 远程 Workspace 创建测试：完整流程验证
- 远程 PTY 测试：输入命令，验证输出

### 性能测试

- **延迟测试**：RPC 平均延迟 < 50ms（局域网）
- **PTY 吞吐量**：大文件输出（cat large.log）延迟 < 200ms
- **并发测试**：100 并发 RPC 请求，P95 延迟 < 100ms

---

## FAQ

### 1. 为什么选择 gRPC + WebSocket 混合方案？

**答**: 根据场景选择最合适的协议：

- **gRPC 用于请求-响应**：强类型、高性能、自动生成代码，适合 Worktree/Git 操作
- **WebSocket 用于实时推送**：低延迟、服务端主动推送，适合 PTY/Agent 流式输出
- 两者结合，发挥各自优势

### 2. 数据库应该在客户端还是服务端？

**答**: 客户端 SQLite，服务端无状态。

- 客户端存储：Projects、Workspaces、Conversations、Connections（元数据）
- 服务端只负责执行操作，不持久化元数据
- 优点：隐私优先、离线可查看历史、服务端可水平扩展

### 3. 文件编辑怎么办？

**答**: 不内置编辑器，推荐两种方案：
1. **VS Code Remote SSH**: 用户用 VS Code 连接到服务器编辑
2. **集成 Monaco Editor**（可选）: 在 Emdash UI 中嵌入轻量级编辑器

### 4. 如何处理网络断线？

**答**: 自动重连 + 状态恢复。

- 客户端检测到断线后，每 5 秒尝试重连
- 重连成功后，重新订阅 PTY/Agent 输出
- 服务端保持会话一段时间（如 5 分钟），允许恢复

### 5. 多用户如何隔离？

**答**: 通过 JWT + 文件系统路径。

- 每个用户的 projects 在 `/data/projects/<userId>/`
- 每个用户的 worktrees 在 `/data/worktrees/<userId>/`
- RPC handler 从 JWT 中提取 userId，拼接路径

### 6. 如何升级服务端？

**答**: 滚动更新 + 优雅关闭。

```bash
# Docker
docker-compose pull
docker-compose up -d  # 会自动替换容器

# Systemd
sudo systemctl stop emdash-server
sudo cp new-version/* /opt/emdash-server/
sudo systemctl start emdash-server
```

服务端在收到 SIGTERM 时：
1. 停止接受新连接
2. 等待所有 RPC 请求完成
3. 关闭所有 PTY/Agent 会话
4. 退出

### 7. 性能瓶颈在哪里？

**答**: 主要是 PTY 输出的网络传输。

优化方案：
- Buffer 聚合：每 50ms 发送一次，而不是每次 `onData` 立即发送
- 压缩：使用 WebSocket 的 `permessage-deflate` 扩展
- 限流：如果输出过快（如 `cat large-file`），限制到 1MB/s

### 8. 如何备份数据？

**答**: 服务端只需备份 worktrees 目录。

```bash
# 定时备份
0 2 * * * tar -czf /backup/worktrees-$(date +\%Y\%m\%d).tar.gz /data/worktrees

# 客户端数据库备份（自动）
Electron app 在 quit 时自动备份 emdash.db
```

---

## 附录

### A. 项目结构

```
emdash/
├── src/                          # 客户端（现有代码）
│   ├── main/
│   │   ├── services/
│   │   │   ├── abstractions/     # 新增：接口定义
│   │   │   │   ├── IWorktreeService.ts
│   │   │   │   ├── IPtyService.ts
│   │   │   │   └── ICodexService.ts
│   │   │   ├── local/            # 新增：本地实现（现有逻辑）
│   │   │   │   ├── LocalWorktreeService.ts
│   │   │   │   ├── LocalPtyService.ts
│   │   │   │   └── LocalCodexService.ts
│   │   │   ├── remote/           # 新增：远程实现
│   │   │   │   ├── RemoteClient.ts
│   │   │   │   ├── RemoteWorktreeService.ts
│   │   │   │   ├── RemotePtyService.ts
│   │   │   │   └── RemoteCodexService.ts
│   │   │   └── ServiceFactory.ts # 新增：服务工厂
│   │   └── ...
│   └── renderer/
│       └── ...
├── server/                       # 新增：服务端
│   ├── src/
│   │   ├── main.ts               # 入口
│   │   ├── config.ts             # 配置
│   │   ├── rpc/
│   │   │   └── RpcHandler.ts     # JSON-RPC 处理
│   │   ├── services/
│   │   │   ├── WorktreeService.ts
│   │   │   ├── PtyService.ts
│   │   │   ├── CodexService.ts
│   │   │   └── GitService.ts
│   │   ├── middleware/
│   │   │   ├── auth.ts
│   │   │   └── rateLimit.ts
│   │   └── lib/
│   │       ├── logger.ts
│   │       └── paths.ts
│   ├── Dockerfile
│   ├── docker-compose.yml
│   ├── package.json
│   └── tsconfig.json
├── shared/                       # 新增：共享类型
│   └── types/
│       ├── worktree.ts
│       ├── agent.ts
│       └── connection.ts
└── docs/
    └── remote-server-architecture.md  # 本文档
```

### B. 环境变量配置

#### 服务端

```bash
# server/.env.example

# Server
NODE_ENV=production
PORT=8080
HOST=0.0.0.0

# Authentication
AUTH_TOKEN=your-random-token-here
# JWT_SECRET=your-jwt-secret  # For multi-user mode

# Paths
PROJECTS_ROOT=/data/projects
WORKTREES_ROOT=/data/worktrees
LOG_DIR=/data/logs

# Logging
LOG_LEVEL=info  # debug | info | warn | error

# Performance
MAX_PTY_SESSIONS=100
MAX_AGENT_SESSIONS=10
PTY_BUFFER_MS=50
```

#### 客户端

```bash
# .env (optional, for dev)
EMDASH_MODE=remote
EMDASH_SERVER_URL=wss://localhost:8080
EMDASH_SERVER_TOKEN=your-token
```

### C. 开发命令速查

```bash
# 客户端
npm run dev              # 启动客户端开发模式
npm run type-check       # 类型检查
npm run lint             # 代码检查

# 服务端
cd server
npm run dev              # 启动服务端开发模式（nodemon + ts-node）
npm run build            # 编译 TypeScript
npm run start            # 启动生产模式
npm run test             # 运行测试
npm run test:watch       # 监听模式运行测试

# Docker
docker-compose up -d     # 启动服务
docker-compose logs -f   # 查看日志
docker-compose down      # 停止服务

# 测试远程连接
wscat -c wss://localhost:8080 -H "Authorization: Bearer your-token"
```

---

---

## 技术栈对比

### Golang + gRPC vs Node.js + JSON-RPC

| 维度 | Node.js + JSON-RPC | Golang + gRPC | 选择理由 |
|-----|-------------------|---------------|---------|
| **性能** | 中等（单线程事件循环） | 高（goroutine 并发） | ✅ Golang 3-5x 性能提升 |
| **类型安全** | TypeScript（编译时） | Protobuf（强类型，跨语言） | ✅ gRPC 自动生成代码，零手写错误 |
| **部署** | 需要 Node.js 运行时 | 单二进制文件 | ✅ Golang 部署极简 |
| **资源占用** | ~50MB+ | ~10MB | ✅ Golang 内存占用小 80% |
| **并发模型** | 回调/Promise | Goroutine + Channel | ✅ Golang 更直观 |
| **生态** | npm 生态丰富 | Go 生态成熟 | 平手 |
| **学习曲线** | 前端友好 | 需学习 Go 语法 | ⚠️ 有学习成本（1-2周） |

### 快速开始

**初始化项目**：
```bash
mkdir emdash-server && cd emdash-server
go mod init github.com/yourusername/emdash-server
go get google.golang.org/grpc@latest
go get github.com/gorilla/websocket@latest
go get github.com/creack/pty@latest
```

**定义 Protobuf**：参见"接口定义"章节

**生成代码**：
```bash
protoc --go_out=. --go-grpc_out=. proto/*.proto
```

**参考资源**：
- [gRPC Go Quick Start](https://grpc.io/docs/languages/go/quickstart/)
- [Protocol Buffers Guide](https://protobuf.dev/)
- [Gorilla WebSocket](https://github.com/gorilla/websocket)
- [creack/pty](https://github.com/creack/pty)

---

## 总结

本文档提供了 Emdash 远程服务端的完整架构设计（Golang + gRPC 版本），包括：

1. ✅ **清晰的架构**：客户端-服务端分离，gRPC 处理 RPC，WebSocket 处理流式数据
2. ✅ **最小化改动**：通过抽象层实现，不破坏现有代码
3. ✅ **高性能技术栈**：Golang + gRPC，单二进制部署，低资源占用
4. ✅ **强类型接口**：Protocol Buffers 定义，自动生成客户端和服务端代码
5. ✅ **生产级部署方案**：Docker、Systemd、Nginx、安全加固
6. ✅ **完整实施路线**：分 3 个阶段，每个阶段 2-4 周

**下一步行动**：

1. **学习 Golang 基础**（如需要，1-2 周）
   - Go 语法、goroutine、channel
   - gRPC 和 Protocol Buffers
   - 推荐资源：[Go by Example](https://gobyexample.com/)、[gRPC官方教程](https://grpc.io/docs/languages/go/quickstart/)

2. **创建服务端项目**（1 周）
   - 初始化 Go module
   - 定义 Protobuf 接口
   - 实现第一个 gRPC Service（WorktreeService）
   - 搭建 WebSocket 基础框架

3. **客户端适配**（1-2 周）
   - 实现 Service 抽象层（接口定义）
   - 生成 TypeScript gRPC 客户端代码
   - 实现 RemoteWorktreeService
   - 测试 gRPC 调用

4. **PTY 流式传输**（1 周）
   - 服务端 PTY 管理（使用 `creack/pty`）
   - WebSocket 推送 PTY 输出
   - 客户端 RemotePtyService
   - 测试远程终端

5. **Agent 管理**（1-2 周）
   - 服务端 Agent 进程管理
   - 流式输出推送
   - 客户端 RemoteCodexService

6. **完善和优化**（2-3 周）
   - 性能优化（buffer 聚合、并发控制）
   - 安全加固（TLS、JWT）
   - 错误处理和断线重连
   - 完整测试

**预计开发时间**：
- **有 Golang 经验**：7-9 周（单人全职）
- **学习 Golang**：9-12 周（单人全职）

**技术栈优势**：
- ✅ 性能提升 3-5 倍（vs Node.js）
- ✅ 内存占用降低 80%
- ✅ 单二进制部署，无运行时依赖
- ✅ 强类型保证，编译期检查错误

**维护成本**：低（架构清晰，类型安全，Golang 易维护）

---

**文档维护**: 请在实施过程中持续更新本文档，记录重要的设计决策和变更。

**参考资源**：
- [gRPC Go Quick Start](https://grpc.io/docs/languages/go/quickstart/)
- [Protocol Buffers](https://protobuf.dev/)
- [Gorilla WebSocket](https://github.com/gorilla/websocket)
- [creack/pty](https://github.com/creack/pty)
- [@grpc/grpc-js](https://www.npmjs.com/package/@grpc/grpc-js) (Node.js gRPC 客户端)
- [ts-proto](https://github.com/stephenh/ts-proto) (TypeScript Protobuf 生成器)
