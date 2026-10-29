import * as React from 'react';
import { cn } from '@/lib/utils';

interface CircleProgressProps {
  value: number;
  size?: number;
  strokeWidth?: number;
  strokeColor?: string;
  className?: string;
  /** 为 false 时禁用圆环过渡，避免高频更新或进度重置时动画滞后 */
  animate?: boolean;
  format?: (percent: number) => React.ReactNode;
}

const CircleProgress = React.forwardRef<HTMLDivElement, CircleProgressProps>(({ value = 0, size = 120, strokeWidth = 8, strokeColor, className, animate = true, format }, ref) => {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.min(100, Math.max(0, value));
  const offset = circumference - (progress / 100) * circumference;

  const defaultFormat = (percent: number) => <span className='text-white'>{`${percent}%`}</span>;

  return (
    <div ref={ref} className={cn('relative inline-flex items-center justify-center', className)} style={{ width: size, height: size }}>
      <svg className='transform -rotate-90' width={size} height={size}>
        {/* 背景圆环 */}
        <circle cx={size / 2} cy={size / 2} r={radius} fill='none' stroke='currentColor' strokeWidth={strokeWidth} className='text-white/20' />
        {/* 进度圆环 */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill='none'
          stroke={strokeColor || 'currentColor'}
          strokeWidth={strokeWidth}
          strokeLinecap='round'
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className={cn(!strokeColor && 'text-primary')}
          style={{ transition: animate ? 'stroke-dashoffset 0.3s ease' : 'none' }}
        />
      </svg>
      {/* 中心内容 */}
      <div className='absolute inset-0 flex items-center justify-center'>{format ? format(progress) : defaultFormat(progress)}</div>
    </div>
  );
});

CircleProgress.displayName = 'CircleProgress';

export { CircleProgress };
