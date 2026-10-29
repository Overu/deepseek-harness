import { type ColumnConfig, type TableProtocol, SERIAL_COL_WIDTH, HEADER_ROW_HEIGHT } from './types';

export const REORDER_ACTIVATION_PX = 5;
export type ReorderMode = 'col' | 'row';

export function getPointerCoords(scrollEl: HTMLElement | null, clientX: number, clientY: number) {
  if (!scrollEl) return { localX: 0, localY: 0, scrollLeft: 0, scrollTop: 0 };
  const rect = scrollEl.getBoundingClientRect();
  const { scrollLeft, scrollTop } = scrollEl;
  return {
    localX: clientX - rect.left + scrollLeft,
    localY: clientY - rect.top + scrollTop,
    scrollLeft,
    scrollTop,
  };
}

const sumSizes = (sizes: number[], count: number, origin: number) => {
  let pos = origin;
  for (let i = 0; i < count; i++) pos += sizes[i];
  return pos;
};

export const getColumnLeft = (columns: ColumnConfig[], index: number) =>
  sumSizes(
    columns.map(c => c.width),
    index,
    SERIAL_COL_WIDTH
  );

export const getRowTop = (rowsHeight: number[], index: number) => sumSizes(rowsHeight, index, HEADER_ROW_HEIGHT);

const columnWidths = (columns: ColumnConfig[]) => columns.map(c => c.width);

const resolveInsertIndex = (local: number, sizes: number[], origin: number) => {
  let pos = origin;
  for (let i = 0; i < sizes.length; i++) {
    if (local < pos + sizes[i] / 2) return i;
    pos += sizes[i];
  }
  return sizes.length;
};

export const resolveColumnInsertIndex = (localX: number, columns: ColumnConfig[]) => resolveInsertIndex(localX, columnWidths(columns), SERIAL_COL_WIDTH);

export const resolveRowInsertIndex = (localY: number, rowsHeight: number[]) => resolveInsertIndex(localY, rowsHeight, HEADER_ROW_HEIGHT);

export const insertTargetIndex = (from: number, insertBefore: number) => (insertBefore <= from ? insertBefore : insertBefore - 1);

export const getInsertLineX = (columns: ColumnConfig[], insertBefore: number) => {
  if (insertBefore <= 0) return getColumnLeft(columns, 0);
  if (insertBefore >= columns.length) return getColumnLeft(columns, columns.length - 1) + columns[columns.length - 1].width;
  return getColumnLeft(columns, insertBefore);
};

export const getInsertLineY = (rowsHeight: number[], insertBefore: number) => {
  if (insertBefore <= 0) return getRowTop(rowsHeight, 0);
  if (insertBefore >= rowsHeight.length) return getRowTop(rowsHeight, rowsHeight.length - 1) + rowsHeight[rowsHeight.length - 1];
  return getRowTop(rowsHeight, insertBefore);
};

export const getGrabOffset = (mode: ReorderMode, sourceIndex: number, localX: number, localY: number, columns: ColumnConfig[], rowsHeight: number[]) =>
  mode === 'col' ? { grabOffsetX: localX - getColumnLeft(columns, sourceIndex), grabOffsetY: 0 } : { grabOffsetX: 0, grabOffsetY: localY - getRowTop(rowsHeight, sourceIndex) };

export function arrayMove<T>(arr: T[], from: number, to: number): T[] {
  if (from === to) return [...arr];
  const next = [...arr];
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
}

const cloneTable = (table: TableProtocol) => JSON.parse(JSON.stringify(table)) as TableProtocol;

export function reorderColumns(table: TableProtocol, from: number, to: number): TableProtocol {
  if (from === to) return table;
  const next = cloneTable(table);
  next.columns = arrayMove(next.columns, from, to);
  return next;
}

export function reorderRows(table: TableProtocol, from: number, to: number): TableProtocol {
  if (from === to) return table;
  const next = cloneTable(table);
  next.data = arrayMove(next.data, from, to);
  next.rowsHeight = arrayMove(next.rowsHeight, from, to);
  return next;
}
