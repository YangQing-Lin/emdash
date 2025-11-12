# Emdash Server

A production-ready Go service that powers the remote capabilities of the Emdash desktop app. The server exposes gRPC APIs, WebSocket streaming, and PTY-backed interactive sessions.

## Security Features
- **JWT bearer authentication:** All clients must present HS256 tokens that include a `userId` claim. See [`docs/security.md`](docs/security.md) for token lifecycles and examples.
- **Optional TLS / WSS encryption:** Enable via environment variables or follow [`docs/tls-setup.md`](docs/tls-setup.md) to generate certificates.
- **Structured audit logging:** Every sensitive RPC and auth failure is captured with user, action, resource, and outcome fields.

Detailed usage guides: [`docs/security.md`](docs/security.md) · [`docs/api-authentication.md`](docs/api-authentication.md)

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

## Environment Variables

| Variable | Required | Description |
| --- | --- | --- |
| `AUTH_SECRET` | ✅ | HMAC secret used to sign and verify JWTs. Defaults to `dev-secret-change-in-production` for local dev only. |
| `TLS_ENABLED` | ❌ | `true` to enable TLS/WSS. Defaults to `false`. |
| `TLS_CERT_FILE` | ❌ | Path to the PEM certificate (used when TLS is enabled). Defaults to `certs/server.crt`. |
| `TLS_KEY_FILE` | ❌ | Path to the PEM private key (used when TLS is enabled). Defaults to `certs/server.key`. |

Copy `config.example.env` to `.env` (or inject variables via your process manager) to bootstrap a configuration template for both dev and production.

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

## Quick Start Security
1. Copy `config.example.env` to `.env` and edit the values:
   - Generate a strong 32+ character `AUTH_SECRET`.
   - Toggle `TLS_ENABLED` and point `TLS_CERT_FILE`/`TLS_KEY_FILE` to your certificate pair.
2. Export or load the variables (`source .env`) before running `make run` or `./bin/emdash-server`.
3. Generate a JWT for your user following [`docs/security.md`](docs/security.md#generating-tokens-for-testing) and call APIs as shown in [`docs/api-authentication.md`](docs/api-authentication.md).
4. Tail the logs to verify audit events whenever you authenticate, start PTY sessions, or modify worktrees.

## Next Steps
- Flesh out gRPC service definitions in `api/proto`.
- Implement service layer logic in `internal/service`.
- Bridge gRPC/WebSocket endpoints to the Electron app clients.
