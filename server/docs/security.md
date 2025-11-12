# Security Overview

Week 7 introduced three pillars of hardening for the Emdash server: signed JWT access tokens, optional TLS/WSS transport encryption, and structured audit logging. This document explains how those features work, how to configure them, and the practices we recommend for production deployments.

## JWT Authentication

All inbound traffic must present a JSON Web Token signed with HS256. gRPC requests attach the token through the `authorization` metadata key, and WebSocket upgrades must include an `Authorization` header. The server extracts the `userId` claim, stores it on the request context, and rejects any call that is missing or carrying an invalid token.

### Token format

- **Algorithm:** HS256 (HMAC-SHA256) using the shared `AUTH_SECRET`.
- **Claims:** Every token must include `userId` plus standard registered claims (`iat`, `exp`) so the server can expire sessions.
- **Expiry:** You control the lifetime when generating the token. We recommend short-lived tokens (24h or less) for human operators and rotating automation tokens regularly.

### Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `AUTH_SECRET` | Yes | HMAC secret used to sign and verify tokens. The server falls back to `dev-secret-change-in-production` but logs a warning—never rely on the default outside local development. |

See `server/config.example.env` for a complete reference.

### Generating tokens for testing

The server exposes helpers in `internal/auth`. You can generate throwaway tokens without adding any new binaries:

**Go (preferred in repo):**

```bash
cd server
cat <<'EOF' > /tmp/generate_jwt.go
package main

import (
	"fmt"
	"log"
	"os"

	"github.com/emdashhq/emdash-server/internal/auth"
)

func main() {
	secret := os.Getenv("AUTH_SECRET")
	token, err := auth.GenerateToken("dev-user", secret, 24)
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(token)
}
EOF
AUTH_SECRET=dev-secret-change-in-production go run /tmp/generate_jwt.go
```

**Node/TypeScript (uses `jsonwebtoken`):**

```bash
cd server
AUTH_SECRET=dev-secret-change-in-production node - <<'NODE'
const jwt = require('jsonwebtoken');
const token = jwt.sign({ userId: 'dev-user' }, process.env.AUTH_SECRET, {
  algorithm: 'HS256',
  expiresIn: '24h',
});
console.log(token);
NODE
```

Replace `dev-user` and the shared secret with your own values. Delete the temporary Go file after use if you commit inside the repo.

### Example clients

**Go gRPC client**

```go
conn, err := grpc.Dial("localhost:50051",
	grpc.WithTransportCredentials(insecure.NewCredentials()))
if err != nil {
	log.Fatal(err)
}
defer conn.Close()

token := os.Getenv("EMDASH_TOKEN")
ctx := metadata.AppendToOutgoingContext(context.Background(),
	"authorization", "Bearer "+token)

resp, err := ptypb.NewPtyServiceClient(conn).Start(ctx, &ptypb.StartRequest{
	Name: "shell",
})
if err != nil {
	log.Fatal(err)
}
fmt.Println("pty session id:", resp.GetId())
```

**TypeScript WebSocket client**

```ts
import WebSocket from 'ws';

const token = process.env.EMDASH_TOKEN!;
const ws = new WebSocket('wss://localhost:8080/ws/pty?id=session-123', {
  headers: { Authorization: `Bearer ${token}` },
  rejectUnauthorized: false, // only for self-signed local testing
});

ws.on('open', () => console.log('connected'));
ws.on('message', (data) => console.log('output', data.toString()));
ws.on('error', console.error);
```

See `server/docs/api-authentication.md` for grpcurl/wscat equivalents.

## Transport Security (TLS / WSS)

TLS is disabled by default but should be enabled for any deployment that leaves your workstation. The same certificates secure both the gRPC (`:50051`) and WebSocket (`:8080`) listeners. Configuration details, self-signed workflows, and production guidance live in [`server/docs/tls-setup.md`](./tls-setup.md).

Relevant environment variables:

| Variable | Default | Description |
| --- | --- | --- |
| `TLS_ENABLED` | `false` | Enables TLS for both listeners. |
| `TLS_CERT_FILE` | `certs/server.crt` | PEM encoded certificate chain. |
| `TLS_KEY_FILE` | `certs/server.key` | PEM encoded private key. |

When TLS is enabled, clients must switch to `grpcs://` and `wss://` endpoints and trust the issuing certificate authority.

## Audit Logging

Every authentication decision and security-sensitive RPC emits a structured JSON line through the server’s Zap logger. Operations currently audited include:

- JWT authentication failures across gRPC and WebSocket transports
- WebSocket connection attempts and PTY session bindings
- PTY lifecycle events (`pty.start`, `pty.kill`)
- Agent lifecycle (`agent.start`, `agent.stop`)
- Worktree provisioning (`worktree.create`, `worktree.remove`)

### Log format

Each event contains the following fields:

| Field | Description |
| --- | --- |
| `timestamp` | RFC3339 UTC timestamp of the event. |
| `user_id` | Authenticated `userId` claim or `unknown` if unavailable. |
| `action` | Namespaced event type (e.g. `auth.failed`). |
| `resource` | Resource identifier such as PTY ID or gRPC method. |
| `success` | Boolean outcome. |
| `metadata` | Optional map with contextual details (remote IP, errors, etc.). |

Example:

```json
{
  "audit": true,
  "timestamp": "2024-05-08T11:13:14.015926Z",
  "user_id": "dev-user",
  "action": "websocket.connected",
  "resource": "pty-123",
  "success": true,
  "metadata": {
    "remote_addr": "192.0.2.1:51558",
    "transport": "websocket"
  }
}
```

### Querying and monitoring

Audit logs are emitted to stdout/stderr with the rest of the server logs. Common ways to inspect them:

- Filter locally with `jq`:
  ```bash
  journalctl -u emdash-server -o json | jq 'select(.audit == true)'
  ```
- Use `rg`/`grep` when stored in log files:
  ```bash
  rg '"audit":true' /var/log/emdash/server.log
  ```
- Ship logs to your SIEM and create alerts for patterns such as repeated `auth.failed`.

## Security Best Practices

- Use a randomly generated `AUTH_SECRET` that is at least 32 characters (256 bits) and store it in your secret manager.
- Enable TLS (`TLS_ENABLED=true`) everywhere except isolated local development; keep certificates and keys readable only by the service user.
- Rotate the JWT secret on a predictable cadence. When rotating, deploy a maintenance window or run two server instances behind a load balancer while clients refresh tokens.
- Monitor audit logs continuously and alert on repeated auth failures, denied operations, or activity from dormant accounts.
- Scope tokens per user or automation task, limit their lifetime, and revoke compromised tokens immediately.
