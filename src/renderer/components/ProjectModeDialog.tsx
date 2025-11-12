import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertDialog as Dialog,
  AlertDialogContent as DialogContent,
  AlertDialogDescription as DialogDescription,
  AlertDialogFooter as DialogFooter,
  AlertDialogHeader as DialogHeader,
  AlertDialogTitle as DialogTitle,
} from './ui/alert-dialog';
import { Button } from './ui/button';
import { Alert, AlertDescription } from './ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemText,
  SelectTrigger,
  SelectValue,
} from './ui/select';
import { Spinner } from './ui/spinner';
import type { RemoteServerRow } from '../../main/db/schema';

type RemoteServerApiResponse<T = unknown> = Promise<{
  success: boolean;
  data?: T;
  error?: string;
}>;

type RemoteServerAPI = {
  remoteServerList: () => RemoteServerApiResponse<RemoteServerRow[]>;
};

const getRemoteServerAPI = (): RemoteServerAPI | undefined => {
  const api = (window as unknown as Window & { electronAPI?: RemoteServerAPI }).electronAPI;
  return api;
};

export type ProjectModeSelection = {
  mode: 'local' | 'remote';
  remoteServerId: string | null;
};

interface ProjectModeDialogProps {
  open: boolean;
  projectName?: string;
  defaultMode?: 'local' | 'remote';
  initialRemoteServerId?: string | null;
  onCancel: () => void;
  onConfirm: (selection: ProjectModeSelection) => void;
}

const MODE_OPTIONS: Array<{
  value: 'local' | 'remote';
  title: string;
  description: string;
}> = [
  {
    value: 'local',
    title: 'Local Mode',
    description: 'Run everything on this computer. Uses your local shell, tools, and network.',
  },
  {
    value: 'remote',
    title: 'Remote Mode',
    description: 'Delegate work to a configured remote server. Great for heavier workloads.',
  },
];

const ProjectModeDialog: React.FC<ProjectModeDialogProps> = ({
  open,
  projectName,
  defaultMode = 'local',
  initialRemoteServerId = null,
  onCancel,
  onConfirm,
}) => {
  const [mode, setMode] = useState<'local' | 'remote'>(defaultMode);
  const [remoteServers, setRemoteServers] = useState<RemoteServerRow[]>([]);
  const [loadingServers, setLoadingServers] = useState(false);
  const [serversError, setServersError] = useState<string | null>(null);
  const [selectedServerId, setSelectedServerId] = useState<string | null>(initialRemoteServerId);

  useEffect(() => {
    if (!open) {
      return;
    }
    setMode(defaultMode);
    setSelectedServerId(initialRemoteServerId);
    setServersError(null);
  }, [defaultMode, initialRemoteServerId, open]);

  const fetchServers = useCallback(async () => {
    const api = getRemoteServerAPI();
    if (!api?.remoteServerList) {
      setServersError('Remote server APIs are unavailable in this build.');
      setRemoteServers([]);
      setLoadingServers(false);
      return;
    }

    try {
      setLoadingServers(true);
      setServersError(null);
      const response = await api.remoteServerList();
      if (!response?.success || !Array.isArray(response.data)) {
        throw new Error(response?.error ?? 'Unable to load remote servers.');
      }
      setRemoteServers(response.data);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load remote servers.';
      setServersError(message);
      setRemoteServers([]);
    } finally {
      setLoadingServers(false);
    }
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }
    void fetchServers();
  }, [fetchServers, open]);

  useEffect(() => {
    if (mode !== 'remote') {
      return;
    }
    if (remoteServers.length === 0) {
      setSelectedServerId(null);
      return;
    }

    setSelectedServerId((prev) => {
      if (prev && remoteServers.some((server) => server.id === prev)) {
        return prev;
      }
      return remoteServers[0]?.id ?? null;
    });
  }, [mode, remoteServers]);

  const canSubmit = mode === 'remote' ? !!selectedServerId : true;

  const handleConfirm = useCallback(() => {
    if (!canSubmit) {
      return;
    }
    onConfirm({
      mode,
      remoteServerId: mode === 'remote' ? selectedServerId : null,
    });
  }, [canSubmit, mode, onConfirm, selectedServerId]);

  const projectLabel = useMemo(() => projectName?.trim() || 'this project', [projectName]);

  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? onCancel() : undefined)}>
      <DialogContent className="max-w-lg">
        <DialogHeader className="text-left">
          <DialogTitle>Select a project mode</DialogTitle>
          <DialogDescription>
            Choose where emdash should run tasks for <span className="font-medium">{projectLabel}</span>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Local mode keeps everything on your machine. Remote mode routes workspace operations through one
            of your configured remote servers.
          </p>

          <div className="grid gap-3">
            {MODE_OPTIONS.map((option) => {
              const isSelected = mode === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setMode(option.value)}
                  className={`flex w-full items-start rounded-md border p-3 text-left transition ${
                    isSelected ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
                  }`}
                >
                  <div className="flex-1">
                    <div className="text-sm font-medium">{option.title}</div>
                    <p className="mt-1 text-xs text-muted-foreground">{option.description}</p>
                  </div>
                  <div
                    className={`ml-3 mt-1 h-4 w-4 rounded-full border ${
                      isSelected ? 'border-primary bg-primary' : 'border-muted-foreground'
                    }`}
                    aria-hidden="true"
                  />
                </button>
              );
            })}
          </div>

          {mode === 'remote' ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-foreground">Remote server</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void fetchServers()}
                  disabled={loadingServers}
                >
                  {loadingServers ? <Spinner size="sm" className="mr-2" /> : null}
                  Refresh
                </Button>
              </div>

              {serversError ? (
                <Alert variant="destructive">
                  <AlertDescription>{serversError}</AlertDescription>
                </Alert>
              ) : null}

              {loadingServers && !serversError ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Spinner size="sm" />
                  Loading remote servers…
                </div>
              ) : null}

              {!loadingServers && remoteServers.length === 0 && !serversError ? (
                <Alert>
                  <AlertDescription>
                    No remote servers found. Add one from Settings → Remote Servers, then refresh this list.
                  </AlertDescription>
                </Alert>
              ) : null}

              {remoteServers.length > 0 ? (
                <Select
                  value={selectedServerId ?? remoteServers[0].id}
                  onValueChange={(value) => setSelectedServerId(value)}
                >
                  <SelectTrigger aria-label="Remote server">
                    <SelectValue placeholder="Select a remote server" />
                  </SelectTrigger>
                  <SelectContent>
                    {remoteServers.map((server) => (
                      <SelectItem key={server.id} value={server.id}>
                        <div className="flex flex-col">
                          <SelectItemText>{server.name}</SelectItemText>
                          <span className="text-xs text-muted-foreground">{server.grpcUrl}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
            </div>
          ) : null}
        </div>

        <DialogFooter className="mt-4">
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" onClick={handleConfirm} disabled={!canSubmit}>
            Continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ProjectModeDialog;
