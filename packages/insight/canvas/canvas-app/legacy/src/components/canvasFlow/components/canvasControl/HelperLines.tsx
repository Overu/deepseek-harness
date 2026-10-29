import { useViewport } from '@xyflow/react';
import type { HelperLinesState } from '../../utils/helperLines';

interface HelperLinesProps {
  lines: HelperLinesState;
  /** 吸附瞬间提亮 */
  highlighted?: boolean;
}

/**
 * 拖拽对齐辅助线：画布坐标系下的横/纵虚线，经 viewport 变换到屏幕。
 */
const HelperLines = ({ lines, highlighted = false }: HelperLinesProps) => {
  const { x, y, zoom } = useViewport();
  const { horizontal, vertical } = lines;

  if (horizontal === undefined && vertical === undefined) return null;
  if (![x, y, zoom].every(Number.isFinite)) return null;

  const stroke = highlighted ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.35)';
  const verticalScreenX = vertical !== undefined ? vertical * zoom + x : undefined;
  const horizontalScreenY = horizontal !== undefined ? horizontal * zoom + y : undefined;

  if ((verticalScreenX !== undefined && !Number.isFinite(verticalScreenX)) || (horizontalScreenY !== undefined && !Number.isFinite(horizontalScreenY))) {
    return null;
  }

  return (
    <svg className='pointer-events-none absolute inset-0 z-[5] h-full w-full overflow-visible'>
      {vertical !== undefined && <line x1={verticalScreenX} y1={0} x2={verticalScreenX} y2='100%' stroke={stroke} strokeWidth={1} strokeDasharray='4 4' />}
      {horizontal !== undefined && <line x1={0} y1={horizontalScreenY} x2='100%' y2={horizontalScreenY} stroke={stroke} strokeWidth={1} strokeDasharray='4 4' />}
    </svg>
  );
};

export default HelperLines;
