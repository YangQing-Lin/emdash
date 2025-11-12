import WebSocket, { type ClientOptions } from 'ws';
import { constants as zlibConstants } from 'zlib';

const WINDOW_BITS = 15;
const DEFAULT_PER_MESSAGE_DEFLATE: NonNullable<ClientOptions['perMessageDeflate']> = {
  clientMaxWindowBits: WINDOW_BITS,
  serverMaxWindowBits: WINDOW_BITS,
  clientNoContextTakeover: true,
  serverNoContextTakeover: true,
  threshold: 256,
  zlibDeflateOptions: {
    level: zlibConstants.Z_DEFAULT_COMPRESSION,
    memLevel: 8,
    windowBits: WINDOW_BITS,
  },
  zlibInflateOptions: {
    windowBits: WINDOW_BITS,
  },
};

const clonePerMessageDeflateOptions = (): NonNullable<ClientOptions['perMessageDeflate']> => ({
  ...DEFAULT_PER_MESSAGE_DEFLATE,
  zlibDeflateOptions: {
    ...DEFAULT_PER_MESSAGE_DEFLATE.zlibDeflateOptions,
  },
  zlibInflateOptions: {
    ...DEFAULT_PER_MESSAGE_DEFLATE.zlibInflateOptions,
  },
});

const buildWebSocketOptions = (): ClientOptions => ({
  perMessageDeflate: clonePerMessageDeflateOptions(),
});

export const createRemoteWebSocket = (url: string): WebSocket => new WebSocket(url, buildWebSocketOptions());
