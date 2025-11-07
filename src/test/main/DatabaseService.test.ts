import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import type { Conversation, Message, Project, Workspace } from '../../main/services/DatabaseService';

const pathState = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { join: joinPath } = require('path') as typeof import('path');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { tmpdir: osTmpdir } = require('os') as typeof import('os');
  const defaultMigrations = joinPath(process.cwd(), 'drizzle');
  return {
    currentDbPath: joinPath(osTmpdir(), 'emdash-default', 'default.sqlite'),
    migrationsPath: defaultMigrations as string | null,
  };
}) as { currentDbPath: string; migrationsPath: string | null };
const DEFAULT_MIGRATIONS_PATH = join(process.cwd(), 'drizzle');

vi.mock('../../main/db/path', () => ({
  resolveDatabasePath: () => pathState.currentDbPath,
  resolveMigrationsPath: () => pathState.migrationsPath,
}));

// eslint-disable-next-line import/first
import { DatabaseService } from '../../main/services/DatabaseService';
// eslint-disable-next-line import/first
import { getDrizzleClient, resetDrizzleClient } from '../../main/db/drizzleClient';
// eslint-disable-next-line import/first
import {
  workspaces as workspacesTable,
  conversations as conversationsTable,
  messages as messagesTable,
} from '../../main/db/schema';
// eslint-disable-next-line import/first
import { eq } from 'drizzle-orm';

type ProjectInput = Omit<Project, 'createdAt' | 'updatedAt'>;
type WorkspaceInput = Omit<Workspace, 'createdAt' | 'updatedAt'>;
type ConversationInput = Omit<Conversation, 'createdAt' | 'updatedAt'>;
type MessageInput = Omit<Message, 'timestamp'>;

interface ServiceContext {
  service: DatabaseService;
  tempDir: string;
}

function buildProject(overrides: Partial<ProjectInput> = {}): ProjectInput {
  return {
    id: overrides.id ?? randomUUID(),
    name: overrides.name ?? '演示项目',
    path: overrides.path ?? `/tmp/project-${randomUUID()}`,
    gitInfo: overrides.gitInfo ?? {
      isGitRepo: true,
      remote: 'git@github.com:demo/repo.git',
      branch: 'main',
    },
    githubInfo:
      overrides.githubInfo ??
      ({
        repository: 'demo/repo',
        connected: true,
      } satisfies NonNullable<Project['githubInfo']>),
  };
}

function buildWorkspace(
  projectId: string,
  overrides: Partial<WorkspaceInput> = {}
): WorkspaceInput {
  return {
    id: overrides.id ?? randomUUID(),
    projectId,
    name: overrides.name ?? '主工作区',
    branch: overrides.branch ?? 'main',
    path: overrides.path ?? `/tmp/workspace-${randomUUID()}`,
    status: overrides.status ?? 'idle',
    agentId: overrides.agentId ?? null,
    metadata: overrides.metadata ?? { env: 'test', retries: 2 },
  };
}

function buildConversation(
  workspaceId: string,
  overrides: Partial<ConversationInput> = {}
): ConversationInput {
  return {
    id: overrides.id ?? randomUUID(),
    workspaceId,
    title: overrides.title ?? '默认标题',
  };
}

function buildMessage(
  conversationId: string,
  overrides: Partial<MessageInput> = {}
): MessageInput {
  return {
    id: overrides.id ?? randomUUID(),
    conversationId,
    content: overrides.content ?? 'hello world',
    sender: overrides.sender ?? 'user',
    metadata: overrides.metadata ?? { tokens: 42 },
  };
}

async function createProject(service: DatabaseService, overrides?: Partial<ProjectInput>) {
  const project = buildProject(overrides);
  await service.saveProject(project);
  return project;
}

async function createWorkspace(
  service: DatabaseService,
  projectId: string,
  overrides?: Partial<WorkspaceInput>
) {
  const workspace = buildWorkspace(projectId, overrides);
  await service.saveWorkspace(workspace);
  return workspace;
}

async function createConversation(
  service: DatabaseService,
  workspaceId: string,
  overrides?: Partial<ConversationInput>
) {
  const conversation = buildConversation(workspaceId, overrides);
  await service.saveConversation(conversation);
  return conversation;
}

async function createMessage(
  service: DatabaseService,
  conversationId: string,
  overrides?: Partial<MessageInput>
) {
  const message = buildMessage(conversationId, overrides);
  await service.saveMessage(message);
  return message;
}

