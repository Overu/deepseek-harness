import { useEffect, useState } from 'react';
import { buildBezierPath, type SourceHandleAnchor } from '../../utils/multiConnect';
import { SelectionConnectHandleVisual } from './SelectionConnectHandle';

interface MultiConnectionPreviewProps {
  anchors: SourceHandleAnchor[];
  toX: number;
  toY: number;
  active: boolean;
}

const DASH_LENGTH = 3;
const GAP_LENGTH = 3;
const ANIMATION_SPEED = 0.2;

/** 多选拖线预览：屏幕坐标 SVG，虚线流动样式对齐 AnimationEdge */
const MultiConnectionPreview = ({ anchors, toX, toY, active }: MultiConnectionPreviewProps) => {
  const [dashOffset, setDashOffset] = useState(0);

  useEffect(() => {
    if (!active) return;

    let animationFrameId = 0;
    let startTime = 0;

    const animate = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const elapsed = timestamp - startTime;
      setDashOffset((-elapsed * ANIMATION_SPEED * 0.1) % (DASH_LENGTH + GAP_LENGTH));
      animationFrameId = requestAnimationFrame(animate);
    };

    animationFrameId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationFrameId);
  }, [active]);

  if (!active || anchors.length === 0) return null;

  return (
    <>
      <svg className='pointer-events-none fixed inset-0 z-[1000] h-screen w-screen overflow-visible' aria-hidden>
        {anchors.map(anchor => {
          const strokeColor = anchor.color || '#b1b1b7';
          return (
            <path
              key={anchor.nodeId}
              fill='none'
              stroke={strokeColor}
              strokeWidth={1.5}
              strokeLinecap='round'
              strokeDasharray={`${DASH_LENGTH} ${GAP_LENGTH}`}
              strokeDashoffset={dashOffset}
              d={buildBezierPath(anchor.x, anchor.y, toX, toY)}
            />
          );
        })}
      </svg>
      <div
        className='pointer-events-none fixed z-[1001]'
        style={{ left: toX, top: toY, transform: 'translate(-50%, -50%)' }}
        aria-hidden
      >
        <SelectionConnectHandleVisual />
      </div>
    </>
  );
};

export default MultiConnectionPreview;
