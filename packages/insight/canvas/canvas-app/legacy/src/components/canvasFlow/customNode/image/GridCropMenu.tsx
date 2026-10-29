import { useState } from 'react';
import { Grid2X2, LoaderCircle } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { GRID_CROP_MAX_SIZE } from './gridCropConfig';
import type { ToolListItem } from '../../settings/toolListConfig';

interface GridCropMenuProps {
  onSelect: (columns: number, rows: number) => void;
  disabled?: boolean;
  loading?: boolean;
  tool: ToolListItem;
}

const PRESETS = [
  { size: 2, label: '4宫格（2x2）' },
  { size: 3, label: '9宫格（3x3）' },
  { size: 4, label: '16宫格（4x4）' },
];

const CUSTOM_CELLS = Array.from({ length: GRID_CROP_MAX_SIZE ** 2 }, (_, index) => ({
  column: (index % GRID_CROP_MAX_SIZE) + 1,
  row: Math.floor(index / GRID_CROP_MAX_SIZE) + 1,
}));

const GridCropMenu = ({ tool, onSelect, disabled = false, loading = true }: GridCropMenuProps) => {
  const [customSize, setCustomSize] = useState({ columns: 3, rows: 5 });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <div
          className={cn(
            'flex items-center justify-center rounded-lg transition-colors hover:bg-white/10 h-8 gap-1 px-2 text-white text-opacity-85',
            disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'
          )}
        >
          {loading ? <LoaderCircle size={20} className='animate-spin' /> : <span className='shrink-0'>{tool.icon}</span>}
          <span className={cn('text-xs whitespace-nowrap', disabled && 'text-white/50')}>{tool.abbreviation || tool.type}</span>
        </div>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side='bottom'
        align='start'
        sideOffset={4}
        onPointerDown={e => e.stopPropagation()}
        className='w-40 min-w-40 rounded-lg border-0 bg-[#262626] p-1 text-white shadow-xl'
      >
        {PRESETS.map(({ size, label }) => (
          <DropdownMenuItem
            key={size}
            onSelect={() => onSelect(size, size)}
            className='h-8 cursor-pointer rounded-lg px-2 py-0 text-sm text-white/85 focus:bg-white/10 focus:text-white'
          >
            <Grid2X2 size={20} />
            <span>{label}</span>
          </DropdownMenuItem>
        ))}

        <DropdownMenuSub>
          <DropdownMenuSubTrigger className='h-8 cursor-pointer rounded-lg px-2 py-0 text-sm text-white/85 focus:bg-white/10 focus:text-white data-[state=open]:bg-white/10 [&_svg]:size-5'>
            自定义
          </DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent
              sideOffset={6}
              alignOffset={-100}
              onPointerDown={e => e.stopPropagation()}
              className='min-w-[152px] rounded-lg border-0 bg-[#262626] p-2 text-white'
            >
              <div className='grid grid-cols-5 gap-1'>
                {CUSTOM_CELLS.map(cell => {
                  const active = cell.column <= customSize.columns && cell.row <= customSize.rows;
                  return (
                    <DropdownMenuItem
                      key={`${cell.column}-${cell.row}`}
                      aria-label={`${cell.column}列${cell.row}行`}
                      onMouseEnter={() => setCustomSize({ columns: cell.column, rows: cell.row })}
                      onFocus={() => setCustomSize({ columns: cell.column, rows: cell.row })}
                      onSelect={() => onSelect(cell.column, cell.row)}
                      disabled={cell.column === 1 && cell.row === 1}
                      className={cn(
                        'h-6 w-6 cursor-pointer rounded-sm border p-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/65',
                        active ? 'border-white/65 bg-white/65 focus:bg-white/65' : 'border-white/15 bg-white/10 focus:bg-white/10'
                      )}
                    />
                  );
                })}
              </div>
              <div className='mt-1 text-center text-sm text-white/85'>
                {customSize.columns} X {customSize.rows}
              </div>
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default GridCropMenu;
