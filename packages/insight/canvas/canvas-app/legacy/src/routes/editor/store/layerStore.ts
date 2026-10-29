/**
 * 图层状态管理 - P1优化
 * 高频更新: 图层列表、选中状态
 */
import { create } from 'zustand';
import type { LayerMeta } from '../core/types';

interface LayerState {
  // 状态
  layers: LayerMeta[];
  activeIds: string[];

  // Actions
  setLayers: (layers: LayerMeta[]) => void;
  setActiveIds: (ids: string[]) => void;

  // 辅助方法
  getLayerById: (id: string) => LayerMeta | undefined;
  updateLayer: (id: string, updates: Partial<LayerMeta>) => void;
  removeLayer: (id: string) => void;
}

export const useLayerStore = create<LayerState>((set, get) => ({
  layers: [],
  activeIds: [],

  setLayers: layers => set({ layers }),

  setActiveIds: activeIds => set({ activeIds }),

  getLayerById: id => {
    return get().layers.find(layer => layer.id === id);
  },

  updateLayer: (id, updates) => {
    set(state => ({
      layers: state.layers.map(layer => (layer.id === id ? { ...layer, ...updates } : layer)),
    }));
  },

  removeLayer: id => {
    set(state => ({
      layers: state.layers.filter(layer => layer.id !== id),
      activeIds: state.activeIds.filter(activeId => activeId !== id),
    }));
  },
}));
