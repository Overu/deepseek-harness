export interface EditorConfig {
  workspaceWidth: number;
  workspaceHeight: number;
}

export interface EditorProps {
  value?: string;
  imageList?: string[];
  canvasId?: string | number;
  nodeId?: string | number;
  onClose?: () => void;
  onSuccess?: (value: string) => void;
}

export interface LayerMeta {
  id: string;
  name: string;
  type: string;
  visible: boolean;
  locked: boolean;
  parentId?: string;
  children?: string[];
}

export interface EditorState {
  version: string;
  timestamp: number;
  layers: LayerMeta[];
  canvasData: any;
}

export interface IPlugin {
  name: string;
  dependencies?: string[]; // 插件依赖声明
  init(context?: any): void; // 支持传入 PluginContext (避免循环依赖用any)
  destroy(): void;
}

export interface FabricObjectExtension {
  id: string;
  name?: string;
  locked?: boolean;
  extensionType?: string;
  extension?: any;
  shapeKind?: ShapeKind;
  fillColor?: string;
  fillOpacity?: number;
  strokeColor?: string;
  strokeOpacity?: number;
}

export type ShapeKind = 'circle' | 'triangle' | 'square' | 'rectangle' | 'star' | 'hexagon';

// 对齐类型
export type AlignmentType = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';

// 文本样式属性
export interface TextStyleProps {
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: string | number;
  fontStyle?: 'normal' | 'italic';
  underline?: boolean;
  linethrough?: boolean;
  textAlign?: 'left' | 'center' | 'right' | 'justify';
  lineHeight?: number;
  charSpacing?: number;
  fill?: string;
}

// 形状样式属性
export interface ShapeStyleProps {
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  fillColor?: string;
  fillOpacity?: number;
  strokeColor?: string;
  strokeOpacity?: number;
}

export interface ExportOptions {
  format: 'png' | 'jpeg';
  quality: number;
  multiplier: number;
}

// Extend Fabric object types
declare module 'fabric' {
  interface Object extends FabricObjectExtension {}
  interface SerializedObjectProps extends FabricObjectExtension {}
}
