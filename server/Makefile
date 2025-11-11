SHELL := /bin/bash
BIN_DIR := bin
BINARY := $(BIN_DIR)/emdash-server
MAIN_PKG := ./cmd/emdash-server
PROTO_FILES := $(wildcard api/proto/*.proto)
PROTOC_BIN := $(shell command -v protoc 2>/dev/null)
PROTOC_INCLUDE := $(realpath $(dir $(PROTOC_BIN))../include)
MODULE_PATH := github.com/emdashhq/emdash-server

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

proto: $(PROTO_FILES)
	@echo "\033[1;36m==> Generating protobuf bindings\033[0m"
	@if ! command -v protoc >/dev/null 2>&1; then \
		echo "protoc not found. Please install the Protocol Buffers compiler."; \
		exit 1; \
	fi
	@if ! command -v protoc-gen-go >/dev/null 2>&1; then \
		echo "\033[1;33mInstalling protoc-gen-go...\033[0m"; \
		GO111MODULE=on go install google.golang.org/protobuf/cmd/protoc-gen-go@latest; \
	fi
	@if ! command -v protoc-gen-go-grpc >/dev/null 2>&1; then \
		echo "\033[1;33mInstalling protoc-gen-go-grpc...\033[0m"; \
		GO111MODULE=on go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@latest; \
	fi
	$(PROTOC_BIN) --proto_path=. --proto_path=$(PROTOC_INCLUDE) --experimental_allow_proto3_optional=true \
		--go_out=. --go_opt=module=$(MODULE_PATH) \
		--go-grpc_out=. --go-grpc_opt=module=$(MODULE_PATH) \
		api/proto/*.proto

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
