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
import { Input } from './ui/input';
import { Alert, AlertDescription } from './ui/alert';
import { Spinner } from './ui/spinner';
import { TestTube, Check, X } from 'lucide-react';
import type { RemoteServerRow } from '../../main/db/schema';

type RemoteServerFormData = {
  name: string;
  grpcUrl: string;
  wsUrl: string;
  token: string;
};

type FieldErrors = Partial<Record<keyof RemoteServerFormData, string>>;

type TestResult = {
  status: 'success' | 'error';
  message: string;
};

type RemoteServerApiResponse<T = unknown> = Promise<{
  success: boolean;
  data?: T;
  error?: string;
}>;

type RemoteServerAPI = {
  remoteServerAdd: (payload: RemoteServerFormData) => RemoteServerApiResponse<RemoteServerRow>;
  remoteServerUpdate: (payload: {
    id: string;
    data: RemoteServerFormData;
  }) => RemoteServerApiResponse<RemoteServerRow>;
  remoteServerTest: (payload: RemoteServerFormData) => RemoteServerApiResponse<{ message?: string }>;
};

const getRemoteServerAPI = (): RemoteServerAPI | undefined => {
  const api = (window as unknown as Window & { electronAPI?: RemoteServerAPI }).electronAPI;
  return api;
};

interface RemoteServerDialogProps {
  open: boolean;
  mode: 'add' | 'edit';
  server?: RemoteServerRow | null;
  onClose: () => void;
  onSaved?: (server: RemoteServerRow) => void;
}

const EMPTY_FORM: RemoteServerFormData = {
  name: '',
  grpcUrl: '',
  wsUrl: '',
  token: '',
};

