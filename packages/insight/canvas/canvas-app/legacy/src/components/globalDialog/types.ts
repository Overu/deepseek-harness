import type * as React from 'react';

export type OpenDialogInjectedProps<TResult = void, TReject = unknown> = {
  resolve: (value: TResult) => void;
  reject: (reason?: TReject) => void;
};

export type OpenDialogComponent<TProps extends object = object, TResult = void, TReject = unknown> = React.ComponentType<TProps & OpenDialogInjectedProps<TResult, TReject>>;

export type OpenDialogRequest<TProps extends object = object, TResult = void, TReject = unknown> = {
  Component: OpenDialogComponent<TProps, TResult, TReject>;
  props: TProps;
  resolve: (value: TResult) => void;
  reject: (reason?: unknown) => void;
};
