import type { Edge, Node } from '@xyflow/react';
import type { CellData, StoryboardGenerateParams, StoryboardMode, TableProtocol } from './types';
import { normalizeStoryboardGenCount, STORYBOARD_BATCH_GENERATE_TYPE } from './types';

export const rowHasImage = (row: Record<string, CellData> | undefined): boolean => {
  if (!row) return false;
  return Object.values(row).some(cell => cell?.type === 'image' && Boolean(cell.value));
};

/** 行内存在 type=text 且 trim 后非空的单元格则视为有提示词 */
export const rowHasText = (row: Record<string, CellData> | undefined): boolean => {
  if (!row) return false;
  return Object.values(row).some(cell => cell?.type === 'text' && Boolean(String(cell.value ?? '').trim()));
};

export const extractRowImages = (row: Record<string, CellData> | undefined): string[] => {
  if (!row) return [];
  return Object.values(row)
    .filter(cell => cell?.type === 'image' && Boolean(cell.value))
    .map(cell => String(cell.value));
};

export const selectedRowsHaveImage = (table: TableProtocol, selectedRowIndexes: number[]): boolean => {
  return selectedRowIndexes.some(index => rowHasImage(table.data[index]));
};

/** 勾选行中缺少提示词的 1-based 行号（按行号升序） */
export const findSelectedRowsMissingText = (table: TableProtocol, selectedRowIndexes: number[]): number[] => {
  return [...selectedRowIndexes]
    .filter(index => !rowHasText(table.data[index]))
    .sort((a, b) => a - b)
    .map(index => index + 1);
};

export const resolveBatchModelType = (hasImage: boolean): 'reference_image_to_image' | 'text_to_image' => (hasImage ? 'reference_image_to_image' : 'text_to_image');

/** 从表格协议抽取勾选行，字段保持 columns.field 顺序 */
export const extractSelectedRowData = (table: TableProtocol, selectedRowIndexes: number[]): Array<Record<string, CellData>> => {
  const fields = table.columns.map(c => c.field);
  return selectedRowIndexes.map(rowIndex => {
    const row = table.data[rowIndex] || {};
    const next: Record<string, CellData> = {};
    fields.forEach(field => {
      next[field] = row[field] ? { ...row[field] } : { type: 'empty', value: '' };
    });
    return next;
  });
};

export const buildStoryboardBatchPayload = (args: {
  canvasId: string;
  nodeId: string;
  storyboardParams: StoryboardGenerateParams;
  /** 当前分镜脚本模式，与 params 同级传给后端 */
  tableSource: StoryboardMode;
  table: TableProtocol;
  selectedRowIndexes: number[];
  childNodeIds: string[];
}) => {
  const rowData = extractSelectedRowData(args.table, args.selectedRowIndexes);
  const hasImage = rowData.some(rowHasImage);
  const modelType = resolveBatchModelType(hasImage);
  const params = normalizeStoryboardGenCount({
    ...args.storyboardParams,
    modelType,
  });

  return {
    type: STORYBOARD_BATCH_GENERATE_TYPE,
    canvasId: String(args.canvasId || ''),
    nodeId: String(args.nodeId || ''),
    data: {
      params,
      tableSource: args.tableSource,
      data: rowData,
      childNodeIds: args.childNodeIds,
    },
  };
};

export interface StoryboardBatchChildNodeInfo {
  prompt?: string;
  value?: string[];
  /** 有值时表示该子节点失败，与 prompt 同级 */
  nodeMsg?: string;
}

/** nodeMsg 存在且 trim 后非空则视为该子节点失败 */
export const isStoryboardBatchChildNodeFailed = (info: StoryboardBatchChildNodeInfo | null | undefined): boolean => {
  return Boolean(String(info?.nodeMsg ?? '').trim());
};

/**
 * 根据 childNodeInfo 单条结果生成生成子节点 data 回写（保留非 tool）。
 * 失败：仅写 prompt + taskInfo.failure；成功：写 value/product/prompt/success。
 */
export const buildStoryboardBatchChildNodeData = (prevData: Record<string, unknown>, info: StoryboardBatchChildNodeInfo): Record<string, unknown> => {
  const prompt = String(info?.prompt ?? '');
  const nextData = { ...prevData };
  delete nextData.type; // 生成节点保持非 tool，避免回写时被标成工具产物

  if (isStoryboardBatchChildNodeFailed(info)) {
    return {
      ...nextData,
      params: {
        ...((prevData as any)?.params || {}),
        prompt,
      },
      taskInfo: {
        ...((prevData as any)?.taskInfo || {}),
        status: 'failure',
        errorMsg: String(info.nodeMsg ?? '').trim(),
      },
    };
  }

  const urls = Array.isArray(info?.value) ? info.value.filter(Boolean).map(String) : [];
  const firstUrl = urls[0] || '';
  return {
    ...nextData,
    value: firstUrl,
    product: urls.map(v => ({ value: v })),
    tempFile: null,
    params: {
      ...((prevData as any)?.params || {}),
      prompt,
    },
    taskInfo: {
      ...((prevData as any)?.taskInfo || {}),
      status: 'success',
      errorMsg: '',
    },
  };
};

