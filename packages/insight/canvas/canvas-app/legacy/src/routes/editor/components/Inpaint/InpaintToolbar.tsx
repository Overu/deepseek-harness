import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Eraser, Focus, Loader2, Pointer, PencilLine, Redo2, SquareDashedMousePointer, Undo2, X } from 'lucide-react';
import pointImage from '@/assets/images/point.png';

export type InpaintToolMode = 'default' | 'box' | 'brush' | 'eraser';
export type InpaintResolution = '1K' | '2K' | '4K';

interface InpaintToolbarProps {
  mode: InpaintToolMode;
  brushSize: number;
  prompt: string;
  resolution: InpaintResolution;
  isLoading: boolean;
  isPointsLoading: boolean;
  points: number | string | null;
  canUndo: boolean;
  canRedo: boolean;
  onModeChange: (mode: InpaintToolMode) => void;
  onBrushSizeChange: (value: number) => void;
  onPromptChange: (value: string) => void;
  onResolutionChange: (value: InpaintResolution) => void;
  onUndo: () => void;
  onRedo: () => void;
  onRecenter: () => void;
  onClose: () => void;
  onSend: () => void;
}

const toolButtonClass = (active: boolean) => `h-8 w-8 text-white hover:bg-white/10 ${active ? 'bg-white/15 ring-1 ring-white/20' : 'bg-transparent'}`;
const tooltipContentClass = '!z-[45] border-white/10 bg-[#222]/95 text-white shadow-2xl';

export const InpaintToolbar = ({
  mode,
  brushSize,
  prompt,
  resolution,
  isLoading,
  isPointsLoading,
  points,
  canUndo,
  canRedo,
  onModeChange,
  onBrushSizeChange,
  onPromptChange,
  onResolutionChange,
  onUndo,
  onRedo,
  onRecenter,
  onClose,
  onSend,
}: InpaintToolbarProps) => {
  return (
    <TooltipProvider delayDuration={200}>
      <div className='fixed left-1/2 top-3 z-[42] flex -translate-x-1/2 items-center gap-1 rounded-lg border border-white/10 bg-[#222]/95 px-2 py-1.5 shadow-2xl backdrop-blur-md'>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size='icon' variant='ghost' className={toolButtonClass(mode === 'default')} onClick={() => onModeChange('default')} disabled={isLoading}>
              <Pointer className='h-4 w-4' />
            </Button>
          </TooltipTrigger>
          <TooltipContent side='bottom' className={tooltipContentClass}>
            选择
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button size='icon' variant='ghost' className={toolButtonClass(mode === 'box')} onClick={() => onModeChange('box')} disabled={isLoading}>
              <SquareDashedMousePointer className='h-4 w-4' />
            </Button>
          </TooltipTrigger>
          <TooltipContent side='bottom' className={tooltipContentClass}>
            框选
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button size='icon' variant='ghost' className={toolButtonClass(mode === 'brush')} onClick={() => onModeChange('brush')} disabled={isLoading}>
              <PencilLine className='h-4 w-4' />
            </Button>
          </TooltipTrigger>
          <TooltipContent side='bottom' className={tooltipContentClass}>
            涂抹
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button size='icon' variant='ghost' className={toolButtonClass(mode === 'eraser')} onClick={() => onModeChange('eraser')} disabled={isLoading}>
              <Eraser className='h-4 w-4' />
            </Button>
          </TooltipTrigger>
          <TooltipContent side='bottom' className={tooltipContentClass}>
            橡皮擦
          </TooltipContent>
        </Tooltip>

        <div className='mx-1 h-4 w-px bg-white/20' />

        <div className='flex w-28 items-center gap-2 px-1'>
          <Slider value={[brushSize]} min={4} max={100} step={1} onValueChange={value => onBrushSizeChange(value[0])} disabled={isLoading} />
          <span className='w-6 text-right text-[10px] text-white/60'>{brushSize}</span>
        </div>

        <div className='mx-1 h-4 w-px bg-white/20' />

        <Tooltip>
          <TooltipTrigger asChild>
            <Button size='icon' variant='ghost' className='h-8 w-8 text-white hover:bg-white/10' onClick={onUndo} disabled={isLoading || !canUndo}>
              <Undo2 className='h-4 w-4' />
            </Button>
          </TooltipTrigger>
          <TooltipContent side='bottom' className={tooltipContentClass}>
            撤销
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button size='icon' variant='ghost' className='h-8 w-8 text-white hover:bg-white/10' onClick={onRedo} disabled={isLoading || !canRedo}>
              <Redo2 className='h-4 w-4' />
            </Button>
          </TooltipTrigger>
          <TooltipContent side='bottom' className={tooltipContentClass}>
            前进
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button size='icon' variant='ghost' className='h-8 w-8 text-white hover:bg-white/10' onClick={onRecenter} disabled={isLoading}>
              <Focus className='h-4 w-4' />
            </Button>
          </TooltipTrigger>
          <TooltipContent side='bottom' className={tooltipContentClass}>
            居中视口
          </TooltipContent>
        </Tooltip>
      </div>

      <Button
        size='icon'
        variant='ghost'
        className='fixed right-4 top-4 z-[43] h-9 w-9 rounded-full border border-white/10 bg-[#222]/95 text-white hover:bg-white/10'
        onClick={onClose}
        disabled={isLoading}
      >
        <X className='h-4 w-4' />
      </Button>

      <div className='fixed bottom-8 left-1/2 z-[42] flex w-[min(540px,calc(100vw-32px))] -translate-x-1/2 flex-col gap-2 rounded-lg border border-white/10 bg-[#242424]/95 p-3 shadow-2xl backdrop-blur-md'>
        <textarea
          className='min-h-[62px] resize-none border-none bg-transparent text-sm text-white outline-none placeholder:text-white/35'
          value={prompt}
          onChange={event => onPromptChange(event.target.value)}
          placeholder='描述需要重绘的内容'
          maxLength={500}
          disabled={isLoading}
        />
        <div className='flex items-center justify-between gap-3'>
          <div className='flex items-center gap-2 text-xs text-white/60'>
            <span>输出分辨率</span>
            <Select value={resolution} onValueChange={value => onResolutionChange(value as InpaintResolution)} disabled={isLoading}>
              <SelectTrigger className='h-8 w-[72px] border-none bg-transparent text-xs text-white hover:bg-white/15 focus:ring-0 focus:ring-offset-0'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent className='z-[44] bg-background/95 backdrop-blur-lg'>
                <SelectItem value='1K'>1K</SelectItem>
                <SelectItem value='2K'>2K</SelectItem>
                <SelectItem value='4K'>4K</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Button className='h-8 gap-2 rounded-md px-3 text-xs min-w-20 btn ins-btn-primary' onClick={onSend} disabled={isLoading || isPointsLoading || !prompt.trim()}>
            {isLoading ? (
              <Loader2 className='h-4 w-4 animate-spin' />
            ) : (
              <>
                {isPointsLoading ? (
                  <Loader2 className='h-4 w-4 animate-spin' />
                ) : (
                  <>
                    <img src={pointImage} alt='points' />
                    <span>{points ?? 0}</span>
                  </>
                )}
                <div className='text-white text-xs iconfont icon-send ml-1'></div>
              </>
            )}
          </Button>
        </div>
      </div>
    </TooltipProvider>
  );
};
