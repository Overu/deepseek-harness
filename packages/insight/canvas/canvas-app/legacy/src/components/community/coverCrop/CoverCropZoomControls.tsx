import { Minus, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';

interface CoverCropZoomControlsProps {
  value: number;
  max: number;
  step: number;
  disabled: boolean;
  onChange: (value: number) => void;
}

export function CoverCropZoomControls({ value, max, step, disabled, onChange }: CoverCropZoomControlsProps) {
  return (
    <div className='flex items-center gap-3 text-white/85'>
      <Button
        type='button'
        variant='ghost'
        size='icon'
        className='h-7 w-7 text-white/80 hover:bg-white/10 hover:text-white'
        disabled={disabled || value <= 0}
        onClick={() => onChange(value - step)}
      >
        <Minus className='h-5 w-5' />
        <span className='sr-only'>缩小</span>
      </Button>
      <Slider
        min={0}
        max={max}
        step={1}
        value={[value]}
        disabled={disabled}
        aria-label='封面缩放'
        className='w-32 disabled:cursor-not-allowed disabled:opacity-40'
        onValueChange={nextValue => onChange(nextValue[0] ?? 0)}
      />
      <Button
        type='button'
        variant='ghost'
        size='icon'
        className='h-7 w-7 text-white/80 hover:bg-white/10 hover:text-white'
        disabled={disabled || value >= max}
        onClick={() => onChange(value + step)}
      >
        <Plus className='h-5 w-5' />
        <span className='sr-only'>放大</span>
      </Button>
      <span className='w-11 text-sm tabular-nums text-white/80'>{value}%</span>
    </div>
  );
}
