import type { CommunityWorkType } from '@/api/community';
import { cn } from '@/lib/utils';
import { WORK_TYPE_OPTIONS } from './constants';

interface WorkTypeSegmentProps {
  value: CommunityWorkType;
  onChange: (value: CommunityWorkType) => void;
}

export function WorkTypeSegment({ value, onChange }: WorkTypeSegmentProps) {
  const activeIndex = WORK_TYPE_OPTIONS.findIndex(option => option.value === value);

  return (
    <div className='relative mx-auto grid h-9 w-full max-w-[600px] grid-cols-2 overflow-hidden rounded-md bg-[#111111] p-1'>
      <span
        className='absolute bottom-1 left-1 top-1 w-[calc(50%-8px)] rounded-md bg-[#565656] transition-transform duration-300 ease-out'
        style={{ transform: `translateX(${Math.max(activeIndex, 0) * 100}%)` }}
      />
      {WORK_TYPE_OPTIONS.map(option => {
        const active = option.value === value;

        return (
          <button
            key={option.value}
            type='button'
            className={cn('relative z-10 h-7 rounded-[5px] text-sm text-white/62 transition-colors duration-200', active && 'text-white')}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
