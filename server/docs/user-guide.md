# Emdash Remote Server - User Guide

**Version**: 1.0
**Last Updated**: 2025-11-12

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Feature Guide](#feature-guide)
3. [Troubleshooting](#troubleshooting)
4. [FAQ](#faq)

---

## Quick Start

### Prerequisites

**Server Requirements:**
- Linux system (Ubuntu 20.04+ recommended)
- Docker (optional but recommended)
- Ports 50051 (gRPC) and 8080 (WebSocket) available
- Git installed

**Client Requirements:**
- Emdash Desktop App (latest version)
- Network access to the remote server

---

### Method 1: Docker Compose (Recommended)

This is the fastest and easiest way to deploy Emdash Server.

#### Step 1: Clone the Repository

```bash
git clone https://github.com/emdashhq/emdash-server.git
cd emdash-server/server
```

#### Step 2: Start the Server

```bash
./scripts/docker-start.sh
```

This script will:
- Generate a secure `AUTH_SECRET` token
- Create necessary data directories
- Build the Docker image (if not exists)
- Start the server with Docker Compose
- Display the connection information

**Example Output:**
```
==========================================
IMPORTANT: Save this AUTH_SECRET securely!
==========================================
AUTH_SECRET=affeecd07a7e4e8dd8d5035a4eabed918e3c78c0a799b0c4b8d2b7318d0c039f

You can set it in .env file or export it:
  export AUTH_SECRET=affeecd07a7e4e8dd8d5035a4eabed918e3c78c0a799b0c4b8d2b7318d0c039f
==========================================

Service endpoints:
  gRPC:      localhost:50051
  WebSocket: localhost:8080
```

**⚠️ IMPORTANT**: Save the `AUTH_SECRET` token securely. You'll need it to configure the Emdash client.

#### Step 3: Verify Server is Running

```bash
docker-compose ps
```

You should see:
```
NAME            IMAGE                  STATUS
emdash-server   emdash-server:latest   Up (healthy)
```

#### Step 4: View Logs

```bash
docker-compose logs -f
```

Look for these startup messages:
```json
{"level":"info","msg":"Emdash Server Starting..."}
{"level":"info","msg":"gRPC server listening","addr":":50051"}
{"level":"info","msg":"WebSocket server listening","addr":":8080"}
```

#### Step 5: Stop the Server

```bash
docker-compose down
```

---

### Method 2: Manual Build and Run

If you prefer not to use Docker:

#### Step 1: Build the Server

```bash
cd emdash-server/server
make build
```

This creates the binary: `./emdash-server`

#### Step 2: Configure Environment

Copy and edit the configuration:

```bash
cp config.example.env .env
nano .env
```

Set a secure `AUTH_SECRET`:

```bash
# Generate a random secret
openssl rand -hex 32

# Add to .env
AUTH_SECRET=your-generated-secret-here
TLS_ENABLED=false
```

#### Step 3: Run the Server

```bash
# Load environment variables
source .env

# Run the server
./emdash-server
```

Or with environment variables inline:

```bash
AUTH_SECRET=your-secret ./emdash-server
```

---

### Client Configuration

After the server is running, configure the Emdash Desktop App:

#### Step 1: Add Remote Server

1. Open Emdash Desktop App
2. Go to **Settings** → **Remote Servers**
3. Click **Add Server**
4. Fill in the details:
   - **Name**: My Remote Server
   - **gRPC URL**: `grpc://your-server-ip:50051`
   - **WebSocket URL**: `ws://your-server-ip:8080`
   - **Auth Token**: `<paste your AUTH_SECRET>`
5. Click **Test Connection**
6. If successful, click **Save**

**Example Configuration:**
```
Name:         Production Server
gRPC URL:     grpc://192.168.1.100:50051
WebSocket URL: ws://192.168.1.100:8080
Auth Token:   affeecd07a7e4e8dd8d5035a4eabed918e3c78c0a799b0c4b8d2b7318d0c039f
```

#### Step 2: Create a Remote Project

1. Click **New Project**
2. Set **Mode** to **Remote**
3. Select your remote server from the dropdown
4. Configure project settings:
   - **Project Name**: My Project
   - **Project Path**: `/path/to/project/on/server`
5. Click **Create**

#### Step 3: Start Working

You can now:
- Create remote workspaces
- Open remote terminals
- Run agents on the remote server
- View git status and diffs

---

## Feature Guide

### Remote Workspace Management

**What is a Workspace?**
A workspace is a Git worktree on the remote server. Each workspace has its own branch and working directory.

#### Create a Workspace

Via the Emdash UI:
1. Select your remote project
2. Click **New Workspace**
3. Enter workspace name (e.g., `feature-auth`)
4. The server creates:
   - A new Git branch: `agent/feature-auth-<timestamp>`
   - A new worktree directory: `../worktrees/feature-auth-<timestamp>`

#### List Workspaces

```bash
# Via gRPC call (example using grpcurl)
grpcurl -plaintext \
  -H "authorization: Bearer <AUTH_SECRET>" \
  -d '{"project_path": "/path/to/project"}' \
  localhost:50051 \
  emdash.worktree.WorktreeService/ListWorktrees
```

Response:
```json
{
  "worktrees": [
    {
      "id": "feature-auth-1699876543",
      "name": "feature-auth",
      "branch": "agent/feature-auth-1699876543",
      "path": "/path/to/worktrees/feature-auth-1699876543",
      "status": "WORKTREE_STATUS_ACTIVE",
      "created_at": "2025-11-12T10:30:00Z"
    }
  ]
}
```

#### Remove a Workspace

Via the Emdash UI:
1. Right-click on the workspace
2. Select **Delete Workspace**
3. Confirm deletion

This will:
- Remove the worktree directory
- Delete the Git branch (optional)

---

### Remote Terminal (PTY)

**What is PTY?**
PTY (Pseudo-Terminal) allows you to run shell commands on the remote server with real-time input/output streaming.

#### Start a Terminal

Via the Emdash UI:
1. Select a workspace
2. Click **Open Terminal**
3. A new terminal tab opens

Behind the scenes:
- Client sends `PtyStart` gRPC request
- Server spawns a shell process (bash/zsh)
- Output is streamed via WebSocket

#### Features

- **Real-time streaming**: < 100ms latency (LAN)
- **Full interactivity**: Arrow keys, Ctrl+C, tab completion
- **Resize support**: Terminal automatically resizes with window
- **Session persistence**: Reconnects after network interruption

#### Example: Running Commands

```bash
# In the remote terminal
cd ~/myproject
git status
npm install
npm test
```

All commands run on the remote server, not your local machine.

---

### Remote Agent Execution

**What is an Agent?**
An agent is a CLI tool (like Codex, Claude Code, Cursor) that runs on the remote server to generate code or perform tasks.

#### Start an Agent

Via the Emdash UI:
1. Select a workspace
2. Click **Start Agent**
3. Choose provider (e.g., Codex)
4. Type your prompt
5. Agent output streams in real-time

#### Supported Providers

- Codex (OpenAI)
- Claude Code
- Cursor
- Gemini
- GitHub Copilot CLI
- Custom CLI tools

#### Example: Codex Agent

```bash
# Server runs this command
codex "Add user authentication to the API"
```

The agent's output (code, reasoning, commands) streams back to the Emdash UI.

---

### Git Operations

#### View Status

Shows all changes in the workspace:
- Staged files
- Unstaged files
- Untracked files

```bash
# Via gRPC
grpcurl -plaintext \
  -H "authorization: Bearer <AUTH_SECRET>" \
  -d '{"workspace_path": "/path/to/worktree"}' \
  localhost:50051 \
  emdash.git.GitService/GetStatus
```

#### Stage Files

```bash
# Via gRPC
grpcurl -plaintext \
  -H "authorization: Bearer <AUTH_SECRET>" \
  -d '{"workspace_path": "/path/to/worktree", "file_path": "src/auth.js"}' \
  localhost:50051 \
  emdash.git.GitService/StageFile
```

#### View File Diff

```bash
# Via gRPC
grpcurl -plaintext \
  -H "authorization: Bearer <AUTH_SECRET>" \
  -d '{"workspace_path": "/path/to/worktree", "file_path": "src/auth.js"}' \
  localhost:50051 \
  emdash.git.GitService/GetFileDiff
```

---

## Troubleshooting

### Connection Issues

#### Problem: "Cannot connect to remote server"

**Symptoms:**
- Emdash UI shows "Offline" for the remote server
- Connection test fails

**Solutions:**

1. **Check server is running:**
   ```bash
   docker-compose ps
   # or
   ps aux | grep emdash-server
   ```

2. **Check network connectivity:**
   ```bash
   # From client machine
   telnet <server-ip> 50051
   telnet <server-ip> 8080
   ```

3. **Check firewall rules:**
   ```bash
   # On server
   sudo ufw status
   sudo ufw allow 50051/tcp
   sudo ufw allow 8080/tcp
   ```

4. **Check server logs:**
   ```bash
   docker-compose logs -f emdash-server
   ```

5. **Verify AUTH_SECRET:**
   - Make sure the token in Emdash UI matches the server's `AUTH_SECRET`
   - Check `.env` file on server

---

#### Problem: "Authentication failed"

**Symptoms:**
- Connection test shows "Unauthorized"
- Logs show: `invalid token` or `unauthenticated`

**Solutions:**

1. **Regenerate AUTH_SECRET:**
   ```bash
   cd server
   openssl rand -hex 32
   # Update .env file
   # Restart server
   docker-compose restart
   ```

2. **Check token format:**
   - Token should be 64 hex characters (32 bytes)
   - No spaces or special characters

3. **Update client configuration:**
   - Settings → Remote Servers → Edit
   - Paste the correct AUTH_SECRET
   - Save and test connection

---

### PTY Issues

#### Problem: "Terminal is slow / High latency"

**Symptoms:**
- Typing lag > 500ms
- Commands take long to execute

**Solutions:**

1. **Check network latency:**
   ```bash
   ping <server-ip>
   ```
   - LAN: < 10ms (expected)
   - WAN: < 100ms (acceptable)
   - > 200ms: Network issue

2. **Check server load:**
   ```bash
   # On server
   top
   htop
   ```
   - High CPU/memory usage? Close unused processes

3. **Enable WebSocket compression:**
   Already enabled by default. Check logs for:
   ```json
   {"msg":"websocket compression enabled"}
   ```

4. **Check for packet loss:**
   ```bash
   mtr <server-ip>
   ```

---

#### Problem: "Terminal output is garbled"

**Symptoms:**
- Strange characters like `^[[A`, `^[[B`
- Colors not displaying correctly

**Solutions:**

1. **Check TERM variable:**
   ```bash
   # In remote terminal
   echo $TERM
   # Should be: xterm-256color
   ```

2. **Resize terminal:**
   - Drag terminal window
   - Server should auto-resize PTY

3. **Clear terminal:**
   ```bash
   reset
   # or
   clear
   ```

---

### Agent Issues

#### Problem: "Agent has no output"

**Symptoms:**
- Agent starts but produces no output
- UI shows "Agent running..." indefinitely

**Solutions:**

1. **Check agent is installed on server:**
   ```bash
   # SSH into server
   which codex
   which claude
   ```

2. **Check agent logs:**
   ```bash
   docker-compose logs -f emdash-server | grep agent
   ```

3. **Test agent manually:**
   ```bash
   # On server
   codex --version
   codex "write hello world in python"
   ```

4. **Check agent credentials:**
   - Codex: `OPENAI_API_KEY` must be set
   - Claude: `ANTHROPIC_API_KEY` must be set

5. **Restart agent:**
   - Stop current agent session
   - Start new session

---

#### Problem: "Agent crashes / exits unexpectedly"

**Symptoms:**
- Agent output stops mid-execution
- Error message: "Agent exited with code 1"

**Solutions:**

1. **Check agent logs:**
   ```bash
   docker-compose logs emdash-server | grep -A 10 "agent.*error"
   ```

2. **Common causes:**
   - API key expired or invalid
   - Rate limit exceeded
   - Network timeout

3. **Retry with simpler prompt:**
   - Test with: "write hello world"
   - If works, original prompt may be too complex

---

### Data Persistence Issues

#### Problem: "Workspaces disappear after restart"

**Symptoms:**
- Created workspaces not listed after server restart

**Solutions:**

1. **Check data volumes:**
   ```bash
   docker-compose down
   ls -la data/
   # Should see: projects/, worktrees/, logs/
   ```

2. **Verify docker-compose.yml:**
   ```yaml
   volumes:
     - ./data/projects:/data/projects
     - ./data/worktrees:/data/worktrees
   ```

3. **Check file permissions:**
   ```bash
   sudo chown -R $USER:$USER data/
   chmod -R 755 data/
   ```

---

### Performance Issues

#### Problem: "Server is slow / Unresponsive"

**Symptoms:**
- API calls timeout
- UI freezes
- High response times

**Solutions:**

1. **Check resource usage:**
   ```bash
   docker stats emdash-server
   ```

2. **Increase resource limits:**
   Edit `docker-compose.yml`:
   ```yaml
   deploy:
     resources:
       limits:
         cpus: '4.0'
         memory: 4G
   ```

3. **Check concurrent sessions:**
   ```bash
   # Too many PTY sessions or agents running?
   docker-compose logs | grep -c "pty.*started"
   docker-compose logs | grep -c "agent.*started"
   ```

4. **Restart server:**
   ```bash
   docker-compose restart
   ```

---

## FAQ

### General Questions

**Q: Can I run multiple projects on one server?**
A: Yes! Each project can have multiple workspaces. Configure project paths accordingly.

**Q: Is HTTPS/TLS required?**
A: Not required but **highly recommended** for production. See [TLS Setup Guide](./tls-setup.md).

**Q: Can multiple clients connect to the same server?**
A: Yes! Each client uses the same `AUTH_SECRET` to authenticate. Future versions will support per-user authentication.

**Q: What happens if the server crashes?**
A: Docker Compose auto-restarts the container. Workspaces and data persist in volumes.

**Q: Can I use this over the internet?**
A: Yes, but you MUST:
- Enable TLS (see [TLS Setup](./tls-setup.md))
- Use a strong `AUTH_SECRET`
- Configure firewall rules
- Consider using a VPN

---

### Security Questions

**Q: Is my code secure on the remote server?**
A: Server stores code in Git worktrees. Ensure:
- Server has encrypted disk
- SSH access is restricted
- Regular backups

**Q: How do I rotate AUTH_SECRET?**
A:
```bash
# 1. Generate new secret
openssl rand -hex 32

# 2. Update server .env
nano .env
# Set new AUTH_SECRET

# 3. Restart server
docker-compose restart

# 4. Update all clients with new token
```

**Q: Are agent API keys secure?**
A: Agent API keys are stored as environment variables on the server. Use secret management tools (e.g., Docker secrets, HashiCorp Vault) for production.

---

### Deployment Questions

**Q: What's the difference between Docker and systemd deployment?**
A:
- **Docker**: Easier, isolated, recommended for most users
- **Systemd**: Native Linux service, lower overhead, for advanced users

**Q: Can I run this on macOS/Windows?**
A: Server requires Linux. Use:
- macOS: Docker Desktop (Linux VM)
- Windows: WSL2 + Docker

**Q: How do I upgrade the server?**
A:
```bash
# Pull latest code
git pull origin main

# Rebuild image
docker build -t emdash-server:latest .

# Restart with new image
docker-compose up -d
```

**Q: How do I backup my data?**
A:
```bash
# Backup data directory
tar -czf emdash-backup-$(date +%Y%m%d).tar.gz data/

# Or use Docker volume backup
docker run --rm \
  -v emdash_data:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/data-backup.tar.gz /data
```

---

## Next Steps

- [API Documentation](./api.md) - gRPC and WebSocket API reference
- [Deployment Guide](./deployment.md) - Production deployment best practices
- [Security Guide](./security.md) - Security hardening and audit logging
- [TLS Setup](./tls-setup.md) - Enable HTTPS/WSS encryption

---

**Need help?** Open an issue on [GitHub](https://github.com/emdashhq/emdash-server/issues)
