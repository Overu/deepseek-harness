import { useState } from 'react';
import { BookOpen, Compass, HelpCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { TUTORIAL_URL } from '@/constants';

interface CanvasOnboardingFloatingButtonProps {
  loading?: boolean;
  disabled?: boolean;
  className?: string;
  onRestart: () => void | Promise<void>;
}

export function CanvasOnboardingFloatingButton({ loading = false, disabled = false, className, onRestart }: CanvasOnboardingFloatingButtonProps) {
  const [popoverOpen, setPopoverOpen] = useState(false);

  return (
    <div className={cn('fixed bottom-6 right-6 z-40', className)}>
      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        <TooltipProvider delayDuration={200}>
          <Tooltip open={popoverOpen ? false : undefined}>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <Button
                  type='button'
                  size='icon'
                  disabled={disabled}
                  aria-label='帮助'
                  className='h-11 w-11 rounded-full border border-white/10 bg-[#2b2b2b] text-white shadow-xl hover:bg-[#3a3a3a] focus-visible:ring-white/70'
                >
                  {loading ? <Loader2 className='h-5 w-5 animate-spin' /> : <HelpCircle className='h-5 w-5' />}
                </Button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent side='left'>帮助</TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <PopoverContent align='end' side='top' sideOffset={8} className='w-[168px] rounded-lg border-white/10 bg-[#2f2f2f] p-1 text-white shadow-xl'>
          <button
            type='button'
            onClick={() => {
              setPopoverOpen(false);
              window.open(TUTORIAL_URL, '_blank');
            }}
            className='flex h-9 w-full items-center gap-2 rounded-md px-3 text-left text-xs text-white/85 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-50'
          >
            <BookOpen className='h-4 w-4' />
            使用教程
          </button>
          <button
            type='button'
            disabled={disabled || loading}
            onClick={() => {
              setPopoverOpen(false);
              void onRestart();
            }}
            className='flex h-9 w-full items-center gap-2 rounded-md px-3 text-left text-xs text-white/85 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-50'
          >
            {loading ? <Loader2 className='h-4 w-4 animate-spin' /> : <Compass className='h-4 w-4' />}
            新手指引
          </button>
        </PopoverContent>
      </Popover>
    </div>
  );
}
