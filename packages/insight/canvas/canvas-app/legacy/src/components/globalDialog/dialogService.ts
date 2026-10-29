import type { OpenDialogComponent, OpenDialogRequest } from './types';

type OpenDialogDispatcher = <TProps extends object, TResult, TReject>(request: OpenDialogRequest<TProps, TResult, TReject>) => void;

let dispatcher: OpenDialogDispatcher | null = null;

export class DialogCancelError extends Error {
  constructor(message = 'Dialog cancelled') {
    super(message);
    this.name = 'DialogCancelError';
  }
}

export const bindOpenDialog = (nextDispatcher: OpenDialogDispatcher) => {
  dispatcher = nextDispatcher;

  return () => {
    if (dispatcher === nextDispatcher) {
      dispatcher = null;
    }
  };
};

export function openDialog<TProps extends object, TResult = void, TReject = unknown>(Component: OpenDialogComponent<TProps, TResult, TReject>, props?: TProps): Promise<TResult> {
  const currentDispatcher = dispatcher;
  if (!currentDispatcher) {
    return Promise.reject(new Error('GlobalDialogProvider is not mounted'));
  }

  return new Promise<TResult>((resolve, reject) => {
    currentDispatcher({
      Component,
      props: props ?? ({} as TProps),
      resolve,
      reject,
    });
  });
}
