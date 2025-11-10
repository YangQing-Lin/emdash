import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Conversation, Message, Project, Workspace } from '../../main/services/DatabaseService';

type ProjectInput = Omit<Project, 'createdAt' | 'updatedAt'>;
type WorkspaceInput = Omit<Workspace, 'createdAt' | 'updatedAt'>;
type ConversationInput = Omit<Conversation, 'createdAt' | 'updatedAt'>;
type MessageInput = Omit<Message, 'timestamp'>;

const {
  handlers,
  handleMock,
  getProjectsMock,
  saveProjectMock,
  getWorkspacesMock,
  saveWorkspaceMock,
  deleteProjectMock,
  saveConversationMock,
  getConversationsMock,
  getOrCreateDefaultConversationMock,
  saveMessageMock,
  getMessagesMock,
  deleteConversationMock,
  deleteWorkspaceMock,
  databaseServiceMock,
  logErrorMock,
  logMock,
} = vi.hoisted(() => {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>();
  const handleMock = vi.fn(
    (channel: string, handler: (event: unknown, ...args: unknown[]) => Promise<unknown>) => {
      handlers.set(channel, handler);
    }
  );

  const getProjectsMock = vi.fn<() => Promise<Project[]>>();
  const saveProjectMock = vi.fn<(project: ProjectInput) => Promise<void>>();
  const getWorkspacesMock = vi.fn<(projectId?: string) => Promise<Workspace[]>>();
  const saveWorkspaceMock = vi.fn<(workspace: WorkspaceInput) => Promise<void>>();
  const deleteProjectMock = vi.fn<(projectId: string) => Promise<void>>();
  const saveConversationMock = vi.fn<(conversation: ConversationInput) => Promise<void>>();
  const getConversationsMock = vi.fn<(workspaceId: string) => Promise<Conversation[]>>();
  const getOrCreateDefaultConversationMock = vi.fn<
    (workspaceId: string) => Promise<Conversation>
  >();
  const saveMessageMock = vi.fn<(message: MessageInput) => Promise<void>>();
  const getMessagesMock = vi.fn<(conversationId: string) => Promise<Message[]>>();
  const deleteConversationMock = vi.fn<(conversationId: string) => Promise<void>>();
  const deleteWorkspaceMock = vi.fn<(workspaceId: string) => Promise<void>>();

  const databaseServiceMock = {
    getProjects: getProjectsMock,
    saveProject: saveProjectMock,
    getWorkspaces: getWorkspacesMock,
    saveWorkspace: saveWorkspaceMock,
    deleteProject: deleteProjectMock,
    saveConversation: saveConversationMock,
    getConversations: getConversationsMock,
    getOrCreateDefaultConversation: getOrCreateDefaultConversationMock,
    saveMessage: saveMessageMock,
    getMessages: getMessagesMock,
    deleteConversation: deleteConversationMock,
    deleteWorkspace: deleteWorkspaceMock,
  };

  const logErrorMock = vi.fn<(message?: unknown, error?: unknown) => void>();
  const logMock = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: logErrorMock,
  };

  return {
    handlers,
    handleMock,
    getProjectsMock,
    saveProjectMock,
    getWorkspacesMock,
    saveWorkspaceMock,
    deleteProjectMock,
    saveConversationMock,
    getConversationsMock,
    getOrCreateDefaultConversationMock,
    saveMessageMock,
    getMessagesMock,
    deleteConversationMock,
    deleteWorkspaceMock,
    databaseServiceMock,
    logErrorMock,
    logMock,
  };
});

vi.mock('electron', () => ({
  ipcMain: {
    handle: handleMock,
  },
}));

vi.mock('../../main/services/DatabaseService', () => ({
  get databaseService() {
    return databaseServiceMock;
  },
}));

vi.mock('../../main/lib/logger', () => ({
  log: logMock,
}));

// eslint-disable-next-line import/first
import { registerDatabaseIpc } from '../../main/ipc/dbIpc';

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown>;

function getHandler(channel: string): Handler {
  const handler = handlers.get(channel);
  if (!handler) {
    throw new Error(`Handler for ${channel} not registered`);
  }
  return handler;
}

async function callChannel<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
  const handler = getHandler(channel);
  return (await handler({}, ...args)) as T;
}

