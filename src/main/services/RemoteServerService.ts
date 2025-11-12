import crypto from 'node:crypto';
import { createConnection } from 'node:net';
import { desc, eq, sql } from 'drizzle-orm';

import { getDrizzleClient } from '../db/drizzleClient';
import { remoteServers, type RemoteServerRow } from '../db/schema';

type RemoteServerInput = Pick<RemoteServerRow, 'name' | 'grpcUrl' | 'wsUrl' | 'token'>;
type RemoteServerUpdate = Partial<RemoteServerInput>;
type RemoteServerInsert = typeof remoteServers.$inferInsert;

const DEFAULT_CONNECTION_TIMEOUT_MS = 5000;

class RemoteServerServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RemoteServerServiceError';
  }
}

class RemoteServerService {
  private readonly connectionTimeoutMs = DEFAULT_CONNECTION_TIMEOUT_MS;

  async addServer(data: RemoteServerInput): Promise<RemoteServerRow> {
    try {
      const db = await this.getDb();
      const id = crypto.randomUUID();

      await db.insert(remoteServers).values({
        id,
        name: data.name,
        grpcUrl: data.grpcUrl,
        wsUrl: data.wsUrl,
        token: data.token,
      });

      const created = await this.getServer(id);
      if (!created) {
        throw new Error('Failed to load newly created server');
      }
      return created;
    } catch (error) {
      throw this.buildError('Failed to add remote server', error);
    }
  }

  async listServers(): Promise<RemoteServerRow[]> {
    try {
      const db = await this.getDb();
      return await db
        .select()
        .from(remoteServers)
        .orderBy(desc(remoteServers.lastUsed), desc(remoteServers.createdAt));
    } catch (error) {
      throw this.buildError('Failed to list remote servers', error);
    }
  }

  async getServer(id: string): Promise<RemoteServerRow | null> {
    try {
      const db = await this.getDb();
      const rows = await db.select().from(remoteServers).where(eq(remoteServers.id, id)).limit(1);
      return rows[0] ?? null;
    } catch (error) {
      throw this.buildError('Failed to get remote server', error);
    }
  }

  async updateServer(id: string, data: RemoteServerUpdate): Promise<RemoteServerRow> {
    try {
      const existing = await this.getServer(id);
      if (!existing) {
        throw new Error('Remote server not found');
      }

      const updates = this.buildUpdatePayload(data);
      if (!updates) {
        return existing;
      }

      const db = await this.getDb();
      await db.update(remoteServers).set(updates).where(eq(remoteServers.id, id));

      const updated = await this.getServer(id);
      if (!updated) {
        throw new Error('Remote server not found');
      }
      return updated;
    } catch (error) {
      throw this.buildError('Failed to update remote server', error);
    }
  }

  async deleteServer(id: string): Promise<void> {
    try {
      const existing = await this.getServer(id);
      if (!existing) {
        throw new Error('Remote server not found');
      }

      const db = await this.getDb();
      await db.delete(remoteServers).where(eq(remoteServers.id, id));
    } catch (error) {
      throw this.buildError('Failed to delete remote server', error);
    }
  }

  async testConnection(
    grpcUrl: string,
    wsUrl: string,
    token: string
  ): Promise<{ success: boolean; message?: string }> {
    try {
      if (!token || !token.trim()) {
        return { success: false, message: 'Token is required to test the connection' };
      }

      const grpcEndpoint = this.parseUrl(grpcUrl, 'gRPC URL');
      const wsEndpoint = this.parseUrl(wsUrl, 'WebSocket URL');

      await Promise.all([this.probeEndpoint(grpcEndpoint), this.probeEndpoint(wsEndpoint)]);

      return { success: true };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error during connection test',
      };
    }
  }

  async updateLastUsed(id: string): Promise<void> {
    try {
      const db = await this.getDb();
      await db
        .update(remoteServers)
        .set({ lastUsed: sql`CURRENT_TIMESTAMP` })
        .where(eq(remoteServers.id, id));
    } catch (error) {
      throw this.buildError('Failed to update last-used timestamp', error);
    }
  }

  private async getDb() {
    const { db } = await getDrizzleClient();
    return db;
  }

  private buildUpdatePayload(data: RemoteServerUpdate): Partial<RemoteServerInsert> | null {
    const updates: Partial<RemoteServerInsert> = {};
    if (data.name !== undefined) {
      updates.name = data.name;
    }
    if (data.grpcUrl !== undefined) {
      updates.grpcUrl = data.grpcUrl;
    }
    if (data.wsUrl !== undefined) {
      updates.wsUrl = data.wsUrl;
    }
    if (data.token !== undefined) {
      updates.token = data.token;
    }

    return Object.keys(updates).length > 0 ? updates : null;
  }

  private parseUrl(value: string, label: string): URL {
    try {
      return new URL(value);
    } catch {
      throw new Error(`${label} is invalid`);
    }
  }

  private async probeEndpoint(url: URL): Promise<void> {
    const host = url.hostname;
    if (!host) {
      throw new Error(`Missing host for ${url.toString()}`);
    }

    const port = this.resolvePort(url);
    await new Promise<void>((resolve, reject) => {
      const socket = createConnection({ host, port });

      const cleanup = () => {
        socket.removeAllListeners();
        socket.destroy();
      };

      socket.setTimeout(this.connectionTimeoutMs);

      socket.once('connect', () => {
        cleanup();
        resolve();
      });

      socket.once('timeout', () => {
        cleanup();
        reject(new Error(`Connection to ${host}:${port} timed out`));
      });

      socket.once('error', (err) => {
        cleanup();
        reject(new Error(`Connection error for ${host}:${port}: ${err.message}`));
      });
    });
  }

  private resolvePort(url: URL): number {
    if (url.port) {
      const parsed = Number(url.port);
      if (!Number.isNaN(parsed) && parsed > 0) {
        return parsed;
      }
    }

    switch (url.protocol) {
      case 'https:':
      case 'wss:':
      case 'grpcs:':
        return 443;
      default:
        return 80;
    }
  }

  private buildError(action: string, error: unknown): Error {
    if (error instanceof RemoteServerServiceError) {
      return error;
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    const wrapped = new RemoteServerServiceError(`${action}: ${message}`);
    console.error(`[RemoteServerService] ${action}`, error);
    return wrapped;
  }
}

export const remoteServerService = new RemoteServerService();
