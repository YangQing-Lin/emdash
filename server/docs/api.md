# Emdash Remote Server - API Documentation

**Version**: 1.0
**Last Updated**: 2025-11-12

---

## Table of Contents

1. [Overview](#overview)
2. [Authentication](#authentication)
3. [gRPC API](#grpc-api)
4. [WebSocket API](#websocket-api)
5. [Error Handling](#error-handling)
6. [Examples](#examples)

---

## Overview

Emdash Server exposes two complementary APIs:

- **gRPC API** (Port 50051): Request/response operations (worktrees, git, PTY control)
- **WebSocket API** (Port 8080): Real-time streaming (PTY output, agent output, events)

### Protocol Stack

```
┌─────────────────────────────────┐
│   Emdash Client (Electron)      │
└────────────┬───────────┬────────┘
             │           │
     gRPC (50051)   WebSocket (8080)
             │           │
┌────────────┴───────────┴────────┐
│   Emdash Server (Golang)        │
└─────────────────────────────────┘
```

### Design Principles

- **gRPC**: Synchronous operations (create/list/delete resources)
- **WebSocket**: Asynchronous streaming (real-time output, events)
- **Authentication**: JWT token in gRPC metadata and WebSocket headers

---

## Authentication

All API requests require a `Bearer` token in the `Authorization` header/metadata.

### JWT Token

The server uses **HS256** (HMAC with SHA-256) to sign JWT tokens. The shared secret is the `AUTH_SECRET` environment variable.

**Token Structure:**
```json
{
  "userId": "user-123",
  "iat": 1699876543,
  "exp": 1699962943
}
```

**Token Generation (server-side only):**
```go
// Server generates tokens (not exposed via API)
token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
    "userId": userId,
    "iat":    time.Now().Unix(),
    "exp":    time.Now().Add(24 * time.Hour).Unix(),
})
tokenString, _ := token.SignedString([]byte(authSecret))
```

**Note**: Current version uses a shared `AUTH_SECRET` for all clients. Future versions will support per-user token generation via a login API.

### gRPC Authentication

Include the token in the `authorization` metadata:

```bash
grpcurl -plaintext \
  -H "authorization: Bearer <YOUR_AUTH_SECRET>" \
  -d '{"project_path": "/path/to/project"}' \
  localhost:50051 \
  emdash.worktree.WorktreeService/ListWorktrees
```

### WebSocket Authentication

Include the token in the initial HTTP upgrade request:

```javascript
const ws = new WebSocket('ws://localhost:8080/ws', {
  headers: {
    'Authorization': 'Bearer <YOUR_AUTH_SECRET>'
  }
});
```

---

## gRPC API

### Base URL

```
grpc://localhost:50051  (without TLS)
grpcs://localhost:50051 (with TLS)
```

### Common Types

Defined in `api/proto/common.proto`:

```protobuf
enum WorktreeStatus {
  WORKTREE_STATUS_UNSPECIFIED = 0;
  WORKTREE_STATUS_ACTIVE = 1;
  WORKTREE_STATUS_PAUSED = 2;
  WORKTREE_STATUS_COMPLETED = 3;
  WORKTREE_STATUS_ERROR = 4;
}

message WorktreeInfo {
  string id = 1;
  string name = 2;
  string branch = 3;
  string path = 4;
  string project_id = 5;
  WorktreeStatus status = 6;
  string created_at = 7;
  optional string last_activity = 8;
}
```

---

### WorktreeService

**Package**: `emdash.worktree`
**Proto**: `api/proto/worktree.proto`

#### CreateWorktree

Creates a new Git worktree with a new branch.

**Request:**
```protobuf
message CreateWorktreeRequest {
  string project_path = 1;    // Path to main project repo
  string workspace_name = 2;  // Name for the workspace
  string project_id = 3;      // Project identifier
}
```

**Response:**
```protobuf
message CreateWorktreeResponse {
  emdash.common.WorktreeInfo worktree = 1;
}
```

**Example:**
```bash
grpcurl -plaintext \
  -H "authorization: Bearer $AUTH_SECRET" \
  -d '{
    "project_path": "/home/user/myproject",
    "workspace_name": "feature-auth",
    "project_id": "proj-123"
  }' \
  localhost:50051 \
  emdash.worktree.WorktreeService/CreateWorktree
```

**Response:**
```json
{
  "worktree": {
    "id": "feature-auth-1699876543",
    "name": "feature-auth",
    "branch": "agent/feature-auth-1699876543",
    "path": "/home/user/worktrees/feature-auth-1699876543",
    "project_id": "proj-123",
    "status": "WORKTREE_STATUS_ACTIVE",
    "created_at": "2025-11-12T10:30:43Z"
  }
}
```

---

#### ListWorktrees

Lists all worktrees for a project.

**Request:**
```protobuf
message ListWorktreesRequest {
  string project_path = 1;
}
```

**Response:**
```protobuf
message ListWorktreesResponse {
  repeated emdash.common.WorktreeInfo worktrees = 1;
}
```

**Example:**
```bash
grpcurl -plaintext \
  -H "authorization: Bearer $AUTH_SECRET" \
  -d '{"project_path": "/home/user/myproject"}' \
  localhost:50051 \
  emdash.worktree.WorktreeService/ListWorktrees
```

---

#### RemoveWorktree

Removes a worktree and optionally deletes the branch.

**Request:**
```protobuf
message RemoveWorktreeRequest {
  string project_path = 1;
  string worktree_id = 2;
  optional string worktree_path = 3;
  optional string branch = 4;
}
```

**Response:**
```protobuf
google.protobuf.Empty
```

**Example:**
```bash
grpcurl -plaintext \
  -H "authorization: Bearer $AUTH_SECRET" \
  -d '{
    "project_path": "/home/user/myproject",
    "worktree_id": "feature-auth-1699876543",
    "worktree_path": "/home/user/worktrees/feature-auth-1699876543",
    "branch": "agent/feature-auth-1699876543"
  }' \
  localhost:50051 \
  emdash.worktree.WorktreeService/RemoveWorktree
```

---

#### GetWorktreeStatus

Gets the Git status of a worktree.

**Request:**
```protobuf
message GetWorktreeStatusRequest {
  string worktree_path = 1;
}
```

**Response:**
```protobuf
message GetWorktreeStatusResponse {
  emdash.common.WorktreeStatusDetails status = 1;
}

message WorktreeStatusDetails {
  bool has_changes = 1;
  repeated string staged_files = 2;
  repeated string unstaged_files = 3;
  repeated string untracked_files = 4;
}
```

---

### GitService

**Package**: `emdash.git`
**Proto**: `api/proto/git.proto`

#### GetStatus

Gets the Git status of a workspace.

**Request:**
```protobuf
message GetStatusRequest {
  string workspace_path = 1;
}
```

**Response:**
```protobuf
message GetStatusResponse {
  repeated GitChange changes = 1;
}

message GitChange {
  string path = 1;
  string status = 2;      // "M", "A", "D", "??"
  int32 additions = 3;
  int32 deletions = 4;
  bool is_staged = 5;
}
```

**Example:**
```bash
grpcurl -plaintext \
  -H "authorization: Bearer $AUTH_SECRET" \
  -d '{"workspace_path": "/home/user/worktrees/feature-auth-1699876543"}' \
  localhost:50051 \
  emdash.git.GitService/GetStatus
```

**Response:**
```json
{
  "changes": [
    {
      "path": "src/auth.js",
      "status": "M",
      "additions": 42,
      "deletions": 10,
      "is_staged": false
    },
    {
      "path": "src/user.js",
      "status": "A",
      "additions": 120,
      "deletions": 0,
      "is_staged": true
    }
  ]
}
```

---

#### StageFile

Stages a file for commit.

**Request:**
```protobuf
message StageFileRequest {
  string workspace_path = 1;
  string file_path = 2;
}
```

**Response:**
```protobuf
google.protobuf.Empty
```

---

#### RevertFile

Reverts changes to a file.

**Request:**
```protobuf
message RevertFileRequest {
  string workspace_path = 1;
  string file_path = 2;
}
```

**Response:**
```protobuf
message RevertFileResponse {
  RevertAction action = 1;
}

enum RevertAction {
  REVERT_ACTION_UNSPECIFIED = 0;
  REVERT_ACTION_UNSTAGED = 1;    // File was unstaged
  REVERT_ACTION_REVERTED = 2;    // File was reverted to HEAD
}
```

---

#### GetFileDiff

Gets the diff for a specific file.

**Request:**
```protobuf
message GetFileDiffRequest {
  string workspace_path = 1;
  string file_path = 2;
}
```

**Response:**
```protobuf
message GetFileDiffResponse {
  repeated FileDiffLine lines = 1;
}

message FileDiffLine {
  optional string left = 1;   // Line number on left (before)
  optional string right = 2;  // Line number on right (after)
  DiffType type = 3;
}

enum DiffType {
  DIFF_TYPE_UNSPECIFIED = 0;
  DIFF_TYPE_CONTEXT = 1;  // Unchanged line
  DIFF_TYPE_ADD = 2;      // Added line (+)
  DIFF_TYPE_DEL = 3;      // Deleted line (-)
}
```

---

### PtyService

**Package**: `emdash.pty`
**Proto**: `api/proto/pty.proto`

#### StartPty

Starts a new PTY (pseudo-terminal) session.

**Request:**
```protobuf
message PtyStartRequest {
  string id = 1;
  string cwd = 2;
  string shell = 3;         // e.g., "/bin/bash"
  map<string, string> env = 4;
  uint32 cols = 5;
  uint32 rows = 6;
}
```

**Response:**
```protobuf
message PtyStartResponse {
  string id = 1;
}
```

**Example:**
```bash
grpcurl -plaintext \
  -H "authorization: Bearer $AUTH_SECRET" \
  -d '{
    "id": "pty-123",
    "cwd": "/home/user/project",
    "shell": "/bin/bash",
    "env": {"TERM": "xterm-256color"},
    "cols": 80,
    "rows": 24
  }' \
  localhost:50051 \
  emdash.pty.PtyService/StartPty
```

**Note**: PTY output is streamed via WebSocket, not gRPC response.

---

#### StreamPtyData (Server-Streaming)

**This is the ONLY gRPC streaming endpoint.**

Streams PTY output events.

**Request:**
```protobuf
message PtyStreamRequest {
  string id = 1;
}
```

**Response (stream):**
```protobuf
message PtyStreamEvent {
  string id = 1;
  oneof event {
    PtyDataEvent data = 2;
    PtyExitEvent exit = 3;
  }
}

message PtyDataEvent {
  string id = 1;
  string data = 2;  // Base64-encoded terminal output
}

message PtyExitEvent {
  string id = 1;
  int32 exit_code = 2;
  string signal = 3;
}
```

**Example:**
```bash
grpcurl -plaintext \
  -H "authorization: Bearer $AUTH_SECRET" \
  -d '{"id": "pty-123"}' \
  localhost:50051 \
  emdash.pty.PtyService/StreamPtyData
```

**Note**: Most clients use WebSocket for PTY streaming instead.

---

#### WritePty

Sends input to the PTY.

**Request:**
```protobuf
message PtyWriteRequest {
  string id = 1;
  string data = 2;  // Raw input (keyboard)
}
```

**Response:**
```protobuf
google.protobuf.Empty
```

---

#### ResizePty

Resizes the PTY terminal.

**Request:**
```protobuf
message PtyResizeRequest {
  string id = 1;
  uint32 cols = 2;
  uint32 rows = 3;
}
```

**Response:**
```protobuf
google.protobuf.Empty
```

---

#### KillPty

Terminates a PTY session.

**Request:**
```protobuf
message PtyKillRequest {
  string id = 1;
}
```

**Response:**
```protobuf
google.protobuf.Empty
```

---

### AgentService

**Package**: `emdash.agent`
**Proto**: `api/proto/agent.proto`

#### StartAgent

Starts a coding agent (Codex, Claude, etc.).

**Request:**
```protobuf
message StartAgentRequest {
  string workspace_id = 1;
  string provider = 2;      // "codex", "claude", "cursor", etc.
  repeated string args = 3; // CLI arguments
  string cwd = 4;
  map<string, string> env = 5;
}
```

**Response:**
```protobuf
message StartAgentResponse {
  string agent_id = 1;
  int32 pid = 2;
}
```

**Example:**
```bash
grpcurl -plaintext \
  -H "authorization: Bearer $AUTH_SECRET" \
  -d '{
    "workspace_id": "ws-123",
    "provider": "codex",
    "args": ["Add user authentication"],
    "cwd": "/home/user/worktrees/feature-auth-1699876543"
  }' \
  localhost:50051 \
  emdash.agent.AgentService/StartAgent
```

**Note**: Agent output streams via WebSocket.

---

#### SendMessage

Sends a message to a running agent.

**Request:**
```protobuf
message SendMessageRequest {
  string workspace_id = 1;
  string message = 2;
}
```

**Response:**
```protobuf
google.protobuf.Empty
```

---

#### StopAgent

Stops a running agent.

**Request:**
```protobuf
message StopAgentRequest {
  string workspace_id = 1;
}
```

**Response:**
```protobuf
google.protobuf.Empty
```

---

#### GetAgentStatus

Gets the status of an agent.

**Request:**
```protobuf
message GetAgentStatusRequest {
  string workspace_id = 1;
}
```

**Response:**
```protobuf
message GetAgentStatusResponse {
  AgentStatus status = 1;
  int32 pid = 2;
  string error_message = 3;
}

enum AgentStatus {
  AGENT_STATUS_UNSPECIFIED = 0;
  AGENT_STATUS_STARTING = 1;
  AGENT_STATUS_RUNNING = 2;
  AGENT_STATUS_STOPPED = 3;
  AGENT_STATUS_ERROR = 4;
}
```

---

## WebSocket API

### Base URL

```
ws://localhost:8080/ws  (without TLS)
wss://localhost:8080/ws (with TLS)
```

### Connection

#### Establish Connection

```javascript
const ws = new WebSocket('ws://localhost:8080/ws', {
  headers: {
    'Authorization': 'Bearer <YOUR_AUTH_SECRET>'
  }
});

ws.on('open', () => {
  console.log('Connected to Emdash Server');
});

ws.on('message', (data) => {
  const event = JSON.parse(data);
  handleEvent(event);
});

ws.on('close', (code, reason) => {
  console.log('Disconnected:', code, reason);
});

ws.on('error', (error) => {
  console.error('WebSocket error:', error);
});
```

#### Authentication

The server validates the JWT token on connection. If invalid, the connection is immediately closed with code `1008` (Policy Violation).

---

### Message Format

All WebSocket messages are JSON objects with a `type` field:

```typescript
interface WebSocketMessage {
  type: string;
  [key: string]: any;
}
```

---

### Client → Server Messages

#### pty.write

Sends input to a PTY session.

**Format:**
```json
{
  "type": "pty.write",
  "id": "pty-123",
  "data": "ls -la\n"
}
```

**Fields:**
- `id`: PTY session ID
- `data`: Input string (keyboard input)

---

#### pty.resize

Resizes a PTY terminal.

**Format:**
```json
{
  "type": "pty.resize",
  "id": "pty-123",
  "cols": 120,
  "rows": 30
}
```

---

#### agent.sendMessage

Sends a message to a running agent.

**Format:**
```json
{
  "type": "agent.sendMessage",
  "workspace_id": "ws-123",
  "message": "Add error handling to the auth function"
}
```

---

### Server → Client Messages

#### pty.data

PTY output event.

**Format:**
```json
{
  "type": "pty.data",
  "id": "pty-123",
  "data": "total 48\ndrwxr-xr-x  12 user  staff   384 Nov 12 10:30 .\n..."
}
```

**Fields:**
- `id`: PTY session ID
- `data`: Terminal output (plain text)

**Rate**: Buffered and sent every 50ms or when buffer > 4KB.

---

#### pty.exit

PTY session exited.

**Format:**
```json
{
  "type": "pty.exit",
  "id": "pty-123",
  "exit_code": 0,
  "signal": ""
}
```

**Fields:**
- `id`: PTY session ID
- `exit_code`: Process exit code
- `signal`: Signal name (e.g., "SIGTERM") if killed

---

#### agent.output

Agent output event (reasoning, code, commands).

**Format:**
```json
{
  "type": "agent.output",
  "workspace_id": "ws-123",
  "chunk": "<reasoning>Analyzing the authentication requirements...</reasoning>"
}
```

**Fields:**
- `workspace_id`: Workspace ID
- `chunk`: Output fragment (may contain XML tags for reasoning, code, etc.)

**Rate**: Streamed in real-time as agent produces output.

---

#### agent.exit

Agent process exited.

**Format:**
```json
{
  "type": "agent.exit",
  "workspace_id": "ws-123",
  "exit_code": 0,
  "error": ""
}
```

**Fields:**
- `workspace_id`: Workspace ID
- `exit_code`: Process exit code
- `error`: Error message if non-zero exit

---

### Event Flow Diagram

```
Client                           Server
   │                                │
   ├─── ws://localhost:8080/ws ────>│  (Auth: Bearer token)
   │<─────── Connection OK ─────────┤
   │                                │
   ├─── {"type": "pty.write"} ─────>│
   │<──── {"type": "pty.data"} ─────┤
   │<──── {"type": "pty.data"} ─────┤
   │<──── {"type": "pty.exit"} ─────┤
   │                                │
   ├─── {"type": "agent.sendMessage"}│
   │<──── {"type": "agent.output"}──┤
   │<──── {"type": "agent.output"}──┤
   │<──── {"type": "agent.exit"} ───┤
   │                                │
```

---

## Error Handling

### gRPC Error Codes

The server uses standard gRPC status codes:

| Code | Status | Description |
|------|--------|-------------|
| 0 | OK | Success |
| 1 | CANCELLED | Request cancelled |
| 2 | UNKNOWN | Unknown error |
| 3 | INVALID_ARGUMENT | Invalid request parameters |
| 5 | NOT_FOUND | Resource not found |
| 7 | PERMISSION_DENIED | Auth failed or insufficient permissions |
| 13 | INTERNAL | Server internal error |
| 14 | UNAVAILABLE | Server unavailable |
| 16 | UNAUTHENTICATED | Missing or invalid token |

**Example Error:**
```json
{
  "code": 16,
  "message": "invalid token: signature is invalid",
  "details": []
}
```

---

### WebSocket Error Codes

The server uses standard WebSocket close codes:

| Code | Reason | Description |
|------|--------|-------------|
| 1000 | Normal Closure | Clean disconnect |
| 1001 | Going Away | Server shutting down |
| 1006 | Abnormal Closure | Network error (no close frame) |
| 1008 | Policy Violation | Authentication failed |
| 1011 | Internal Error | Server error |

**Example:**
```javascript
ws.on('close', (code, reason) => {
  if (code === 1008) {
    console.error('Authentication failed:', reason);
  }
});
```

---

## Examples

### Complete PTY Session (gRPC + WebSocket)

#### 1. Connect to WebSocket

```javascript
const ws = new WebSocket('ws://localhost:8080/ws', {
  headers: {
    'Authorization': `Bearer ${AUTH_SECRET}`
  }
});

ws.on('message', (data) => {
  const event = JSON.parse(data);

  if (event.type === 'pty.data') {
    process.stdout.write(event.data);
  }

  if (event.type === 'pty.exit') {
    console.log('PTY exited with code:', event.exit_code);
    ws.close();
  }
});
```

#### 2. Start PTY via gRPC

```bash
grpcurl -plaintext \
  -H "authorization: Bearer $AUTH_SECRET" \
  -d '{
    "id": "my-pty",
    "cwd": "/home/user/project",
    "shell": "/bin/bash",
    "cols": 80,
    "rows": 24
  }' \
  localhost:50051 \
  emdash.pty.PtyService/StartPty
```

#### 3. Send Input via WebSocket

```javascript
ws.send(JSON.stringify({
  type: 'pty.write',
  id: 'my-pty',
  data: 'ls -la\n'
}));
```

#### 4. Receive Output

Server streams via WebSocket:
```json
{"type": "pty.data", "id": "my-pty", "data": "total 48\n"}
{"type": "pty.data", "id": "my-pty", "data": "drwxr-xr-x  12 user  staff   384 Nov 12 10:30 .\n"}
```

#### 5. Kill PTY

```bash
grpcurl -plaintext \
  -H "authorization: Bearer $AUTH_SECRET" \
  -d '{"id": "my-pty"}' \
  localhost:50051 \
  emdash.pty.PtyService/KillPty
```

---

### Complete Agent Session

#### 1. Start Agent

```bash
grpcurl -plaintext \
  -H "authorization: Bearer $AUTH_SECRET" \
  -d '{
    "workspace_id": "feature-auth-123",
    "provider": "codex",
    "args": ["Add JWT authentication"],
    "cwd": "/home/user/worktrees/feature-auth"
  }' \
  localhost:50051 \
  emdash.agent.AgentService/StartAgent
```

**Response:**
```json
{
  "agent_id": "agent-456",
  "pid": 12345
}
```

#### 2. Receive Output via WebSocket

```json
{"type": "agent.output", "workspace_id": "feature-auth-123", "chunk": "<reasoning>I'll add JWT authentication to the API...</reasoning>"}
{"type": "agent.output", "workspace_id": "feature-auth-123", "chunk": "<code>const jwt = require('jsonwebtoken');</code>"}
{"type": "agent.exit", "workspace_id": "feature-auth-123", "exit_code": 0}
```

#### 3. Send Follow-up Message

```javascript
ws.send(JSON.stringify({
  type: 'agent.sendMessage',
  workspace_id: 'feature-auth-123',
  message: 'Add token expiration handling'
}));
```

---

## Rate Limits

Currently **no rate limits** are enforced. Future versions will implement:

- Per-user request limits
- Concurrent connection limits
- Bandwidth throttling for PTY/agent streaming

---

## Versioning

API follows semantic versioning:

- **Current**: v1.0
- **Breaking changes**: Will increment major version (v2.0)
- **Backward-compatible additions**: Will increment minor version (v1.1)

Protobuf allows backward-compatible schema evolution:
- New fields can be added without breaking existing clients
- Field numbers must never be reused

---

## Additional Resources

- [User Guide](./user-guide.md) - Quick start and feature guide
- [Security Guide](./security.md) - Authentication and audit logging
- [Deployment Guide](./deployment.md) - Production deployment
- [Protobuf Files](../api/proto/) - Full schema definitions

---

**Questions?** Open an issue on [GitHub](https://github.com/emdashhq/emdash-server/issues)
