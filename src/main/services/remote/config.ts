export const REMOTE_SERVER_URL =
  process.env.EMDASH_REMOTE_SERVER_URL ||
  process.env.EMDASH_REMOTE_SERVER ||
  'ws://localhost:8080';
export const GRPC_SERVER_URL = process.env.EMDASH_GRPC_SERVER || 'localhost:50051';
