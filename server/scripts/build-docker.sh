#!/bin/bash

set -e

# Default values
IMAGE_NAME="emdash-server"
TAG="${1:-latest}"

echo "Building Docker image: ${IMAGE_NAME}:${TAG}"
echo "========================================"

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$(dirname "$SCRIPT_DIR")"

# Change to server directory
cd "$SERVER_DIR"

# Build the image
docker build -t "${IMAGE_NAME}:${TAG}" .

echo ""
echo "Build completed successfully!"
echo "========================================"

# Show image info
echo ""
echo "Image details:"
docker images "${IMAGE_NAME}:${TAG}" --format "table {{.Repository}}\t{{.Tag}}\t{{.Size}}\t{{.ID}}"

# Check image size
IMAGE_SIZE=$(docker images "${IMAGE_NAME}:${TAG}" --format "{{.Size}}")
echo ""
echo "Image size: ${IMAGE_SIZE}"

# Extract numeric size in MB (handle both MB and GB)
if [[ ${IMAGE_SIZE} == *"GB"* ]]; then
    echo "WARNING: Image size exceeds target (< 50MB)"
elif [[ ${IMAGE_SIZE} == *"MB"* ]]; then
    SIZE_MB=$(echo "${IMAGE_SIZE}" | sed 's/MB//')
    if (( $(echo "$SIZE_MB > 50" | bc -l) )); then
        echo "WARNING: Image size (${IMAGE_SIZE}) exceeds target (< 50MB)"
    else
        echo "SUCCESS: Image size is within target (< 50MB)"
    fi
fi

echo ""
echo "To run the container:"
echo "  docker run -p 50051:50051 -p 8080:8080 ${IMAGE_NAME}:${TAG}"
