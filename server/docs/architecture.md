# Emdash Server - 架构文档

**版本**: 1.0
**最后更新**: 2025-11-12

---

## 目录

1. [系统概览](#系统概览)
2. [Docker 架构](#docker-架构)
3. [目录结构与卷挂载](#目录结构与卷挂载)
4. [代码执行流程](#代码执行流程)
5. [客户端 vs 服务端 Docker 使用方式](#客户端-vs-服务端-docker-使用方式)
6. [安全考虑](#安全考虑)

---

## 系统概览

Emdash Server 是一个基于 Go 语言的远程服务，可以让多个编码代理（coding agents）在隔离的 Git worktree 中并行工作。服务端运行在 Docker 容器内，管理以下内容：

- **Git worktrees**：每个工作空间的隔离工作目录
- **Agent 进程**：CLI 工具，如 Codex、Claude Code、Cursor 等
- **PTY 会话**：交互式终端会话
- **实时流式传输**：基于 WebSocket 的输出流

```
┌──────────────────────────────────────────────────────────────┐
│                    宿主机 (Linux)                             │
│                                                               │
│  客户端应用  ◄────── gRPC/WebSocket ──────►  Docker 容器      │
│  (Electron)                                   (emdash-server) │
│                                                               │
│  ./data/projects/   ◄────── 卷挂载 ──────►  /data/projects/    │
│  ./data/worktrees/  ◄────── 卷挂载 ──────►  /data/worktrees/   │
│  ./data/logs/       ◄────── 卷挂载 ──────►  /data/logs/        │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

---

## Docker 架构

### 容器设计

Emdash Server 使用**多阶段 Docker 构建**来优化镜像大小和安全性：

#### 构建阶段
```dockerfile
FROM golang:1.24-alpine AS builder
# 编译 Go 二进制文件，使用静态链接
RUN CGO_ENABLED=0 GOOS=linux go build -o emdash-server
```

#### 运行阶段
```dockerfile
FROM alpine:latest
# 最小化运行时环境，仅包含必要工具
RUN apk add --no-cache git openssh-client ca-certificates bash
COPY --from=builder /app/emdash-server .
```

**主要优势**：
- **镜像体积小**：~50 MB（相比包含完整 Go 工具链的 ~1 GB）
- **安全性**：运行时镜像中不包含构建工具
- **性能**：静态二进制文件，无外部依赖

---

### 为什么使用 Docker？

服务端运行在 Docker 中可以提供：

1. **隔离性**：服务端进程与宿主机系统隔离
2. **可移植性**：可以在任何安装了 Docker 的地方部署
3. **一致性**：开发、测试、生产环境保持一致
4. **资源限制**：通过 Docker 限制 CPU/内存使用
5. **便于更新**：拉取新镜像并重启即可

---

## 目录结构与卷挂载

### 三个关键卷

Docker Compose 将三个宿主机目录挂载到容器内：

```yaml
volumes:
  - ./data/projects:/data/projects      # 源代码仓库
  - ./data/worktrees:/data/worktrees    # 工作空间的 Git worktrees
  - ./data/logs:/data/logs              # 应用日志
```

### 卷挂载的工作原理

**卷挂载（Volume mounting）** 在宿主机和容器之间创建**双向同步**：

```
宿主机                          Docker 容器
─────────────                   ───────────────
./data/projects/                /data/projects/
├── myproject/                  ├── myproject/
│   ├── src/                    │   ├── src/
│   ├── .git/                   │   ├── .git/
│   └── package.json            │   └── package.json
│                               │
│   ◄────── 双向同步 ──────►
│           (实时)
│
./data/worktrees/               /data/worktrees/
├── feature-auth-123/           ├── feature-auth-123/
│   ├── src/                    │   ├── src/
│   └── package.json            │   └── package.json
```

**关键特性**：
- **实时同步**：容器内的更改 → 立即在宿主机上可见
- **持久化**：数据在容器重启后仍然保留
- **相同 inode**：文件共享相同的底层文件系统
- **权限**：继承自宿主机文件系统

---

### 目录职责

| 目录 | 用途 | 创建者 | 使用者 |
|-----------|---------|------------|---------|
| `data/projects/` | 主 Git 仓库 | 用户（手动克隆） | 服务端（git worktree add） |
| `data/worktrees/` | 工作空间的隔离 worktrees | 服务端（git worktree add） | 服务端 + Agent 进程 |
| `data/logs/` | 应用日志 | 服务端（zap logger） | 服务端 |
| `certs/` | TLS 证书（可选） | 用户（证书生成） | 服务端（TLS 配置） |

---

### 初始设置

部署服务端时，创建数据目录：

```bash
cd server
mkdir -p data/{projects,worktrees,logs}
chmod -R 755 data/
```

服务端运行期间会填充这些目录：

1. **克隆项目**（手动或未来通过 API）：
   ```bash
   cd data/projects
   git clone https://github.com/user/myproject.git
   ```

2. **服务端创建 worktrees**（通过 gRPC API）：
   ```bash
   # 客户端调用：CreateWorktree(project_path="/data/projects/myproject")
   # 服务端执行（容器内）：
   git worktree add -b workspace/feature-auth /data/worktrees/feature-auth-123
   ```

3. **服务端写入日志**：
   ```
   data/logs/emdash-server-2025-11-12.log
   ```

---

## 代码执行流程

### Worktree 创建流程

```
┌────────────┐       1. gRPC 请求           ┌─────────────────┐
│   客户端    │ ──────────────────────────►  │  emdash-server  │
│ (Electron) │                               │  (容器内)        │
└────────────┘                               └────────┬────────┘
                                                      │
                                                      │ 2. 执行 git 命令
                                                      ▼
                                            ┌──────────────────────────┐
                                            │ exec.Command("git",      │
                                            │   "worktree", "add",     │
                                            │   "-b", "workspace/feat",│
                                            │   "/data/worktrees/feat")│
                                            └──────────┬───────────────┘
                                                       │
                                                       │ 3. 写入挂载的卷
                                                       ▼
                                            ┌─────────────────────────┐
                                            │ /data/worktrees/        │
                                            │   feature-auth-123/     │
                                            │     ├── src/            │
                                            │     └── package.json    │
                                            └──────────┬──────────────┘
                                                       │
                                                       │ 4. 同步到宿主机（自动）
                                                       ▼
                                            ┌─────────────────────────┐
                                            │ ./data/worktrees/       │
                                            │   feature-auth-123/     │
                                            │     ├── src/            │
                                            │     └── package.json    │
                                            └─────────────────────────┘
```

**关键点**：
1. 服务端从客户端接收 gRPC 请求
2. 服务端**在容器内**执行 `git` 命令
3. Git 写入到 `/data/worktrees/`（容器路径）
4. 卷挂载自动同步到 `./data/worktrees/`（宿主机路径）
5. 无需显式的"同步"命令 - 这是文件系统级别的

---

### Agent 执行流程

```
┌────────────┐       1. StartAgent 请求     ┌─────────────────┐
│   客户端    │ ──────────────────────────►   │  emdash-server  │
└────────────┘                                └────────┬────────┘
                                                       │
                                                       │ 2. 启动 agent 进程
                                                       ▼
                                            ┌──────────────────────────┐
                                            │ exec.Command("codex",    │
                                            │   "Add authentication")  │
                                            │ cmd.Dir = "/data/        │
                                            │   worktrees/feat-123"    │
                                            └──────────┬───────────────┘
                                                       │
                                                       │ 3. Agent 读写代码
                                                       ▼
                                            ┌─────────────────────────┐
                                            │ /data/worktrees/        │
                                            │   feature-auth-123/     │
                                            │     ├── src/auth.js     │ ◄── Agent 修改
                                            │     └── package.json    │
                                            └──────────┬──────────────┘
                                                       │
                                                       │ 4. 同步到宿主机（自动）
                                                       ▼
                                            ┌─────────────────────────┐
                                            │ ./data/worktrees/       │
                                            │   feature-auth-123/     │
                                            │     ├── src/auth.js     │ ◄── 宿主机可见
                                            │     └── package.json    │
                                            └─────────────────────────┘
                                                       │
                                                       │ 5. 流式输出
                                                       ▼
┌────────────┐    WebSocket (agent.output)  ┌─────────────────┐
│   客户端    │ ◄────────────────────────────│  emdash-server  │
└────────────┘                               └─────────────────┘
```

**关键点**：
1. Agent 进程**在容器内**运行
2. Agent 读写容器路径 `/data/worktrees/feat-123`
3. 更改通过卷挂载自动在宿主机上可见
4. Agent 输出通过 WebSocket 流式传输到客户端
5. 客户端可以同时监控代码更改（文件系统）和 agent 输出（WebSocket）

---

## 客户端 vs 服务端 Docker 使用方式

Emdash 有**两种不同的 Docker 使用模式**：

### 服务端 Docker 使用方式

**含义**：服务端本身运行在 Docker 容器内

**方式**：
```bash
docker-compose up -d
```

**架构**：
```
宿主机
├── docker-compose.yml
├── Dockerfile
└── data/                    ◄───┐
    ├── projects/                 │
    └── worktrees/                │ 卷挂载
                                  │
┌────────────────────────────┐   │
│  Docker 容器                │   │
│  (emdash-server)           │   │
│                            │   │
│  /data/projects/    ◄──────┘
│  /data/worktrees/
│                            │
│  - Go 服务端进程            │
│  - git 命令                 │
│  - agent 进程               │
└────────────────────────────┘
```

**目的**：隔离服务端运行时环境

---

### 客户端 Docker 使用方式

**含义**：Electron 客户端为工作空间启动临时 Docker 容器

**方式**：
```typescript
// 客户端代码 (containerRunnerService.ts)
const cmd = `docker run -d \
  -v ${workspacePath}:/workspace \
  -w /workspace/src \
  -p 3000:3000 \
  node:20 \
  bash -c "npm install && npm start"`;
```

**架构**：
```
宿主机（客户端）
├── Electron 应用 (emdash 客户端)
│   └── 启动新容器 ──────┐
├── 工作空间目录             │
│   └── myproject/          │ 卷挂载
                            │
┌──────────────────────────────┐   │
│  临时 Docker 容器             │   │
│  (node:20)                   │   │
│                              │   │
│  /workspace/  ◄──────────────┘
│                              │
│  - npm install               │
│  - npm start                 │
│  - 开发服务器（端口 3000）     │
└──────────────────────────────┘
```

**目的**：在隔离容器中运行工作空间的开发服务器

---

### 主要区别

| 方面 | 服务端 Docker | 客户端 Docker |
|--------|-------------------|-------------------|
| **容器生命周期** | 长期运行（数天/数周） | 短期运行（数小时） |
| **谁运行它** | 服务端本身被容器化 | 客户端启动容器 |
| **卷挂载** | `./data/projects:/data/projects` | `-v ${workspacePath}:/workspace` |
| **目的** | 服务端运行时隔离 | 工作空间开发环境 |
| **管理方式** | docker-compose | 客户端应用 (containerRunnerService) |
| **容器数量** | 1 个容器（服务端） | N 个容器（每个工作空间一个） |
| **镜像** | 自定义 `emdash-server:latest` | 公共 `node:20`（或自定义） |

---

### 两者之间的交互

```
┌─────────────────────────────────────────────────────────────┐
│                        宿主机                                 │
│                                                              │
│  ┌──────────────────────┐           ┌────────────────────┐ │
│  │  客户端容器           │           │  服务端容器         │ │
│  │  (每个工作空间)       │           │  (emdash-server)   │ │
│  │                      │           │                    │ │
│  │  /workspace/  ◄─┐    │           │  /data/worktrees/ ◄┼─┤
│  │  - npm start     │    │  gRPC/WS  │  - git worktree   │ │
│  │  - 端口 3000     │    │◄─────────►│  - agent spawn    │ │
│  └──────────────────┘    │           └────────────────────┘ │
│           │              │                      │            │
│           │ 卷挂载       │                      │ 卷挂载      │
│           ▼              │                      ▼            │
│  ./worktrees/feat-123/   │           ./data/worktrees/       │
│  - 代码更改对两个容器     │           - 由服务端管理           │
│    都可见                │                                   │
└─────────────────────────────────────────────────────────────┘
```

**关键洞察**：两个容器都可以通过卷挂载访问同一个工作空间目录，实现无缝协作。

---

## 安全考虑

### 卷挂载安全

**风险**：
1. **宿主机文件系统暴露**：容器可以读写宿主机目录
2. **权限提升**：容器用户 = 宿主机用户（默认情况下）
3. **数据损坏**：容器中的 bug 可能损坏宿主机文件

**缓解措施**：

1. **对敏感数据使用只读挂载**：
   ```yaml
   volumes:
     - ./certs:/app/certs:ro  # 只读
   ```

2. **以非 root 用户运行**（未来增强）：
   ```dockerfile
   RUN adduser -D -u 1000 emdash
   USER emdash
   ```

3. **限制挂载范围**：只挂载必要的目录
   ```yaml
   # 好：特定目录
   - ./data/projects:/data/projects

   # 坏：整个 home 目录
   - /home/user:/home/user  # 不要这样做
   ```

4. **使用 Docker secrets** 处理敏感配置：
   ```yaml
   secrets:
     - auth_secret
   ```

---

### 网络安全

**暴露的端口**：
- `50051`：gRPC API
- `8080`：WebSocket

**建议**：
1. **使用 VPN**：不要将端口暴露到公共互联网
2. **启用 TLS**：生产环境设置 `TLS_ENABLED=true`
3. **防火墙规则**：限制访问仅限已知客户端 IP
4. **反向代理**：使用 Nginx 配合速率限制（参见 deployment.md）

---

### 资源限制

通过 Docker 限制防止资源耗尽：

```yaml
deploy:
  resources:
    limits:
      cpus: '2.0'        # 最多 2 个 CPU 核心
      memory: 2G         # 最多 2 GB 内存
    reservations:
      cpus: '0.5'        # 保证 0.5 个核心
      memory: 512M       # 保证 512 MB
```

**为什么重要**：
- Agent 进程可能占用大量 CPU/内存
- 失控进程不会导致宿主机崩溃
- 保证基线性能

---

## 最佳实践

### 开发工作流程

1. **使用卷挂载进行实时开发**：
   ```yaml
   volumes:
     - ./cmd:/app/cmd          # 热重载 Go 代码
     - ./internal:/app/internal
   ```

2. **使用 `docker-compose` 进行本地开发**：
   ```bash
   docker-compose up --build  # 代码更改时重新构建
   ```

3. **经常检查容器日志**：
   ```bash
   docker-compose logs -f --tail=100
   ```

---

### 生产部署

1. **预构建镜像**并推送到仓库：
   ```bash
   docker build -t emdash-server:v1.2.3 .
   docker push registry.example.com/emdash-server:v1.2.3
   ```

2. **使用特定镜像标签**（不要用 `latest`）：
   ```yaml
   services:
     emdash-server:
       image: registry.example.com/emdash-server:v1.2.3
   ```

3. **启用自动重启**：
   ```yaml
   restart: unless-stopped
   ```

4. **监控容器健康**：
   ```yaml
   healthcheck:
     test: ["CMD", "nc", "-z", "localhost", "50051"]
     interval: 30s
   ```

---

### 备份策略

**需要备份的内容**：
1. `data/projects/` - 源代码仓库
2. `data/worktrees/` - 活跃的工作空间
3. `data/logs/` - 应用日志
4. `.env` - 配置文件
5. `certs/` - TLS 证书

**如何备份**：
```bash
# 停止服务端（可选，为了一致性）
docker-compose down

# 创建备份
tar -czf backup-$(date +%Y%m%d).tar.gz \
  data/ .env certs/

# 重启服务端
docker-compose up -d
```

**恢复**：
```bash
docker-compose down
tar -xzf backup-20251112.tar.gz
docker-compose up -d
```

---

## 故障排查

### 卷挂载问题

**问题**：宿主机和容器之间的更改未同步

**解决方案**：
1. 检查挂载路径：
   ```bash
   docker inspect emdash-server | grep -A 10 Mounts
   ```

2. 验证文件权限：
   ```bash
   ls -la data/
   # 应该显示 user:group 所有权
   ```

3. 从容器内测试写入：
   ```bash
   docker exec emdash-server sh -c 'echo test > /data/logs/test.txt'
   cat data/logs/test.txt  # 应该显示 "test"
   ```

---

### 性能问题

**问题**：macOS/Windows 上文件操作缓慢

**原因**：Docker Desktop 使用基于 VM 的文件系统转换

**解决方案**：
1. 生产环境使用 Linux 宿主机（原生 Docker）
2. 在 Docker Desktop 中启用 "VirtioFS"（仅 macOS）
3. 使用 `:cached` 挂载选项（一致性较低，速度更快）：
   ```yaml
   volumes:
     - ./data/worktrees:/data/worktrees:cached
   ```

---

### 端口冲突

**问题**：端口 50051 或 8080 已被占用

**解决方案**：
1. 查找冲突进程：
   ```bash
   lsof -i :50051
   ```

2. 在 `docker-compose.yml` 中更改端口：
   ```yaml
   ports:
     - "50052:50051"  # 映射宿主机 50052 → 容器 50051
   ```

---

## 相关资源

- [部署指南](./deployment.md) - 生产部署步骤
- [用户指南](./user-guide.md) - 常见操作和故障排查
- [API 文档](./api.md) - gRPC 和 WebSocket API 参考
- [安全指南](./security.md) - 认证和审计日志

---

**有问题？** 在 [GitHub](https://github.com/emdashhq/emdash-server/issues) 上提交 issue
