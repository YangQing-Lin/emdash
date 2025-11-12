import React, { useCallback, useEffect, useState } from 'react';
import { Server, Plus, Edit, Trash2, TestTube, Check, X } from 'lucide-react';
import type { RemoteServerRow } from '../../main/db/schema';
import RemoteServerDialog from './RemoteServerDialog';
import { Button } from './ui/button';
import { Alert, AlertDescription } from './ui/alert';
import { Spinner } from './ui/spinner';

type RemoteServerApiResponse<T = unknown> = Promise<{
  success: boolean;
  data?: T;
  error?: string;
}>;

type RemoteServerAPI = {
  remoteServerList: () => RemoteServerApiResponse<RemoteServerRow[]>;
  remoteServerDelete: (id: string) => RemoteServerApiResponse;
  remoteServerTest: (payload: { grpcUrl: string; wsUrl: string; token: string }) => RemoteServerApiResponse<{
    message?: string;
  }>;
};

const getRemoteServerAPI = (): RemoteServerAPI | undefined => {
  const api = (window as unknown as Window & { electronAPI?: RemoteServerAPI }).electronAPI;
  return api;
};

type TestStatus = {
  status: 'success' | 'error';
  message: string;
};

const sortServers = (servers: RemoteServerRow[]): RemoteServerRow[] => {
  return [...servers].sort((a, b) => {
    const aLast = a.lastUsed ? new Date(a.lastUsed).getTime() : 0;
    const bLast = b.lastUsed ? new Date(b.lastUsed).getTime() : 0;
    if (aLast !== bLast) {
      return bLast - aLast;
    }

    const aCreated = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bCreated = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return bCreated - aCreated;
  });
};

const formatTimestamp = (value?: string | null): string => {
  if (!value) {
    return 'Never used';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  } catch {
    return date.toISOString();
  }
};

