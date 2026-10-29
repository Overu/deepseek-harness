import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { useColor, ColorService, type IColor, ColorPicker } from 'react-color-palette';
import 'react-color-palette/css';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Pipette } from 'lucide-react';
import { Tooltip, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

import styles from './shared.module.less';
import { cn } from '@/lib/utils';

// ---------- 类型定义 ----------

interface ColorPickerButtonProps {
  /** 当前颜色值（HEX 格式，如 "#ff0000" 或带透明度 "#ff000080"） */
  color: string;
  /** 颜色变更回调，返回完整 IColor 对象 */
  onChange: (color: IColor) => void;
  /** 可选标签文字 */
  label?: string;
  /** 是否显示透明度控制（默认 true） */
  showAlpha?: boolean;
  /** 是否显示颜色吸取器按钮（默认 true，仅 Chromium 浏览器可用） */
  showEyeDropper?: boolean;
  /** 颜色面板高度（默认 160） */
  height?: number;
  /** 自定义 className */
  className?: string;
  /** 颜色面板弹出方向 */
  side?: 'top' | 'right' | 'bottom' | 'left';
  /** 颜色面板对齐方式 */
  align?: 'start' | 'center' | 'end';
  /** 触发器样式 */
  triggerVariant?: 'default' | 'swatch';
  /** 颜色面板顶部的自定义内容 */
  contentHeader?: ReactNode;
}

// ---------- EyeDropper API 类型声明 ----------

interface EyeDropperResult {
  sRGBHex: string;
}

interface EyeDropperConstructor {
  new (): {
    open: () => Promise<EyeDropperResult>;
  };
}

declare global {
  interface Window {
    EyeDropper?: EyeDropperConstructor;
  }
}

// ---------- 工具函数 ----------

/** 检测浏览器是否支持 EyeDropper API */
function isEyeDropperSupported(): boolean {
  return typeof window !== 'undefined' && 'EyeDropper' in window;
}

// ---------- 子组件：颜色吸取器按钮 ----------

interface EyeDropperButtonProps {
  onColorPicked: (hex: string) => void;
}

function EyeDropperButton({ onColorPicked }: EyeDropperButtonProps) {
  const [isPicking, setIsPicking] = useState(false);

  const handlePick = useCallback(async () => {
    if (!window.EyeDropper) return;
    setIsPicking(true);
    try {
      const dropper = new window.EyeDropper();
      const result = await dropper.open();
      onColorPicked(result.sRGBHex);
    } catch {
      // 用户按 ESC 取消，忽略
    } finally {
      setIsPicking(false);
    }
  }, [onColorPicked]);

  if (!isEyeDropperSupported()) return null;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant='ghost'
            size='icon'
            className={`h-8 w-8 p-0 rounded transition-colors ${isPicking ? 'bg-zinc-600 text-white' : 'hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200'}`}
            onClick={handlePick}
            disabled={isPicking}
          >
            <Pipette size={18} />
          </Button>
        </TooltipTrigger>
      </Tooltip>
    </TooltipProvider>
  );
}

// ---------- 主组件 ----------

export function ColorPickerButton({
  color,
  onChange,
  label,
  height = 180,
  showAlpha = true,
  showEyeDropper = true,
  className = '',
  side = 'bottom',
  align = 'start',
  triggerVariant = 'default',
  contentHeader,
}: ColorPickerButtonProps) {
  const [colorState, setColorState] = useColor(color);

  // 同步外部 color prop → 内部状态
  useEffect(() => {
    if (color !== colorState.hex) {
      try {
        const newColor = ColorService.convert('hex', color);
        setColorState(newColor);
      } catch {
        // 无效 hex 值，忽略
      }
    }
  }, [color]);

  const handleColorChange = useCallback(
    (newColor: IColor) => {
      setColorState(newColor);
      onChange(newColor);
    },
    [onChange, setColorState]
  );

  const handleEyeDropper = useCallback(
    (hex: string) => {
      try {
        const newColor = ColorService.convert('hex', hex);
        setColorState(newColor);
        onChange(newColor);
      } catch {
        // 无效颜色，忽略
      }
    },
    [onChange, setColorState]
  );

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant='ghost'
          className={cn('h-7 rounded-sm transition-all', triggerVariant === 'swatch' ? 'w-7 p-1' : 'gap-2 !px-2', className)}
          aria-label={label || '选择颜色'}
        >
          {/* 颜色预览块 - 棋盘格背景表示透明度 */}
          <div
            className={cn('rounded', triggerVariant === 'swatch' ? 'h-5 w-5' : 'h-6 w-10')}
            style={{
              backgroundImage:
                'linear-gradient(45deg, #808080 25%, transparent 25%), linear-gradient(-45deg, #808080 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #808080 75%), linear-gradient(-45deg, transparent 75%, #808080 75%)',
              backgroundSize: '6px 6px',
              backgroundPosition: '0 0, 0 3px, 3px -3px, -3px 0px',
            }}
          >
            <div
              className='w-full h-full rounded'
              style={{
                backgroundColor: colorState.hex,
              }}
            />
          </div>
          {triggerVariant === 'default' && label && <span className='text-xs text-muted-foreground'>{label}</span>}
          {triggerVariant === 'default' && <span className='text-xs text-muted-foreground font-mono w-20'>{colorState.hex}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className='w-64 p-2 border-none rounded-xl overflow-hidden shadow-2xl relative' side={side} align={align}>
        {contentHeader}
        {/* 颜色选择面板 */}
        <div className={styles['editor-custom_colorPicker']}>
          <ColorPicker color={colorState} onChange={handleColorChange} hideAlpha={!showAlpha} hideInput={['hsv', 'rgb']} height={height} />
          <div className={styles['color-pen']}>{showEyeDropper && <EyeDropperButton onColorPicked={handleEyeDropper} />}</div>
        </div>
        {/* <div className={styles['editor-custom_colorPicker']}>
          <Saturation
            height={180}
            color={colorState}
            onChange={setColorState}
          />
          <div className='flex gap-2 pr-3'>

            {showEyeDropper && (
              <div className='flex items-center justify-between px-3 py-2 '>
                <div className='flex items-center'>
                  <EyeDropperButton onColorPicked={handleEyeDropper} />
                </div>
              </div>
            )}

            <div
              className={`flex-1 ${styles['editor-custom_colorPicker_bar']}`}
            >
              <Hue color={colorState} onChange={setColorState} />
              <Alpha color={colorState} onChange={setColorState} />
            </div>
          </div>
        </div> */}
      </PopoverContent>
    </Popover>
  );
}
