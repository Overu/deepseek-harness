import type { Object as FabricObject } from 'fabric';

import { useEditorEngine } from '../../hooks/useEditorEngine';
import { PropertyButton, PropertyColorPop, PropertyPopup, PropertySelect } from '../common/PropertyBar';
import { Slider } from '@/components/ui/slider';
import { type IColor } from 'react-color-palette';
import { Bold, Italic, Underline, Strikethrough, AlignLeft, AlignCenter, AlignRight, TextInitial } from 'lucide-react';

interface TextPropsProps {
  object: FabricObject;
}

const FONT_FAMILIES = ['Arial', 'Helvetica', 'Times New Roman', 'Georgia', 'Courier New', 'Verdana', 'Comic Sans MS'];

const FONT_WEIGHTS = [
  { label: 'ExtraLight', value: '100' },
  { label: 'Light', value: '300' },
  { label: 'Normal', value: '400' },
  { label: 'Medium', value: '500' },
  { label: 'Bold', value: '700' },
  { label: 'Heavy', value: '900' },
];

export function TextProps({ object }: TextPropsProps) {
  const engine = useEditorEngine();

  // @ts-ignore
  const fill = (object.fill as string) || '#000000';
  // @ts-ignore
  const fontFamily = object.fontFamily || 'Arial';
  // @ts-ignore
  const fontSize = object.fontSize || 16;
  // @ts-ignore
  const fontWeight = object.fontWeight || 'normal';
  // @ts-ignore
  const fontStyle = object.fontStyle || 'normal';
  // @ts-ignore
  const underline = object.underline || false;
  // @ts-ignore
  const linethrough = object.linethrough || false;
  // @ts-ignore
  const textAlign = object.textAlign || 'left';
  // @ts-ignore
  const lineHeight = object.lineHeight || 1.16;
  // @ts-ignore
  const charSpacing = object.charSpacing || 0;

  const handleColorChange = (newColor: IColor) => {
    if (!object.id) return;
    engine.updateObjectProps(object.id, { fill: newColor.hex });
  };

  const handleFontFamilyChange = (font: string) => {
    console.log(object, font);
    if (!object.id) return;
    engine.updateObjectProps(object.id, { fontFamily: font } as any);
  };

  const handleFontWeightChange = (weight: string) => {
    if (!object.id) return;
    engine.updateObjectProps(object.id, { fontWeight: Number(weight) } as any);
  };

  const handleFontSizeChange = (val: number) => {
    if (!object.id) return;
    engine.updateObjectProps(object.id, { fontSize: val } as any);
  };

  const handleLineHeightChange = (val: number) => {
    if (!object.id) return;
    engine.updateObjectProps(object.id, { lineHeight: val } as any);
  };

  const handleCharSpacingChange = (val: number) => {
    if (!object.id) return;
    engine.updateObjectProps(object.id, { charSpacing: val } as any);
  };

  const toggleBold = () => {
    if (!object.id) return;
    const currentWeight = typeof fontWeight === 'number' ? fontWeight : fontWeight === 'bold' ? 700 : 400;
    const newWeight = currentWeight >= 700 ? 400 : 700;
    engine.updateObjectProps(object.id, { fontWeight: newWeight } as any);
  };

  const toggleItalic = () => {
    if (!object.id) return;
    const newStyle = fontStyle === 'italic' ? 'normal' : 'italic';
    engine.updateObjectProps(object.id, { fontStyle: newStyle } as any);
  };

  const toggleUnderline = () => {
    if (!object.id) return;
    engine.updateObjectProps(object.id, {
      underline: !underline as boolean,
    } as any);
  };

  const toggleLinethrough = () => {
    if (!object.id) return;
    engine.updateObjectProps(object.id, {
      linethrough: !linethrough as boolean,
    } as any);
  };

  const handleTextAlign = (align: string) => {
    if (!object.id) return;
    engine.updateObjectProps(object.id, { textAlign: align } as any);
  };

  const isBold = fontWeight === 'bold' || fontWeight === 700;
  const isItalic = fontStyle === 'italic';

  // Spacing Content extracted for PropertyPopup
  const spacingContent = (
    <div className='flex flex-col gap-2 px-2'>
      {/* 行距 */}
      <div className='flex flex-col gap-2'>
        <div className='flex justify-between text-[10px] text-muted-foreground font-medium px-0.5'>
          <span>行距</span>
          <span>{lineHeight.toFixed(2)}</span>
        </div>
        <Slider value={[lineHeight]} min={0.5} max={3} step={0.1} className='cursor-pointer' onValueChange={([val]) => handleLineHeightChange(val)} />
      </div>

      {/* 字距 */}
      <div className='flex flex-col gap-2'>
        <div className='flex justify-between text-[10px] text-muted-foreground font-medium px-0.5'>
          <span>字距</span>
          <span>{charSpacing}</span>
        </div>
        <Slider value={[charSpacing]} min={-200} max={800} step={10} className='cursor-pointer' onValueChange={([val]) => handleCharSpacingChange(val)} />
      </div>
    </div>
  );

  return (
    <div className='flex items-center text-sm'>
      {/* 颜色选择器 */}
      <PropertyColorPop color={fill} onChange={handleColorChange} />

      {/* 字体 */}
      <PropertySelect value={fontFamily} onValueChange={handleFontFamilyChange} options={FONT_FAMILIES.map(font => ({ label: font, value: font }))} className='w-32 border-none' />

      {/* 字重 */}
      <PropertySelect
        value={typeof fontWeight === 'number' ? String(fontWeight) : fontWeight === 'bold' ? '700' : '400'}
        onValueChange={handleFontWeightChange}
        options={FONT_WEIGHTS}
        className='w-24 border-none -ml-4'
      />

      {/* 字号 */}
      {/* <PropertySliderPop
        label='字号'
        value={fontSize}
        min={8}
        max={200}
        suffix='px'
        onValueChange={handleFontSizeChange}
        className='h-6'
      /> */}

      {/* 样式按钮 */}
      <div className='flex items-center gap-1 -ml-4'>
        <PropertyButton isActive={isBold} onClick={toggleBold} tooltip='加粗'>
          <Bold size={14} />
        </PropertyButton>
        <PropertyButton isActive={isItalic} onClick={toggleItalic} tooltip='斜体'>
          <Italic size={14} />
        </PropertyButton>
        <PropertyButton isActive={underline} onClick={toggleUnderline} tooltip='下划线'>
          <Underline size={14} />
        </PropertyButton>
        <PropertyButton isActive={linethrough} onClick={toggleLinethrough} tooltip='删除线'>
          <Strikethrough size={14} />
        </PropertyButton>
        {/* 对齐方式 */}
        <PropertyButton isActive={textAlign === 'left'} onClick={() => handleTextAlign('left')} tooltip='左对齐'>
          <AlignLeft size={14} />
        </PropertyButton>
        <PropertyButton isActive={textAlign === 'center'} onClick={() => handleTextAlign('center')} tooltip='居中对齐'>
          <AlignCenter size={14} />
        </PropertyButton>
        <PropertyButton isActive={textAlign === 'right'} onClick={() => handleTextAlign('right')} tooltip='右对齐'>
          <AlignRight size={14} />
        </PropertyButton>
        {/* <PropertyButton
          isActive={textAlign === 'justify'}
          onClick={() => handleTextAlign('justify')}
          tooltip='两端对齐'
        >
          <AlignJustify size={14} />
        </PropertyButton> */}
      </div>

      {/* 行间距 Popover utilizing PropertyPopup */}
      <PropertyPopup
        trigger={
          <PropertyButton tooltip='间距设置'>
            <TextInitial size={14} />
          </PropertyButton>
        }
        content={spacingContent}
        contentClassName='w-48 bg-zinc-900 border-zinc-700'
      />
    </div>
  );
}