describe('DatabaseService', () => {
  let context: ServiceContext | null = null;

  async function setupService(): Promise<ServiceContext> {
    process.env.EMDASH_DISABLE_NATIVE_DB = '0';
    const dir = mkdtempSync(join(tmpdir(), 'emdash-db-'));
    pathState.currentDbPath = join(dir, 'database.sqlite');
    pathState.migrationsPath = DEFAULT_MIGRATIONS_PATH;
    await resetDrizzleClient();
    Reflect.set(DatabaseService as unknown as Record<string, unknown>, 'migrationsApplied', false);
    const service = new DatabaseService();
    await service.initialize();
    return { service, tempDir: dir };
  }

  async function disposeContext() {
    if (context?.service) {
      await context.service.close();
    }
    await resetDrizzleClient();
    if (context?.tempDir) {
      rmSync(context.tempDir, { recursive: true, force: true });
    }
    context = null;
    pathState.migrationsPath = DEFAULT_MIGRATIONS_PATH;
  }

  function currService(): DatabaseService {
    if (!context) {
      throw new Error('Service context missing');
    }
    return context.service;
  }

  beforeEach(async () => {
    context = await setupService();
  });

  afterEach(async () => {
    await disposeContext();
    vi.restoreAllMocks();
  });

  afterAll(() => {
    delete process.env.EMDASH_DISABLE_NATIVE_DB;
  });

  describe('Projects 模块', () => {
    it('应该创建项目并通过 getProjects 返回', async () => {
      const service = currService();
      const project = buildProject({ name: '数据库测试项目' });

      // Arrange
      await service.saveProject(project);

      // Act
      const projects = await service.getProjects();

      // Assert
      expect(projects).toHaveLength(1);
      expect(projects[0].name).toBe('数据库测试项目');
      expect(projects[0].path).toBe(project.path);
    });

    it('应该按更新时间倒序返回项目', async () => {
      const service = currService();

      // Arrange
      const older = await createProject(service, { name: '旧' });
      const _newer = await createProject(service, { name: '新' });
      await service.saveProject({ ...older, name: '旧-更新' });

      // Act
      const projects = await service.getProjects();

      // Assert
      expect(projects[0].name).toBe('旧-更新');
      expect(projects[1].name).toBe('新');
    });

    it('应该处理重复路径并更新信息', async () => {
      const service = currService();

      // Arrange
      const project = await createProject(service, { path: '/tmp/shared-path', name: '第一次' });
      await service.saveProject({
        ...project,
        name: '第二次',
        gitInfo: { isGitRepo: true, remote: 'git@github.com:new/repo.git', branch: 'main' },
      });

      // Act
      const projects = await service.getProjects();

      // Assert
      expect(projects).toHaveLength(1);
      expect(projects[0].name).toBe('第二次');
      expect(projects[0].gitInfo.remote).toBe('git@github.com:new/repo.git');
    });

    it('应该删除项目并清空结果', async () => {
      const service = currService();

      // Arrange
      const project = await createProject(service, { name: '待删除' });

      // Act
      await service.deleteProject(project.id);
      const projects = await service.getProjects();

      // Assert
      expect(projects).toHaveLength(0);
    });

    it('应该正确映射 gitInfo 和 githubInfo 字段', async () => {
      const service = currService();

      // Arrange
      const project = buildProject({
        gitInfo: { isGitRepo: true, remote: 'git@github.com:demo.git', branch: 'release' },
        githubInfo: { repository: 'demo/app', connected: true },
      });
      await service.saveProject(project);

      // Act
      const [stored] = await service.getProjects();

      // Assert
      expect(stored.gitInfo).toEqual({
        isGitRepo: true,
        remote: 'git@github.com:demo.git',
        branch: 'release',
      });
      expect(stored.githubInfo).toEqual({ repository: 'demo/app', connected: true });
    });

    it('没有 git 信息时 isGitRepo 应为 false', async () => {
      const service = currService();
      const project: ProjectInput = {
        id: randomUUID(),
        name: '未初始化 git',
        path: `/tmp/project-${randomUUID()}`,
        gitInfo: { isGitRepo: false },
      };

      // Arrange
      await service.saveProject(project);

      // Act
      const [stored] = await service.getProjects();

      // Assert
      expect(stored.gitInfo.isGitRepo).toBe(false);
      expect(stored.githubInfo).toBeUndefined();
    });
  });

  describe('Workspaces 模块', () => {
    it('应该创建 workspace 并保持 metadata', async () => {
      const service = currService();
      const project = await createProject(service);
      const metadata = { feature: 'sync', enabled: true };

      // Arrange
      await service.saveWorkspace(buildWorkspace(project.id, { metadata }));

      // Act
      const workspaces = await service.getWorkspaces();

      // Assert
      expect(workspaces).toHaveLength(1);
      expect(workspaces[0].metadata).toEqual(metadata);
    });

    it('getWorkspaces 应该允许按项目过滤', async () => {
      const service = currService();
      const projectA = await createProject(service, { name: 'A' });
      const projectB = await createProject(service, { name: 'B' });

      // Arrange
      await createWorkspace(service, projectA.id, { name: 'A 的 Workspace' });
      await createWorkspace(service, projectB.id, { name: 'B 的 Workspace' });

      // Act
      const workspaces = await service.getWorkspaces(projectA.id);

      // Assert
      expect(workspaces).toHaveLength(1);
      expect(workspaces[0].projectId).toBe(projectA.id);
    });

    it('deleteWorkspace 应该删除对应记录', async () => {
      const service = currService();
      const project = await createProject(service);
      // Arrange
      const workspace = await createWorkspace(service, project.id, { name: '待删' });

      // Act
      await service.deleteWorkspace(workspace.id);
      const workspaces = await service.getWorkspaces();

      // Assert
      expect(workspaces).toHaveLength(0);
    });

    it('metadata 为字符串时也能正确反序列化', async () => {
      const service = currService();
      const project = await createProject(service);

      // Arrange
      await service.saveWorkspace(
        buildWorkspace(project.id, { metadata: JSON.stringify({ env: 'prod' }) })
      );

      // Act
      const [workspace] = await service.getWorkspaces();

      // Assert
      expect(workspace.metadata).toEqual({ env: 'prod' });
    });

    it('projectId 不存在时 saveWorkspace 当前不会失败（记录行为）', async () => {
      const service = currService();

      // Arrange
      const invalidWorkspace = buildWorkspace('missing-project');

      // Act
      await expect(service.saveWorkspace(invalidWorkspace)).resolves.toBeUndefined();
      const workspaces = await service.getWorkspaces();

      // Assert
      expect(workspaces.some((workspace) => workspace.id === invalidWorkspace.id)).toBe(true);
    });

    it('解析 metadata 失败时返回 null 并记录警告', async () => {
      const service = currService();
      const project = await createProject(service);
      const workspace = buildWorkspace(project.id);
      await service.saveWorkspace(workspace);
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const { db } = await getDrizzleClient();

      // Arrange
      await db
        .update(workspacesTable)
        .set({ metadata: '{oops' })
        .where(eq(workspacesTable.id, workspace.id));

      // Act
      const [stored] = await service.getWorkspaces();

      // Assert
      expect(stored.metadata).toBeNull();
      expect(warnSpy).toHaveBeenCalled();
    });

    it('删除项目不会自动删除 workspace（当前实现）', async () => {
      const service = currService();
      const project = await createProject(service);
      // Arrange
      await createWorkspace(service, project.id);

      // Act
      await service.deleteProject(project.id);
      const workspaces = await service.getWorkspaces();

      // Assert
      expect(workspaces).toHaveLength(1);
      expect(workspaces[0].projectId).toBe(project.id);
    });
  });

  describe('Conversations 模块', () => {
    it('应该创建 conversation 并按 workspace 返回', async () => {
      const service = currService();
      const project = await createProject(service);
      const workspace = await createWorkspace(service, project.id);

      // Arrange
      await createConversation(service, workspace.id, { title: '会话A' });

      // Act
      const conversations = await service.getConversations(workspace.id);

      // Assert
      expect(conversations).toHaveLength(1);
      expect(conversations[0].title).toBe('会话A');
    });

    it('重复保存 conversation 应更新标题', async () => {
      const service = currService();
      const project = await createProject(service);
      const workspace = await createWorkspace(service, project.id);
      // Arrange
      const conversation = await createConversation(service, workspace.id, { title: '初始' });

      // Act
      await service.saveConversation({ ...conversation, title: '更新后' });
      const [stored] = await service.getConversations(workspace.id);

      // Assert
      expect(stored.title).toBe('更新后');
    });

    it('deleteConversation 应删除记录', async () => {
      const service = currService();
      const project = await createProject(service);
      const workspace = await createWorkspace(service, project.id);
      // Arrange
      const conversation = await createConversation(service, workspace.id);

      // Act
      await service.deleteConversation(conversation.id);
      const conversations = await service.getConversations(workspace.id);

      // Assert
      expect(conversations).toHaveLength(0);
    });

    it('getOrCreateDefaultConversation 在缺失时应创建默认会话', async () => {
      const service = currService();
      const project = await createProject(service);
      const workspace = await createWorkspace(service, project.id);

      // Arrange
      const existing = await service.getConversations(workspace.id);
      expect(existing).toHaveLength(0);

      // Act
      const created = await service.getOrCreateDefaultConversation(workspace.id);
      const conversations = await service.getConversations(workspace.id);

      // Assert
      expect(created.title).toBe('Default Conversation');
      expect(conversations).toHaveLength(1);
    });

    it('getOrCreateDefaultConversation 应复用最早创建的会话', async () => {
      const service = currService();
      const project = await createProject(service);
      const workspace = await createWorkspace(service, project.id);
      const first = await createConversation(service, workspace.id, { title: '早期' });
      await createConversation(service, workspace.id, { title: '较新' });
      const { db } = await getDrizzleClient();

      // Arrange
      await db
        .update(conversationsTable)
        .set({ createdAt: '2024-01-01T00:00:00.000Z' })
        .where(eq(conversationsTable.id, first.id));

      // Act
      const existing = await service.getOrCreateDefaultConversation(workspace.id);

      // Assert
      expect(existing.id).toBe(first.id);
      expect(existing.title).toBe('早期');
    });
  });

  describe('Messages 模块', () => {
    it('saveMessage 应该创建消息记录', async () => {
      const service = currService();
      const project = await createProject(service);
      const workspace = await createWorkspace(service, project.id);
      const conversation = await createConversation(service, workspace.id);

      // Arrange
      await createMessage(service, conversation.id, { content: '第一条' });

      // Act
      const messages = await service.getMessages(conversation.id);

      // Assert
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe('第一条');
    });

    it('getMessages 只返回指定会话的消息', async () => {
      const service = currService();
      const project = await createProject(service);
      const workspaceA = await createWorkspace(service, project.id);
      const workspaceB = await createWorkspace(service, project.id, { name: '另一个' });
      const conversationA = await createConversation(service, workspaceA.id);
      const conversationB = await createConversation(service, workspaceB.id);

      // Arrange
      await createMessage(service, conversationA.id, { content: 'A-1' });
      await createMessage(service, conversationB.id, { content: 'B-1' });

      // Act
      const messages = await service.getMessages(conversationA.id);

      // Assert
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe('A-1');
    });

    it('getMessages 应按时间升序排序', async () => {
      const service = currService();
      const project = await createProject(service);
      const workspace = await createWorkspace(service, project.id);
      const conversation = await createConversation(service, workspace.id);
      const first = await createMessage(service, conversation.id, { content: '旧' });
      const second = await createMessage(service, conversation.id, { content: '新' });
      const { db } = await getDrizzleClient();

      // Arrange
      await db
        .update(messagesTable)
        .set({ timestamp: '2024-01-02T00:00:00.000Z' })
        .where(eq(messagesTable.id, first.id));
      await db
        .update(messagesTable)
        .set({ timestamp: '2024-01-01T00:00:00.000Z' })
        .where(eq(messagesTable.id, second.id));

      // Act
      const messages = await service.getMessages(conversation.id);

      // Assert
      expect(messages.map((m) => m.content)).toEqual(['新', '旧']);
    });

    it('保存消息时应更新 conversation 的 updatedAt', async () => {
      const service = currService();
      const project = await createProject(service);
      const workspace = await createWorkspace(service, project.id);
      const conversation = await createConversation(service, workspace.id);
      // Arrange
      const original = await service.getConversations(workspace.id);

      // Act
      await createMessage(service, conversation.id, { content: '触发更新时间' });
      const updated = await service.getConversations(workspace.id);

      // Assert
      expect(updated[0].updatedAt >= original[0].updatedAt).toBe(true);
    });

    it('重复 message id 不会插入重复记录', async () => {
      const service = currService();
      const project = await createProject(service);
      const workspace = await createWorkspace(service, project.id);
      const conversation = await createConversation(service, workspace.id);
      const message = buildMessage(conversation.id, { content: '唯一' });

      // Arrange
      await service.saveMessage(message);
      await service.saveMessage(message);

      // Act
      const { db } = await getDrizzleClient();
      const rows = await db
        .select()
        .from(messagesTable)
        .where(eq(messagesTable.id, message.id));

      // Assert
      expect(rows).toHaveLength(1);
    });

    it('删除 conversation 不会自动删除消息（当前实现）', async () => {
      const service = currService();
      const project = await createProject(service);
      const workspace = await createWorkspace(service, project.id);
      const conversation = await createConversation(service, workspace.id);
      // Arrange
      await createMessage(service, conversation.id);

      // Act
      await service.deleteConversation(conversation.id);
      const messages = await service.getMessages(conversation.id);

      // Assert
      expect(messages).toHaveLength(1);
    });
  });

  describe('初始化与生命周期', () => {
    it('initialize 可以多次调用', async () => {
      const service = currService();

      // Arrange
      await service.close();

      // Act
      await service.initialize();
      await service.initialize();

      // Assert
      const projects = await service.getProjects();
      expect(projects).toEqual([]);
    });

    it('close 再次调用会抛错（当前行为）', async () => {
      await disposeContext();
      const { service, tempDir } = await setupService();

      try {
        // Act
        await service.close();

        // Assert
        await expect(service.close()).rejects.toThrow('Database is closed');
      } finally {
        await resetDrizzleClient();
        rmSync(tempDir, { recursive: true, force: true });
        context = null;
        pathState.migrationsPath = DEFAULT_MIGRATIONS_PATH;
      }
    });

    it('缺少迁移目录时 initialize 应失败', async () => {
      await disposeContext();
      const tempDir = mkdtempSync(join(tmpdir(), 'emdash-migrations-missing-'));
      pathState.currentDbPath = join(tempDir, 'database.sqlite');
      pathState.migrationsPath = null;
      const service = new DatabaseService();

      try {
        // Arrange
        expect(pathState.migrationsPath).toBeNull();
        Reflect.set(DatabaseService as unknown as Record<string, unknown>, 'migrationsApplied', false);

        // Act & Assert
        await expect(service.initialize()).rejects.toThrow('Drizzle migrations folder not found');
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('EMDASH_DISABLE_NATIVE_DB=1 时应跳过所有操作', async () => {
      await disposeContext();
      process.env.EMDASH_DISABLE_NATIVE_DB = '1';
      const disabled = new DatabaseService();

      // Arrange
      expect(process.env.EMDASH_DISABLE_NATIVE_DB).toBe('1');

      // Act
      await disabled.initialize();
      await disabled.saveProject(buildProject());
      const projects = await disabled.getProjects();

      // Assert
      expect(projects).toEqual([]);
      await disabled.close();
      process.env.EMDASH_DISABLE_NATIVE_DB = '0';
      context = await setupService();
    });
  });

  describe('错误处理', () => {
    it('保存 workspace 时 metadata 无法序列化应抛错', async () => {
      const service = currService();
      const project = await createProject(service);

      // Arrange
      const invalid = buildWorkspace(project.id, {
        metadata: { count: BigInt(1) } as unknown as Workspace['metadata'],
      });

      // Act & Assert
      await expect(service.saveWorkspace(invalid)).rejects.toThrow();
    });

    it('保存 message 时若会话不存在会创建孤立消息（当前行为）', async () => {
      const service = currService();

      // Arrange
      const invalidMessage = buildMessage('missing-conversation');

      // Act
      await expect(service.saveMessage(invalidMessage)).resolves.toBeUndefined();
      const stored = await service.getMessages(invalidMessage.conversationId);

      // Assert
      expect(stored).toHaveLength(1);
      expect(stored[0].conversationId).toBe(invalidMessage.conversationId);
    });

    it('parseWorkspaceMetadata JSON 错误时不会中断流程', async () => {
      const service = currService();
      const project = await createProject(service);
      const workspace = buildWorkspace(project.id);
      await service.saveWorkspace(workspace);
      const { db } = await getDrizzleClient();
      // Arrange
      await db
        .update(workspacesTable)
        .set({ metadata: '{"broken":' })
        .where(eq(workspacesTable.id, workspace.id));

      // Act
      const [stored] = await service.getWorkspaces();

      // Assert
      expect(stored.metadata).toBeNull();
    });
  });
});
