import React from 'react';
import { PropertyPopup } from './PropertyPopup';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';
import { Blend } from 'lucide-react';

interface PropertySliderPopProps {
  label?: React.ReactNode | string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onValueChange: (val: number) => void;
  suffix?: string;
  icon?: React.ElementType;
  className?: string; // For the trigger button
}

export function PropertySliderPop({
  label,
  value,
  min = 0,
  max = 100,
  step = 1,
  onValueChange,
  suffix = '',
  icon: Icon,
  className,
  tooltip,
}: PropertySliderPopProps & { tooltip?: string }) {
  const trigger = (
    <Button variant='ghost' className={cn('h-7 w-0 transition-all text-xs', className)}>
      {Icon && <Icon size={14} className='text-muted-foreground' />}
      {label}
    </Button>
  );

  const content = (
    <div className='flex flex-col gap-3'>
      <div className='flex justify-between text-[10px] text-muted-foreground font-medium px-0.5'>
        <span>
          {value}
          {suffix}
        </span>
      </div>
      <Slider value={[value]} min={min} max={max} step={step} className='cursor-pointer' onValueChange={([val]) => onValueChange(val)} />
    </div>
  );

  return <PropertyPopup trigger={trigger} content={content} contentClassName='w-48 ' tooltip={tooltip} />;
}
