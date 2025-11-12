# Emdash 远程服务端开发排期

> **版本**: v1.0
> **创建日期**: 2025-11-10
> **项目周期**: 7-10 周（单人全职）
> **技术栈**: Golang 1.21+ + gRPC + WebSocket + TypeScript
> **参考文档**: [remote-server-architecture.md](./remote-server-architecture.md)

---

## 目录

1. [项目概述](#项目概述)
2. [总体时间线](#总体时间线)
3. [Phase 1: 基础架构](#phase-1-基础架构)
4. [Phase 2: 完整功能](#phase-2-完整功能)
5. [Phase 3: 生产就绪](#phase-3-生产就绪)
6. [风险评估与应对](#风险评估与应对)
7. [资源需求](#资源需求)
8. [里程碑与交付物](#里程碑与交付物)
9. [质量标准](#质量标准)

---

## 项目概述

### 核心目标

引入 **客户端-服务端架构**，在不破坏现有本地功能的前提下，新增远程服务端模式：

- ✅ **双模式支持**: 本地模式（保持原样）+ 远程模式（新增）
- ✅ **高性能**: 远程 PTY 延迟 < 100ms，Agent 流式输出流畅
- ✅ **易部署**: Docker 镜像、Systemd service、一键安装
- ✅ **架构清晰**: 客户端/服务端职责分离，最小化 fork 冲突

### 技术栈

| 组件 | 技术选型 |
|-----|---------|
| 服务端运行时 | Golang 1.21+ |
| RPC 框架 | gRPC + Protocol Buffers |
| 实时推送 | WebSocket (gorilla/websocket) |
| PTY | creack/pty |
| 客户端 RPC | @grpc/grpc-js + ts-proto |
| 客户端 WS | ws 库 |

### 开发模式

- **有 Golang 经验**: 7-9 周
- **学习 Golang**: 9-12 周（包含 1-2 周学习期）

---

## 总体时间线

```
Week 1-3   │ Phase 1: 基础架构
           │ ├─ 客户端抽象层
           │ ├─ Golang 服务端基础
           │ └─ 远程 PTY 功能
           │
Week 4-7   │ Phase 2: 完整功能
           │ ├─ 远程 Agent 管理
           │ ├─ 配置管理 + UI
           │ ├─ 性能优化
           │ └─ 安全认证
           │
Week 8-10  │ Phase 3: 生产就绪
           │ ├─ 部署方案
           │ ├─ 文档编写
           │ └─ 测试修复
```

---

## Phase 1: 基础架构

**目标**: 搭建核心架构，实现远程 PTY 功能
**周期**: 2-3 周
**关键产出**: 可运行的远程 PTY Demo

### Week 1: 客户端抽象层 ✅

#### 任务 1.1: Service 接口定义 ✅
**工时**: 2 天
**负责**: 客户端架构
**依赖**: 无

**任务描述**:
1. 创建 `src/main/services/abstractions/` 目录
2. 定义核心接口:
   - `IWorktreeService.ts` - Worktree 创建、列表、删除、状态
   - `IPtyService.ts` - PTY 启动、写入、调整尺寸、关闭
   - `ICodexService.ts` - Agent 创建、流式消息、停止、状态
   - `IGitService.ts` - Git 状态、diff、log

**交付物**:
- TypeScript 接口文件 (4 个)
- 接口方法签名包含完整类型注解
- JSDoc 文档注释

**验收标准**:
- [x] `npm run type-check` 通过
- [x] 所有方法包含返回值类型（Promise）
- [x] 参数类型明确（不使用 `any`）

---

#### 任务 1.2: 本地实现重构 ✅
**工时**: 3 天
**负责**: 客户端架构
**依赖**: 任务 1.1

**任务描述**:
1. 创建 `src/main/services/local/` 目录
2. 重构现有代码为 Local 实现类:
   - `LocalWorktreeService.ts` - 封装 `src/main/services/WorktreeService.ts`
   - `LocalPtyService.ts` - 封装 `src/main/services/ptyManager.ts`
   - `LocalCodexService.ts` - 封装 `src/main/services/CodexService.ts`
   - `LocalGitService.ts` - 封装 `src/main/services/GitService.ts`
3. 实现接口，保持现有逻辑不变

**交付物**:
- Local 实现类 (4 个)
- 单元测试覆盖核心方法

**验收标准**:
- [x] 所有实现类通过接口类型检查
- [x] 现有 IPC 调用逻辑不变（兼容性测试）
- [x] 单元测试覆盖率 > 70%

---

#### 任务 1.3: ServiceFactory 实现 ✅
**工时**: 1 天
**负责**: 客户端架构
**依赖**: 任务 1.2

**任务描述**:
1. 创建 `src/main/services/ServiceFactory.ts`
2. 实现工厂模式:
   ```typescript
   class ServiceFactory {
     private mode: 'local' | 'remote';

     getWorktreeService(): IWorktreeService {
       return this.mode === 'local'
         ? new LocalWorktreeService()
         : new RemoteWorktreeService();
     }

     // ... 其他服务的 getter
   }
   ```
3. 修改所有 IPC Handler，改为通过工厂获取服务

**交付物**:
- `ServiceFactory.ts`
- IPC Handler 重构（`src/main/ipc/*.ts`）

**验收标准**:
- [x] 工厂可根据配置切换模式
- [x] 所有 IPC 调用通过工厂获取服务
- [x] `npm run dev` 启动正常，功能不受影响

---

### Week 2: Golang 服务端基础 ✅

#### 任务 2.1: 项目初始化 ✅
**工时**: 1 天
**负责**: 服务端架构
**依赖**: 无

**任务描述**:
1. 创建 `server/` 目录
2. 初始化 Go module:
   ```bash
   go mod init github.com/yourusername/emdash-server
   ```
3. 安装依赖:
   ```bash
   go get google.golang.org/grpc@latest
   go get google.golang.org/protobuf@latest
   go get github.com/gorilla/websocket@latest
   go get github.com/creack/pty@latest
   go get go.uber.org/zap@latest
   ```
4. 创建目录结构:
   ```
   server/
   ├── cmd/server/main.go
   ├── internal/
   │   ├── config/
   │   ├── services/
   │   ├── grpc/
   │   ├── ws/
   │   └── logger/
   ├── proto/
   └── go.mod
   ```

**交付物**:
- Go 项目结构
- `go.mod` 和 `go.sum`
- `Makefile` (包含 build、test、proto 等命令)

**验收标准**:
- [x] `go build ./cmd/server` 成功编译
- [x] 项目结构符合 Go 最佳实践

---

#### 任务 2.2: Protobuf 定义与代码生成 ✅
**工时**: 2 天
**负责**: 服务端架构
**依赖**: 任务 2.1

**任务描述**:
1. 定义 Protobuf 文件:
   - `proto/worktree.proto` - WorktreeService 定义
   - `proto/git.proto` - GitService 定义
2. 生成 Go 代码:
   ```bash
   protoc --go_out=. --go-grpc_out=. proto/*.proto
   ```
3. 生成 TypeScript 代码 (客户端使用):
   ```bash
   protoc --plugin=protoc-gen-ts_proto=./node_modules/.bin/protoc-gen-ts_proto \
          --ts_proto_out=./src/main/services/remote/generated \
          proto/*.proto
   ```

**交付物**:
- Protobuf 定义 (2 个)
- 生成的 Go 代码 (`pb/*.pb.go`)
- 生成的 TypeScript 代码 (`*.ts`)
- 生成脚本 (`scripts/gen-proto.sh`)

**验收标准**:
- [x] Protobuf 编译无错误
- [x] Go 代码符合 gRPC 规范
- [x] TypeScript 代码类型完整

---

#### 任务 2.3: gRPC Server 实现 ✅
**工时**: 2 天
**负责**: 服务端架构
**依赖**: 任务 2.2

**任务描述**:
1. 实现 gRPC 服务器:
   ```go
   // internal/grpc/server.go
   func NewGRPCServer(config *config.Config) *grpc.Server {
     s := grpc.NewServer(
       grpc.UnaryInterceptor(authInterceptor),
     )
     pb.RegisterWorktreeServiceServer(s, &worktreeServer{})
     pb.RegisterGitServiceServer(s, &gitServer{})
     return s
   }
   ```
2. 实现空方法（返回未实现错误）
3. 启动服务器（端口 50051）

**交付物**:
- `internal/grpc/server.go`
- 服务端骨架代码

**验收标准**:
- [x] 服务器启动无错误
- [x] gRPC 反射可访问服务
- [x] 使用 `grpcurl` 可列出服务

---

#### 任务 2.4: WebSocket Server 实现 ✅
**工时**: 2 天
**负责**: 服务端架构
**依赖**: 任务 2.1

**任务描述**:
1. 实现 WebSocket 服务器:
   ```go
   // internal/ws/server.go
   func NewWebSocketServer(config *config.Config) *http.Server {
     mux := http.NewServeMux()
     mux.HandleFunc("/ws", handleWebSocket)
     return &http.Server{Addr: ":8080", Handler: mux}
   }
   ```
2. 实现连接管理:
   - 连接建立时验证 JWT Token
   - 维护 `map[connID]*websocket.Conn`
   - 连接断开时清理资源
3. 实现消息路由（根据 `type` 字段分发）

**交付物**:
- `internal/ws/server.go`
- `internal/ws/manager.go` (连接管理)

**验收标准**:
- [x] WebSocket 服务器启动成功
- [x] 使用 `wscat` 可连接
- [x] 消息 JSON 解析正确

---

### Week 3: 远程 PTY 功能 ✅

#### 任务 3.1: 服务端 PTY Service ✅
**工时**: 3 天
**负责**: 服务端开发
**依赖**: 任务 2.4

**任务描述**:
1. 实现 `internal/services/pty_service.go`:
   ```go
   type PtyService struct {
     sessions map[string]*ptySession
     mu       sync.RWMutex
   }

   func (s *PtyService) Start(shell string, cwd string) (string, error)
   func (s *PtyService) Write(id string, data []byte) error
   func (s *PtyService) Resize(id string, rows, cols uint16) error
   func (s *PtyService) Kill(id string) error
   ```
2. 使用 `creack/pty` 创建 PTY 进程
3. 监听 PTY 输出，通过 WebSocket 推送
4. 会话清理机制（超时 5 分钟无活动则关闭）

**交付物**:
- `internal/services/pty_service.go`
- PTY 会话管理逻辑
- 单元测试

**验收标准**:
- [x] PTY 进程启动成功
- [x] PTY 输出实时推送
- [x] 会话在无活动后自动清理
- [x] 无内存泄漏（使用 `go test -memprofile` 验证）

---

#### 任务 3.2: 客户端 Remote PTY Service ✅
**工时**: 2 天
**负责**: 客户端开发
**依赖**: 任务 1.3, 任务 3.1

**任务描述**:
1. 实现 `src/main/services/remote/RemotePtyService.ts`:
   ```typescript
   class RemotePtyService implements IPtyService {
     constructor(private client: RemoteClient) {}

     async startPty(shell: string, cwd: string): Promise<string> {
       const msg = { type: 'pty.start', shell, cwd };
       const response = await this.client.send(msg);
       return response.id;
     }

     writePty(id: string, data: string): void {
       this.client.send({ type: 'pty.write', id, data });
     }

     // ... 其他方法
   }
   ```
2. 实现 `src/main/services/remote/RemoteClient.ts`:
   - WebSocket 连接管理
   - 消息序列化/反序列化
   - 事件分发（`pty.data` → EventEmitter）
   - 自动重连（5 秒间隔）

**交付物**:
- `RemotePtyService.ts`
- `RemoteClient.ts`
- IPC Handler 更新（支持远程模式）

**验收标准**:
- [x] 远程 PTY 可正常启动
- [x] 输入输出双向传输正常
- [x] 断线后自动重连

---

#### 任务 3.3: 端到端测试 ✅
**工时**: 2 天
**负责**: QA + 全栈
**依赖**: 任务 3.2

**任务描述**:
1. 编写集成测试:
   - 启动服务端（测试模式）
   - 启动客户端（远程模式）
   - 创建 PTY 会话
   - 执行命令（`echo hello`）
   - 验证输出
2. 性能测试:
   - 测量 PTY 延迟（输入 → 输出）
   - 目标: 局域网 < 100ms，广域网 < 200ms
3. 压力测试:
   - 同时创建 50 个 PTY 会话
   - 验证无崩溃、无内存泄漏

**交付物**:
- 集成测试脚本 (`tests/e2e/remote-pty.test.ts`)
- 性能测试报告
- 压力测试报告

**验收标准**:
- [x] 集成测试通过率 100%
- [x] PTY 延迟达标
- [x] 50 并发会话稳定运行

---

## Phase 2: 完整功能

**目标**: 实现完整的远程服务端功能
**周期**: 3-4 周
**关键产出**: 功能完整的远程服务端

### Week 4: 远程 Agent 管理 ✅

#### 任务 4.1: 服务端 Codex Service ✅
**工时**: 3 天
**负责**: 服务端开发
**依赖**: Phase 1 完成

**任务描述**:
1. 实现 `internal/services/codex_service.go`:
   ```go
   type CodexService struct {
     agents map[string]*agentSession
     mu     sync.RWMutex
   }

   func (s *CodexService) Start(workspaceId, provider string, args []string) error
   func (s *CodexService) SendMessage(workspaceId, message string) error
   func (s *CodexService) Stop(workspaceId string) error
   ```
2. 使用 `os/exec` 启动 Agent CLI 进程（codex、claude 等）
3. 监听 stdout/stderr，流式推送到 WebSocket
4. 进程生命周期管理（超时 1 小时自动停止）

**交付物**:
- `internal/services/codex_service.go`
- Agent 会话管理逻辑
- 单元测试

**验收标准**:
- [x] Agent 进程启动成功
- [x] 流式输出实时推送
- [x] 进程异常退出可捕获
- [x] 无僵尸进程

---

#### 任务 4.2: WorktreeService 完整实现 ✅
**工时**: 2 天
**负责**: 服务端开发
**依赖**: 任务 2.2

**任务描述**:
1. 实现 `internal/services/worktree_service.go`:
   ```go
   func (s *WorktreeService) CreateWorktree(req *pb.CreateWorktreeRequest) (*pb.WorktreeInfo, error) {
     // git worktree add -b <branch> <path>
   }

   func (s *WorktreeService) ListWorktrees(req *pb.ListWorktreesRequest) (*pb.ListWorktreesResponse, error) {
     // git worktree list --porcelain
   }

   func (s *WorktreeService) RemoveWorktree(req *pb.RemoveWorktreeRequest) (*pb.RemoveWorktreeResponse, error) {
     // git worktree remove <path>
   }
   ```
2. 解析 Git 命令输出
3. 错误处理（worktree 已存在、路径无效等）

**交付物**:
- `worktree_service.go`
- Git 命令包装器
- 单元测试

**验收标准**:
- [x] Worktree 创建/删除成功
- [x] 错误场景正确处理
- [x] Git 输出解析准确

---

#### 任务 4.3: 客户端 Remote Agent Service ✅
**工时**: 2 天
**负责**: 客户端开发
**依赖**: 任务 4.1

**任务描述**:
1. 实现 `src/main/services/remote/RemoteCodexService.ts`:
   ```typescript
   class RemoteCodexService implements ICodexService {
     async sendMessageStream(
       workspaceId: string,
       message: string,
       onChunk: (chunk: string) => void
     ): Promise<void> {
       this.client.send({ type: 'agent.start', workspaceId, message });
       this.client.on(`agent.output.${workspaceId}`, onChunk);
     }
   }
   ```
2. 实现 `RemoteWorktreeService.ts`（调用 gRPC）
3. 更新 IPC Handler 支持远程模式

**交付物**:
- `RemoteCodexService.ts`
- `RemoteWorktreeService.ts`
- IPC Handler 更新

**验收标准**:
- [x] 远程 Agent 可正常启动
- [x] 流式输出实时显示在 UI
- [x] Worktree 创建/删除通过 gRPC 调用成功

---

### Week 5: 配置管理 + UI

#### 任务 5.1: 数据库 Schema 更新
**工时**: 1 天
**负责**: 客户端架构
**依赖**: 无

**任务描述**:
1. 更新 `src/main/db/schema.ts`:
   ```typescript
   export const remoteServers = sqliteTable('remote_servers', {
     id: text('id').primaryKey(),
     name: text('name').notNull(),
     grpcUrl: text('grpc_url').notNull(), // grpc://host:50051
     wsUrl: text('ws_url').notNull(),     // wss://host:8080
     token: text('token').notNull(),      // Encrypted
     createdAt: text('created_at').notNull(),
     lastUsed: text('last_used'),
   });

   export const projects = sqliteTable('projects', {
     // ... 现有字段
     mode: text('mode').default('local'), // 'local' | 'remote'
     remoteServerId: text('remote_server_id').references(() => remoteServers.id),
   });
   ```
2. 生成数据库迁移:
   ```bash
   npx drizzle-kit generate
   ```

**交付物**:
- Schema 更新
- 数据库迁移文件

**验收标准**:
- [ ] 迁移成功应用
- [ ] 现有数据不受影响

---

#### 任务 5.2: 设置页面 - 服务器管理
**工时**: 3 天
**负责**: 前端开发
**依赖**: 任务 5.1

**任务描述**:
1. 新增设置页面 "Remote Servers"
2. 实现功能:
   - 添加服务器（名称、gRPC URL、WS URL、Token）
   - 测试连接（调用 Health Check）
   - 编辑/删除服务器
   - 查看连接状态（在线/离线）
3. UI 组件:
   - 服务器列表（Card 布局）
   - 添加服务器表单（Dialog）
   - 连接状态指示器（Badge: 绿色/灰色）

**交付物**:
- `src/renderer/components/RemoteServerSettings.tsx`
- IPC Handler: `remote-server:add`, `remote-server:test`, etc.

**验收标准**:
- [ ] 可添加/编辑/删除服务器
- [ ] 连接测试可显示结果
- [ ] UI 符合设计规范

---

#### 任务 5.3: 项目配置 - 模式选择
**工时**: 2 天
**负责**: 前端开发
**依赖**: 任务 5.2

**任务描述**:
1. 更新项目创建/编辑流程
2. 新增字段:
   - Mode: `local` | `remote` (Radio 选择)
   - Remote Server: 下拉选择（仅 remote 模式显示）
3. 运行时根据 Project 配置切换 ServiceFactory 模式

**交付物**:
- 项目配置 UI 更新
- ServiceFactory 模式切换逻辑

**验收标准**:
- [ ] 创建项目时可选择模式
- [ ] Remote 模式下 Agent 调用远程服务端
- [ ] 模式切换无需重启应用

---

### Week 6: 性能优化

#### 任务 6.1: PTY Buffer 聚合
**工时**: 2 天
**负责**: 服务端开发
**依赖**: 任务 3.1

**任务描述**:
1. 优化 PTY 输出推送:
   - 不直接转发每次 `onData` 事件
   - 聚合 50ms 内的输出
   - 批量发送（减少 WebSocket 消息数量）
2. 实现逻辑:
   ```go
   type ptySession struct {
     buffer []byte
     timer  *time.Timer
   }

   func (s *ptySession) onData(data []byte) {
     s.buffer = append(s.buffer, data...)
     s.timer.Reset(50 * time.Millisecond)
   }

   func (s *ptySession) flush() {
     wss.Send(s.connID, s.buffer)
     s.buffer = s.buffer[:0]
   }
   ```

**交付物**:
- PTY buffer 聚合实现
- 性能对比测试

**验收标准**:
- [ ] WebSocket 消息数量减少 > 50%
- [ ] 延迟 < 100ms（聚合不影响用户体验）

---

#### 任务 6.2: WebSocket 压缩
**工时**: 1 天
**负责**: 服务端开发
**依赖**: 任务 2.4

**任务描述**:
1. 启用 WebSocket 压缩扩展:
   ```go
   upgrader := websocket.Upgrader{
     EnableCompression: true,
   }
   ```
2. 客户端启用压缩:
   ```typescript
   const ws = new WebSocket(url, {
     perMessageDeflate: true,
   });
   ```

**交付物**:
- 压缩配置
- 带宽测试报告

**验收标准**:
- [ ] 带宽占用减少 > 30%（文本输出）
- [ ] CPU 占用增加 < 10%

---

#### 任务 6.3: 断线重连优化
**工时**: 2 天
**负责**: 客户端开发
**依赖**: 任务 3.2

**任务描述**:
1. 实现指数退避重连:
   ```typescript
   class RemoteClient {
     private reconnectDelay = 1000;

     private reconnect() {
       setTimeout(() => {
         this.connect();
         this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
       }, this.reconnectDelay);
     }
   }
   ```
2. 重连成功后:
   - 重新订阅 PTY 会话
   - 恢复 Agent 会话（如果服务端仍保持）
3. 显示重连状态（Toast 提示）

**交付物**:
- 重连逻辑优化
- UI 状态提示

**验收标准**:
- [ ] 断线后自动重连
- [ ] 重连成功后会话恢复
- [ ] 用户感知延迟 < 5 秒

---

### Week 7: 安全认证

#### 任务 7.1: JWT Token 认证
**工时**: 2 天
**负责**: 服务端开发
**依赖**: 任务 2.3, 2.4

**任务描述**:
1. 实现 JWT 认证:
   ```go
   // internal/auth/jwt.go
   func GenerateToken(userId string) (string, error) {
     claims := jwt.MapClaims{
       "userId": userId,
       "exp":    time.Now().Add(24 * time.Hour).Unix(),
     }
     token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
     return token.SignedString([]byte(jwtSecret))
   }

   func VerifyToken(tokenString string) (string, error) {
     // 解析并验证 Token
   }
   ```
2. gRPC Interceptor:
   ```go
   func authInterceptor(ctx context.Context, req interface{}, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (interface{}, error) {
     md, _ := metadata.FromIncomingContext(ctx)
     token := md.Get("authorization")[0]
     userId, err := auth.VerifyToken(token)
     if err != nil {
       return nil, status.Errorf(codes.Unauthenticated, "invalid token")
     }
     ctx = context.WithValue(ctx, "userId", userId)
     return handler(ctx, req)
   }
   ```
3. WebSocket 认证:
   - 连接建立时验证 `Authorization` Header
   - 验证失败则关闭连接

**交付物**:
- `internal/auth/jwt.go`
- gRPC/WebSocket 认证中间件

**验收标准**:
- [ ] 无效 Token 请求被拒绝
- [ ] Token 过期后自动刷新
- [ ] 单元测试覆盖认证逻辑

---

#### 任务 7.2: TLS/WSS 支持
**工时**: 2 天
**负责**: 服务端开发 + DevOps
**依赖**: 任务 7.1

**任务描述**:
1. gRPC TLS:
   ```go
   creds, _ := credentials.NewServerTLSFromFile("cert.pem", "key.pem")
   s := grpc.NewServer(grpc.Creds(creds))
   ```
2. WebSocket TLS:
   ```go
   http.ListenAndServeTLS(":8080", "cert.pem", "key.pem", handler)
   ```
3. 自签名证书生成脚本（开发用）
4. Let's Encrypt 证书配置文档（生产用）

**交付物**:
- TLS 配置代码
- 证书生成脚本 (`scripts/gen-cert.sh`)
- Nginx 反向代理配置示例

**验收标准**:
- [ ] gRPC 和 WebSocket 均支持 TLS
- [ ] 自签名证书本地测试成功
- [ ] 文档包含 Let's Encrypt 配置指南

---

#### 任务 7.3: 审计日志
**工时**: 1 天
**负责**: 服务端开发
**依赖**: 任务 7.1

**任务描述**:
1. 实现审计日志:
   ```go
   // internal/logger/audit.go
   func LogAudit(userId, action, resource string, success bool) {
     logger.Info("audit",
       zap.String("userId", userId),
       zap.String("action", action),
       zap.String("resource", resource),
       zap.Bool("success", success),
       zap.Time("timestamp", time.Now()),
     )
   }
   ```
2. 记录操作:
   - Worktree 创建/删除
   - Agent 启动/停止
   - 认证失败

**交付物**:
- 审计日志模块
- 日志格式文档

**验收标准**:
- [ ] 敏感操作均有日志记录
- [ ] 日志包含 userId、timestamp、action
- [ ] 日志可导出为 JSON 格式

---

## Phase 3: 生产就绪

**目标**: 完善部署方案、文档、测试
**周期**: 2-3 周
**关键产出**: 可生产部署的完整系统

### Week 8: 部署方案

#### 任务 8.1: Docker 镜像
**工时**: 2 天
**负责**: DevOps
**依赖**: Phase 2 完成

**任务描述**:
1. 编写 `server/Dockerfile`:
   ```dockerfile
   # Build stage
   FROM golang:1.21-alpine AS builder
   WORKDIR /app
   COPY go.mod go.sum ./
   RUN go mod download
   COPY . .
   RUN CGO_ENABLED=0 go build -o server ./cmd/server

   # Run stage
   FROM alpine:latest
   RUN apk add --no-cache git openssh-client ca-certificates
   WORKDIR /app
   COPY --from=builder /app/server .
   EXPOSE 50051 8080
   CMD ["./server"]
   ```
2. 优化镜像大小（多阶段构建）
3. 推送到 Docker Hub

**交付物**:
- `Dockerfile`
- 镜像构建脚本
- Docker Hub 镜像 (< 50MB)

**验收标准**:
- [ ] 镜像构建成功
- [ ] 容器启动正常
- [ ] 镜像大小 < 50MB

---

#### 任务 8.2: Docker Compose 配置
**工时**: 1 天
**负责**: DevOps
**依赖**: 任务 8.1

**任务描述**:
1. 编写 `docker-compose.yml`:
   ```yaml
   version: '3.8'
   services:
     emdash-server:
       image: emdash/server:latest
       ports:
         - "50051:50051"
         - "8080:8080"
       volumes:
         - ./data/projects:/data/projects
         - ./data/worktrees:/data/worktrees
         - ./data/logs:/data/logs
       environment:
         - AUTH_TOKEN=${AUTH_TOKEN}
         - GRPC_PORT=50051
         - WS_PORT=8080
         - PROJECTS_ROOT=/data/projects
         - WORKTREES_ROOT=/data/worktrees
   ```
2. 启动脚本:
   ```bash
   #!/bin/bash
   export AUTH_TOKEN=$(openssl rand -hex 32)
   echo "AUTH_TOKEN: $AUTH_TOKEN"
   docker-compose up -d
   ```

**交付物**:
- `docker-compose.yml`
- 启动脚本 (`scripts/docker-start.sh`)

**验收标准**:
- [ ] `docker-compose up -d` 启动成功
- [ ] 数据持久化（重启后数据不丢失）

---

#### 任务 8.3: Systemd Service
**工时**: 1 天
**负责**: DevOps
**依赖**: Phase 2 完成

**任务描述**:
1. 一键安装脚本 `scripts/install.sh`:
   ```bash
   #!/bin/bash
   # 下载二进制
   wget https://github.com/.../emdash-server-linux-amd64 -O /opt/emdash-server/server

   # 创建专用用户
   useradd -r -s /bin/false emdash

   # 生成 Token
   TOKEN=$(openssl rand -hex 32)
   echo "AUTH_TOKEN=$TOKEN" > /etc/emdash-server/config.env

   # 注册 systemd service
   cp emdash-server.service /etc/systemd/system/
   systemctl enable emdash-server
   systemctl start emdash-server
   ```
2. Systemd service 文件:
   ```ini
   [Unit]
   Description=Emdash Remote Server
   After=network.target

   [Service]
   Type=simple
   User=emdash
   WorkingDirectory=/opt/emdash-server
   EnvironmentFile=/etc/emdash-server/config.env
   ExecStart=/opt/emdash-server/server
   Restart=always

   [Install]
   WantedBy=multi-user.target
   ```

**交付物**:
- `scripts/install.sh`
- `emdash-server.service`

**验收标准**:
- [ ] 安装脚本执行成功
- [ ] 服务自动启动
- [ ] 崩溃后自动重启

---

#### 任务 8.4: Nginx 反向代理配置
**工时**: 1 天
**负责**: DevOps
**依赖**: 任务 7.2

**任务描述**:
1. 编写 Nginx 配置 `docs/nginx.conf`:
   ```nginx
   upstream grpc_backend {
     server localhost:50051;
   }

   upstream ws_backend {
     server localhost:8080;
   }

   server {
     listen 443 ssl http2;
     server_name emdash.example.com;

     ssl_certificate /etc/letsencrypt/live/emdash.example.com/fullchain.pem;
     ssl_certificate_key /etc/letsencrypt/live/emdash.example.com/privkey.pem;

     location /grpc {
       grpc_pass grpc://grpc_backend;
     }

     location /ws {
       proxy_pass http://ws_backend;
       proxy_http_version 1.1;
       proxy_set_header Upgrade $http_upgrade;
       proxy_set_header Connection "upgrade";
       proxy_read_timeout 3600s;
     }
   }
   ```

**交付物**:
- Nginx 配置示例
- Let's Encrypt 自动续签脚本

**验收标准**:
- [ ] gRPC 和 WebSocket 均可通过 Nginx 访问
- [ ] TLS 终止在 Nginx
- [ ] 健康检查正常

---

### Week 9: 文档编写

#### 任务 9.1: 用户指南
**工时**: 2 天
**负责**: 技术写作
**依赖**: Phase 2 完成

**任务描述**:
编写 `docs/user-guide.md`，包含：
1. **快速开始**:
   - 服务端部署（Docker / Systemd）
   - 客户端配置（添加远程服务器）
   - 创建远程项目
2. **功能说明**:
   - 远程 Workspace 管理
   - 远程 Terminal 使用
   - Agent 远程执行
3. **故障排查**:
   - 连接失败
   - PTY 延迟高
   - Agent 无输出

**交付物**:
- `docs/user-guide.md`
- 截图/GIF 演示

**验收标准**:
- [ ] 新用户可按文档完成部署
- [ ] 常见问题有解决方案

---

#### 任务 9.2: API 文档
**工时**: 1 天
**负责**: 技术写作
**依赖**: Phase 2 完成

**任务描述**:
编写 `docs/api.md`，包含：
1. **gRPC API**:
   - 所有 RPC 方法签名
   - 请求/响应示例
   - 错误码说明
2. **WebSocket API**:
   - 消息类型定义
   - 事件流图
   - 示例代码

**交付物**:
- `docs/api.md`
- Protobuf 文档（自动生成）

**验收标准**:
- [ ] 所有 API 有文档覆盖
- [ ] 示例代码可运行

---

#### 任务 9.3: 部署文档
**工时**: 1 天
**负责**: DevOps + 技术写作
**依赖**: Week 8 完成

**任务描述**:
编写 `docs/deployment.md`，包含：
1. **系统要求**:
   - Linux (Ubuntu 20.04+)
   - Docker (可选)
   - 端口开放 (50051, 8080)
2. **部署方式**:
   - Docker Compose (推荐)
   - Systemd Service
   - 手动运行
3. **安全加固**:
   - TLS 配置
   - Firewall 规则
   - Token 管理
4. **升级与备份**:
   - 滚动更新
   - 数据备份

**交付物**:
- `docs/deployment.md`

**验收标准**:
- [ ] 涵盖所有部署方式
- [ ] 安全最佳实践完整

---

### Week 10: 测试修复

#### 任务 10.1: 端到端测试
**工时**: 2 天
**负责**: QA
**依赖**: Phase 2 完成

**任务描述**:
1. 编写 E2E 测试套件:
   - 远程项目创建
   - 远程 Workspace 创建
   - 远程 Terminal 操作
   - 远程 Agent 执行
   - 断线重连
2. 使用 Playwright 自动化测试

**交付物**:
- `tests/e2e/remote-server.spec.ts`
- 测试报告

**验收标准**:
- [ ] 测试覆盖所有核心流程
- [ ] 通过率 > 95%

---

#### 任务 10.2: 性能测试
**工时**: 2 天
**负责**: QA + 后端
**依赖**: Week 6 完成

**任务描述**:
1. PTY 延迟测试:
   - 输入命令 → 输出显示延迟
   - 局域网 < 50ms，广域网 < 100ms
2. gRPC 吞吐量测试:
   - 100 并发请求，P95 延迟 < 100ms
3. Agent 流式输出测试:
   - 大文件输出（10MB）无丢失
4. 并发压力测试:
   - 100 并发 PTY 会话
   - 10 并发 Agent 会话

**交付物**:
- 性能测试脚本
- 性能测试报告

**验收标准**:
- [ ] 所有指标达标
- [ ] 无内存泄漏

---

#### 任务 10.3: 安全审计
**工时**: 1 天
**负责**: 安全工程师
**依赖**: Week 7 完成

**任务描述**:
1. 代码审计:
   - 检查 SQL 注入风险（虽然无 DB，但检查路径遍历）
   - 检查命令注入风险（`os/exec` 使用）
   - 检查敏感信息泄漏（日志、错误消息）
2. 渗透测试:
   - 尝试绕过认证
   - 尝试访问其他用户资源
   - DoS 攻击测试（速率限制）

**交付物**:
- 安全审计报告
- 漏洞修复列表

**验收标准**:
- [ ] 无高危漏洞
- [ ] 中危漏洞已修复或有缓解措施

---

#### 任务 10.4: Bug 修复与优化
**工时**: 3 天
**负责**: 全栈团队
**依赖**: 任务 10.1, 10.2, 10.3

**任务描述**:
1. 修复测试中发现的 Bug
2. 性能优化（针对测试报告）
3. 代码 Review
4. 最终集成测试

**交付物**:
- Bug 修复列表
- 优化报告

**验收标准**:
- [ ] 所有测试通过
- [ ] 代码 Review 完成
- [ ] 文档更新

---

## 风险评估与应对

### 技术风险

| 风险 | 概率 | 影响 | 应对措施 |
|-----|------|------|---------|
| **Golang 学习曲线** | 高 | 中 | 预留 1-2 周学习期，提供培训资源 |
| **gRPC 调试困难** | 中 | 中 | 使用 `grpcurl` 工具，启用详细日志 |
| **PTY 延迟超标** | 中 | 高 | 实施 Buffer 聚合，使用 WebSocket 压缩 |
| **断线重连复杂** | 高 | 中 | 优先实现基础版（简单重连），后续迭代 |
| **多用户隔离漏洞** | 低 | 高 | 代码审计，路径验证，安全测试 |

### 项目风险

| 风险 | 概率 | 影响 | 应对措施 |
|-----|------|------|---------|
| **时间延期** | 中 | 中 | 每周 Review 进度，及时调整任务 |
| **资源不足** | 低 | 高 | 关键任务优先，非核心功能后置 |
| **需求变更** | 中 | 中 | 锁定 Phase 1/2 需求，Phase 3 可调整 |
| **兼容性问题** | 中 | 中 | 早期测试，保持本地模式为 fallback |

### 缓解策略

1. **技术预研**（在 Phase 1 前）:
   - Golang 基础学习（1 周）
   - gRPC Hello World（2 天）
   - WebSocket Demo（1 天）

2. **增量交付**:
   - 每个 Phase 结束进行 Demo
   - 获取早期反馈
   - 及时调整方向

3. **代码质量**:
   - 单元测试覆盖率 > 70%
   - 每周 Code Review
   - CI/CD 自动化测试

---

## 资源需求

### 人员配置

| 角色 | 数量 | 技能要求 | 工作量 |
|-----|------|---------|-------|
| **全栈工程师** | 1 | TypeScript, Golang, gRPC, React | 全职 10 周 |
| **前端工程师** | 1 (可选) | React, TypeScript, UI/UX | 兼职 Week 5 |
| **DevOps 工程师** | 1 (可选) | Docker, Nginx, Linux | 兼职 Week 8 |
| **QA 工程师** | 1 (可选) | 测试自动化, Playwright | 兼职 Week 10 |

**最小配置**: 1 名全栈工程师（9-12 周）

### 基础设施

| 资源 | 用途 | 配置 | 成本 |
|-----|------|------|------|
| **开发服务器** | 运行测试服务端 | 2 vCPU, 4GB RAM, Linux | $10/月 |
| **测试服务器** | 集成测试、性能测试 | 4 vCPU, 8GB RAM, Linux | $20/月 |
| **域名** | 测试 TLS/WSS | 任意域名 + Let's Encrypt | $12/年 |

**总成本**: ~$50/月（开发测试期）

---

## 里程碑与交付物

### Milestone 1: 基础架构完成（Week 3）✅
**交付物**:
- ✅ 客户端 Service 抽象层
- ✅ Golang 服务端基础（gRPC + WebSocket）
- ✅ 远程 PTY 功能可用
- ✅ 集成测试通过

**演示**:
- 客户端连接远程服务端
- 创建远程 Terminal
- 执行命令（`ls`, `echo`）
- 实时输出

**评审标准**:
- [x] PTY 延迟 < 200ms （实测 0.26ms）
- [x] 代码架构清晰
- [x] 文档完整

---

### Milestone 2: 完整功能可用（Week 7） 🚧 进行中
**交付物**:
- ✅ 远程 Agent 管理 (Week 4 完成)
- ✅ Worktree 远程操作 (Week 4 完成)
- ⏳ 配置管理 UI (Week 5)
- ⏳ 性能优化完成 (Week 6)
- ⏳ 安全认证（JWT + TLS）(Week 7)

**演示**:
- 创建远程项目
- 创建远程 Workspace
- 启动远程 Agent（Codex）
- 实时查看 Agent 输出
- 断线重连测试

**评审标准**:
- [x] 远程 Agent 管理功能正常 (Week 4)
- [x] Worktree 操作功能正常 (Week 4)
- [ ] 配置管理 UI 完成 (Week 5)
- [ ] 性能指标达标 (Week 6)
- [ ] 安全机制完善 (Week 7)

---

### Milestone 3: 生产就绪（Week 10）
**交付物**:
- ✅ Docker 镜像 + Compose 配置
- ✅ Systemd Service
- ✅ 完整文档（用户指南、API、部署）
- ✅ 测试报告（E2E、性能、安全）
- ✅ 已知问题列表

**演示**:
- Docker 一键部署
- 客户端连接生产服务端
- 完整工作流演示

**上线标准**:
- [ ] 所有测试通过
- [ ] 文档完整
- [ ] 部署脚本可用
- [ ] 无 P0/P1 级 Bug

---

## 质量标准

### 代码质量

| 指标 | 目标 | 检查方式 |
|-----|------|---------|
| **单元测试覆盖率** | > 70% | `go test -cover` / `vitest --coverage` |
| **代码复杂度** | < 15 (Cyclomatic) | `golangci-lint` / ESLint |
| **代码审查** | 100% | GitHub PR Review |
| **类型检查** | 0 错误 | `go build` / `npm run type-check` |

### 性能标准

| 指标 | 目标 | 测试方式 |
|-----|------|---------|
| **gRPC 延迟** | P95 < 100ms | `ghz` 压测工具 |
| **PTY 延迟** | < 100ms (LAN) | 手动测试 + 计时 |
| **WebSocket 吞吐量** | > 10MB/s | `wscat` + `dd` 测试 |
| **并发 PTY 会话** | 100 会话稳定 | 压力测试脚本 |
| **内存占用** | < 200MB (100会话) | `top` / `pprof` |

### 安全标准

| 指标 | 目标 | 检查方式 |
|-----|------|---------|
| **认证机制** | JWT + TLS | 代码审查 + 渗透测试 |
| **路径遍历防护** | 100% 验证 | 单元测试 + 审计 |
| **审计日志** | 覆盖敏感操作 | 日志审查 |
| **漏洞扫描** | 0 高危 | `gosec` / `npm audit` |

---

## 附录

### A. 依赖关系图

```
Phase 1 基础架构
  ├─ Week 1: 客户端抽象层 ──┐
  ├─ Week 2: Golang 服务端基础 ──┤
  └─ Week 3: 远程 PTY ────────────┴──► Milestone 1
                                      │
Phase 2 完整功能                      │
  ├─ Week 4: 远程 Agent ─────────────┤
  ├─ Week 5: 配置管理 + UI ──────────┤
  ├─ Week 6: 性能优化 ───────────────┤
  └─ Week 7: 安全认证 ───────────────┴──► Milestone 2
                                      │
Phase 3 生产就绪                      │
  ├─ Week 8: 部署方案 ───────────────┤
  ├─ Week 9: 文档编写 ───────────────┤
  └─ Week 10: 测试修复 ──────────────┴──► Milestone 3 (Release)
```

### B. 关键技术决策

| 决策 | 理由 | 备选方案 | 风险 |
|-----|------|---------|------|
| **Golang vs Node.js** | 性能、并发、单二进制 | Node.js | 学习曲线 |
| **gRPC vs JSON-RPC** | 强类型、性能、流式 | JSON-RPC | 调试复杂 |
| **WebSocket vs gRPC Stream** | 低延迟、主动推送 | gRPC Stream | 需维护两种协议 |
| **客户端数据库** | 隐私、离线可用 | 服务端数据库 | 同步复杂 |

### C. 参考资源

**Golang**:
- [Go by Example](https://gobyexample.com/)
- [Effective Go](https://golang.org/doc/effective_go)

**gRPC**:
- [gRPC Go Quick Start](https://grpc.io/docs/languages/go/quickstart/)
- [Protocol Buffers Guide](https://protobuf.dev/)

**WebSocket**:
- [Gorilla WebSocket](https://github.com/gorilla/websocket)
- [WebSocket Protocol RFC](https://datatracker.ietf.org/doc/html/rfc6455)

**PTY**:
- [creack/pty](https://github.com/creack/pty)
- [PTY Internals](https://www.linusakesson.net/programming/tty/)

---

## 总结

本开发排期详细规划了 Emdash 远程服务端的实施路径，分为 **3 个阶段、10 周**，从基础架构到生产就绪。

### 核心要点

1. **渐进式开发**: 每个阶段交付可演示的功能，降低风险
2. **质量优先**: 每个阶段包含测试，确保代码质量和性能
3. **文档同步**: 开发过程中持续更新文档
4. **风险可控**: 识别技术和项目风险，提前制定应对措施

### 下一步行动

1. **启动会议**: 确认排期、资源、优先级
2. **技术预研**: Golang 学习、gRPC Demo（如需要）
3. **Phase 1 启动**: 创建项目分支、初始化代码仓库

---

**文档维护**: 请在实施过程中每周更新进度，标注完成任务和阻塞问题。

**联系人**: [Luke] - 架构设计与技术决策
