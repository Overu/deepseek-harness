import { Check, X, Eraser, Paintbrush, RefreshCw, Undo, Redo } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Slider } from '@/components/ui/slider';
import type { MattingBrushMode } from './constants';

interface MattingActionToolbarProps {
  isLoading: boolean;
  brushMode: MattingBrushMode;
  brushSize: number;
  historyIndex: number;
  localHistoryLength: number;
  onAutoMatting: () => void;
  onBrushModeChange: (mode: MattingBrushMode) => void;
  onBrushSizeChange: (value: number[]) => void;
  onBrushSizeCommit: (value: number[]) => void;
  onRefresh: () => void;
  onManualMatting: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}

export function MattingActionToolbar({
  isLoading,
  brushMode,
  brushSize,
  historyIndex,
  localHistoryLength,
  onAutoMatting,
  onBrushModeChange,
  onBrushSizeChange,
  onBrushSizeCommit,
  onRefresh,
  onManualMatting,
  onUndo,
  onRedo,
  onCancel,
  onConfirm,
}: MattingActionToolbarProps) {
  return (
    <div
      className='fixed inset-0 z-[1001] pointer-events-none'
      onClick={e => e.stopPropagation()}
      onDoubleClick={e => {
        e.stopPropagation();
        e.preventDefault();
      }}
      onMouseDown={e => e.stopPropagation()}
      onMouseUp={e => e.stopPropagation()}
      onPointerDown={e => e.stopPropagation()}
      onPointerMove={e => e.stopPropagation()}
      onPointerUp={e => e.stopPropagation()}
    >
      <TooltipProvider>
        {/* 顶部：抠图操作 */}
        <div className='absolute left-1/2 top-6 flex -translate-x-1/2 items-center gap-4 pointer-events-auto'>
          <div className='rounded-xl bg-zinc-800/95 p-1.5 shadow-lg'>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type='button'
                  onClick={onAutoMatting}
                  disabled={isLoading}
                  className='flex h-9 items-center rounded-lg px-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50 chat-send-button'
                >
                  自动抠图
                </button>
              </TooltipTrigger>
              <TooltipContent>
                <p>一键自动抠图</p>
              </TooltipContent>
            </Tooltip>
          </div>

          <div className='flex items-center gap-2 rounded-xl bg-zinc-800/95 p-1.5 shadow-lg'>
            <div role='group' aria-label='画笔模式' className='flex items-center rounded-lg bg-zinc-950/80 p-0.5'>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type='button'
                    onClick={() => onBrushModeChange('keep')}
                    disabled={isLoading}
                    aria-pressed={brushMode === 'keep'}
                    className={`flex h-9 text-nowrap items-center gap-1.5 rounded-md px-2.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                      brushMode === 'keep' ? 'bg-zinc-600 text-white shadow-inner' : 'text-zinc-200 hover:bg-zinc-800'
                    }`}
                  >
                    <Paintbrush size={17} />
                    <span>保留区域</span>
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>涂抹需要保留的主体区域</p>
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type='button'
                    onClick={() => onBrushModeChange('remove')}
                    disabled={isLoading}
                    aria-pressed={brushMode === 'remove'}
                    className={`flex h-9 text-nowrap items-center gap-1.5 rounded-md px-2.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                      brushMode === 'remove' ? 'bg-zinc-600 text-white shadow-inner' : 'text-zinc-200 hover:bg-zinc-800'
                    }`}
                  >
                    <Eraser size={17} />
                    <span>去除区域</span>
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>涂抹需要删除的区域</p>
                </TooltipContent>
              </Tooltip>
            </div>

            <Slider
              value={[brushSize]}
              min={5}
              max={100}
              step={1}
              disabled={isLoading}
              aria-label='画笔大小'
              className='w-28'
              onValueChange={onBrushSizeChange}
              onValueCommit={onBrushSizeCommit}
            />
            <span className='w-9 text-right font-mono text-xs text-zinc-300'>{brushSize}%</span>

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type='button'
                  onClick={onRefresh}
                  disabled={isLoading}
                  className='flex h-9 w-9 items-center justify-center rounded-md text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50'
                >
                  <RefreshCw size={19} />
                </button>
              </TooltipTrigger>
              <TooltipContent side='bottom'>
                <p>清空当前涂抹区域</p>
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type='button'
                  onClick={onManualMatting}
                  disabled={isLoading}
                  className='flex h-9 items-center rounded-lg px-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50 chat-send-button'
                >
                  开始抠图
                </button>
              </TooltipTrigger>
              <TooltipContent side='bottom'>
                <p>基于当前涂抹区域识别抠图</p>
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* 底部：历史与退出操作 */}
        <div className='absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-900/95 px-2 py-1.5 shadow-lg pointer-events-auto'>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type='button'
                onClick={onUndo}
                disabled={isLoading || historyIndex <= 0}
                className='flex h-8 w-8 items-center justify-center rounded text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50'
              >
                <Undo size={18} />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <p>撤销</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type='button'
                onClick={onRedo}
                disabled={isLoading || historyIndex >= localHistoryLength - 1}
                className='flex h-8 w-8 items-center justify-center rounded text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50'
              >
                <Redo size={18} />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <p>重做</p>
            </TooltipContent>
          </Tooltip>

          <div className='mx-1 h-6 w-px bg-zinc-700' />

          <button
            type='button'
            onClick={onCancel}
            disabled={isLoading}
            className='flex h-8 items-center gap-1 rounded px-2 text-sm text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50'
          >
            <X size={17} />
            <span>取消</span>
          </button>

          <button
            type='button'
            onClick={onConfirm}
            disabled={isLoading}
            className='flex h-8 items-center gap-1.5 rounded px-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50 chat-send-button'
          >
            <Check size={17} />
            <span>保存并退出</span>
          </button>
        </div>
      </TooltipProvider>
    </div>
  );
}
