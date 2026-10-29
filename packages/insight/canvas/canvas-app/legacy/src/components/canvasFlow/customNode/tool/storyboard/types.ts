import type { TaskInfo } from '../../../utils/type';

export type CellType = 'empty' | 'text' | 'image' | 'video' | 'audio';

export interface CellData {
  type: CellType;
  value: string;
}

export interface ColumnConfig {
  field: string;
  title: string;
  width: number;
}

export interface TableProtocol {
  columns: ColumnConfig[];
  rowsHeight: number[];
  data: Array<Record<string, CellData>>;
}

// 后端约定：custom=自定义，gen_script=剧本生成，video_understand=视频反推
export type StoryboardMode = 'custom' | 'gen_script' | 'video_understand';

/** 分镜批量生成参数（嵌套于 data.params.storyboardParams，与图片节点 params 同构） */
export type StoryboardGenerateParams = Record<string, any>;

/** 分镜批量生成任务态（与 taskInfo 同级同结构） */
export type StoryboardInfo = TaskInfo;

/** 允许自定义 gen_count 的模型；其余模型 gen_count 固定为 1 */
export const STORYBOARD_MULTI_GEN_COUNT_MODELS = ['mj-v7', 'niji-v7'] as const;

export const STORYBOARD_BATCH_GENERATE_TYPE = 'STORYBOARD_BATCH_GENERATE';

export const isStoryboardMultiGenCountModel = (model: string) => (STORYBOARD_MULTI_GEN_COUNT_MODELS as readonly string[]).includes(model);

/** 按模型规范 gen_count：非 mj/niji 系列强制为 1 */
export const normalizeStoryboardGenCount = (params: StoryboardGenerateParams): StoryboardGenerateParams => {
  const model = String(params?.model || '');
  if (isStoryboardMultiGenCountModel(model)) return params;
  return { ...params, gen_count: 1 };
};

/** 分镜表格单元格显示比例（持久化于 params.aspectRatio） */
export const STORYBOARD_ASPECT_RATIOS = ['custom', '9:16', '16:9', '1:1', '3:4', '4:3', '21:9'] as const;
export type StoryboardAspectRatio = (typeof STORYBOARD_ASPECT_RATIOS)[number];
export const STORYBOARD_DEFAULT_ASPECT_RATIO: StoryboardAspectRatio = 'custom';

export const getStoryboardAspectRatioLabel = (ratio: string) => (ratio === 'custom' ? '自定义' : ratio);

export interface CellLocation {
  rowIndex: number;
  field: string;
}

/** 列宽固定 */
export const SERIAL_COL_WIDTH = 80;
/** 表头行高固定 */
export const HEADER_ROW_HEIGHT = 40;
/** 默认行高/列宽 */
export const DEFAULT_CELL_SIZE = 200;
/** 表格最大宽度 */
export const TABLE_MAX_WIDTH = 2000;
/** 表格最大高度 */
export const TABLE_MAX_HEIGHT = 1200;
/** 表格最大行数 */
export const MAX_TABLE_ROWS = 99;
/** 表格最大列数 */
export const MAX_TABLE_COLS = 99;
/** 拖拽数据 mime */
export const STORYBOARD_DRAG_MIME = 'application/x-storyboard-cell';
