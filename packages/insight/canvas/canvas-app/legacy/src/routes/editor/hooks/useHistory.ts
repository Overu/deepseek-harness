/**
 * 历史记录 Hook
 *
 * 🔌 连接 HistoryPlugin 和 React UI
 *
 * 实现方式:
 * 1. 通过 Plugin.subscribe() 订阅状态变化
 * 2. 自动同步到 historyStore (用于UI展示)
 * 3. 提供 undo/redo 便捷方法
 */

import { useEffect } from 'react';
import { useEditorEngine } from './useEditorEngine';
import { useHistoryStore } from '../store/historyStore';
import type { HistoryPlugin } from '../core/plugins/HistoryPlugin';

export function useHistory() {
  const engine = useEditorEngine();
  const { canUndo, canRedo, undoCount, redoCount } = useHistoryStore();

  // 订阅 HistoryPlugin 的状态更新
  useEffect(() => {
    if (!engine) return;

    const historyPlugin = engine.pluginManager.get('HistoryPlugin') as HistoryPlugin;
    if (!historyPlugin) {
      console.warn('HistoryPlugin 未找到');
      return;
    }

    // 订阅状态变化
    const unsubscribe = historyPlugin.subscribe(state => {
      useHistoryStore.getState().updateState(state);
    });

    return unsubscribe;
  }, [engine]);

  const undo = () => {
    if (!engine || !canUndo) return;
    engine.undo();
  };

  const redo = () => {
    if (!engine || !canRedo) return;
    engine.redo();
  };

  return {
    canUndo,
    canRedo,
    undoCount,
    redoCount,
    undo,
    redo,
  };
}
