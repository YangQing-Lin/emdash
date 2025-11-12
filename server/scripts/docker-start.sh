#!/bin/bash

set -e

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$(dirname "$SCRIPT_DIR")"

# Change to server directory
cd "$SERVER_DIR"

echo "========================================"
echo "Emdash Server - Docker Compose Start"
echo "========================================"
echo ""

# Check if docker-compose.yml exists
if [ ! -f "docker-compose.yml" ]; then
    echo "ERROR: docker-compose.yml not found in $SERVER_DIR"
    exit 1
fi

# Generate AUTH_SECRET if not set
if [ -z "$AUTH_SECRET" ]; then
    echo "Generating new AUTH_SECRET..."
    export AUTH_SECRET=$(openssl rand -hex 32)
    echo ""
    echo "=========================================="
    echo "IMPORTANT: Save this AUTH_SECRET securely!"
    echo "=========================================="
    echo "AUTH_SECRET=$AUTH_SECRET"
    echo ""
    echo "You can set it in .env file or export it:"
    echo "  export AUTH_SECRET=$AUTH_SECRET"
    echo "=========================================="
    echo ""

    # Create .env file if it doesn't exist
    if [ ! -f ".env" ]; then
        echo "Creating .env file..."
        cat > .env <<EOF
# Emdash Server Environment Configuration
# Generated on $(date)

AUTH_SECRET=$AUTH_SECRET
TLS_ENABLED=false

# Uncomment and configure for production:
# TLS_ENABLED=true
# TLS_CERT_FILE=/app/certs/server.crt
# TLS_KEY_FILE=/app/certs/server.key
EOF
        echo ".env file created!"
        echo ""
    fi
fi

# Create data directories if they don't exist
echo "Creating data directories..."
mkdir -p data/projects data/worktrees data/logs
echo "Data directories created."
echo ""

# Pull/build the latest image
echo "Checking Docker image..."
if ! docker images emdash-server:latest --format "{{.Repository}}" | grep -q "emdash-server"; then
    echo "Image not found. Building..."
    docker build -t emdash-server:latest .
else
    echo "Image found: emdash-server:latest"
fi
echo ""

# Start services
echo "Starting Docker Compose services..."
docker-compose up -d

echo ""
echo "=========================================="
echo "Services started successfully!"
echo "=========================================="
echo ""
echo "Service endpoints:"
echo "  gRPC:      localhost:50051"
echo "  WebSocket: localhost:8080"
echo ""
echo "To view logs:"
echo "  docker-compose logs -f"
echo ""
echo "To stop services:"
echo "  docker-compose down"
echo ""
echo "To check status:"
echo "  docker-compose ps"
echo "=========================================="
