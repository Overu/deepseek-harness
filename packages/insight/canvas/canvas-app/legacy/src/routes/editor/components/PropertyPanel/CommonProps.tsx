import type { Object as FabricObject } from 'fabric';
import { useEditorEngine } from '../../hooks/useEditorEngine';
import { PropertyButton, PropertySeparator, PropertySliderPop } from '../common/PropertyBar';
import { useLayerStore } from '../../store/layerStore';
import { Copy, Trash2, Layers, Blend, ChevronsUp, ChevronUp, ChevronDown, ChevronsDown } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface CommonPropsProps {
  object: FabricObject;
}

export function CommonProps({ object }: CommonPropsProps) {
  const engine = useEditorEngine();
  const layers = useLayerStore(state => state.layers);

  const layerIndex = layers.findIndex(l => l.id === object.id);
  const isTop = layerIndex === 0;
  // If object isn't in layers (e.g. active group/workspace itself), default to false or true safely
  const isBottom = layerIndex !== -1 ? layerIndex === layers.length - 1 : false;

  // const width = object.width
  //   ? Math.round(object.width * (object.scaleX || 1))
  //   : 0;
  // const height = object.height
  //   ? Math.round(object.height * (object.scaleY || 1))
  //   : 0;
  const opacity = Math.round((object.opacity ?? 1) * 100);

  const handleOpacityChange = (val: number) => {
    if (!object.id) return;
    engine.updateObjectProps(object.id, { opacity: val / 100 });
  };

  const handleDuplicate = () => {
    if (!object.id) return;
    engine.duplicateObject(object.id);
  };

  const handleDelete = () => {
    if (!object.id) return;
    const canvas = engine.getCanvas();
    canvas.remove(object);
    canvas.requestRenderAll();
  };

  return (
    <div className='flex items-center gap-0 text-sm'>
      {/* 尺寸显示 */}
      {/* <PropertyItem className='text-[10px] text-muted-foreground'>
        <span>
          {width} × {height}
        </span>
      </PropertyItem> */}

      <PropertySeparator />

      {/* 透明度 */}
      <PropertySliderPop label={<Blend size={14} className='text-white' />} value={opacity} min={0} max={100} onValueChange={handleOpacityChange} tooltip='透明度' />

      {/* 操作按钮 */}
      <div className='flex items-center gap-1'>
        {/* 增加图层设置 */}
        <DropdownMenu>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <PropertyButton>
                    <Layers size={12} />
                  </PropertyButton>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>
                <p>图层顺序</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <DropdownMenuContent className='w-32 bg-zinc-900 border-zinc-700' side='top'>
            <DropdownMenuItem
              className='flex items-center gap-2 text-zinc-100 focus:bg-zinc-800 focus:text-zinc-100 cursor-pointer text-xs data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed'
              onSelect={() => object.id && engine.bringToFront(object.id)}
              disabled={isTop}
            >
              <ChevronsUp size={12} />
              移到顶层
            </DropdownMenuItem>
            <DropdownMenuItem
              className='flex items-center gap-2 text-zinc-100 focus:bg-zinc-800 focus:text-zinc-100 cursor-pointer text-xs data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed'
              onSelect={() => object.id && engine.bringForward(object.id)}
              disabled={isTop}
            >
              <ChevronUp size={12} />
              上移一层
            </DropdownMenuItem>
            <DropdownMenuItem
              className='flex items-center gap-2 text-zinc-100 focus:bg-zinc-800 focus:text-zinc-100 cursor-pointer text-xs data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed'
              onSelect={() => object.id && engine.sendBackward(object.id)}
              disabled={isBottom}
            >
              <ChevronDown size={12} />
              下移一层
            </DropdownMenuItem>
            <DropdownMenuItem
              className='flex items-center gap-2 text-zinc-100 focus:bg-zinc-800 focus:text-zinc-100 cursor-pointer text-xs data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed'
              onSelect={() => object.id && engine.sendToBack(object.id)}
              disabled={isBottom}
            >
              <ChevronsDown size={12} />
              移到底层
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <PropertyButton onClick={handleDuplicate} tooltip='复制'>
          <Copy size={12} />
        </PropertyButton>
        <PropertyButton onClick={handleDelete} className='text-red-400 hover:text-red-300 hover:bg-zinc-800' tooltip='删除'>
          <Trash2 size={12} />
        </PropertyButton>
      </div>
    </div>
  );
}
