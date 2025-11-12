# Build stage
FROM golang:1.24-alpine AS builder

# Install build dependencies
RUN apk add --no-cache git make

WORKDIR /app

# Copy go mod files
COPY go.mod go.sum ./
RUN go mod download

# Copy source code
COPY . .

# Build the binary
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-w -s" -o emdash-server ./cmd/emdash-server

# Run stage
FROM alpine:latest

# Install runtime dependencies
RUN apk add --no-cache \
    git \
    openssh-client \
    ca-certificates \
    bash

# Create app directory
WORKDIR /app

# Copy binary from builder
COPY --from=builder /app/emdash-server .

# Copy example config
COPY config.example.env .

# Expose ports
EXPOSE 50051 8080

# Run the server
CMD ["./emdash-server"]
