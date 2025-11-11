# Emdash Server

A production-ready Go service that powers the remote capabilities of the Emdash desktop app. The server exposes gRPC APIs, WebSocket streaming, and PTY-backed interactive sessions.

## Directory Layout
```
server/
├── cmd/emdash-server      # Application entry point
├── internal/              # Private application logic
│   ├── grpc               # gRPC server implementation (WIP)
│   ├── service            # Business/domain services (WIP)
│   └── websocket          # WebSocket handlers and hubs (WIP)
├── api/proto              # Protobuf definitions and RPC contracts
├── pkg                    # Reusable public packages (optional)
├── Makefile               # Build / test automation
└── go.mod                 # Go module definition
```

## Requirements
- Go 1.24+ (managed automatically via `toolchain` directive)
- `protoc` and `buf` (optional, only for proto generation)

## Commands
- `make build` – Compile the binary to `bin/emdash-server`.
- `make run` – Build then run the server.
- `make test` – Run Go tests with coverage output.
- `make proto` – Placeholder for future protobuf compilation pipeline.
- `make clean` – Remove build artifacts.
- `make dev` – Run with [`air`](https://github.com/air-verse/air) hot reload if installed.

## Development Setup
1. Ensure Go 1.24+ is available (`go env GOTOOLCHAIN` will download automatically).
2. From the repository root run:
   ```bash
   cd server
   make build
   ./bin/emdash-server
   ```
3. Place `.proto` files inside `api/proto/` and wire up services inside `internal/`.
4. Use `make dev` for iterative development; install `air` via `go install github.com/air-verse/air@latest`.

## Next Steps
- Flesh out gRPC service definitions in `api/proto`.
- Implement service layer logic in `internal/service`.
- Bridge gRPC/WebSocket endpoints to the Electron app clients.