const RemoteServerDialog: React.FC<RemoteServerDialogProps> = ({
  open,
  mode,
  server,
  onClose,
  onSaved,
}) => {
  const [formData, setFormData] = useState<RemoteServerFormData>(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  const dialogTitle = useMemo(
    () => (mode === 'add' ? 'Add remote server' : 'Edit remote server'),
    [mode]
  );

  useEffect(() => {
    if (!open) {
      return;
    }

    setFormData(
      server
        ? {
            name: server.name,
            grpcUrl: server.grpcUrl,
            wsUrl: server.wsUrl,
            token: server.token,
          }
        : { ...EMPTY_FORM }
    );
    setFieldErrors({});
    setFormError(null);
    setTestResult(null);
    setTesting(false);
  }, [open, server]);

  const validate = useCallback((data: RemoteServerFormData): FieldErrors => {
    const errors: FieldErrors = {};

    if (!data.name.trim()) {
      errors.name = 'Name is required.';
    }

    const grpcValue = data.grpcUrl.trim();
    if (!grpcValue) {
      errors.grpcUrl = 'gRPC URL is required.';
    } else if (!/^grpc(s)?:\/\//i.test(grpcValue)) {
      errors.grpcUrl = 'gRPC URL must start with grpc:// or grpcs://';
    }

    const wsValue = data.wsUrl.trim();
    if (!wsValue) {
      errors.wsUrl = 'WebSocket URL is required.';
    } else if (!/^ws(s)?:\/\//i.test(wsValue)) {
      errors.wsUrl = 'WebSocket URL must start with ws:// or wss://';
    }

    if (!data.token.trim()) {
      errors.token = 'Token is required.';
    }

    return errors;
  }, []);

  const handleInputChange = useCallback(
    (field: keyof RemoteServerFormData) =>
      (event: React.ChangeEvent<HTMLInputElement>) => {
        const { value } = event.target;
        setFormData((prev) => ({ ...prev, [field]: value }));
        setFieldErrors((prev) => ({ ...prev, [field]: undefined }));
        setTestResult(null);
        setFormError(null);
      },
    []
  );

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setFormError(null);

      const trimmed: RemoteServerFormData = {
        name: formData.name.trim(),
        grpcUrl: formData.grpcUrl.trim(),
        wsUrl: formData.wsUrl.trim(),
        token: formData.token.trim(),
      };

      const validation = validate(trimmed);
      if (Object.keys(validation).length) {
        setFieldErrors(validation);
        return;
      }

      try {
        setSubmitting(true);
        const api = getRemoteServerAPI();
        if (!api) {
          throw new Error('Remote server APIs are unavailable in this build.');
        }

        let response: any;
        if (mode === 'add') {
          response = await api.remoteServerAdd(trimmed);
        } else {
          if (!server) {
            throw new Error('Missing remote server context.');
          }
          response = await api.remoteServerUpdate({
            id: server.id,
            data: trimmed,
          });
        }

        if (!response?.success || !response?.data) {
          throw new Error(response?.error ?? 'Unable to save remote server.');
        }

        onSaved?.(response.data as RemoteServerRow);
        onClose();
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to save remote server.';
        setFormError(message);
      } finally {
        setSubmitting(false);
      }
    },
    [formData, mode, onClose, onSaved, server, validate]
  );

  const handleTestConnection = useCallback(async () => {
    setFormError(null);
    const trimmed: RemoteServerFormData = {
      name: formData.name.trim(),
      grpcUrl: formData.grpcUrl.trim(),
      wsUrl: formData.wsUrl.trim(),
      token: formData.token.trim(),
    };

    const validation = validate(trimmed);
    if (Object.keys(validation).length) {
      setFieldErrors(validation);
      return;
    }

    try {
      setTesting(true);
      setTestResult(null);

      const api = getRemoteServerAPI();
      if (!api) {
        throw new Error('Remote server APIs are unavailable in this build.');
      }

      const response = await api.remoteServerTest(trimmed);
      if (!response?.success) {
        throw new Error(response?.error ?? 'Unable to reach the remote server.');
      }

      const successMessage = response?.data?.message || 'Connection successful.';
      setTestResult({ status: 'success', message: successMessage });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to reach the remote server.';
      setTestResult({ status: 'error', message });
    } finally {
      setTesting(false);
    }
  }, [formData, validate]);

  const renderField = (
    field: keyof RemoteServerFormData,
    label: string,
    props?: Partial<React.ComponentProps<typeof Input>>
  ) => (
    <div className="space-y-1">
      <label htmlFor={field} className="text-sm font-medium text-foreground">
        {label}
      </label>
      <Input
        id={field}
        value={formData[field]}
        onChange={handleInputChange(field)}
        aria-invalid={fieldErrors[field] ? 'true' : 'false'}
        {...props}
      />
      {fieldErrors[field] ? (
        <p className="text-xs text-destructive" role="alert">
          {fieldErrors[field]}
        </p>
      ) : null}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => (!nextOpen ? onClose() : undefined)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
          <DialogDescription>
            Manage remote agents that run workspaces on other machines.
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-3">
            {renderField('name', 'Name', {
              placeholder: 'Prod build server',
            })}
            {renderField('grpcUrl', 'gRPC URL', {
              placeholder: 'grpcs://server.example.com:50051',
              spellCheck: false,
            })}
            {renderField('wsUrl', 'WebSocket URL', {
              placeholder: 'wss://server.example.com:443/ws',
              spellCheck: false,
            })}
            {renderField('token', 'Token', {
              type: 'password',
              placeholder: 'Secret token',
              autoComplete: 'off',
            })}
          </div>

          {formError ? (
            <Alert variant="destructive">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          ) : null}

          {testResult ? (
            <Alert variant={testResult.status === 'error' ? 'destructive' : 'default'}>
              {testResult.status === 'success' ? (
                <Check className="h-4 w-4" />
              ) : (
                <X className="h-4 w-4" />
              )}
              <AlertDescription>{testResult.message}</AlertDescription>
            </Alert>
          ) : null}

          <DialogFooter className="!flex-col gap-3 sm:!flex-row sm:items-center sm:justify-between">
            <Button
              type="button"
              variant="outline"
              onClick={handleTestConnection}
              disabled={testing || submitting}
            >
              {testing ? (
                <Spinner size="sm" className="mr-2" />
              ) : (
                <TestTube className="mr-2 h-4 w-4" />
              )}
              Test connection
            </Button>
            <div className="flex w-full items-center justify-end gap-2 sm:w-auto">
              <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? <Spinner size="sm" className="mr-2" /> : null}
                {mode === 'add' ? 'Add server' : 'Save changes'}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default RemoteServerDialog;
