import type { Object as FabricObject } from 'fabric';
import { useEditorEngine } from '../../hooks/useEditorEngine';
import { PropertyColorPop } from '../common/PropertyBar';
import { type IColor } from 'react-color-palette';
import { colorWithOpacity, DEFAULT_SHAPE_STYLE, parseShapeColor } from '../../core/utils/shapeUtils';
import { Slider } from '@/components/ui/slider';

interface ShapePropsProps {
  object: FabricObject;
}

export function ShapeProps({ object }: ShapePropsProps) {
  const engine = useEditorEngine();

  const nativeFill = parseShapeColor(object.fill, DEFAULT_SHAPE_STYLE.fillColor, 100);
  const nativeStroke = parseShapeColor(object.stroke, DEFAULT_SHAPE_STYLE.strokeColor, 100);
  const fillColor = object.fillColor === 'transparent' ? DEFAULT_SHAPE_STYLE.fillColor : object.fillColor || nativeFill.color;
  const fillOpacity = object.fillOpacity ?? nativeFill.opacity;
  const strokeColor = object.strokeColor === 'transparent' ? DEFAULT_SHAPE_STYLE.strokeColor : object.strokeColor || nativeStroke.color;
  const strokeOpacity = object.strokeOpacity ?? nativeStroke.opacity;
  const strokeWidth = object.strokeWidth ?? 0;

  const handleFillChange = (newColor: IColor) => {
    if (!object.id) return;
    const nextFill = parseShapeColor(newColor.hex, fillColor, newColor.rgb.a * 100);
    engine.updateObjectProps(object.id, {
      fillColor: nextFill.color,
      fillOpacity: nextFill.opacity,
      fill: colorWithOpacity(nextFill.color, nextFill.opacity),
    });
  };

  const handleStrokeChange = (newColor: IColor) => {
    if (!object.id) return;
    const nextStroke = parseShapeColor(newColor.hex, strokeColor, newColor.rgb.a * 100);
    engine.updateObjectProps(object.id, {
      strokeColor: nextStroke.color,
      strokeOpacity: nextStroke.opacity,
      stroke: colorWithOpacity(nextStroke.color, nextStroke.opacity),
    });
  };

  const handleStrokeWidthChange = (val: number) => {
    if (!object.id) return;
    engine.updateObjectProps(object.id, { strokeWidth: val });
  };

  const strokeWidthControl = (
    <div className='flex flex-col gap-2 px-3 pt-3 pb-4'>
      <div className='flex items-center justify-between text-xs text-muted-foreground'>
        <span>描边宽度</span>
        <span>{strokeWidth}px</span>
      </div>
      <Slider aria-label='描边宽度' value={[strokeWidth]} min={0} max={20} step={1} onValueChange={([value]) => handleStrokeWidthChange(value)} />
    </div>
  );

  return (
    <div className='flex items-center gap-1 text-sm'>
      {/* 填充颜色 */}
      <PropertyColorPop label='填充' color={colorWithOpacity(fillColor, fillOpacity)} onChange={handleFillChange} triggerVariant='swatch' />

      {/* 描边颜色和宽度 */}
      <PropertyColorPop
        label='描边'
        color={colorWithOpacity(strokeColor, strokeOpacity)}
        onChange={handleStrokeChange}
        triggerVariant='swatch'
        contentHeader={strokeWidthControl}
      />
    </div>
  );
}
