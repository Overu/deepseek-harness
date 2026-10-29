import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useFlowStore } from '@/store/flowStore';
import { Check, Minus, MoreHorizontal, MoreVertical } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import StoryboardCell from './StoryboardCell';
import { StoryboardReorderOverlay, useStoryboardRowColReorder } from './useStoryboardRowColReorder';
import {
  type CellData,
  type CellType,
  type ColumnConfig,
  type TableProtocol,
  type CellLocation,
  SERIAL_COL_WIDTH,
  HEADER_ROW_HEIGHT,
  DEFAULT_CELL_SIZE,
  TABLE_MAX_WIDTH,
  TABLE_MAX_HEIGHT,
  MAX_TABLE_ROWS,
  MAX_TABLE_COLS,
  STORYBOARD_DRAG_MIME,
} from './types';

// 与 tw.tableScroll 中 [&::-webkit-scrollbar]:w-2/h-2 保持一致
const SCROLLBAR_SIZE = 8;

interface StoryboardTableProps {
  /** 所属分镜节点 id，用于画布节点拖入时的单元格高亮 */
  nodeId: string;
  table: TableProtocol;
  editing: boolean;
  expanded: boolean;
  /** 分镜生成模式：左侧勾选栏，禁止一切表格内容变更 */
  selectionMode?: boolean;
  selectedRowIndexes?: number[];
  onToggleRow?: (rowIndex: number) => void;
  onToggleAllRows?: () => void;
  /** 新增行列时的默认列宽（比例预设下为统一尺寸） */
  defaultCellWidth?: number;
  /** 新增行列时的默认行高 */
  defaultCellHeight?: number;
  onChange: (next: TableProtocol) => void;
  /** 用户手动拖拽列宽/行高时回调（传入已更新的 table，由父组件原子写入 table + aspectRatio） */
  onCellSizeManualChange?: (next: TableProtocol) => void;
  onOpenUploadFor: (location: CellLocation, type: 'image' | 'video' | 'audio') => void;
  /** 单元格内容拖拽到画布外创建对应类型节点 */
  onDragCellOutToCanvas: (cell: CellData, screenPosition: { x: number; y: number }) => void;
}

const cloneTable = (table: TableProtocol): TableProtocol => JSON.parse(JSON.stringify(table));

const tw = {
  storyboardWrapper: 'relative z-0 bg-[#1a1a1a] border border-white/15 rounded-2xl overflow-hidden box-border',
  tableScroll:
    'overflow-auto nowheel [scrollbar-color:rgba(255,255,255,0.2)_transparent]' +
    ' [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar]:h-2' +
    ' [&::-webkit-scrollbar-thumb]:bg-white/20 [&::-webkit-scrollbar-thumb]:rounded' +
    ' [&::-webkit-scrollbar-track]:bg-transparent',
  tableGrid: 'grid relative bg-[#1a1a1a]',
  cell: 'relative bg-[#1a1a1a] box-border',
  headerCell: 'group relative sticky top-0 z-[1] bg-[#262626] text-white/85 text-[13px] flex items-center justify-center select-none border-r border-b border-white/25',
  serialCell: 'group relative sticky left-0 z-[1] bg-[#262626] text-white/85 text-[13px] flex items-center justify-center select-none border-r border-b border-white/25',
  /** 占位格：与角标同尺寸，保证网格布局；角标本身用 cornerCellFixed 叠在滚动区外 */
  cornerPlaceholder: 'bg-[#262626] border-r border-b border-white/25',
  cornerCellFixed: 'absolute top-0 left-0 z-[10] bg-[#262626] text-white/85 text-[13px] flex items-center justify-center select-none border-r border-b border-white/25',
  colHeaderActions: 'absolute top-1/2 right-1 -translate-y-1/2 flex z-[1]',
  serialCellActions: 'absolute left-1/2 top-1 -translate-x-1/2 flex z-[1]',
  headerActionBtn:
    'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto' +
    ' transition-opacity duration-150' +
    ' w-5 h-5 rounded-md bg-white/10 border border-white/15 shadow-sm' +
    ' flex items-center justify-center cursor-pointer text-white/70 hover:text-white hover:bg-white/15',
  colResizer: 'absolute right-[-3px] top-0 w-[6px] h-full cursor-col-resize z-[6]',
  rowResizer: 'absolute bottom-[-3px] left-0 h-[6px] w-full cursor-row-resize z-[6]',
  resizeIndicator: 'absolute bg-[#4155F0] pointer-events-none z-[999]',
  dropdownMenuItem:
    'cursor-pointer hover:bg-white/10 focus:bg-white/10' +
    ' data-[disabled]:pointer-events-auto data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[disabled]:hover:bg-transparent',
  dropdownMenuItemDanger: 'text-red-400 focus:text-red-400 hover:text-red-400',
};