const RemoteServersCard: React.FC = () => {
  const [servers, setServers] = useState<RemoteServerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialogState, setDialogState] = useState<{
    open: boolean;
    mode: 'add' | 'edit';
    server: RemoteServerRow | null;
  }>({
    open: false,
    mode: 'add',
    server: null,
  });
  const [testingMap, setTestingMap] = useState<Record<string, boolean>>({});
  const [testStatus, setTestStatus] = useState<Record<string, TestStatus>>({});
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const ipcAvailable = Boolean(getRemoteServerAPI());

  const fetchServers = useCallback(
    async (opts?: { silent?: boolean }) => {
      const api = getRemoteServerAPI();
      if (!api?.remoteServerList) {
        setError('Remote server APIs are unavailable in this build.');
        setLoading(false);
        setRefreshing(false);
        return;
      }

      if (opts?.silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      try {
        const response = await api.remoteServerList();
        if (response?.success && Array.isArray(response.data)) {
          setServers(sortServers(response.data));
          setError(null);
        } else {
          throw new Error(response?.error ?? 'Unable to load remote servers.');
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unable to load remote servers.';
        setError(message);
      } finally {
        if (opts?.silent) {
          setRefreshing(false);
        } else {
          setLoading(false);
        }
      }
    },
    []
  );

  useEffect(() => {
    void fetchServers();
  }, [fetchServers]);

  const openAddDialog = useCallback(() => {
    setDialogState({ open: true, mode: 'add', server: null });
  }, []);

  const openEditDialog = useCallback((server: RemoteServerRow) => {
    setDialogState({ open: true, mode: 'edit', server });
  }, []);

  const closeDialog = useCallback(() => {
    setDialogState((prev) => ({ ...prev, open: false, server: null }));
  }, []);

  const handleServerSaved = useCallback(
    (saved: RemoteServerRow) => {
      setServers((prev) => {
        const next = prev.some((item) => item.id === saved.id)
          ? prev.map((item) => (item.id === saved.id ? saved : item))
          : [...prev, saved];
        return sortServers(next);
      });
      setTestStatus((prev) => {
        const next = { ...prev };
        delete next[saved.id];
        return next;
      });
      closeDialog();
      void fetchServers({ silent: true });
    },
    [closeDialog, fetchServers]
  );

  const handleDelete = useCallback(
    async (server: RemoteServerRow) => {
      const api = getRemoteServerAPI();
      if (!api?.remoteServerDelete) {
        setError('Remote server APIs are unavailable in this build.');
        return;
      }

      const confirmed = window.confirm(`Delete remote server "${server.name}"?`);
      if (!confirmed) {
        return;
      }

      setDeletingId(server.id);
      try {
        const response = await api.remoteServerDelete(server.id);
        if (!response?.success) {
          throw new Error(response?.error ?? 'Failed to delete remote server.');
        }

        setServers((prev) => prev.filter((item) => item.id !== server.id));
        setTestStatus((prev) => {
          const next = { ...prev };
          delete next[server.id];
          return next;
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to delete remote server.';
        setError(message);
      } finally {
        setDeletingId(null);
      }
    },
    []
  );

  const handleTestConnection = useCallback(async (server: RemoteServerRow) => {
    const api = getRemoteServerAPI();
    if (!api?.remoteServerTest) {
      setError('Remote server APIs are unavailable in this build.');
      return;
    }

    setTestingMap((prev) => ({ ...prev, [server.id]: true }));
    setTestStatus((prev) => {
      const next = { ...prev };
      delete next[server.id];
      return next;
    });

    try {
      const response = await api.remoteServerTest({
        grpcUrl: server.grpcUrl,
        wsUrl: server.wsUrl,
        token: server.token,
      });

      if (!response?.success) {
        throw new Error(response?.error ?? 'Unable to reach the remote server.');
      }

      const message = response?.data?.message || 'Connection successful.';
      setTestStatus((prev) => ({ ...prev, [server.id]: { status: 'success', message } }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to reach the remote server.';
      setTestStatus((prev) => ({ ...prev, [server.id]: { status: 'error', message } }));
    } finally {
      setTestingMap((prev) => {
        const next = { ...prev };
        delete next[server.id];
        return next;
      });
    }
  }, []);

  const isLoading = loading && !refreshing;

  const emptyState = !isLoading && !servers.length;

  return (
    <div className="rounded-xl border border-border/60 bg-muted/10 p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Server className="h-4 w-4" />
          Remote servers
        </div>
        <div className="flex items-center gap-2">
          {refreshing ? <Spinner size="sm" className="text-muted-foreground" /> : null}
          <Button type="button" size="sm" onClick={openAddDialog} disabled={!ipcAvailable}>
            <Plus className="mr-1 h-4 w-4" />
            Add server
          </Button>
        </div>
      </div>

      {error ? (
        <div className="mt-4">
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </div>
      ) : null}

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Spinner size="lg" className="text-muted-foreground" />
        </div>
      ) : null}

      {emptyState ? (
        <div className="mt-6 rounded-lg border border-dashed border-border/60 bg-background/60 p-6 text-center text-sm text-muted-foreground">
          No remote servers yet. Add one to run workspaces on remote machines.
        </div>
      ) : null}

      {!isLoading && servers.length ? (
        <div className="mt-4 space-y-4">
          {servers.map((server) => {
            const testing = Boolean(testingMap[server.id]);
            const testMessage = testStatus[server.id];
            const isDeleting = deletingId === server.id;
            return (
              <div key={server.id} className="rounded-lg border border-border/60 bg-background/40 p-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-[240px] flex-1 space-y-2">
                    <div>
                      <p className="text-sm font-semibold text-foreground">{server.name}</p>
                      <p className="text-xs text-muted-foreground">Last used: {formatTimestamp(server.lastUsed)}</p>
                    </div>
                    <dl className="space-y-1 text-xs text-muted-foreground">
                      <div className="flex flex-wrap gap-1">
                        <dt className="font-medium uppercase tracking-wide text-[11px] text-muted-foreground/80">
                          gRPC
                        </dt>
                        <dd className="font-mono text-[11px] text-foreground/80">{server.grpcUrl}</dd>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        <dt className="font-medium uppercase tracking-wide text-[11px] text-muted-foreground/80">
                          WebSocket
                        </dt>
                        <dd className="font-mono text-[11px] text-foreground/80">{server.wsUrl}</dd>
                      </div>
                    </dl>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => openEditDialog(server)}
                      disabled={!ipcAvailable || isDeleting}
                    >
                      <Edit className="mr-1 h-4 w-4" />
                      Edit
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => handleTestConnection(server)}
                      disabled={testing || isDeleting || !ipcAvailable}
                    >
                      {testing ? <Spinner size="sm" className="mr-2" /> : <TestTube className="mr-1 h-4 w-4" />}
                      Test connection
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={() => void handleDelete(server)}
                      disabled={isDeleting || !ipcAvailable}
                    >
                      {isDeleting ? <Spinner size="sm" className="mr-2" /> : <Trash2 className="mr-1 h-4 w-4" />}
                      Delete
                    </Button>
                  </div>
                </div>

                {testMessage ? (
                  <div className="mt-3">
                    <Alert variant={testMessage.status === 'error' ? 'destructive' : 'default'}>
                      {testMessage.status === 'success' ? (
                        <Check className="h-4 w-4" />
                      ) : (
                        <X className="h-4 w-4" />
                      )}
                      <AlertDescription>{testMessage.message}</AlertDescription>
                    </Alert>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      <RemoteServerDialog
        open={dialogState.open}
        mode={dialogState.mode}
        server={dialogState.server ?? undefined}
        onClose={closeDialog}
        onSaved={handleServerSaved}
      />
    </div>
  );
};

export default RemoteServersCard;