function createProject(overrides?: Partial<Project>): Project {
  const base: Project = {
    id: 'proj-1',
    name: 'Project One',
    path: '/repo/project-one',
    gitInfo: {
      isGitRepo: true,
      remote: 'origin',
      branch: 'main',
    },
    githubInfo: {
      repository: 'org/project-one',
      connected: true,
    },
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-02T00:00:00.000Z',
  };
  return { ...base, ...overrides };
}

function createWorkspace(overrides?: Partial<Workspace>): Workspace {
  const base: Workspace = {
    id: 'ws-1',
    projectId: 'proj-1',
    name: 'Workspace Alpha',
    branch: 'agent/workspace-alpha',
    path: '/repo/workspaces/alpha',
    status: 'active',
    agentId: 'codex',
    metadata: { root: '/repo' },
    createdAt: '2024-01-03T00:00:00.000Z',
    updatedAt: '2024-01-04T00:00:00.000Z',
  };
  return { ...base, ...overrides };
}

function createConversation(overrides?: Partial<Conversation>): Conversation {
  const base: Conversation = {
    id: 'conv-1',
    workspaceId: 'ws-1',
    title: 'Default Conversation',
    createdAt: '2024-01-05T00:00:00.000Z',
    updatedAt: '2024-01-06T00:00:00.000Z',
  };
  return { ...base, ...overrides };
}

function createMessage(overrides?: Partial<Message>): Message {
  const base: Message = {
    id: 'msg-1',
    conversationId: 'conv-1',
    content: 'Hello world',
    sender: 'user',
    timestamp: '2024-01-07T00:00:00.000Z',
    metadata: '{"run":"1"}',
  };
  return { ...base, ...overrides };
}

function createProjectInput(overrides?: Partial<ProjectInput>): ProjectInput {
  const base: ProjectInput = {
    id: 'proj-input-1',
    name: 'Project Input',
    path: '/repo/input',
    gitInfo: {
      isGitRepo: true,
      remote: 'origin',
      branch: 'input',
    },
    githubInfo: {
      repository: 'org/input',
      connected: false,
    },
  };
  return { ...base, ...overrides };
}

function createWorkspaceInput(overrides?: Partial<WorkspaceInput>): WorkspaceInput {
  const base: WorkspaceInput = {
    id: 'ws-input-1',
    projectId: 'proj-1',
    name: 'Workspace Input',
    branch: 'agent/input',
    path: '/repo/workspaces/input',
    status: 'running',
    agentId: 'claude',
    metadata: { branch: 'agent/input' },
  };
  return { ...base, ...overrides };
}

function createConversationInput(overrides?: Partial<ConversationInput>): ConversationInput {
  const base: ConversationInput = {
    id: 'conv-input-1',
    workspaceId: 'ws-1',
    title: 'Input Conversation',
  };
  return { ...base, ...overrides };
}

function createMessageInput(overrides?: Partial<MessageInput>): MessageInput {
  const base: MessageInput = {
    id: 'msg-input-1',
    conversationId: 'conv-1',
    content: 'Testing',
    sender: 'agent',
    metadata: '{"role":"assistant"}',
  };
  return { ...base, ...overrides };
}

