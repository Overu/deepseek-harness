import { useCallback, useEffect, useRef, useState } from 'react';
import { bindOpenDialog } from './dialogService';
import type { OpenDialogInjectedProps, OpenDialogRequest } from './types';

type ActiveDialog = {
  id: number;
  request: OpenDialogRequest<object, unknown, unknown>;
  settled: boolean;
};

export function GlobalDialogProvider() {
  const [dialogs, setDialogs] = useState<ActiveDialog[]>([]);
  const dialogsRef = useRef<ActiveDialog[]>([]);
  const dialogIdRef = useRef(0);

  useEffect(() => {
    dialogsRef.current = dialogs;
  }, [dialogs]);

  const removeDialog = useCallback((dialogId: number) => {
    dialogsRef.current = dialogsRef.current.filter(dialog => dialog.id !== dialogId);
    setDialogs(prev => prev.filter(dialog => dialog.id !== dialogId));
  }, []);

  const settleDialog = useCallback(
    (dialogId: number, settle: 'resolve' | 'reject', value?: unknown) => {
      const currentDialog = dialogsRef.current.find(dialog => dialog.id === dialogId);
      if (!currentDialog || currentDialog.settled) return;

      if (settle === 'resolve') {
        currentDialog.request.resolve(value);
      } else {
        currentDialog.request.reject(value);
      }

      dialogsRef.current = dialogsRef.current.map(dialog => (dialog.id === dialogId ? { ...dialog, settled: true } : dialog));
      setDialogs(prev => prev.map(dialog => (dialog.id === dialogId ? { ...dialog, settled: true } : dialog)));
      window.setTimeout(() => removeDialog(dialogId), 200);
    },
    [removeDialog]
  );

  useEffect(() => {
    return bindOpenDialog(request => {
      const nextDialog: ActiveDialog = {
        id: dialogIdRef.current + 1,
        request: request as unknown as OpenDialogRequest<object, unknown, unknown>,
        settled: false,
      };

      dialogIdRef.current = nextDialog.id;
      dialogsRef.current = [...dialogsRef.current, nextDialog];
      setDialogs(prev => [...prev, nextDialog]);
    });
  }, []);

  return (
    <>
      {dialogs.map(dialog => {
        const { Component, props } = dialog.request;
        const injectedProps: OpenDialogInjectedProps<unknown, unknown> = {
          resolve: value => settleDialog(dialog.id, 'resolve', value),
          reject: reason => settleDialog(dialog.id, 'reject', reason),
        };

        return <Component key={dialog.id} {...props} {...injectedProps} />;
      })}
    </>
  );
}
