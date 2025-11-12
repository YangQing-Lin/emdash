# API Authentication

All remote surfaces of the Emdash server (gRPC and WebSocket) rely on a shared JWT bearer token. This document shows how to attach tokens to requests, what the expected format looks like, and how to troubleshoot the most common errors.

## Token requirements

- **Format:** `Authorization: Bearer <jwt-token>`
- **Algorithm:** HS256
- **Claims:** `userId` (string), `iat`, and `exp`
- **Secret:** Provided through `AUTH_SECRET`

Tokens are validated on every call. Expired tokens, missing claims, or signatures that do not match the configured secret result in an `UNAUTHENTICATED` gRPC error or `401 Unauthorized` over WebSocket.

## gRPC authentication

Attach the token via gRPC metadata before invoking a method:

```go
ctx := metadata.AppendToOutgoingContext(context.Background(),
	"authorization", "Bearer "+token)
resp, err := ptypb.NewPtyServiceClient(conn).Start(ctx, req)
```

### grpcurl example

```bash
cd server
TOKEN=$(node -e "console.log(require('jsonwebtoken').sign({ userId: 'dev-user' }, 'dev-secret-change-in-production', { algorithm: 'HS256', expiresIn: '1h' }))")

grpcurl \
  -plaintext \
  -H "authorization: Bearer $TOKEN" \
  -d '{"name":"shell"}' \
  localhost:50051 emdash.pty.PtyService/Start
```

When TLS is enabled, remove `-plaintext` and supply `-cacert` or `-authority` as described in [`tls-setup.md`](./tls-setup.md).

## WebSocket authentication

WebSocket clients must provide the same `Authorization` header during the HTTP upgrade:

```ts
const socket = new WebSocket('wss://host:8080/ws/pty?id=session-123', {
  headers: { Authorization: `Bearer ${token}` },
});
```

### wscat example

```bash
# --no-check should only be used with self-signed certs in local dev
wscat \
  --no-check \
  -H "Authorization: Bearer $TOKEN" \
  -c wss://localhost:8080/ws/pty?id=session-123
```

Use `ws://` instead of `wss://` only when TLS is disabled.

## Common error codes

| Transport | Status / Code | Cause | Suggested fix |
| --- | --- | --- | --- |
| gRPC | `UNAUTHENTICATED` | Missing `authorization` metadata | Add `-H "authorization: Bearer …"` or metadata in code. |
| gRPC | `UNAUTHENTICATED: invalid token: token is expired` | Token `exp` in the past | Generate a fresh token or reduce clock skew. |
| gRPC | `UNAUTHENTICATED: invalid token: token missing userId claim` | Token payload does not include `userId` | Ensure the `userId` claim is set when signing the JWT. |
| WebSocket | `401 Unauthorized (missing Authorization header)` | Header omitted | Include `Authorization: Bearer …` in the upgrade request. |
| WebSocket | `401 Unauthorized (invalid token)` | Invalid signature or secret mismatch | Verify both client and server use the same `AUTH_SECRET`. |

If problems persist, enable TLS, regenerate the secret, or consult the structured audit logs described in [`security.md`](./security.md)—every rejected request is captured with the reason code.
