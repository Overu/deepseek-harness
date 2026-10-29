import React from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface PropertyPopupProps {
  trigger: React.ReactNode;
  content: React.ReactNode;
  contentClassName?: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function PropertyPopup({ trigger, content, contentClassName, side = 'bottom', align = 'start', isOpen, onOpenChange, tooltip }: PropertyPopupProps & { tooltip?: string }) {
  const triggerNode = <PopoverTrigger asChild>{trigger}</PopoverTrigger>;

  const wrappedTrigger = tooltip ? (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{triggerNode}</TooltipTrigger>
        <TooltipContent>
          <p>{tooltip}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  ) : (
    triggerNode
  );

  return (
    <Popover open={isOpen} onOpenChange={onOpenChange}>
      {wrappedTrigger}
      <PopoverContent className={contentClassName || 'w-64 p-4'} side={side} align={align}>
        {content}
      </PopoverContent>
    </Popover>
  );
}
