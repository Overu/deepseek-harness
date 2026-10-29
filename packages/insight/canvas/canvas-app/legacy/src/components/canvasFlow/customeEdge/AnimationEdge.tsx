// GradientDashEdge.tsx
import { useEffect, useState, useRef } from 'react';
import { type EdgeProps, getBezierPath } from '@xyflow/react';
import setting from '../settings/setting';
import EdgeDeleteControl from './EdgeDeleteControl';

const { handlerColorMap } = setting;

interface GradientDashEdgeData {
  strokeWidth?: number;
  dashLength?: number;
  gapLength?: number;
  animationSpeed?: number;
  gradientColors?: [string, string, string];
  pulseEffect?: boolean;
}

const AnimationEdge = ({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style = {}, data, markerEnd, selected, sourceHandleId }: EdgeProps) => {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  const edgeData = (data as GradientDashEdgeData) || {};
  const {
    strokeWidth = 1.5,
    dashLength = 12,
    gapLength = 8,
    animationSpeed = 0.8,
    gradientColors = [handlerColorMap[sourceHandleId as keyof typeof handlerColorMap] || '#4ecdc4'],
    pulseEffect = false,
  } = edgeData;

  const [dashOffset, setDashOffset] = useState(0);
  const [gradientId] = useState(() => `gradient-${id}-${Math.random().toString(36).substr(2, 9)}`);
  const pathRef = useRef<SVGPathElement>(null);
  const [pulseIntensity, setPulseIntensity] = useState(0);

  // 动画效果
  useEffect(() => {
    let animationFrameId: number;
    let startTime: number;

    const animate = (timestamp: number) => {
      if (!startTime) startTime = timestamp;

      const elapsed = timestamp - startTime;

      // 计算虚线偏移
      const offset = (-elapsed * animationSpeed * 0.1) % (dashLength + gapLength);
      setDashOffset(offset);

      // 脉冲效果
      if (pulseEffect) {
        const intensity = 0.5 + 0.5 * Math.sin(elapsed * 0.005);
        setPulseIntensity(intensity);
      }

      animationFrameId = requestAnimationFrame(animate);
    };

    animationFrameId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [animationSpeed, dashLength, gapLength, pulseEffect]);

  // 根据选择状态调整样式
  const edgeStyle = selected
    ? {
        strokeWidth: strokeWidth + 2,
        filter: 'drop-shadow(0 0 4px rgba(66, 153, 225, 0.5))',
      }
    : {};

  return (
    <>
      <defs>
        <linearGradient id={gradientId} x1='0%' y1='0%' x2='100%' y2='0%'>
          {gradientColors.map((color, index) => (
            <stop key={index} offset={`${(index * 100) / (gradientColors.length - 1)}%`} stopColor={color} stopOpacity={pulseEffect ? pulseIntensity : 1} />
          ))}
        </linearGradient>
      </defs>

      <EdgeDeleteControl id={id} edgePath={edgePath} labelX={labelX} labelY={labelY} selected={selected}>
        <path
          ref={pathRef}
          id={id}
          style={{
            ...style,
            fill: 'none',
            stroke: `url(#${gradientId})`,
            strokeWidth: strokeWidth + (pulseEffect ? pulseIntensity * 2 : 0),
            strokeDasharray: `${dashLength} ${gapLength}`,
            strokeDashoffset: dashOffset,
            strokeLinecap: 'round',
            transition: 'stroke-width 0.3s ease',
            ...edgeStyle,
          }}
          className='react-flow__edge-path gradient-dash-edge'
          d={edgePath}
          markerEnd={markerEnd}
        />
      </EdgeDeleteControl>
    </>
  );
};

export default AnimationEdge;
