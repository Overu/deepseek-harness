import toolUtil from '../../../utils/toolUtil';
import { DEFAULT_CELL_SIZE, type StoryboardAspectRatio, type TableProtocol } from './types';

const SHORT_SIDE = DEFAULT_CELL_SIZE;

export interface DisplaySize {
  width: number;
  height: number;
}

export interface AdjustFirstRowSizesResult {
  table: TableProtocol;
  /** 首行是否存在有效图片单元格（用于决定是否提交列宽/行高变更） */
  hasFirstRowImage: boolean;
}

/** 按短边 200px、长边等比换算展示尺寸 */
export const computeDisplaySizeFromNatural = (naturalWidth: number, naturalHeight: number): DisplaySize => {
  if (naturalWidth <= 0 || naturalHeight <= 0) {
    return { width: SHORT_SIDE, height: SHORT_SIDE };
  }
  if (naturalWidth >= naturalHeight) {
    return {
      width: Math.round((naturalWidth / naturalHeight) * SHORT_SIDE),
      height: SHORT_SIDE,
    };
  }
  return {
    width: SHORT_SIDE,
    height: Math.round((naturalHeight / naturalWidth) * SHORT_SIDE),
  };
};

/** 按预设比例换算统一单元格尺寸（短边 200px） */
export const computeCellSizeFromAspectRatio = (ratio: Exclude<StoryboardAspectRatio, 'custom'>): DisplaySize => {
  const parsed = toolUtil.parseAspectRatio(ratio);
  if (!parsed) return { width: SHORT_SIDE, height: SHORT_SIDE };
  return computeDisplaySizeFromNatural(parsed.w, parsed.h);
};

/** 将表格所有列宽/行高统一为指定尺寸 */
export const applyUniformCellSize = (table: TableProtocol, size: DisplaySize): TableProtocol => {
  const next = JSON.parse(JSON.stringify(table)) as TableProtocol;
  next.columns = next.columns.map(col => ({ ...col, width: size.width }));
  next.rowsHeight = next.data.map(() => size.height);
  return next;
};

const loadImageNaturalSize = (url: string): Promise<{ width: number; height: number }> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = reject;
    img.src = url;
  });

/**
 * 遍历首行图片单元格，按图片比例调整对应列宽与首行行高。
 * 若首行存在图片则 `hasFirstRowImage` 为 true。
 */
export const adjustFirstRowSizesForImages = async (table: TableProtocol): Promise<AdjustFirstRowSizesResult> => {
  const next = JSON.parse(JSON.stringify(table)) as TableProtocol;
  const firstRow = next.data[0];
  if (!firstRow || !Array.isArray(next.columns) || next.columns.length === 0) {
    return { table: next, hasFirstRowImage: false };
  }

  const imageCells = next.columns.map((col, colIndex) => ({ col, colIndex, cell: firstRow[col.field] })).filter(({ cell }) => cell?.type === 'image' && !!cell.value);

  const hasFirstRowImage = imageCells.length > 0;
  if (!hasFirstRowImage) {
    return { table: next, hasFirstRowImage: false };
  }

  if (!Array.isArray(next.rowsHeight)) next.rowsHeight = [];
  while (next.rowsHeight.length < next.data.length) {
    next.rowsHeight.push(DEFAULT_CELL_SIZE);
  }

  const sizeResults = await Promise.all(
    imageCells.map(async ({ colIndex, cell }) => {
      try {
        const natural = await loadImageNaturalSize(cell!.value);
        const display = computeDisplaySizeFromNatural(natural.width, natural.height);
        return { colIndex, ...display };
      } catch {
        return null;
      }
    })
  );

  const adjusted = sizeResults.filter((item): item is { colIndex: number; width: number; height: number } => item != null);
  if (adjusted.length > 0) {
    adjusted.forEach(({ colIndex, width }) => {
      next.columns[colIndex].width = width;
    });
    next.rowsHeight[0] = Math.max(...adjusted.map(item => item.height), next.rowsHeight[0] ?? DEFAULT_CELL_SIZE);
  }

  return { table: next, hasFirstRowImage: true };
};