describe('registerDatabaseIpc', () => {
  beforeEach(() => {
    handlers.clear();
    handleMock.mockReset();
    logErrorMock.mockReset();
    getProjectsMock.mockReset();
    saveProjectMock.mockReset();
    getWorkspacesMock.mockReset();
    saveWorkspaceMock.mockReset();
    deleteProjectMock.mockReset();
    saveConversationMock.mockReset();
    getConversationsMock.mockReset();
    getOrCreateDefaultConversationMock.mockReset();
    saveMessageMock.mockReset();
    getMessagesMock.mockReset();
    deleteConversationMock.mockReset();
    deleteWorkspaceMock.mockReset();
  });

  describe('db:getProjects', () => {
    it('returns projects from the service', async () => {
      const projects = [createProject(), createProject({ id: 'proj-2', name: 'Second' })];
      getProjectsMock.mockResolvedValue(projects);

      registerDatabaseIpc();
      const result = await callChannel<Project[]>('db:getProjects');

      expect(getProjectsMock).toHaveBeenCalledTimes(1);
      expect(result).toEqual(projects);
    });

    it('returns empty array when there are no projects', async () => {
      getProjectsMock.mockResolvedValue([]);

      registerDatabaseIpc();
      const result = await callChannel<Project[]>('db:getProjects');

      expect(result).toEqual([]);
    });

    it('returns empty array when the service throws', async () => {
      const error = new Error('db unavailable');
      getProjectsMock.mockRejectedValue(error);

      registerDatabaseIpc();
      const result = await callChannel<Project[]>('db:getProjects');

      expect(result).toEqual([]);
      expect(logErrorMock).toHaveBeenCalledWith('Failed to get projects:', error);
    });

    it('logs string errors from the service', async () => {
      getProjectsMock.mockRejectedValue('bad');

      registerDatabaseIpc();
      await callChannel<Project[]>('db:getProjects');

      expect(logErrorMock).toHaveBeenCalledWith('Failed to get projects:', 'bad');
    });
  });

  describe('db:saveProject', () => {
    it('saves project data through the service', async () => {
      const payload = createProjectInput();
      saveProjectMock.mockResolvedValue();

      registerDatabaseIpc();
      await callChannel('db:saveProject', payload);

      expect(saveProjectMock).toHaveBeenCalledWith(payload);
    });

    it('returns a success response once saved', async () => {
      saveProjectMock.mockResolvedValue();
      const payload = createProjectInput();

      registerDatabaseIpc();
      const result = await callChannel<{ success: boolean }>('db:saveProject', payload);

      expect(result).toEqual({ success: true });
    });

    it('returns failure response when save fails', async () => {
      const error = new Error('write failed');
      saveProjectMock.mockRejectedValue(error);

      registerDatabaseIpc();
      const result = await callChannel<{ success: boolean; error: string }>(
        'db:saveProject',
        createProjectInput()
      );

      expect(result).toEqual({ success: false, error: 'write failed' });
      expect(logErrorMock).toHaveBeenCalledWith('Failed to save project:', error);
    });

    it('passes project payload for validation', async () => {
      const payload = createProjectInput({ name: 'Validation' });

      registerDatabaseIpc();
      await callChannel('db:saveProject', payload);

      expect(saveProjectMock.mock.calls[0][0]).toBe(payload);
    });
  });

  describe('db:getWorkspaces', () => {
    it('returns all workspaces when no projectId is provided', async () => {
      const workspaces = [createWorkspace(), createWorkspace({ id: 'ws-2', projectId: 'proj-2' })];
      getWorkspacesMock.mockResolvedValue(workspaces);

      registerDatabaseIpc();
      const result = await callChannel<Workspace[]>('db:getWorkspaces');

      expect(getWorkspacesMock).toHaveBeenCalledWith(undefined);
      expect(result).toEqual(workspaces);
    });

    it('returns filtered workspaces when projectId is provided', async () => {
      const workspaces = [createWorkspace({ id: 'ws-3', projectId: 'proj-9' })];
      getWorkspacesMock.mockResolvedValue(workspaces);

      registerDatabaseIpc();
      const result = await callChannel<Workspace[]>('db:getWorkspaces', 'proj-9');

      expect(getWorkspacesMock).toHaveBeenCalledWith('proj-9');
      expect(result).toEqual(workspaces);
    });

    it('returns empty array when service finds no workspaces', async () => {
      getWorkspacesMock.mockResolvedValue([]);

      registerDatabaseIpc();
      const result = await callChannel<Workspace[]>('db:getWorkspaces', 'proj-3');

      expect(result).toEqual([]);
    });

    it('returns empty array when service throws', async () => {
      const error = new Error('missing table');
      getWorkspacesMock.mockRejectedValue(error);

      registerDatabaseIpc();
      const result = await callChannel<Workspace[]>('db:getWorkspaces');

      expect(result).toEqual([]);
      expect(logErrorMock).toHaveBeenCalledWith('Failed to get workspaces:', error);
    });

    it('logs non-error rejections as well', async () => {
      getWorkspacesMock.mockRejectedValue('boom');

      registerDatabaseIpc();
      await callChannel<Workspace[]>('db:getWorkspaces', 'proj-7');

      expect(logErrorMock).toHaveBeenCalledWith('Failed to get workspaces:', 'boom');
    });
  });

  describe('db:saveWorkspace', () => {
    it('invokes service to save workspace', async () => {
      const payload = createWorkspaceInput();
      saveWorkspaceMock.mockResolvedValue();

      registerDatabaseIpc();
      await callChannel('db:saveWorkspace', payload);

      expect(saveWorkspaceMock).toHaveBeenCalledWith(payload);
    });

    it('returns success response after saving', async () => {
      saveWorkspaceMock.mockResolvedValue();
      const payload = createWorkspaceInput({ name: 'Saved' });

      registerDatabaseIpc();
      const result = await callChannel<{ success: boolean }>('db:saveWorkspace', payload);

      expect(result).toEqual({ success: true });
    });

    it('returns failure details when service throws', async () => {
      const error = new Error('validation failed');
      saveWorkspaceMock.mockRejectedValue(error);

      registerDatabaseIpc();
      const result = await callChannel<{ success: boolean; error: string }>(
        'db:saveWorkspace',
        createWorkspaceInput()
      );

      expect(result).toEqual({ success: false, error: 'validation failed' });
      expect(logErrorMock).toHaveBeenCalledWith('Failed to save workspace:', error);
    });

    it('passes workspace data through unchanged for validation', async () => {
      const payload = createWorkspaceInput({ metadata: { label: 'QA' } });

      registerDatabaseIpc();
      await callChannel('db:saveWorkspace', payload);

      expect(saveWorkspaceMock.mock.calls[0][0]).toBe(payload);
    });
  });

  describe('db:deleteProject', () => {
    it('calls the service with provided projectId', async () => {
      deleteProjectMock.mockResolvedValue();

      registerDatabaseIpc();
      await callChannel('db:deleteProject', 'proj-123');

      expect(deleteProjectMock).toHaveBeenCalledWith('proj-123');
    });

    it('returns success response when deletion completes', async () => {
      deleteProjectMock.mockResolvedValue();

      registerDatabaseIpc();
      const result = await callChannel<{ success: boolean }>('db:deleteProject', 'proj-456');

      expect(result).toEqual({ success: true });
    });

    it('handles service errors such as missing project', async () => {
      const error = new Error('project not found');
      deleteProjectMock.mockRejectedValue(error);

      registerDatabaseIpc();
      const result = await callChannel<{ success: boolean; error: string }>(
        'db:deleteProject',
        'proj-missing'
      );

      expect(result).toEqual({ success: false, error: 'project not found' });
      expect(logErrorMock).toHaveBeenCalledWith('Failed to delete project:', error);
    });

    it('passes raw projectId for validation', async () => {
      const projectId = 'proj--with--spaces';

      registerDatabaseIpc();
      await callChannel('db:deleteProject', projectId);

      expect(deleteProjectMock.mock.calls[0][0]).toBe(projectId);
    });
  });

  describe('db:saveConversation', () => {
    it('saves conversation via service', async () => {
      const payload = createConversationInput();
      saveConversationMock.mockResolvedValue();

      registerDatabaseIpc();
      await callChannel('db:saveConversation', payload);

      expect(saveConversationMock).toHaveBeenCalledWith(payload);
    });

    it('returns success response after saving conversation', async () => {
      saveConversationMock.mockResolvedValue();

      registerDatabaseIpc();
      const result = await callChannel<{ success: boolean }>(
        'db:saveConversation',
        createConversationInput()
      );

      expect(result).toEqual({ success: true });
    });

    it('handles service errors for conversation save', async () => {
      const error = new Error('duplicate conversation');
      saveConversationMock.mockRejectedValue(error);

      registerDatabaseIpc();
      const result = await callChannel<{ success: boolean; error: string }>(
        'db:saveConversation',
        createConversationInput({ id: 'conv-dupe' })
      );

      expect(result).toEqual({ success: false, error: 'duplicate conversation' });
      expect(logErrorMock).toHaveBeenCalledWith('Failed to save conversation:', error);
    });

    it('passes conversation data for validation', async () => {
      const payload = createConversationInput({ title: 'Validate me' });

      registerDatabaseIpc();
      await callChannel('db:saveConversation', payload);

      expect(saveConversationMock.mock.calls[0][0]).toBe(payload);
    });
  });

  describe('db:getConversations', () => {
    it('returns conversations for workspaceId', async () => {
      const conversations = [
        createConversation(),
        createConversation({ id: 'conv-2', title: 'Secondary' }),
      ];
      getConversationsMock.mockResolvedValue(conversations);

      registerDatabaseIpc();
      const result = await callChannel<{ success: boolean; conversations: Conversation[] }>(
        'db:getConversations',
        'ws-abc'
      );

      expect(getConversationsMock).toHaveBeenCalledWith('ws-abc');
      expect(result.conversations).toEqual(conversations);
    });

    it('wraps conversation list in success response', async () => {
      const conversations = [createConversation({ id: 'conv-3' })];
      getConversationsMock.mockResolvedValue(conversations);

      registerDatabaseIpc();
      const result = await callChannel<{ success: boolean; conversations: Conversation[] }>(
        'db:getConversations',
        'ws-1'
      );

      expect(result).toEqual({ success: true, conversations });
    });

    it('returns failure response when service throws', async () => {
      const error = new Error('read failed');
      getConversationsMock.mockRejectedValue(error);

      registerDatabaseIpc();
      const result = await callChannel<{ success: boolean; error: string }>(
        'db:getConversations',
        'ws-err'
      );

      expect(result).toEqual({ success: false, error: 'read failed' });
      expect(logErrorMock).toHaveBeenCalledWith('Failed to get conversations:', error);
    });

    it('forwards workspaceId for validation', async () => {
      const workspaceId = 'ws- with spaces';
      getConversationsMock.mockResolvedValue([]);

      registerDatabaseIpc();
      await callChannel('db:getConversations', workspaceId);

      expect(getConversationsMock).toHaveBeenCalledWith(workspaceId);
    });
  });

  describe('db:getOrCreateDefaultConversation', () => {
    it('returns existing default conversation', async () => {
      const conversation = createConversation({ id: 'conv-default', title: 'Existing default' });
      getOrCreateDefaultConversationMock.mockResolvedValue(conversation);

      registerDatabaseIpc();
      const result = await callChannel<{ success: boolean; conversation: Conversation }>(
        'db:getOrCreateDefaultConversation',
        'ws-1'
      );

      expect(result).toEqual({ success: true, conversation });
    });

    it('requests creation of default conversation when missing', async () => {
      const conversation = createConversation({ id: 'conv-new', workspaceId: 'ws-new' });
      getOrCreateDefaultConversationMock.mockResolvedValue(conversation);

      registerDatabaseIpc();
      const result = await callChannel<{ success: boolean; conversation: Conversation }>(
        'db:getOrCreateDefaultConversation',
        'ws-new'
      );

      expect(getOrCreateDefaultConversationMock).toHaveBeenCalledWith('ws-new');
      expect(result.conversation).toEqual(conversation);
    });

    it('wraps conversation in success response', async () => {
      const conversation = createConversation({ title: 'Wrapped default' });
      getOrCreateDefaultConversationMock.mockResolvedValue(conversation);

      registerDatabaseIpc();
      const result = await callChannel<{ success: boolean; conversation: Conversation }>(
        'db:getOrCreateDefaultConversation',
        'ws-wrap'
      );

      expect(result.success).toBe(true);
      expect(result.conversation).toBe(conversation);
    });

    it('handles service errors for default conversation', async () => {
      const error = new Error('workspace missing');
      getOrCreateDefaultConversationMock.mockRejectedValue(error);

      registerDatabaseIpc();
      const result = await callChannel<{ success: boolean; error: string }>(
        'db:getOrCreateDefaultConversation',
        'ws-error'
      );

      expect(result).toEqual({ success: false, error: 'workspace missing' });
      expect(logErrorMock).toHaveBeenCalledWith(
        'Failed to get or create default conversation:',
        error
      );
    });
  });

  describe('db:saveMessage', () => {
    it('saves message via service', async () => {
      const payload = createMessageInput();
      saveMessageMock.mockResolvedValue();

      registerDatabaseIpc();
      await callChannel('db:saveMessage', payload);

      expect(saveMessageMock).toHaveBeenCalledWith(payload);
    });

    it('returns success response when message saved', async () => {
      saveMessageMock.mockResolvedValue();

      registerDatabaseIpc();
      const result = await callChannel<{ success: boolean }>(
        'db:saveMessage',
        createMessageInput()
      );

      expect(result).toEqual({ success: true });
    });

    it('handles service errors when saving message', async () => {
      const error = new Error('save failed');
      saveMessageMock.mockRejectedValue(error);

      registerDatabaseIpc();
      const result = await callChannel<{ success: boolean; error: string }>(
        'db:saveMessage',
        createMessageInput({ id: 'msg-fail' })
      );

      expect(result).toEqual({ success: false, error: 'save failed' });
      expect(logErrorMock).toHaveBeenCalledWith('Failed to save message:', error);
    });

    it('passes message payload for validation', async () => {
      const payload = createMessageInput({ content: 'Validate message' });

      registerDatabaseIpc();
      await callChannel('db:saveMessage', payload);

      expect(saveMessageMock.mock.calls[0][0]).toBe(payload);
    });
  });

  describe('db:getMessages', () => {
    it('returns messages for a conversation', async () => {
      const messages = [
        createMessage(),
        createMessage({ id: 'msg-2', content: 'Second', sender: 'agent' }),
      ];
      getMessagesMock.mockResolvedValue(messages);

      registerDatabaseIpc();
      const result = await callChannel<{ success: boolean; messages: Message[] }>(
        'db:getMessages',
        'conv-1'
      );

      expect(getMessagesMock).toHaveBeenCalledWith('conv-1');
      expect(result.messages).toEqual(messages);
    });

    it('wraps messages in a success response', async () => {
      const messages = [createMessage({ id: 'msg-3' })];
      getMessagesMock.mockResolvedValue(messages);

      registerDatabaseIpc();
      const result = await callChannel<{ success: boolean; messages: Message[] }>(
        'db:getMessages',
        'conv-wrap'
      );

      expect(result).toEqual({ success: true, messages });
    });

    it('returns failure response when service errors', async () => {
      const error = new Error('load failed');
      getMessagesMock.mockRejectedValue(error);

      registerDatabaseIpc();
      const result = await callChannel<{ success: boolean; error: string }>(
        'db:getMessages',
        'conv-error'
      );

      expect(result).toEqual({ success: false, error: 'load failed' });
      expect(logErrorMock).toHaveBeenCalledWith('Failed to get messages:', error);
    });

    it('forwards conversationId for validation', async () => {
      const conversationId = 'conv special';
      getMessagesMock.mockResolvedValue([]);

      registerDatabaseIpc();
      await callChannel('db:getMessages', conversationId);

      expect(getMessagesMock).toHaveBeenCalledWith(conversationId);
    });
  });

  describe('db:deleteConversation', () => {
    it('calls service to delete conversation', async () => {
      deleteConversationMock.mockResolvedValue();

      registerDatabaseIpc();
      await callChannel('db:deleteConversation', 'conv-123');

      expect(deleteConversationMock).toHaveBeenCalledWith('conv-123');
    });

    it('returns success after deleting conversation', async () => {
      deleteConversationMock.mockResolvedValue();

      registerDatabaseIpc();
      const result = await callChannel<{ success: boolean }>(
        'db:deleteConversation',
        'conv-321'
      );

      expect(result).toEqual({ success: true });
    });

    it('handles service errors for delete conversation', async () => {
      const error = new Error('conversation not found');
      deleteConversationMock.mockRejectedValue(error);

      registerDatabaseIpc();
      const result = await callChannel<{ success: boolean; error: string }>(
        'db:deleteConversation',
        'conv-missing'
      );

      expect(result).toEqual({ success: false, error: 'conversation not found' });
      expect(logErrorMock).toHaveBeenCalledWith('Failed to delete conversation:', error);
    });
  });

  describe('db:deleteWorkspace', () => {
    it('calls service to delete workspace', async () => {
      deleteWorkspaceMock.mockResolvedValue();

      registerDatabaseIpc();
      await callChannel('db:deleteWorkspace', 'ws-1');

      expect(deleteWorkspaceMock).toHaveBeenCalledWith('ws-1');
    });

    it('returns success when workspace deletion completes', async () => {
      deleteWorkspaceMock.mockResolvedValue();

      registerDatabaseIpc();
      const result = await callChannel<{ success: boolean }>('db:deleteWorkspace', 'ws-2');

      expect(result).toEqual({ success: true });
    });

    it('handles service errors for workspace deletion', async () => {
      const error = new Error('workspace missing');
      deleteWorkspaceMock.mockRejectedValue(error);

      registerDatabaseIpc();
      const result = await callChannel<{ success: boolean; error: string }>(
        'db:deleteWorkspace',
        'ws-missing'
      );

      expect(result).toEqual({ success: false, error: 'workspace missing' });
      expect(logErrorMock).toHaveBeenCalledWith('Failed to delete workspace:', error);
    });
  });
});
