# Emdash Remote Server - Deployment Guide

**Version**: 1.0
**Last Updated**: 2025-11-12

---

## Table of Contents

1. [System Requirements](#system-requirements)
2. [Deployment Methods](#deployment-methods)
3. [Security Hardening](#security-hardening)
4. [Monitoring & Logs](#monitoring--logs)
5. [Backup & Recovery](#backup--recovery)
6. [Upgrades](#upgrades)
7. [Production Checklist](#production-checklist)

---

## System Requirements

### Minimum Requirements

| Resource | Requirement |
|----------|-------------|
| **OS** | Linux (Ubuntu 20.04+, Debian 11+, RHEL 8+) |
| **CPU** | 1 vCPU (2+ recommended) |
| **RAM** | 2 GB (4 GB+ recommended) |
| **Disk** | 20 GB (SSD recommended) |
| **Network** | Stable internet, low latency |

### Recommended Production Setup

| Resource | Specification |
|----------|--------------|
| **OS** | Ubuntu 22.04 LTS |
| **CPU** | 4 vCPU |
| **RAM** | 8 GB |
| **Disk** | 100 GB SSD |
| **Network** | 1 Gbps, < 50ms latency to clients |

### Required Ports

| Port | Protocol | Purpose | Firewall Rule |
|------|----------|---------|---------------|
| 50051 | TCP | gRPC API | Allow from client IPs |
| 8080 | TCP | WebSocket | Allow from client IPs |
| 22 | TCP | SSH (management) | Allow from admin IPs only |

**⚠️ Security Note**: Do NOT expose ports 50051 and 8080 to the public internet without TLS/WSS encryption.

---

## Deployment Methods

### Method 1: Docker Compose (Recommended)

**Pros:**
- Easiest setup
- Isolated environment
- Easy to upgrade
- Works on any Linux with Docker

**Cons:**
- Requires Docker installation
- Slightly higher resource usage

#### Installation Steps

##### 1. Install Docker and Docker Compose

**Ubuntu/Debian:**
```bash
# Update package list
sudo apt-get update

# Install prerequisites
sudo apt-get install -y apt-transport-https ca-certificates curl software-properties-common

# Add Docker GPG key
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo apt-key add -

# Add Docker repository
sudo add-apt-repository "deb [arch=amd64] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable"

# Install Docker
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# Add your user to docker group
sudo usermod -aG docker $USER
newgrp docker

# Verify installation
docker --version
docker compose version
```

**RHEL/CentOS:**
```bash
sudo yum install -y yum-utils
sudo yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
sudo yum install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo systemctl start docker
sudo systemctl enable docker
```

##### 2. Clone Repository

```bash
git clone https://github.com/emdashhq/emdash-server.git
cd emdash-server/server
```

##### 3. Configure Environment

```bash
# Generate secure AUTH_SECRET
export AUTH_SECRET=$(openssl rand -hex 32)

# Create .env file
cat > .env <<EOF
# Authentication
AUTH_SECRET=$AUTH_SECRET

# TLS Configuration (set to true in production)
TLS_ENABLED=false
TLS_CERT_FILE=/app/certs/server.crt
TLS_KEY_FILE=/app/certs/server.key
EOF

# Secure the .env file
chmod 600 .env

# Save AUTH_SECRET in a secure location!
echo "AUTH_SECRET=$AUTH_SECRET" > ~/emdash-auth-secret.txt
chmod 600 ~/emdash-auth-secret.txt
```

##### 4. Start Services

```bash
# One-liner start (builds image, creates volumes, starts container)
./scripts/docker-start.sh

# Or manually:
docker build -t emdash-server:latest .
docker compose up -d
```

##### 5. Verify Deployment

```bash
# Check container status
docker compose ps

# View logs
docker compose logs -f

# Check health
docker inspect emdash-server | grep -i health
```

Expected output:
```
NAME            STATUS
emdash-server   Up (healthy)
```

##### 6. Configure Firewall

```bash
# Allow gRPC and WebSocket ports
sudo ufw allow 50051/tcp comment 'Emdash gRPC'
sudo ufw allow 8080/tcp comment 'Emdash WebSocket'

# Enable firewall
sudo ufw enable
```

---

### Method 2: Systemd Service

**Pros:**
- Native Linux service
- Lower resource overhead
- No Docker dependency

**Cons:**
- More complex setup
- Manual dependency management
- Requires Go toolchain for building

#### Installation Steps

##### 1. Install Dependencies

```bash
# Install Go 1.24+
wget https://go.dev/dl/go1.24.0.linux-amd64.tar.gz
sudo tar -C /usr/local -xzf go1.24.0.linux-amd64.tar.gz
export PATH=$PATH:/usr/local/go/bin
echo 'export PATH=$PATH:/usr/local/go/bin' >> ~/.bashrc

# Install Git
sudo apt-get install -y git

# Verify
go version
git --version
```

##### 2. Build Server

```bash
# Clone repository
git clone https://github.com/emdashhq/emdash-server.git
cd emdash-server/server

# Build binary
make build

# Verify binary
./emdash-server --version
```

##### 3. Install Server

```bash
# Create dedicated user
sudo useradd -r -s /bin/false -d /opt/emdash-server emdash

# Create installation directory
sudo mkdir -p /opt/emdash-server
sudo mkdir -p /var/log/emdash-server
sudo mkdir -p /etc/emdash-server

# Copy binary
sudo cp emdash-server /opt/emdash-server/
sudo chmod +x /opt/emdash-server/emdash-server

# Set ownership
sudo chown -R emdash:emdash /opt/emdash-server
sudo chown -R emdash:emdash /var/log/emdash-server
```

##### 4. Configure Environment

```bash
# Generate AUTH_SECRET
AUTH_SECRET=$(openssl rand -hex 32)

# Create config file
sudo tee /etc/emdash-server/config.env > /dev/null <<EOF
AUTH_SECRET=$AUTH_SECRET
TLS_ENABLED=false
TLS_CERT_FILE=/etc/emdash-server/certs/server.crt
TLS_KEY_FILE=/etc/emdash-server/certs/server.key
EOF

# Secure config
sudo chmod 600 /etc/emdash-server/config.env
sudo chown emdash:emdash /etc/emdash-server/config.env

# Save secret
echo "AUTH_SECRET=$AUTH_SECRET" > ~/emdash-auth-secret.txt
chmod 600 ~/emdash-auth-secret.txt
```

##### 5. Create Systemd Service

```bash
sudo tee /etc/systemd/system/emdash-server.service > /dev/null <<'EOF'
[Unit]
Description=Emdash Remote Server
Documentation=https://github.com/emdashhq/emdash-server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=emdash
Group=emdash
WorkingDirectory=/opt/emdash-server
EnvironmentFile=/etc/emdash-server/config.env
ExecStart=/opt/emdash-server/emdash-server
Restart=always
RestartSec=10s
StandardOutput=journal
StandardError=journal
SyslogIdentifier=emdash-server

# Security hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/log/emdash-server

# Resource limits
LimitNOFILE=65536
LimitNPROC=4096

[Install]
WantedBy=multi-user.target
EOF
```

##### 6. Start Service

```bash
# Reload systemd
sudo systemctl daemon-reload

# Enable auto-start
sudo systemctl enable emdash-server

# Start service
sudo systemctl start emdash-server

# Check status
sudo systemctl status emdash-server
```

##### 7. View Logs

```bash
# Follow logs
sudo journalctl -u emdash-server -f

# View recent logs
sudo journalctl -u emdash-server -n 100
```

---

### Method 3: Manual Run (Development Only)

**For development/testing only. NOT recommended for production.**

```bash
cd emdash-server/server
source .env
./emdash-server
```

---

## Security Hardening

### 1. Enable TLS/WSS Encryption

**⚠️ CRITICAL for production deployments.**

#### Generate Self-Signed Certificates (Development/Testing)

```bash
cd server
./scripts/gen-cert.sh
```

This creates:
- `certs/server.crt` (certificate)
- `certs/server.key` (private key)

Update `.env`:
```bash
TLS_ENABLED=true
TLS_CERT_FILE=/app/certs/server.crt
TLS_KEY_FILE=/app/certs/server.key
```

Restart server:
```bash
docker compose restart
# or
sudo systemctl restart emdash-server
```

#### Use Let's Encrypt (Production)

For production, use Let's Encrypt for free, trusted certificates.

##### Install Certbot

```bash
sudo apt-get install -y certbot
```

##### Obtain Certificate

```bash
# Replace with your domain
sudo certbot certonly --standalone -d emdash.example.com
```

Certificates are saved to:
```
/etc/letsencrypt/live/emdash.example.com/fullchain.pem
/etc/letsencrypt/live/emdash.example.com/privkey.pem
```

##### Configure Server

Update `.env`:
```bash
TLS_ENABLED=true
TLS_CERT_FILE=/etc/letsencrypt/live/emdash.example.com/fullchain.pem
TLS_KEY_FILE=/etc/letsencrypt/live/emdash.example.com/privkey.pem
```

For Docker, mount certificates:
```yaml
# docker-compose.yml
volumes:
  - /etc/letsencrypt:/etc/letsencrypt:ro
```

##### Auto-Renewal

```bash
# Test renewal
sudo certbot renew --dry-run

# Add cron job for auto-renewal
sudo crontab -e

# Add this line (renews every day at 2am)
0 2 * * * certbot renew --quiet && docker compose restart emdash-server
```

---

### 2. Firewall Configuration

#### UFW (Ubuntu)

```bash
# Default deny
sudo ufw default deny incoming
sudo ufw default allow outgoing

# Allow SSH (from specific IP only!)
sudo ufw allow from <your-admin-ip> to any port 22

# Allow Emdash ports (from client IPs or VPN subnet)
sudo ufw allow from <client-ip-range> to any port 50051
sudo ufw allow from <client-ip-range> to any port 8080

# Enable firewall
sudo ufw enable

# Check status
sudo ufw status numbered
```

#### Firewalld (RHEL/CentOS)

```bash
# Add rules
sudo firewall-cmd --permanent --add-rich-rule='rule family="ipv4" source address="<client-ip-range>" port protocol="tcp" port="50051" accept'
sudo firewall-cmd --permanent --add-rich-rule='rule family="ipv4" source address="<client-ip-range>" port protocol="tcp" port="8080" accept'

# Reload
sudo firewall-cmd --reload

# Check
sudo firewall-cmd --list-all
```

---

### 3. SSH Hardening

Edit `/etc/ssh/sshd_config`:

```bash
# Disable root login
PermitRootLogin no

# Disable password authentication (use SSH keys only)
PasswordAuthentication no
PubkeyAuthentication yes

# Disable empty passwords
PermitEmptyPasswords no

# Change default port (optional)
Port 2222
```

Restart SSH:
```bash
sudo systemctl restart sshd
```

---

### 4. Secure AUTH_SECRET Management

**Best Practices:**

1. **Generate strong secrets:**
   ```bash
   openssl rand -hex 32
   ```

2. **Never commit to Git:**
   Add to `.gitignore`:
   ```
   .env
   *-secret.txt
   ```

3. **Restrict file permissions:**
   ```bash
   chmod 600 .env
   chmod 600 /etc/emdash-server/config.env
   ```

4. **Rotate periodically:**
   - Rotate every 90 days
   - Update all clients after rotation

5. **Use secret management (production):**
   - HashiCorp Vault
   - AWS Secrets Manager
   - Docker Secrets

---

### 5. Network Security

#### Use VPN (Recommended)

Instead of exposing ports to the internet, use a VPN:

- **WireGuard** (modern, fast)
- **OpenVPN** (mature, widely supported)
- **Tailscale** (easiest, zero-config)

Clients connect via VPN, Emdash traffic stays on private network.

#### Use Reverse Proxy (Nginx)

For additional security, use Nginx as a reverse proxy with rate limiting.

See [Nginx Configuration](#nginx-reverse-proxy-optional) below.

---

## Monitoring & Logs

### View Logs

#### Docker Compose

```bash
# All logs
docker compose logs -f

# Last 100 lines
docker compose logs --tail=100

# Filter by level
docker compose logs | grep level=error
```

#### Systemd

```bash
# Follow logs
sudo journalctl -u emdash-server -f

# Recent errors
sudo journalctl -u emdash-server -p err -n 50
```

### Log Format

Logs are structured JSON (zap logger):

```json
{
  "level": "info",
  "ts": 1699876543.123,
  "caller": "emdash-server/main.go:121",
  "msg": "gRPC server listening",
  "addr": ":50051",
  "tls_enabled": true
}
```

**Log Levels:**
- `debug`: Verbose debugging
- `info`: Normal operations
- `warn`: Warnings, non-critical
- `error`: Errors, requires attention
- `fatal`: Critical errors, server crash

### Audit Logs

Security-sensitive operations are logged with `audit=true`:

```json
{
  "level": "info",
  "msg": "audit",
  "audit": true,
  "userId": "user-123",
  "action": "worktree.create",
  "resource": "/home/user/project",
  "success": true,
  "timestamp": "2025-11-12T10:30:43Z"
}
```

**Audited Actions:**
- Worktree create/delete
- Agent start/stop
- Authentication failures

**Filter audit logs:**
```bash
docker compose logs | grep audit=true
```

### Metrics & Health Checks

#### Health Check Endpoint

Docker Compose includes a health check:

```yaml
healthcheck:
  test: ["CMD", "nc", "-z", "localhost", "50051"]
  interval: 30s
  timeout: 10s
  retries: 3
```

Check health:
```bash
docker inspect emdash-server | grep -A 10 Health
```

#### Resource Usage

```bash
# Docker stats
docker stats emdash-server

# System resources
htop
```

---

## Backup & Recovery

### What to Backup

| Item | Path | Frequency | Critical |
|------|------|-----------|----------|
| **Configuration** | `.env` or `/etc/emdash-server/config.env` | After changes | ✅ Critical |
| **Projects** | `data/projects/` | Daily | ✅ Critical |
| **Worktrees** | `data/worktrees/` | Hourly | ⚠️ Important |
| **Logs** | `data/logs/` | Weekly | ℹ️ Optional |
| **Certificates** | `certs/` or `/etc/letsencrypt/` | After renewal | ✅ Critical |

### Backup Procedures

#### Manual Backup

```bash
# Stop server
docker compose down
# or
sudo systemctl stop emdash-server

# Create backup
tar -czf emdash-backup-$(date +%Y%m%d).tar.gz \
  data/ \
  .env \
  certs/

# Verify backup
tar -tzf emdash-backup-$(date +%Y%m%d).tar.gz

# Restart server
docker compose up -d
# or
sudo systemctl start emdash-server

# Store backup securely (off-site)
scp emdash-backup-*.tar.gz backup-server:/backups/emdash/
```

#### Automated Backup Script

```bash
#!/bin/bash
# /opt/emdash-server/backup.sh

BACKUP_DIR="/backups/emdash"
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/emdash-backup-$DATE.tar.gz"

# Create backup
cd /path/to/emdash-server/server
tar -czf "$BACKUP_FILE" data/ .env certs/

# Keep only last 30 days
find "$BACKUP_DIR" -name "emdash-backup-*.tar.gz" -mtime +30 -delete

# Upload to S3 (optional)
# aws s3 cp "$BACKUP_FILE" s3://my-bucket/emdash-backups/
```

Add to cron:
```bash
crontab -e

# Daily backup at 3am
0 3 * * * /opt/emdash-server/backup.sh
```

### Recovery Procedures

#### Restore from Backup

```bash
# Stop server
docker compose down

# Extract backup
tar -xzf emdash-backup-20251112.tar.gz

# Verify files
ls -la data/ .env certs/

# Restart server
docker compose up -d

# Verify
docker compose logs -f
```

#### Disaster Recovery

In case of complete server loss:

1. **Provision new server** with same specifications
2. **Install Docker/systemd** (same deployment method)
3. **Restore from backup**:
   ```bash
   scp backup-server:/backups/emdash/latest.tar.gz .
   tar -xzf latest.tar.gz
   ```
4. **Start server**
5. **Update DNS** (if domain changed)
6. **Update clients** with new server address

**Recovery Time Objective (RTO)**: < 1 hour
**Recovery Point Objective (RPO)**: Last backup (daily = 24 hours)

---

## Upgrades

### Minor Upgrades (Same Major Version)

Example: v1.0 → v1.1

```bash
# 1. Backup first!
./backup.sh

# 2. Pull latest code
git pull origin main

# 3. Rebuild image
docker build -t emdash-server:latest .

# 4. Restart with new image
docker compose up -d

# 5. Verify
docker compose logs -f
```

**Downtime**: < 10 seconds (Docker Compose rolling update)

### Major Upgrades (Breaking Changes)

Example: v1.x → v2.0

**⚠️ Follow official upgrade guide for major versions.**

General steps:

1. **Read release notes** for breaking changes
2. **Test in staging** environment first
3. **Backup production** data
4. **Schedule maintenance window**
5. **Perform upgrade**
6. **Run migration scripts** (if any)
7. **Update clients** to compatible version
8. **Monitor for issues**

---

## Nginx Reverse Proxy (Optional)

For additional security, SSL termination, and rate limiting:

### Install Nginx

```bash
sudo apt-get install -y nginx
```

### Configure Nginx

```bash
sudo tee /etc/nginx/sites-available/emdash <<'EOF'
upstream grpc_backend {
    server localhost:50051;
}

upstream ws_backend {
    server localhost:8080;
}

# Rate limiting
limit_req_zone $binary_remote_addr zone=api_limit:10m rate=10r/s;
limit_req_zone $binary_remote_addr zone=ws_limit:10m rate=5r/s;

server {
    listen 443 ssl http2;
    server_name emdash.example.com;

    # SSL certificates
    ssl_certificate /etc/letsencrypt/live/emdash.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/emdash.example.com/privkey.pem;

    # SSL hardening
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers 'ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256';
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;

    # gRPC endpoint
    location /emdash. {
        limit_req zone=api_limit burst=20 nodelay;

        grpc_pass grpc://grpc_backend;
        grpc_set_header X-Real-IP $remote_addr;
        grpc_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    # WebSocket endpoint
    location /ws {
        limit_req zone=ws_limit burst=10 nodelay;

        proxy_pass http://ws_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}

# Redirect HTTP to HTTPS
server {
    listen 80;
    server_name emdash.example.com;
    return 301 https://$server_name$request_uri;
}
EOF
```

### Enable Configuration

```bash
sudo ln -s /etc/nginx/sites-available/emdash /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### Update Firewall

```bash
# Allow HTTPS
sudo ufw allow 443/tcp

# Block direct access to Emdash ports (only allow from localhost)
sudo ufw deny 50051/tcp
sudo ufw deny 8080/tcp
```

### Update Clients

Change client configuration:
- gRPC URL: `grpcs://emdash.example.com:443`
- WebSocket URL: `wss://emdash.example.com:443/ws`

---

## Production Checklist

Before going to production, verify:

### Security
- [ ] TLS/WSS encryption enabled
- [ ] Strong `AUTH_SECRET` (32+ bytes hex)
- [ ] Firewall configured (allow only client IPs)
- [ ] SSH hardened (keys only, no root)
- [ ] OS and packages updated
- [ ] Audit logs enabled

### Deployment
- [ ] Using Docker Compose or systemd
- [ ] Auto-restart on failure configured
- [ ] Health checks enabled
- [ ] Resource limits set (CPU, memory)

### Networking
- [ ] Ports 50051, 8080 exposed only to VPN/clients
- [ ] Rate limiting configured (Nginx)
- [ ] DNS configured (if using domain)

### Monitoring
- [ ] Log aggregation setup (optional)
- [ ] Disk space monitoring (alert at 80%)
- [ ] CPU/memory monitoring
- [ ] Uptime monitoring (Pingdom, UptimeRobot)

### Backup
- [ ] Automated daily backups
- [ ] Backups stored off-site
- [ ] Recovery tested once

### Documentation
- [ ] `AUTH_SECRET` saved securely
- [ ] Server IP/domain documented
- [ ] Firewall rules documented
- [ ] Runbook for common issues

---

## Next Steps

- [User Guide](./user-guide.md) - Quick start and feature guide
- [API Documentation](./api.md) - gRPC and WebSocket API reference
- [Security Guide](./security.md) - Detailed security hardening
- [TLS Setup](./tls-setup.md) - TLS/WSS configuration

---

**Questions?** Open an issue on [GitHub](https://github.com/emdashhq/emdash-server/issues)
