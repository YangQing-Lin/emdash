#!/usr/bin/env bash
# Generates a local self-signed TLS certificate for the emdash server.
# Usage: ./scripts/gen-cert.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CERT_DIR="${REPO_ROOT}/certs"
CERT_FILE="${CERT_DIR}/server.crt"
KEY_FILE="${CERT_DIR}/server.key"

mkdir -p "${CERT_DIR}"

openssl req \
  -x509 \
  -nodes \
  -newkey rsa:2048 \
  -keyout "${KEY_FILE}" \
  -out "${CERT_FILE}" \
  -days 365 \
  -subj "/CN=localhost/O=Emdash Development"

chmod 600 "${KEY_FILE}"

cat <<INFO
Generated self-signed certificate:
  Certificate: ${CERT_FILE}
  Key:         ${KEY_FILE}
INFO