/** 解析分镜批量轮询结果：childNodeInfo 为 { prompt, value[], nodeMsg? } */
export const parseStoryboardBatchChildNodeInfo = (resData: any): Record<string, StoryboardBatchChildNodeInfo> | null => {
  if (!resData) return null;
  let resultInfo = resData?.result;
  if (typeof resultInfo === 'string') {
    try {
      resultInfo = JSON.parse(resultInfo);
    } catch {
      /* ignore */
    }
  }
  const childNodeInfo = resData?.childNodeInfo || resultInfo?.childNodeInfo;
  if (!childNodeInfo || typeof childNodeInfo !== 'object') return null;
  return childNodeInfo as Record<string, StoryboardBatchChildNodeInfo>;
};

/**
 * 短边策略（mediaDimensions 短边=400）下，长边最大约 400*(21/9)。
 * 布局外接盒按该上限预留，避免参考图/生成节点在 16:9、9:16、21:9 下堆叠。
 */
export const STORYBOARD_IMAGE_SHORT_SIDE = 400;
export const STORYBOARD_IMAGE_LAYOUT_SIZE = Math.ceil(STORYBOARD_IMAGE_SHORT_SIDE * (21 / 9));
export const STORYBOARD_UPLOAD_SPACING_Y = STORYBOARD_IMAGE_LAYOUT_SIZE + 20;
export const STORYBOARD_GEN_OFFSET_X = STORYBOARD_IMAGE_LAYOUT_SIZE + 120;
const ROW_CLUSTER_GAP_Y = 40;
/** 分镜节点右侧到首批子节点的水平间距 */
const TOOL_TO_CHILD_GAP_X = 160;

/** 解析分镜工具节点实际宽度（优先 measured，避免写死宽度导致与宽表重叠） */
export const resolveStoryboardToolNodeWidth = (toolNode: Node, fallbackWidth = STORYBOARD_IMAGE_SHORT_SIDE): number => {
  const measured = toolNode.measured?.width;
  if (typeof measured === 'number' && measured > 0) return measured;
  if (typeof toolNode.width === 'number' && toolNode.width > 0) return toolNode.width;
  return fallbackWidth;
};

export interface StoryboardUploadCreateMeta {
  /** 1-based 表格绝对行号（分镜序号） */
  shotNumber: number;
  /** 1-based 行内参考图序号 */
  refIndex: number;
}

export interface LayoutStoryboardBatchArgs {
  toolNode: Node;
  toolNodeWidth?: number;
  selectedRows: Array<Record<string, CellData>>;
  /**
   * 与 selectedRows 等长的 1-based 分镜序号（表格绝对行号）。
   * 缺省时回退为 rowIdx+1（仅适合连续从首行勾选的场景）。
   */
  shotNumbers?: number[];
  /** 与 selectedRows 等长的生成节点（已 create，待定位） */
  genNodes: Node[];
  createUploadNode: (url: string, position: { x: number; y: number }, meta: StoryboardUploadCreateMeta) => Node;
  createToolToChildEdge: (childId: string) => Edge;
  createUploadToGenEdge: (uploadId: string, genId: string) => Edge;
}

export interface LayoutStoryboardBatchResult {
  allNodes: Node[];
  allEdges: Edge[];
  genNodeIds: string[];
}

/** 按行布局：有图则上传节点纵向排列后连到生成节点；无图则工具直连生成节点 */
export const layoutStoryboardBatchNodes = (args: LayoutStoryboardBatchArgs): LayoutStoryboardBatchResult => {
  const { toolNode, selectedRows, genNodes, createUploadNode, createToolToChildEdge, createUploadToGenEdge } = args;
  const toolWidth = args.toolNodeWidth && args.toolNodeWidth > 0 ? args.toolNodeWidth : resolveStoryboardToolNodeWidth(toolNode);
  const baseX = toolNode.position.x + toolWidth + TOOL_TO_CHILD_GAP_X;
  let cursorY = toolNode.position.y;
  const layoutSize = STORYBOARD_IMAGE_LAYOUT_SIZE;
  const uploadSpacingY = STORYBOARD_UPLOAD_SPACING_Y;
  const genOffsetX = STORYBOARD_GEN_OFFSET_X;

  const allNodes: Node[] = [];
  const allEdges: Edge[] = [];
  const genNodeIds: string[] = [];

  selectedRows.forEach((row, rowIdx) => {
    const genNode = genNodes[rowIdx];
    if (!genNode) return;
    const shotNumber = args.shotNumbers?.[rowIdx] ?? rowIdx + 1;
    const imageUrls = extractRowImages(row);

    if (imageUrls.length === 0) {
      genNode.position = { x: baseX, y: cursorY };
      allNodes.push(genNode);
      allEdges.push(createToolToChildEdge(genNode.id));
      genNodeIds.push(genNode.id);
      cursorY += layoutSize + ROW_CLUSTER_GAP_Y;
      return;
    }

    const uploadNodes = imageUrls.map((url, i) => createUploadNode(url, { x: baseX, y: cursorY + i * uploadSpacingY }, { shotNumber, refIndex: i + 1 }));
    const clusterHeight = Math.max(imageUrls.length * uploadSpacingY - (uploadSpacingY - layoutSize), layoutSize);
    const genY = cursorY + (clusterHeight - layoutSize) / 2;
    genNode.position = { x: baseX + genOffsetX, y: genY };

    uploadNodes.forEach(uploadNode => {
      allNodes.push(uploadNode);
      allEdges.push(createToolToChildEdge(uploadNode.id));
      allEdges.push(createUploadToGenEdge(uploadNode.id, genNode.id));
    });
    allNodes.push(genNode);
    genNodeIds.push(genNode.id);

    cursorY += clusterHeight + ROW_CLUSTER_GAP_Y;
  });

  return { allNodes, allEdges, genNodeIds };
};
