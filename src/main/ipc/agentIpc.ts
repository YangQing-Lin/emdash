import { ipcMain, BrowserWindow } from 'electron';
import { agentService } from '../services/AgentService';
import { codexService } from '../services/CodexService';

type ProviderId = 'codex' | 'claude';

type AgentSendMessageArgs = {
  providerId: ProviderId;
  workspaceId: string;
  worktreePath: string;
  message: string;
  conversationId?: string;
};

type AgentStopArgs = {
  providerId: ProviderId;
  workspaceId: string;
};

type Validation<T> =
  | {
      ok: true;
      value: T;
    }
  | {
      ok: false;
      error: string;
    };

const INVALID_ARGS_ERROR = 'Invalid arguments object';
const INVALID_PROVIDER_ERROR = 'Invalid argument: providerId must be "codex" or "claude"';
const INVALID_WORKSPACE_ERROR = 'Invalid argument: workspaceId must be a non-empty string';
const INVALID_WORKTREE_ERROR = 'Invalid argument: worktreePath must be a non-empty string';
const INVALID_MESSAGE_ERROR = 'Invalid argument: message must be a non-empty string';
const INVALID_CONVERSATION_ERROR = 'Invalid argument: conversationId must be a string';

function isProviderId(value: unknown): value is ProviderId {
  return value === 'codex' || value === 'claude';
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function validateSendMessageArgs(args: unknown): Validation<AgentSendMessageArgs> {
  if (!args || typeof args !== 'object') {
    return { ok: false, error: INVALID_ARGS_ERROR };
  }

  const {
    providerId,
    workspaceId,
    worktreePath,
    message,
    conversationId,
  } = args as Partial<AgentSendMessageArgs>;

  if (!isProviderId(providerId)) {
    return { ok: false, error: INVALID_PROVIDER_ERROR };
  }
  if (!isNonEmptyString(workspaceId)) {
    return { ok: false, error: INVALID_WORKSPACE_ERROR };
  }
  if (!isNonEmptyString(worktreePath)) {
    return { ok: false, error: INVALID_WORKTREE_ERROR };
  }
  if (!isNonEmptyString(message)) {
    return { ok: false, error: INVALID_MESSAGE_ERROR };
  }
  if (conversationId !== undefined && typeof conversationId !== 'string') {
    return { ok: false, error: INVALID_CONVERSATION_ERROR };
  }

  return {
    ok: true,
    value: {
      providerId,
      workspaceId,
      worktreePath,
      message,
      ...(conversationId !== undefined ? { conversationId } : {}),
    },
  };
}

function validateStopArgs(args: unknown): Validation<AgentStopArgs> {
  if (!args || typeof args !== 'object') {
    return { ok: false, error: INVALID_ARGS_ERROR };
  }

  const { providerId, workspaceId } = args as Partial<AgentStopArgs>;
  if (!isProviderId(providerId)) {
    return { ok: false, error: INVALID_PROVIDER_ERROR };
  }
  if (!isNonEmptyString(workspaceId)) {
    return { ok: false, error: INVALID_WORKSPACE_ERROR };
  }
  return {
    ok: true,
    value: {
      providerId,
      workspaceId,
    },
  };
}

export function registerAgentIpc() {
  // Installation check
  ipcMain.handle('agent:check-installation', async (_e, providerId: ProviderId) => {
    try {
      const ok = await agentService.isInstalled(providerId);
      return { success: true, isInstalled: ok };
    } catch (e: any) {
      return { success: false, error: e?.message || String(e) };
    }
  });

  // Installation instructions
  ipcMain.handle(
    'agent:get-installation-instructions',
    async (_e, providerId: ProviderId) => {
      try {
        const text = agentService.getInstallationInstructions(providerId);
        return { success: true, instructions: text };
      } catch (e: any) {
        return { success: false, error: e?.message || String(e) };
      }
    }
  );

  // Start streaming
  ipcMain.handle(
    'agent:send-message-stream',
    async (_e, args: AgentSendMessageArgs) => {
      try {
        const validation = validateSendMessageArgs(args);
        if (!validation.ok) {
          return { success: false, error: validation.error };
        }
        await agentService.startStream(validation.value);
        return { success: true };
      } catch (e: any) {
        return { success: false, error: e?.message || String(e) };
      }
    }
  );

  // Stop streaming
  ipcMain.handle(
    'agent:stop-stream',
    async (_e, args: AgentStopArgs) => {
      try {
        const validation = validateStopArgs(args);
        if (!validation.ok) {
          return { success: false, error: validation.error };
        }
        const ok = await agentService.stopStream(
          validation.value.providerId,
          validation.value.workspaceId
        );
        return { success: ok };
      } catch (e: any) {
        return { success: false, error: e?.message || String(e) };
      }
    }
  );

  // Bridge Codex native events to generic agent events so renderer can listen once
  codexService.on('codex:output', (data: any) => {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach((w) =>
      w.webContents.send('agent:stream-output', { providerId: 'codex', ...data })
    );
  });
  codexService.on('codex:error', (data: any) => {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach((w) =>
      w.webContents.send('agent:stream-error', { providerId: 'codex', ...data })
    );
  });
  codexService.on('codex:complete', (data: any) => {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach((w) =>
      w.webContents.send('agent:stream-complete', { providerId: 'codex', ...data })
    );
  });

  // Forward AgentService events (Claude et al.)
  agentService.on('agent:output', (data: any) => {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach((w) => w.webContents.send('agent:stream-output', data));
  });
  agentService.on('agent:error', (data: any) => {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach((w) => w.webContents.send('agent:stream-error', data));
  });
  agentService.on('agent:complete', (data: any) => {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach((w) => w.webContents.send('agent:stream-complete', data));
  });

  // console.log('✅ Agent IPC handlers registered');
}
