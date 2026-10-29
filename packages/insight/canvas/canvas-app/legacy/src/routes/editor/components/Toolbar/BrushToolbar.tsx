import { useEditorEngine } from '../../hooks/useEditorEngine';
import { useEditorStore } from '../../store/editorStore';
import { PropertyBar, PropertyItem, PropertyColorPop, PropertySeparator } from '../common/PropertyBar';
import { Slider } from '@/components/ui/slider';
import { type IColor } from 'react-color-palette';
import { LineSquiggle } from 'lucide-react';

export function BrushToolbar() {
  const engine = useEditorEngine();
  const { activeTool, brushSettings, setBrushSettings } = useEditorStore();

  const updateSettings = (partial: Partial<typeof brushSettings>) => {
    setBrushSettings(partial);
    engine.setBrushSettings(partial);
  };

  return (
    <PropertyBar className='animate-in fade-in slide-in-from-top-2 duration-200 px-4'>
      {/* 大小 */}
      <PropertyItem>
        <div className='flex items-center gap-2 w-36'>
          <span className='text-xs text-white whitespace-nowrap'>大小</span>
          <Slider value={[brushSettings.width]} min={1} max={100} step={1} className='flex-1 cursor-pointer' onValueChange={([val]) => updateSettings({ width: val })} />
          <span className='text-[10px] text-zinc-500 tabular-nums w-8 text-right'>{brushSettings.width}px</span>
        </div>
      </PropertyItem>

      {/* 硬度 */}
      <PropertyItem>
        <div className='flex items-center gap-2 w-36'>
          <span className='text-xs text-white whitespace-nowrap'>硬度</span>
          <Slider value={[brushSettings.hardness]} min={1} max={100} step={1} className='flex-1 cursor-pointer' onValueChange={([val]) => updateSettings({ hardness: val })} />
          <span className='text-[10px] text-zinc-500 tabular-nums w-8 text-right'>{brushSettings.hardness}%</span>
        </div>
      </PropertyItem>

      {activeTool === 'draw' && (
        <>
          <PropertySeparator />
          <span className='text-xs text-white whitespace-nowrap'>颜色</span>
          <PropertyColorPop
            color={brushSettings.color}
            onChange={(c: IColor) => {
              updateSettings({ color: c.hex });
            }}
          />
        </>
      )}
    </PropertyBar>
  );
}
