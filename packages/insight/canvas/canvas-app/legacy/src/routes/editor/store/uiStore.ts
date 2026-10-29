/**
 * UI 状态管理 - P1优化
 * 低频更新: 缩放、面板状态、主题等
 */
import { create } from 'zustand';

interface UIState {
  // 状态
  zoom: number;
  panelCollapsed: {
    layer: boolean;
    props: boolean;
    material: boolean;
  };
  theme: 'light' | 'dark';
  gridVisible: boolean;
  rulersVisible: boolean;

  // Actions
  setZoom: (zoom: number) => void;
  togglePanel: (panel: 'layer' | 'props' | 'material') => void;
  setTheme: (theme: 'light' | 'dark') => void;
  toggleGrid: () => void;
  toggleRulers: () => void;
}

export const useUIStore = create<UIState>(set => ({
  zoom: 1,
  panelCollapsed: {
    layer: false,
    props: false,
    material: false,
  },
  theme: 'light',
  gridVisible: false,
  rulersVisible: false,

  setZoom: zoom => set({ zoom }),

  togglePanel: panel =>
    set(state => ({
      panelCollapsed: {
        ...state.panelCollapsed,
        [panel]: !state.panelCollapsed[panel],
      },
    })),

  setTheme: theme => set({ theme }),

  toggleGrid: () => set(state => ({ gridVisible: !state.gridVisible })),

  toggleRulers: () => set(state => ({ rulersVisible: !state.rulersVisible })),
}));
