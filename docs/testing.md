# 测试指南

本文档总结了如何执行和解读新的远程 PTY 测试套件和性能基准测试。

## 前置要求

- **Node.js 22.20.0**（使用 `nvm use` 或手动安装）
- **npm** 10+
- **Go 1.24**（通过 `toolchain` 指令自动管理）
- 端口 `50051` 和 `8080` 必须可用于 Go 服务器集成测试

## TypeScript 测试套件

- 运行所有 Vitest 套件（单元测试 + 集成测试）：

  ```bash
  npm run test
  ```

- 测试现在包含：
  - `src/test/remote-pty.test.ts`：使用模拟 WebSocket 服务器对 `RemotePtyService` 进行单元测试
  - `src/test/integration/pty-e2e.test.ts`：完整的端到端流程，启动 Go 服务器，通过 gRPC 创建远程 PTY，并测试 WebSocket 桥接。需要 Go 工具链和开放的端口
- 如需跳过重量级 E2E 测试（例如在受限的 CI 环境中），设置 `SKIP_REMOTE_PTY_E2E=1`

## Go 测试

- 运行所有 Go 单元测试和集成测试：

  ```bash
  cd server
  go test ./...
  ```

- 测试覆盖重点：
  - `server/internal/service/pty_service_test.go` 验证 PTY 生命周期操作
  - `server/test/integration_test.go` 启动 gRPC + WebSocket 服务器，并通过 JSON 验证远程 PTY 流程

## 性能基准测试

- 测量 PTY 性能指标：

  ```bash
  cd server
  go test -bench=. ./internal/service
  ```

- 报告的指标：
  - `BenchmarkStartPty`：PTY 创建延迟（目标 < 50 ms）
  - `BenchmarkWritePty`：写入延迟（目标 < 5 ms）
  - `BenchmarkConcurrentPty`：12 个并发会话的调度时间（目标批处理 < 50 ms）
- 如果未达到目标，基准测试将失败；如果出现回退，请检查系统负载

## 故障排查

- **Go 服务器端口已被占用**：停止冲突进程或设置 `SKIP_REMOTE_PTY_E2E=1`
- **缺少 Go 工具链**：安装 Go 1.24+ 或依赖 `go env GOTOOLCHAIN` 自动下载
- **PTY 操作缓慢**：确保没有残留的 shell 进程（`pkill -f emdash-server`），并在系统空闲时重新运行基准测试
- **Electron 模拟**：测试框架对 `electron` 进行 stub。避免在测试外导入生产环境的 BrowserWindow 逻辑
