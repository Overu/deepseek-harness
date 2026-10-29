import { useState } from 'react';
import { Circle, Hexagon, RectangleHorizontal, Square, Star, Triangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useEditorEngine } from '../../hooks/useEditorEngine';
import type { ShapeKind } from '../../core/types';
import { SHAPE_LABELS } from '../../core/utils/shapeUtils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

const SHAPE_ITEMS: Array<{ kind: ShapeKind; icon: typeof Circle }> = [
  { kind: 'circle', icon: Circle },
  { kind: 'triangle', icon: Triangle },
  { kind: 'square', icon: Square },
  { kind: 'rectangle', icon: RectangleHorizontal },
  { kind: 'star', icon: Star },
  { kind: 'hexagon', icon: Hexagon },
];

export function ShapePicker() {
  const engine = useEditorEngine();
  const [open, setOpen] = useState(false);

  const handleAddShape = (kind: ShapeKind) => {
    engine.addShape(kind);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip open={open ? false : undefined}>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button variant={open ? 'secondary' : 'ghost'} size='icon' className='h-9 w-9 transition-all' aria-label='添加图形'>
              <Square className='h-4 w-4' />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side='top'>添加图形</TooltipContent>
      </Tooltip>
      <PopoverContent side='top' align='center' sideOffset={8} className='w-40 p-1.5 bg-background/95 backdrop-blur-lg border-border/60'>
        <div className='flex flex-col gap-0.5' role='menu' aria-label='选择图形'>
          {SHAPE_ITEMS.map(({ kind, icon: Icon }) => (
            <button
              key={kind}
              type='button'
              role='menuitem'
              className='flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-sm text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
              onClick={() => handleAddShape(kind)}
            >
              <Icon className='h-5 w-5' />
              <span>{SHAPE_LABELS[kind]}</span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
