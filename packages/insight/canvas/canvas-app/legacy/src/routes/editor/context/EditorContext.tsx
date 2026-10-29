import React, { createContext, type ReactNode } from 'react';
import type { EditorEngine } from '../core/EditorEngine';

export const EditorContext = createContext<EditorEngine | null>(null);

interface EditorProviderProps {
  children: ReactNode;
  engine: EditorEngine;
}

export function EditorProvider({ children, engine }: EditorProviderProps) {
  return <EditorContext.Provider value={engine}>{children}</EditorContext.Provider>;
}
