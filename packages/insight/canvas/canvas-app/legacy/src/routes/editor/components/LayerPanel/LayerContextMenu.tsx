import React from 'react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Copy, Trash2, ChevronsUp, ChevronsDown, ChevronUp, ChevronDown, MoreVertical, Lock, Unlock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useEditorEngine } from '../../hooks/useEditorEngine';
import { useLayerStore } from '../../store/layerStore';

interface LayerContextMenuProps {
  layerId: string;
}

export const LayerContextMenu = React.memo(function LayerContextMenu({ layerId }: LayerContextMenuProps) {
  const engine = useEditorEngine();
  const [open, setOpen] = React.useState(false);
  const layers = useLayerStore(state => state.layers);
  const layerIndex = layers.findIndex(l => l.id === layerId);
  const layer = layers[layerIndex];

  // In the layer store, layers are reversed (index 0 is the top-most layer)
  const isTop = layerIndex === 0;
  const isBottom = layerIndex === layers.length - 1;

  const handleDuplicate = (e: Event) => {
    e.preventDefault();
    engine.duplicateObject(layerId);
    setOpen(false);
  };

  const handleDelete = (e: Event) => {
    e.preventDefault();
    const obj = engine.getObjectById(layerId);
    if (obj) {
      engine.getCanvas().remove(obj);
      engine.getCanvas().requestRenderAll();
    }
    setOpen(false);
  };

  const handleBringToFront = (e: Event) => {
    e.preventDefault();
    engine.bringToFront(layerId);
    setOpen(false);
  };

  const handleSendToBack = (e: Event) => {
    e.preventDefault();
    engine.sendToBack(layerId);
    setOpen(false);
  };

  const handleBringForward = (e: Event) => {
    e.preventDefault();
    engine.bringForward(layerId);
    setOpen(false);
  };

  const handleSendBackward = (e: Event) => {
    e.preventDefault();
    engine.sendBackward(layerId);
    setOpen(false);
  };

  const handleToggleLock = (e: Event) => {
    e.preventDefault();
    engine.toggleLayerLock(layerId);
    setOpen(false);
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant='ghost' size='icon' className='h-6 w-6 p-0 bg-zinc-900/90 hover:bg-zinc-800 rounded' onClick={e => e.stopPropagation()}>
          <MoreVertical size={12} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className='w-48 bg-zinc-900 border-zinc-700'>
        <DropdownMenuItem className='flex items-center gap-2 text-zinc-100 focus:bg-zinc-800 focus:text-zinc-100 cursor-pointer' onSelect={handleDuplicate}>
          <Copy size={14} />
          复制
        </DropdownMenuItem>

        <DropdownMenuItem className='flex items-center gap-2 text-red-400 focus:bg-zinc-800 focus:text-red-400 cursor-pointer' onSelect={handleDelete}>
          <Trash2 size={14} />
          删除
        </DropdownMenuItem>

        <DropdownMenuSeparator className='bg-zinc-800' />

        <DropdownMenuItem className='flex items-center gap-2 text-zinc-100 focus:bg-zinc-800 focus:text-zinc-100 cursor-pointer' onSelect={handleToggleLock}>
          {layer?.locked ? (
            <>
              <Unlock size={14} />
              解锁
            </>
          ) : (
            <>
              <Lock size={14} />
              锁定
            </>
          )}
        </DropdownMenuItem>

        <DropdownMenuSeparator className='bg-zinc-800' />

        <DropdownMenuItem
          className='flex items-center gap-2 text-zinc-100 focus:bg-zinc-800 focus:text-zinc-100 cursor-pointer data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed'
          onSelect={handleBringToFront}
          disabled={isTop}
        >
          <ChevronsUp size={14} />
          移到顶层
        </DropdownMenuItem>
        <DropdownMenuItem
          className='flex items-center gap-2 text-zinc-100 focus:bg-zinc-800 focus:text-zinc-100 cursor-pointer data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed'
          onSelect={handleBringForward}
          disabled={isTop}
        >
          <ChevronUp size={14} />
          上移一层
        </DropdownMenuItem>

        <DropdownMenuItem
          className='flex items-center gap-2 text-zinc-100 focus:bg-zinc-800 focus:text-zinc-100 cursor-pointer data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed'
          onSelect={handleSendBackward}
          disabled={isBottom}
        >
          <ChevronDown size={14} />
          下移一层
        </DropdownMenuItem>

        <DropdownMenuItem
          className='flex items-center gap-2 text-zinc-100 focus:bg-zinc-800 focus:text-zinc-100 cursor-pointer data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed'
          onSelect={handleSendToBack}
          disabled={isBottom}
        >
          <ChevronsDown size={14} />
          移到底层
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
});

LayerContextMenu.displayName = 'LayerContextMenu';
