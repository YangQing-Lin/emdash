import { useEffect, useRef } from 'react';
import { useToast } from '@/hooks/use-toast';
import type { RemoteConnectionStatus } from '@shared/remoteConnection';

type ToastHandle = ReturnType<ReturnType<typeof useToast>['toast']>;

const SERVICE_LABELS: Record<
  RemoteConnectionStatus['service'],
  { reconnecting: string; reconnected: string; noun: string }
> = {
  pty: {
    reconnecting: 'Terminal connection lost',
    reconnected: 'Terminal connection restored',
    noun: 'terminal',
  },
  codex: {
    reconnecting: 'Agent link interrupted',
    reconnected: 'Agent link restored',
    noun: 'agent',
  },
};

const formatDelay = (ms?: number): string | null => {
  if (!ms || ms <= 0) {
    return null;
  }
  if (ms < 1000) {
    return `${ms} ms`;
  }
  const seconds = ms / 1000;
  return seconds >= 10 ? `${Math.round(seconds)} s` : `${seconds.toFixed(1)} s`;
};

export function useRemoteConnectionToasts(): void {
  const { toast } = useToast();
  const handlesRef = useRef<Map<string, ToastHandle>>(new Map());
  const dismissTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const clearTimer = (key: string) => {
      const timer = dismissTimersRef.current.get(key);
      if (timer) {
        clearTimeout(timer);
        dismissTimersRef.current.delete(key);
      }
    };

    const removeHandle = (key: string) => {
      handlesRef.current.delete(key);
      clearTimer(key);
    };

    const handleStatus = (status: RemoteConnectionStatus) => {
      if (!status?.service || !status.id) {
        return;
      }
      const key = `${status.service}:${status.id}`;
      const labels = SERVICE_LABELS[status.service];
      if (!labels) return;

      if (status.phase === 'reconnecting') {
        clearTimer(key);
        const delayText = formatDelay(status.nextDelayMs);
        const attemptText = status.attempt ? `Attempt ${status.attempt}` : 'Retrying';
        const description = delayText
          ? `${attemptText} in ${delayText} for ${labels.noun} ${status.id}`
          : `${attemptText} for ${labels.noun} ${status.id}`;

        const existing = handlesRef.current.get(key);
        if (existing) {
          existing.update({
            id: existing.id,
            title: labels.reconnecting,
            description,
            variant: 'default',
          });
        } else {
          const handle = toast({
            title: labels.reconnecting,
            description,
            variant: 'default',
          });
          handlesRef.current.set(key, handle);
        }
        return;
      }

      if (status.phase === 'reconnected') {
        const description = `Latency recovered for ${labels.noun} ${status.id}`;
        const existing = handlesRef.current.get(key);
        const handle =
          existing ??
          toast({
            title: labels.reconnected,
            description,
            variant: 'default',
          });

        handle.update({
          id: handle.id,
          title: labels.reconnected,
          description,
          variant: 'default',
        });
        clearTimer(key);
        const timer = setTimeout(() => {
          handle.dismiss();
          removeHandle(key);
        }, 2500);
        dismissTimersRef.current.set(key, timer);
        if (!existing) {
          handlesRef.current.set(key, handle);
        }
        return;
      }
    };

    const off =
      window.electronAPI.onRemoteConnectionStatus?.((payload: RemoteConnectionStatus) => {
        handleStatus(payload);
      }) ?? null;

    return () => {
      off?.();
      handlesRef.current.forEach((handle, key) => {
        try {
          handle.dismiss();
        } catch {
          // ignore
        } finally {
          clearTimer(key);
        }
      });
      handlesRef.current.clear();
      dismissTimersRef.current.clear();
    };
  }, [toast]);
}
