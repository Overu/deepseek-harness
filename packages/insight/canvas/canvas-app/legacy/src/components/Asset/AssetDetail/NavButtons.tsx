import React from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';

interface NavButtonsProps {
  onNavigate: (dir: 'up' | 'down') => void;
  assetIndex: number;
  totalCount: number;
  variant?: 'vertical' | 'horizontal';
  children?: React.ReactNode;
}

export const NavButtons: React.FC<NavButtonsProps> = ({ onNavigate, assetIndex, totalCount, variant = 'vertical', children }) => {
  const isHorizontal = variant === 'horizontal';
  const PrevIcon = isHorizontal ? ChevronLeft : ChevronUp;
  const NextIcon = isHorizontal ? ChevronRight : ChevronDown;
  const buttonClassName = cn(
    'w-10 h-10 bg-black/40 hover:bg-white/10 rounded-md disabled:opacity-10 transition-all border border-white/5 backdrop-blur-2xl shadow-2xl hover:scale-110 active:scale-95 group flex justify-center items-center',
    isHorizontal && 'flex-1 border-0 bg-transparent shadow-none backdrop-blur-none hover:scale-100 hover:bg-white/5'
  );

  return (
    <div className={cn('z-10 flex', isHorizontal ? 'w-full items-center' : 'absolute left-10 top-1/2 -translate-y-1/2 flex-col gap-6')}>
      <button onClick={() => onNavigate('up')} disabled={assetIndex <= 0} className={buttonClassName} title='上一个 (Arrow Up/Left)'>
        <PrevIcon className='text-white' size={16} />
      </button>
      {isHorizontal && children && <div className='flex flex-[3] items-center justify-center'>{children}</div>}
      <button onClick={() => onNavigate('down')} disabled={assetIndex >= totalCount - 1} className={buttonClassName} title='下一个 (Arrow Down/Right)'>
        <NextIcon className='text-white' size={16} />
      </button>
    </div>
  );
};
