SHELL := /bin/bash
BIN_DIR := bin
BINARY := $(BIN_DIR)/emdash-server
MAIN_PKG := ./cmd/emdash-server

.PHONY: build test proto clean run dev

build:
	@mkdir -p $(BIN_DIR)
	@echo "\033[1;32m==> Building $(BINARY)\033[0m"
	GO111MODULE=on go build -trimpath -ldflags "-s -w" -o $(BINARY) $(MAIN_PKG)

run: build
	@echo "\033[1;34m==> Launching $(BINARY)\033[0m"
	./$(BINARY)

clean:
	@echo "\033[1;33m==> Cleaning build artifacts\033[0m"
	rm -rf $(BIN_DIR) coverage.out

proto:
	@echo "\033[1;36m==> Proto generation placeholder\033[0m"
	@echo "Add protoc commands targeting files under api/proto as needed."

test:
	@echo "\033[1;32m==> Running tests with coverage\033[0m"
	go test ./... -coverprofile=coverage.out

dev:
	@if command -v air >/dev/null 2>&1; then \
		 echo "\033[1;35m==> Starting Air dev server\033[0m"; \
		 air; \
	else \
		 echo "\033[1;33mAir not found; falling back to go run\033[0m"; \
		 go run $(MAIN_PKG); \
	fi
