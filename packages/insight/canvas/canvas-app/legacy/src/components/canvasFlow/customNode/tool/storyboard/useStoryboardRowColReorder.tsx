import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  REORDER_ACTIVATION_PX,
  type ReorderMode,
  getColumnLeft,
  getGrabOffset,
  getInsertLineX,
  getInsertLineY,
  getPointerCoords,
  getRowTop,
  insertTargetIndex,
  reorderColumns,
  reorderRows,
  resolveColumnInsertIndex,
  resolveRowInsertIndex,
} from './storyboardReorder';
import { type ColumnConfig, SERIAL_COL_WIDTH, type TableProtocol } from './types';

export interface ReorderDragState {
  mode: ReorderMode;
  sourceIndex: number;
  insertBefore: number;
  localX: number;
  localY: number;
  scrollLeft: number;
  scrollTop: number;
  grabOffsetX: number;
  grabOffsetY: number;
  activated: boolean;
}

interface UseStoryboardRowColReorderOptions {
  editing: boolean;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  columns: ColumnConfig[];
  rowsHeight: number[];
  table: TableProtocol;
  isResizing: boolean;
  onCommit: (next: TableProtocol) => void;
}

const AUTO_SCROLL_EDGE = 24;
const AUTO_SCROLL_STEP = 12;
const INDICATOR = '#4155F0';

const isBlockedTarget = (target: EventTarget | null) =>
  target instanceof Element && !!target.closest('input, [data-reorder-block], [data-slot="dropdown-menu-trigger"], [role="menuitem"]');

const resolveInsertBeforeByGhost = (
  mode: ReorderMode,
  sourceIndex: number,
  localX: number,
  localY: number,
  grabOffsetX: number,
  grabOffsetY: number,
  columns: ColumnConfig[],
  rowsHeight: number[]
) => {
  if (mode === 'col') {
    const width = columns[sourceIndex]?.width ?? 0;
    const centerX = localX - grabOffsetX + width / 2;
    return resolveColumnInsertIndex(centerX, columns);
  }
  const height = rowsHeight[sourceIndex] ?? 0;
  const centerY = localY - grabOffsetY + height / 2;
  return resolveRowInsertIndex(centerY, rowsHeight);
};

