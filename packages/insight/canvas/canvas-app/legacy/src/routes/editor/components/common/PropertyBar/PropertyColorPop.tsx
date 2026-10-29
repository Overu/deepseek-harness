import type { ReactNode } from 'react';
import { type IColor } from 'react-color-palette';
import { ColorPickerButton } from '../../shared/ColorPickerButton';
import { cn } from '@/lib/utils';

interface PropertyColorPopProps {
  label?: string;
  color: string; // hex
  onChange: (color: IColor) => void;
  className?: string;
  /** 是否显示透明度控制 */
  showAlpha?: boolean;
  /** 是否显示颜色吸取器 */
  showEyeDropper?: boolean;
  triggerVariant?: 'default' | 'swatch';
  contentHeader?: ReactNode;
}

export function PropertyColorPop({ label, color, onChange, className, showAlpha = true, showEyeDropper = true, triggerVariant, contentHeader }: PropertyColorPopProps) {
  return (
    <ColorPickerButton
      color={color}
      onChange={onChange}
      label={label}
      showAlpha={showAlpha}
      showEyeDropper={showEyeDropper}
      className={cn(className)}
      triggerVariant={triggerVariant}
      contentHeader={contentHeader}
    />
  );
}
