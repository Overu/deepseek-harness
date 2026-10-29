/**
 * 历史记录状态管理 - 简化版
 *
 * 🔄 架构调整说明:
 * - HistoryPlugin 现在自行管理历史栈（参考Vue Fabric Editor）
 * - Store仅用于UI状态同步，不再存储历史数据
 * - 通过Plugin的subscribe机制实现响应式更新
 */

import { create } from 'zustand';

interface HistoryState {
  // UI状态
  canUndo: boolean;
  canRedo: boolean;
  undoCount: number;
  redoCount: number;

  // Actions
  updateState: (state: Partial<HistoryState>) => void;
}

export const useHistoryStore = create<HistoryState>(set => ({
  canUndo: false,
  canRedo: false,
  undoCount: 0,
  redoCount: 0,

  updateState: state => set(state),
}));