export function useStoryboardRowColReorder({ editing, scrollRef, columns, rowsHeight, table, isResizing, onCommit }: UseStoryboardRowColReorderOptions) {
  const [dragState, setDragState] = useState<ReorderDragState | null>(null);
  const [sessionActive, setSessionActive] = useState(false);
  const pendingRef = useRef<{ mode: ReorderMode; sourceIndex: number; startX: number; startY: number; pointerId: number } | null>(null);
  const dragRef = useRef<ReorderDragState | null>(null);
  const ctxRef = useRef({ columns, rowsHeight, table, onCommit });
  ctxRef.current = { columns, rowsHeight, table, onCommit };
  dragRef.current = dragState;

  const buildDragState = (mode: ReorderMode, sourceIndex: number, coords: ReturnType<typeof getPointerCoords>): ReorderDragState => {
    const { columns: cols, rowsHeight: heights } = ctxRef.current;
    const grab = getGrabOffset(mode, sourceIndex, coords.localX, coords.localY, cols, heights);
    const insertBefore = resolveInsertBeforeByGhost(mode, sourceIndex, coords.localX, coords.localY, grab.grabOffsetX, grab.grabOffsetY, cols, heights);
    return {
      mode,
      sourceIndex,
      insertBefore,
      localX: coords.localX,
      localY: coords.localY,
      scrollLeft: coords.scrollLeft,
      scrollTop: coords.scrollTop,
      grabOffsetX: grab.grabOffsetX,
      grabOffsetY: grab.grabOffsetY,
      activated: true,
    };
  };

  const resetSession = () => {
    pendingRef.current = null;
    dragRef.current = null;
    setDragState(null);
    setSessionActive(false);
  };

  useEffect(() => {
    if (!sessionActive) return;

    const onMove = (e: PointerEvent) => {
      const pending = pendingRef.current;
      const current = dragRef.current;
      const scrollEl = scrollRef.current;
      if (!scrollEl) return;

      if (pending && !current) {
        if (Math.hypot(e.clientX - pending.startX, e.clientY - pending.startY) < REORDER_ACTIVATION_PX) return;
        const next = buildDragState(pending.mode, pending.sourceIndex, getPointerCoords(scrollEl, e.clientX, e.clientY));
        pendingRef.current = null;
        dragRef.current = next;
        setDragState(next);
      } else if (current?.activated) {
        e.preventDefault();
        const coords = getPointerCoords(scrollEl, e.clientX, e.clientY);
        const insertBefore = resolveInsertBeforeByGhost(
          current.mode,
          current.sourceIndex,
          coords.localX,
          coords.localY,
          current.grabOffsetX,
          current.grabOffsetY,
          ctxRef.current.columns,
          ctxRef.current.rowsHeight
        );
        const next: ReorderDragState = {
          ...current,
          localX: coords.localX,
          localY: coords.localY,
          scrollLeft: coords.scrollLeft,
          scrollTop: coords.scrollTop,
          insertBefore,
        };
        dragRef.current = next;
        setDragState(next);
      } else {
        return;
      }

      const rect = scrollEl.getBoundingClientRect();
      const relX = e.clientX - rect.left;
      const relY = e.clientY - rect.top;
      if (relX < AUTO_SCROLL_EDGE) scrollEl.scrollLeft = Math.max(0, scrollEl.scrollLeft - AUTO_SCROLL_STEP);
      else if (relX > rect.width - AUTO_SCROLL_EDGE) scrollEl.scrollLeft = Math.min(scrollEl.scrollWidth - scrollEl.clientWidth, scrollEl.scrollLeft + AUTO_SCROLL_STEP);
      if (relY < AUTO_SCROLL_EDGE) scrollEl.scrollTop = Math.max(0, scrollEl.scrollTop - AUTO_SCROLL_STEP);
      else if (relY > rect.height - AUTO_SCROLL_EDGE) scrollEl.scrollTop = Math.min(scrollEl.scrollHeight - scrollEl.clientHeight, scrollEl.scrollTop + AUTO_SCROLL_STEP);
    };

    const onUp = (e: PointerEvent) => {
      const pending = pendingRef.current;
      if (pending?.pointerId === e.pointerId) {
        resetSession();
        return;
      }
      const current = dragRef.current;
      if (!current?.activated) return;

      const { mode, sourceIndex, insertBefore } = current;
      const target = insertTargetIndex(sourceIndex, insertBefore);
      const { table: latest, onCommit: commit } = ctxRef.current;
      if (target !== sourceIndex) {
        commit(mode === 'col' ? reorderColumns(latest, sourceIndex, target) : reorderRows(latest, sourceIndex, target));
      }
      resetSession();
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [sessionActive, scrollRef]);

  const onPointerDown = useCallback(
    (mode: ReorderMode, index: number) => (e: React.PointerEvent) => {
      if (!editing || isResizing || e.button !== 0 || isBlockedTarget(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      pendingRef.current = { mode, sourceIndex: index, startX: e.clientX, startY: e.clientY, pointerId: e.pointerId };
      setSessionActive(true);
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    },
    [editing, isResizing]
  );

  return {
    dragState,
    isReordering: !!dragState?.activated,
    onPointerDownCol: useCallback((i: number) => onPointerDown('col', i), [onPointerDown]),
    onPointerDownRow: useCallback((i: number) => onPointerDown('row', i), [onPointerDown]),
  };
}

// —— 拖拽视觉层 ——

interface ReorderOverlayProps {
  dragState: ReorderDragState | null;
  columns: ColumnConfig[];
  rowsHeight: number[];
  totalContentWidth: number;
  totalContentHeight: number;
}

const Handle = ({ axis }: { axis: 'col' | 'row' }) => (
  <div
    className='absolute rounded-full bg-white border border-white/30'
    style={axis === 'col' ? { width: 8, height: 8, left: -3, top: 4 } : { width: 8, height: 8, left: SERIAL_COL_WIDTH + 4, top: -3 }}
  />
);

export const StoryboardReorderOverlay = memo(({ dragState, columns, rowsHeight, totalContentWidth, totalContentHeight }: ReorderOverlayProps) => {
  if (!dragState?.activated) return null;

  const { mode, sourceIndex, insertBefore, localX, localY, scrollLeft, scrollTop, grabOffsetX, grabOffsetY } = dragState;
  const ghostLeft = localX - grabOffsetX - scrollLeft;
  const ghostTop = localY - grabOffsetY - scrollTop;
  const isCol = mode === 'col';
  const count = isCol ? columns.length : rowsHeight.length;
  const hoverIndex = Math.min(insertBefore, count - 1);
  const showHover = insertBefore < count && hoverIndex !== sourceIndex;

  if (isCol) {
    const col = columns[sourceIndex];
    if (!col) return null;
    const sourceLeft = getColumnLeft(columns, sourceIndex) - scrollLeft;
    const lineLeft = getInsertLineX(columns, insertBefore) - scrollLeft - 1;
    const hoverLeft = getColumnLeft(columns, hoverIndex) - scrollLeft;
    return (
      <>
        <div className='absolute pointer-events-none z-[7] border-2 border-[#4155F0] rounded-sm' style={{ left: sourceLeft, top: 0, width: col.width, height: '100%' }} />
        {showHover && <div className='absolute pointer-events-none z-[8] bg-white/5' style={{ left: hoverLeft, top: 0, width: columns[hoverIndex].width, height: '100%' }} />}
        <div
          className='absolute pointer-events-none z-[9] rounded-sm border-2 border-[#4155F0] bg-[#262626]/75 shadow-lg'
          style={{ left: ghostLeft, top: 0, width: col.width, height: totalContentHeight }}
        />
        <div className='absolute pointer-events-none z-[999]' style={{ left: lineLeft, top: 0, width: 2, height: '100%', background: INDICATOR }}>
          <Handle axis='col' />
        </div>
      </>
    );
  }

  const rowHeight = rowsHeight[sourceIndex];
  if (!rowHeight) return null;
  const sourceTop = getRowTop(rowsHeight, sourceIndex) - scrollTop;
  const lineTop = getInsertLineY(rowsHeight, insertBefore) - scrollTop - 1;
  const hoverTop = getRowTop(rowsHeight, hoverIndex) - scrollTop;

  return (
    <>
      <div className='absolute pointer-events-none z-[7] border-2 border-[#4155F0] rounded-sm' style={{ left: 0, top: sourceTop, width: '100%', height: rowHeight }} />
      {showHover && <div className='absolute pointer-events-none z-[8] bg-white/5' style={{ left: 0, top: hoverTop, width: '100%', height: rowsHeight[hoverIndex] }} />}
      <div
        className='absolute pointer-events-none z-[9] rounded-sm border-2 border-[#4155F0] bg-[#262626]/75 shadow-lg'
        style={{ left: 0, top: ghostTop, width: totalContentWidth, height: rowHeight }}
      />
      <div className='absolute pointer-events-none z-[999]' style={{ left: 0, top: lineTop, width: '100%', height: 2, background: INDICATOR }}>
        <Handle axis='row' />
      </div>
    </>
  );
});

StoryboardReorderOverlay.displayName = 'StoryboardReorderOverlay';