const ensureRowSlots = (row: Record<string, CellData> | undefined, fields: string[]): Record<string, CellData> => {
  const next: Record<string, CellData> = {};
  fields.forEach(field => {
    next[field] = row && row[field] ? row[field] : { type: 'empty', value: '' };
  });
  return next;
};

const StoryboardTable = ({
  nodeId,
  table,
  editing,
  expanded,
  selectionMode = false,
  selectedRowIndexes = [],
  onToggleRow,
  onToggleAllRows,
  defaultCellWidth = DEFAULT_CELL_SIZE,
  defaultCellHeight = DEFAULT_CELL_SIZE,
  onChange,
  onCellSizeManualChange,
  onOpenUploadFor,
  onDragCellOutToCanvas,
}: StoryboardTableProps) => {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const dragSourceRef = useRef<CellLocation | null>(null);
  const [hoverCell, setHoverCell] = useState<CellLocation | null>(null);
  /** 单元格内容拖拽中，用于隐藏悬浮操作按钮 */
  const [isDraggingCell, setIsDraggingCell] = useState(false);
  const canvasDropPreview = useFlowStore(state => state.storyboardDropPreview);
  const [textFocusKey, setTextFocusKey] = useState<{ location: CellLocation; key: number } | null>(null);

  // 列宽/行高拖拽指示
  const [resizeIndicator, setResizeIndicator] = useState<{
    type: 'col' | 'row';
    /** 与画布相对位置 */
    position: number;
  } | null>(null);
  const resizeDataRef = useRef<{
    type: 'col' | 'row';
    index: number;
    startCoord: number;
    startSize: number;
    accumulated: number;
  } | null>(null);
  const [isResizing, setIsResizing] = useState(false);

  const columns = table.columns;
  const rowsHeight = table.rowsHeight;
  const data = table.data;

  /** 生成模式下禁止编辑态交互（勾选除外） */
  const interactiveEditing = editing && !selectionMode;
  const selectedRowSet = useMemo(() => new Set(selectedRowIndexes), [selectedRowIndexes]);
  const allRowsSelected = data.length > 0 && selectedRowIndexes.length === data.length;
  const someRowsSelected = selectedRowIndexes.length > 0 && !allRowsSelected;

  const { dragState, isReordering, onPointerDownCol, onPointerDownRow } = useStoryboardRowColReorder({
    editing: interactiveEditing,
    scrollRef,
    columns,
    rowsHeight,
    table,
    isResizing,
    onCommit: onChange,
  });

  const reorderHandleClass = (mode: 'col' | 'row', index: number) => {
    const active = dragState?.mode === mode && dragState.sourceIndex === index && dragState.activated;
    const cursor = interactiveEditing ? (isReordering ? 'cursor-grabbing' : 'cursor-grab') : '';
    const activeRing = active ? 'ring-2 ring-[#4155F0] z-[2]' : '';
    const activeBg = active ? 'bg-[#4155F0]/35' : '';
    return `${cursor} ${activeRing} ${activeBg}`;
  };
  const atMaxRows = data.length >= MAX_TABLE_ROWS;
  const atMaxCols = columns.length >= MAX_TABLE_COLS;

  const totalContentWidth = useMemo(() => SERIAL_COL_WIDTH + columns.reduce((sum, col) => sum + col.width, 0), [columns]);
  const totalContentHeight = useMemo(() => HEADER_ROW_HEIGHT + rowsHeight.reduce((sum, h) => sum + h, 0), [rowsHeight]);
  const visibleWidth = expanded ? totalContentWidth : Math.min(totalContentWidth, TABLE_MAX_WIDTH);
  const visibleHeight = expanded ? totalContentHeight : Math.min(totalContentHeight, TABLE_MAX_HEIGHT);
  const overflowX = totalContentWidth > visibleWidth;
  const overflowY = totalContentHeight > visibleHeight;

  /** 表格内所有非空单元格，供预览左右切换 */
  const tablePreview = useMemo(() => {
    const urls: string[] = [];
    const types: Array<'image' | 'video' | 'audio' | 'text'> = [];
    const indexByLocation = new Map<string, number>();
    data.forEach((row, rowIndex) => {
      columns.forEach(col => {
        const cell = row[col.field];
        if (!cell || cell.type === 'empty' || !cell.value.trim()) return;
        indexByLocation.set(`${rowIndex}:${col.field}`, urls.length);
        urls.push(cell.value);
        types.push(cell.type);
      });
    });
    return { urls, types, indexByLocation };
  }, [data, columns]);

  // 出现垂直/水平滚动条时，wrapper 需要预留滚动条宽度，避免遮挡最右侧/最底部单元格
  const containerStyle: React.CSSProperties = expanded
    ? { width: totalContentWidth, height: totalContentHeight, maxWidth: 'none', maxHeight: 'none' }
    : {
        width: visibleWidth + (overflowY ? SCROLLBAR_SIZE : 0),
        height: visibleHeight + (overflowX ? SCROLLBAR_SIZE : 0),
        maxWidth: TABLE_MAX_WIDTH + SCROLLBAR_SIZE,
        maxHeight: TABLE_MAX_HEIGHT + SCROLLBAR_SIZE,
      };

  /** 整体修改 table 协议 */
  const update = (mutator: (next: TableProtocol) => void) => {
    const next = cloneTable(table);
    mutator(next);
    onChange(next);
  };

  /** 更新某单元格 */
  const updateCell = (location: CellLocation, cell: CellData) => {
    update(next => {
      const row = ensureRowSlots(
        next.data[location.rowIndex],
        next.columns.map(c => c.field)
      );
      row[location.field] = cell;
      next.data[location.rowIndex] = row;
    });
  };

  /** 列名修改 */
  const updateColumnTitle = (colIndex: number, title: string) => {
    update(next => {
      next.columns[colIndex].title = title;
    });
  };

  // 行列增删
  const insertRow = (rowIndex: number, position: 'before' | 'after') => {
    if (table.data.length >= MAX_TABLE_ROWS) return;
    update(next => {
      const fields = next.columns.map(c => c.field);
      const newRow: Record<string, CellData> = {};
      fields.forEach(f => (newRow[f] = { type: 'empty', value: '' }));
      const insertAt = position === 'before' ? rowIndex : rowIndex + 1;
      next.data.splice(insertAt, 0, newRow);
      next.rowsHeight.splice(insertAt, 0, defaultCellHeight);
    });
  };

  const removeRow = (rowIndex: number) => {
    if (table.data.length <= 1) return;
    update(next => {
      next.data.splice(rowIndex, 1);
      next.rowsHeight.splice(rowIndex, 1);
    });
  };

  const insertColumn = (colIndex: number, position: 'before' | 'after') => {
    if (table.columns.length >= MAX_TABLE_COLS) return;
    update(next => {
      const insertAt = position === 'before' ? colIndex : colIndex + 1;
      const baseField = `c_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      const newCol: ColumnConfig = { field: baseField, title: '自定义', width: defaultCellWidth };
      next.columns.splice(insertAt, 0, newCol);
      next.data.forEach(row => {
        row[baseField] = { type: 'empty', value: '' };
      });
    });
  };

  const removeColumn = (colIndex: number) => {
    if (table.columns.length <= 1) return;
    update(next => {
      const field = next.columns[colIndex].field;
      next.columns.splice(colIndex, 1);
      next.data.forEach(row => {
        delete row[field];
      });
    });
  };

  // ============================
  // 列宽/行高拖拽
  // ============================
  useEffect(() => {
    if (!resizeDataRef.current) return;

    const handleMove = (event: MouseEvent) => {
      const ctx = resizeDataRef.current;
      if (!ctx) return;

      if (ctx.type === 'col') {
        const delta = event.clientX - ctx.startCoord;
        ctx.accumulated = Math.max(40, ctx.startSize + delta);
        const currentScrollLeft = scrollRef.current?.scrollLeft ?? 0;
        const indicatorX = getColumnBoundaryPosition(ctx.index) - currentScrollLeft + (ctx.accumulated - ctx.startSize);
        setResizeIndicator({ type: 'col', position: indicatorX });
      } else {
        const delta = event.clientY - ctx.startCoord;
        ctx.accumulated = Math.max(40, ctx.startSize + delta);
        const currentScrollTop = scrollRef.current?.scrollTop ?? 0;
        const indicatorY = getRowBoundaryPosition(ctx.index) - currentScrollTop + (ctx.accumulated - ctx.startSize);
        setResizeIndicator({ type: 'row', position: indicatorY });
      }
    };

    const handleUp = () => {
      const ctx = resizeDataRef.current;
      if (!ctx) return;

      const next = cloneTable(table);
      if (ctx.type === 'col') {
        next.columns[ctx.index].width = ctx.accumulated;
      } else {
        next.rowsHeight[ctx.index] = ctx.accumulated;
      }

      // 与切 custom 比例合并为一次写入，避免第二次 updateNodeData 用过期 dataRef 覆盖尺寸
      if (onCellSizeManualChange) {
        onCellSizeManualChange(next);
      } else {
        onChange(next);
      }

      resizeDataRef.current = null;
      setIsResizing(false);
      setResizeIndicator(null);
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);

    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [resizeIndicator]);

  const startColResize = (e: React.MouseEvent, colIndex: number) => {
    if (isReordering) return;
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);
    resizeDataRef.current = {
      type: 'col',
      index: colIndex,
      startCoord: e.clientX,
      startSize: columns[colIndex].width,
      accumulated: columns[colIndex].width,
    };
    const scrollLeft = scrollRef.current?.scrollLeft ?? 0;
    setResizeIndicator({ type: 'col', position: getColumnBoundaryPosition(colIndex) - scrollLeft });
  };

  const startRowResize = (e: React.MouseEvent, rowIndex: number) => {
    if (isReordering) return;
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);
    resizeDataRef.current = {
      type: 'row',
      index: rowIndex,
      startCoord: e.clientY,
      startSize: rowsHeight[rowIndex],
      accumulated: rowsHeight[rowIndex],
    };
    const scrollTop = scrollRef.current?.scrollTop ?? 0;
    setResizeIndicator({ type: 'row', position: getRowBoundaryPosition(rowIndex) - scrollTop });
  };

  const getColumnBoundaryPosition = (colIndex: number) => {
    let pos = SERIAL_COL_WIDTH;
    for (let i = 0; i <= colIndex; i++) {
      pos += columns[i].width;
    }
    return pos;
  };

  const getRowBoundaryPosition = (rowIndex: number) => {
    let pos = HEADER_ROW_HEIGHT;
    for (let i = 0; i <= rowIndex; i++) {
      pos += rowsHeight[i];
    }
    return pos;
  };

  // ============================
  // 拖拽相关
  // ============================
  const onDragStartCell = (location: CellLocation) => (e: React.DragEvent) => {
    if (!interactiveEditing) {
      e.preventDefault();
      return;
    }
    setIsDraggingCell(true);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData(STORYBOARD_DRAG_MIME, JSON.stringify(location));
    // 兼容部分场景 dataTransfer 丢失（偶现 drop 读不到 mime 数据）
    dragSourceRef.current = location;
    // 某些浏览器需要至少一个 text/plain 才会稳定触发 drop
    if (!e.dataTransfer.getData('text/plain')) e.dataTransfer.setData('text/plain', '');
  };

  const onDragOverCell = (location: CellLocation) => (e: React.DragEvent) => {
    if (!interactiveEditing) return;
    e.preventDefault();
    e.stopPropagation();
    setHoverCell(location);
  };

  const onDragLeaveCell = () => () => {
    setHoverCell(null);
  };

  const getDragSourceLocation = (e: React.DragEvent): CellLocation | null => {
    const internalRaw = e.dataTransfer.getData(STORYBOARD_DRAG_MIME);
    if (internalRaw) {
      try {
        return JSON.parse(internalRaw) as CellLocation;
      } catch {
        return null;
      }
    }
    return dragSourceRef.current;
  };

  const moveOrSwap = (row: Record<string, CellData>, sourceField: string, targetField: string) => {
    const sourceCell = row[sourceField];
    const targetCell = row[targetField];

    // 源为空时不处理，避免异常拖拽覆盖目标
    if (!sourceCell || sourceCell.type === 'empty') return false;

    // 目标为空：移动（源清空，目标填充）；目标非空：互换
    if (!targetCell || targetCell.type === 'empty') {
      row[sourceField] = { type: 'empty', value: '' };
      row[targetField] = { ...sourceCell };
    } else {
      row[sourceField] = targetCell;
      row[targetField] = sourceCell;
    }

    return true;
  };

  const onDropCell = (location: CellLocation) => (e: React.DragEvent) => {
    if (!interactiveEditing) return;
    e.preventDefault();
    e.stopPropagation();
    setHoverCell(null);
    setIsDraggingCell(false);

    // 表格内单元格互换
    const source = getDragSourceLocation(e);
    if (!source) return;
    if (source.rowIndex === location.rowIndex && source.field === location.field) return;

    update(next => {
      const fields = next.columns.map(c => c.field);

      // 同一行内拖拽：必须在同一个 row 对象上变更，否则两次写回会互相覆盖（导致偶现“源格未清空”）
      if (source.rowIndex === location.rowIndex) {
        const row = ensureRowSlots(next.data[source.rowIndex], fields);
        const changed = moveOrSwap(row, source.field, location.field);
        if (!changed) return;
        next.data[source.rowIndex] = row;
        return;
      }

      const sourceRow = ensureRowSlots(next.data[source.rowIndex], fields);
      const targetRow = ensureRowSlots(next.data[location.rowIndex], fields);
      const sourceCell = sourceRow[source.field];
      if (!sourceCell || sourceCell.type === 'empty') return;

      // 目标为空：移动；目标非空：互换（跨行时必须成对更新）
      const targetCell = targetRow[location.field];
      if (!targetCell || targetCell.type === 'empty') {
        sourceRow[source.field] = { type: 'empty', value: '' };
        targetRow[location.field] = { ...sourceCell };
      } else {
        sourceRow[source.field] = targetCell;
        targetRow[location.field] = sourceCell;
      }

      next.data[source.rowIndex] = sourceRow;
      next.data[location.rowIndex] = targetRow;
    });

    dragSourceRef.current = null;
  };

  const onDragEndCell = (location: CellLocation) => async (e: React.DragEvent) => {
    if (!interactiveEditing) return;
    setIsDraggingCell(false);
    dragSourceRef.current = null;
    const tableRect = wrapperRef.current?.getBoundingClientRect();
    if (!tableRect) return;
    const inside = e.clientX >= tableRect.left && e.clientX <= tableRect.right && e.clientY >= tableRect.top && e.clientY <= tableRect.bottom;
    if (inside) return;

    const fields = columns.map(c => c.field);
    const row = data[location.rowIndex];
    const cell = row?.[location.field] || ensureRowSlots(row, fields)[location.field];
    if (!cell || cell.type === 'empty') return;

    onDragCellOutToCanvas(cell, { x: e.clientX, y: e.clientY });
  };

  const onDropToTable = (e: React.DragEvent) => {
    if (!interactiveEditing) return;
    if (hoverCell) return; // 已经被某个单元格处理
    e.preventDefault();
    // 计算落入的单元格
    const wrapperRect = wrapperRef.current?.getBoundingClientRect();
    if (!wrapperRect) return;
    const scrollLeft = scrollRef.current?.scrollLeft ?? 0;
    const scrollTop = scrollRef.current?.scrollTop ?? 0;
    const localX = e.clientX - wrapperRect.left + scrollLeft;
    const localY = e.clientY - wrapperRect.top + scrollTop;
    if (localX < SERIAL_COL_WIDTH || localY < HEADER_ROW_HEIGHT) return;

    let runX = SERIAL_COL_WIDTH;
    let foundCol = -1;
    for (let i = 0; i < columns.length; i++) {
      if (localX >= runX && localX < runX + columns[i].width) {
        foundCol = i;
        break;
      }
      runX += columns[i].width;
    }
    let runY = HEADER_ROW_HEIGHT;
    let foundRow = -1;
    for (let i = 0; i < rowsHeight.length; i++) {
      if (localY >= runY && localY < runY + rowsHeight[i]) {
        foundRow = i;
        break;
      }
      runY += rowsHeight[i];
    }
    if (foundCol < 0 || foundRow < 0) return;
    const location: CellLocation = { rowIndex: foundRow, field: columns[foundCol].field };
    onDropCell(location)(e);
  };

  // ============================
  // 单元格操作回调
  // ============================
  const handleSelectType = (location: CellLocation) => (type: Exclude<CellType, 'empty'>) => {
    if (type === 'text') {
      updateCell(location, { type: 'text', value: '' });
      setTextFocusKey({ location, key: Date.now() });
    } else {
      onOpenUploadFor(location, type);
    }
  };

  const handleChangeText = (location: CellLocation) => (text: string) => {
    updateCell(location, { type: 'text', value: text });
  };

  const handleDelete = (location: CellLocation) => () => {
    updateCell(location, { type: 'empty', value: '' });
  };

  const handleReupload = (location: CellLocation, type: 'image' | 'video' | 'audio') => () => {
    onOpenUploadFor(location, type);
  };

  // ============================
  // 渲染
  // ============================
  const renderHeader = () => {
    return (
      <>
        <div className={tw.cornerPlaceholder} style={{ width: SERIAL_COL_WIDTH, height: HEADER_ROW_HEIGHT, gridColumn: 1, gridRow: 1 }} aria-hidden />
        {columns.map((col, colIndex) => (
          <div
            key={col.field}
            className={`${tw.headerCell} ${reorderHandleClass('col', colIndex)}`}
            style={{ height: HEADER_ROW_HEIGHT, gridColumn: colIndex + 2, gridRow: 1 }}
            onPointerDown={interactiveEditing ? onPointerDownCol(colIndex) : undefined}
          >
            {interactiveEditing ? (
              <input
                value={col.title}
                onChange={e => updateColumnTitle(colIndex, e.target.value)}
                onClick={e => e.stopPropagation()}
                onKeyDown={e => e.stopPropagation()}
                onPointerDown={e => e.stopPropagation()}
                className='bg-transparent text-center outline-none w-full px-2 nodrag'
              />
            ) : (
              <span className='truncate px-2 max-w-full'>{col.title}</span>
            )}
            {interactiveEditing && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <div data-reorder-block className={`${tw.colHeaderActions} ${tw.headerActionBtn}`} onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}>
                    <MoreVertical size={14} />
                  </div>
                </DropdownMenuTrigger>
                <DropdownMenuContent align='end' className='bg-[#262626] border-white/10 text-white'>
                  <DropdownMenuItem className={tw.dropdownMenuItem} disabled={atMaxCols} onSelect={() => insertColumn(colIndex, 'before')}>
                    向左侧插入1列
                  </DropdownMenuItem>
                  <DropdownMenuItem className={tw.dropdownMenuItem} disabled={atMaxCols} onSelect={() => insertColumn(colIndex, 'after')}>
                    向右侧插入1列
                  </DropdownMenuItem>
                  <DropdownMenuItem className={`${tw.dropdownMenuItem} ${tw.dropdownMenuItemDanger}`} onSelect={() => removeColumn(colIndex)}>
                    删除1列
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {interactiveEditing && <div className={tw.colResizer} data-reorder-block onMouseDown={e => startColResize(e, colIndex)} />}
          </div>
        ))}
      </>
    );
  };

  const renderBody = () => {
    return rowsHeight.map((rowHeight, rowIndex) => {
      const row = ensureRowSlots(
        data[rowIndex],
        columns.map(c => c.field)
      );
      return (
        <div key={rowIndex} style={{ display: 'contents' }}>
          <div
            className={`${tw.serialCell} ${selectionMode ? '' : reorderHandleClass('row', rowIndex)}`}
            style={{ width: SERIAL_COL_WIDTH, height: rowHeight, gridColumn: 1, gridRow: rowIndex + 2 }}
            onPointerDown={interactiveEditing ? onPointerDownRow(rowIndex) : undefined}
          >
            {selectionMode ? (
              <button
                type='button'
                className={`nodrag nopan nowheel w-4 h-4 rounded-sm border flex items-center justify-center ${
                  selectedRowSet.has(rowIndex) ? 'bg-[#4155F0] border-[#4155F0] text-white' : 'border-white/40 bg-transparent'
                }`}
                onPointerDown={e => e.stopPropagation()}
                onClick={e => {
                  e.stopPropagation();
                  onToggleRow?.(rowIndex);
                }}
              >
                {selectedRowSet.has(rowIndex) ? <Check className='w-3 h-3' strokeWidth={3} /> : null}
              </button>
            ) : (
              <span>{rowIndex + 1}</span>
            )}
            {interactiveEditing && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <div data-reorder-block className={`${tw.serialCellActions} ${tw.headerActionBtn}`} onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}>
                    <MoreHorizontal size={14} />
                  </div>
                </DropdownMenuTrigger>
                <DropdownMenuContent align='start' className='bg-[#262626] border-white/10 text-white'>
                  <DropdownMenuItem className={tw.dropdownMenuItem} disabled={atMaxRows} onSelect={() => insertRow(rowIndex, 'before')}>
                    向上方插入1行
                  </DropdownMenuItem>
                  <DropdownMenuItem className={tw.dropdownMenuItem} disabled={atMaxRows} onSelect={() => insertRow(rowIndex, 'after')}>
                    向下方插入1行
                  </DropdownMenuItem>
                  <DropdownMenuItem className={`${tw.dropdownMenuItem} ${tw.dropdownMenuItemDanger}`} onSelect={() => removeRow(rowIndex)}>
                    删除1行
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {interactiveEditing && <div className={tw.rowResizer} data-reorder-block onMouseDown={e => startRowResize(e, rowIndex)} />}
          </div>
          {columns.map((col, colIndex) => {
            const location: CellLocation = { rowIndex, field: col.field };
            const cell = row[col.field];
            const canvasDropMatch =
              !!canvasDropPreview && canvasDropPreview.storyboardNodeId === nodeId && canvasDropPreview.rowIndex === rowIndex && canvasDropPreview.field === col.field;
            const highlighted = (!!hoverCell && hoverCell.rowIndex === rowIndex && hoverCell.field === col.field) || canvasDropMatch;
            const dropBlocked = canvasDropMatch && !!canvasDropPreview?.blocked;
            return (
              <div key={col.field} className={tw.cell} style={{ width: col.width, height: rowHeight, gridColumn: colIndex + 2, gridRow: rowIndex + 2 }}>
                <StoryboardCell
                  cell={cell}
                  editing={interactiveEditing}
                  showActions={!isDraggingCell && !isReordering}
                  highlighted={highlighted}
                  dropBlocked={dropBlocked}
                  width={col.width}
                  height={rowHeight}
                  previewUrls={tablePreview.urls}
                  previewTypes={tablePreview.types}
                  previewInitialIndex={tablePreview.indexByLocation.get(`${rowIndex}:${col.field}`) ?? 0}
                  onSelectType={handleSelectType(location)}
                  onChangeText={handleChangeText(location)}
                  onReupload={handleReupload(location, cell.type === 'video' ? 'video' : cell.type === 'audio' ? 'audio' : 'image')}
                  onDelete={handleDelete(location)}
                  onDragStartCell={onDragStartCell(location)}
                  onDragOverCell={onDragOverCell(location)}
                  onDragLeaveCell={onDragLeaveCell()}
                  onDropCell={onDropCell(location)}
                  onDragEndCell={onDragEndCell(location)}
                  textAutoFocusKey={textFocusKey && textFocusKey.location.rowIndex === rowIndex && textFocusKey.location.field === col.field ? textFocusKey.key : undefined}
                />
              </div>
            );
          })}
        </div>
      );
    });
  };

  return (
    <div className={tw.storyboardWrapper} ref={wrapperRef} style={containerStyle} data-storyboard-table='true'>
      <div
        ref={scrollRef}
        data-storyboard-scroll='true'
        // 生成模式需可滚动/勾选，故打开 pointer-events；画布拖入另由 data-storyboard-accept-drop 门控
        data-storyboard-accept-drop={interactiveEditing ? 'true' : 'false'}
        className={`${tw.tableScroll} ${interactiveEditing || selectionMode ? '' : 'pointer-events-none'}`}
        style={{
          width: '100%',
          height: '100%',
          overflowX: overflowX ? 'auto' : 'hidden',
          overflowY: overflowY ? 'auto' : 'hidden',
          boxSizing: 'border-box',
        }}
        onDrop={onDropToTable}
        onDragOver={e => interactiveEditing && e.preventDefault()}
        onMouseDownCapture={e => e.button === 1 && e.preventDefault()}
      >
        <div
          className={tw.tableGrid}
          style={{
            gridTemplateColumns: `${SERIAL_COL_WIDTH}px ${columns.map(col => `${col.width}px`).join(' ')}`,
            gridTemplateRows: `${HEADER_ROW_HEIGHT}px ${rowsHeight.map(h => `${h}px`).join(' ')}`,
            width: totalContentWidth,
            height: totalContentHeight,
          }}
        >
          {renderHeader()}
          {renderBody()}
        </div>
      </div>
      <div className={`${tw.cornerCellFixed} ${selectionMode ? '' : 'pointer-events-none'}`} style={{ width: SERIAL_COL_WIDTH, height: HEADER_ROW_HEIGHT }}>
        {selectionMode ? (
          <button
            type='button'
            className={`nodrag nopan nowheel w-4 h-4 rounded-sm border flex items-center justify-center ${
              allRowsSelected ? 'bg-[#4155F0] border-[#4155F0] text-white' : someRowsSelected ? 'bg-[#4155F0] border-[#4155F0] text-white' : 'border-white/40 bg-transparent'
            }`}
            onPointerDown={e => e.stopPropagation()}
            onClick={e => {
              e.stopPropagation();
              onToggleAllRows?.();
            }}
          >
            {allRowsSelected ? <Check className='w-3 h-3' strokeWidth={3} /> : someRowsSelected ? <Minus className='w-3 h-3' strokeWidth={3} /> : null}
          </button>
        ) : (
          '序号'
        )}
      </div>
      <StoryboardReorderOverlay dragState={dragState} columns={columns} rowsHeight={rowsHeight} totalContentWidth={totalContentWidth} totalContentHeight={totalContentHeight} />
      {!isReordering && resizeIndicator?.type === 'col' && <div className={tw.resizeIndicator} style={{ left: resizeIndicator.position - 1, top: 0, width: 2, height: '100%' }} />}
      {!isReordering && resizeIndicator?.type === 'row' && <div className={tw.resizeIndicator} style={{ top: resizeIndicator.position - 1, left: 0, height: 2, width: '100%' }} />}
    </div>
  );
};

export default memo(StoryboardTable);
