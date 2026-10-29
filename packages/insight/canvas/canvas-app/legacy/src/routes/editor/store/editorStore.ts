import { create } from 'zustand';
import type { LayerMeta } from '../core/types';

export interface EditorParams {
  canvasId?: string;
  nodeId?: string;
  value?: string; // Initial image URL or data
  imageList?: string[]; // Side panel images
  onClose?: () => void;
  onSuccess?: (value: string) => void;
}

export type ToolType = 'select' | 'hand' | 'text' | 'draw';

interface BrushSettings {
  color: string;
  width: number;
  hardness: number;
}

interface EditorState {
  // Data Params
  params: EditorParams;
  setParams: (params: EditorParams) => void;

  // Track if canvas has unsaved changes
  isDirty: boolean;
  documentVersion: number;
  markDocumentChanged: () => void;
  markDocumentSaved: (savedVersion: number) => void;
  resetDocumentState: () => void;

  // Editor State
  layers: LayerMeta[];
  activeIds: string[];
  zoom: number;
  activeTool: ToolType;
  brushSettings: BrushSettings;
  setLayers: (layers: LayerMeta[]) => void;
  setActiveIds: (ids: string[]) => void;
  setZoom: (zoom: number) => void;
  setActiveTool: (tool: ToolType) => void;
  setBrushSettings: (settings: Partial<BrushSettings>) => void;
}

export const useEditorStore = create<EditorState>(set => ({
  params: {},
  isDirty: false,
  documentVersion: 0,
  layers: [],
  activeIds: [],
  zoom: 1,
  activeTool: 'select',
  brushSettings: {
    color: '#000000',
    width: 5,
    hardness: 100,
  },
  setParams: params => set({ params }),
  markDocumentChanged: () =>
    set(state => ({
      documentVersion: state.documentVersion + 1,
      isDirty: true,
    })),
  markDocumentSaved: savedVersion =>
    set(state => ({
      isDirty: state.documentVersion !== savedVersion,
    })),
  resetDocumentState: () =>
    set({
      documentVersion: 0,
      isDirty: false,
    }),
  setLayers: layers => set({ layers }),
  setActiveIds: activeIds => set({ activeIds }),
  setZoom: zoom => set({ zoom }),
  setActiveTool: activeTool => set({ activeTool }),
  setBrushSettings: settings =>
    set(state => ({
      brushSettings: { ...state.brushSettings, ...settings },
    })),
}));
