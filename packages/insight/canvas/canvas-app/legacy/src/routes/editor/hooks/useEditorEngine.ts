import { useContext } from 'react';
import { EditorContext } from '../context/EditorContext';
import type { EditorEngine } from '../core/EditorEngine';

export function useEditorEngine(): EditorEngine {
  const engine = useContext(EditorContext);
  if (!engine) {
    throw new Error('useEditorEngine must be used within EditorProvider');
  }
  return engine;
}
