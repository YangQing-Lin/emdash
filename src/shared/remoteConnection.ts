export type RemoteConnectionService = 'pty' | 'codex';

export type RemoteConnectionPhase = 'connecting' | 'reconnecting' | 'reconnected' | 'failed';

export interface RemoteConnectionStatus {
  service: RemoteConnectionService;
  id: string;
  phase: RemoteConnectionPhase;
  attempt?: number;
  nextDelayMs?: number;
  reason?: string;
}
