/**
 * IPC Mock 工具
 *
 * 用于测试 Electron IPC 通信的 mock 框架
 * 支持 ipcMain.handle() 和事件发送的模拟
 */

import { vi } from 'vitest';
import type { IpcMainInvokeEvent } from 'electron';

/**
 * IPC Handler 类型定义
 */
export type IpcHandler = (event: IpcMainInvokeEvent, ...args: any[]) => any;

/**
 * IPC Mock 实例
 */
export interface IpcMockInstance {
  /**
   * Mock 的 ipcMain 对象
   */
  ipcMain: {
    handle: ReturnType<typeof vi.fn>;
    removeHandler: ReturnType<typeof vi.fn>;
  };

  /**
   * Mock 的 IPC 事件对象
   */
  mockEvent: Partial<IpcMainInvokeEvent>;

  /**
   * 调用已注册的 IPC handler
   * @param channel - IPC 频道名
   * @param args - 传递给 handler 的参数
   */
  invoke: (channel: string, ...args: any[]) => Promise<any>;

  /**
   * 获取发送到渲染进程的事件
   * @param channel - 事件频道名
   */
  getEvents: (channel: string) => any[][];

  /**
   * 清除所有事件记录
   */
  clearEvents: () => void;

  /**
   * 清除所有 handlers
   */
  clearHandlers: () => void;

  /**
   * 获取所有已注册的频道
   */
  getRegisteredChannels: () => string[];
}

/**
 * 创建 IPC Mock 实例
 *
 * @example
 * ```typescript
 * const { ipcMain, invoke, getEvents } = createIpcMock();
 *
 * // 注册 IPC handlers
 * registerMyIpc(ipcMain);
 *
 * // 调用 handler
 * const result = await invoke('my-channel', arg1, arg2);
 *
 * // 检查发送的事件
 * const events = getEvents('event-channel');
 * ```
 */
export const createIpcMock = (): IpcMockInstance => {
  // 存储注册的 handlers
  const handlers = new Map<string, IpcHandler>();

  // 存储发送到渲染进程的事件
  const events = new Map<string, any[][]>();

  // Mock ipcMain.handle()
  const handle = vi.fn((channel: string, handler: IpcHandler) => {
    handlers.set(channel, handler);
  });

  // Mock ipcMain.removeHandler()
  const removeHandler = vi.fn((channel: string) => {
    handlers.delete(channel);
  });

  // Mock WebContents.send()
  const sendToRenderer = vi.fn((channel: string, ...args: any[]) => {
    if (!events.has(channel)) {
      events.set(channel, []);
    }
    events.get(channel)!.push(args);
  });

  // Mock IPC 事件对象
  const mockEvent: Partial<IpcMainInvokeEvent> = {
    sender: {
      send: sendToRenderer,
      // 添加其他必要的 WebContents 方法
      sendToFrame: vi.fn(),
      postMessage: vi.fn(),
    } as any,
    processId: 1,
    frameId: 1,
  };

  /**
   * 调用已注册的 handler
   */
  const invoke = async (channel: string, ...args: any[]) => {
    const handler = handlers.get(channel);
    if (!handler) {
      throw new Error(`No handler registered for channel: ${channel}`);
    }
    return handler(mockEvent as IpcMainInvokeEvent, ...args);
  };

  /**
   * 获取发送到渲染进程的事件
   */
  const getEvents = (channel: string): any[][] => {
    return events.get(channel) || [];
  };

  /**
   * 清除所有事件记录
   */
  const clearEvents = () => {
    events.clear();
  };

  /**
   * 清除所有 handlers
   */
  const clearHandlers = () => {
    handlers.clear();
  };

  /**
   * 获取所有已注册的频道
   */
  const getRegisteredChannels = (): string[] => {
    return Array.from(handlers.keys());
  };

  return {
    ipcMain: {
      handle,
      removeHandler,
    },
    mockEvent,
    invoke,
    getEvents,
    clearEvents,
    clearHandlers,
    getRegisteredChannels,
  };
};

/**
 * 验证 IPC handler 是否已注册
 *
 * @example
 * ```typescript
 * expectHandlerRegistered(ipcMock, 'my-channel');
 * ```
 */
export const expectHandlerRegistered = (
  ipcMock: IpcMockInstance,
  channel: string
): void => {
  const registered = ipcMock.getRegisteredChannels();
  if (!registered.includes(channel)) {
    throw new Error(
      `Expected handler to be registered for channel: ${channel}\n` +
      `Registered channels: ${registered.join(', ')}`
    );
  }
};

/**
 * 验证事件是否被发送到渲染进程
 *
 * @example
 * ```typescript
 * expectEventSent(ipcMock, 'my-event', 1);
 * ```
 */
export const expectEventSent = (
  ipcMock: IpcMockInstance,
  channel: string,
  expectedCount?: number
): any[][] => {
  const sentEvents = ipcMock.getEvents(channel);

  if (expectedCount !== undefined && sentEvents.length !== expectedCount) {
    throw new Error(
      `Expected ${expectedCount} events on channel ${channel}, ` +
      `but got ${sentEvents.length}`
    );
  }

  if (sentEvents.length === 0) {
    throw new Error(`No events sent on channel: ${channel}`);
  }

  return sentEvents;
};

/**
 * 等待事件被发送（用于异步场景）
 *
 * @example
 * ```typescript
 * await waitForEvent(ipcMock, 'my-event', { timeout: 1000 });
 * ```
 */
export const waitForEvent = async (
  ipcMock: IpcMockInstance,
  channel: string,
  options: { timeout?: number; count?: number } = {}
): Promise<any[][]> => {
  const { timeout = 5000, count = 1 } = options;

  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const events = ipcMock.getEvents(channel);
    if (events.length >= count) {
      return events;
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }

  throw new Error(
    `Timeout waiting for ${count} events on channel ${channel}. ` +
    `Got ${ipcMock.getEvents(channel).length} events in ${timeout}ms`
  );
};
