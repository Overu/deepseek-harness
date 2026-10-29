import React from 'react';
import { Button, type ButtonProps } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface PropertyButtonProps extends ButtonProps {
  isActive?: boolean;
  tooltip?: string;
  icon?: React.ElementType;
}

export const PropertyButton = React.forwardRef<HTMLButtonElement, PropertyButtonProps>(
  ({ className, variant = 'ghost', size = 'sm', isActive, children, tooltip, icon: Icon, ...props }, ref) => {
    const comp = (
      <Button ref={ref} variant={variant} size={size} className={cn('h-7 px-2 text-xs hover:bg-zinc-800', isActive && 'bg-zinc-700 text-zinc-100', className)} {...props}>
        {Icon && <Icon size={14} className={children ? 'mr-2' : ''} />}
        {children}
      </Button>
    );

    if (tooltip) {
      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>{comp}</TooltipTrigger>
            <TooltipContent>
              <p>{tooltip}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    }

    return comp;
  }
);

PropertyButton.displayName = 'PropertyButton';
