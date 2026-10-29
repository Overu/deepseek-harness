import { ArrowUpToLine } from 'lucide-react';
import type { RefObject } from 'react';

import { useBackToTop } from '@/hooks/useBackToTop';
import { cn } from '@/lib/utils';

interface BackToTopButtonProps {
  scrollTargetRef?: RefObject<HTMLElement | null>;
  className?: string;
}

export function BackToTopButton({ scrollTargetRef, className }: BackToTopButtonProps) {
  const { isVisible, scrollToTop } = useBackToTop({ scrollTargetRef });

  return (
    <button
      type='button'
      aria-label='返回顶部'
      aria-hidden={!isVisible}
      tabIndex={isVisible ? 0 : -1}
      className={cn(
        'z-30 flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-[#2b2b2b]/95 text-white/80 shadow-lg backdrop-blur transition-[opacity,transform,background-color,color] duration-200 hover:bg-[#3a3a3a] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50',
        scrollTargetRef ? 'absolute bottom-4 right-4' : 'fixed bottom-6 right-6',
        isVisible ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-2 opacity-0',
        className
      )}
      onClick={scrollToTop}
    >
      <ArrowUpToLine className='h-4 w-4' aria-hidden='true' />
    </button>
  );
}
