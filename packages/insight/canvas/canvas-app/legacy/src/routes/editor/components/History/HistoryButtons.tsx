/**
 * 历史记录按钮组件
 *
 * 📚 参考: Vue Fabric Editor history.vue
 *
 * 特性:
 * - 显示撤销/重做按钮及可用次数
 * - 自动禁用不可用状态
 * - 支持快捷键提示
 * - 暗黑主题适配
 */

import { Undo2, Redo2 } from 'lucide-react';
import { useHistory } from '../../hooks/useHistory';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

export function HistoryButtons() {
  const { canUndo, canRedo, undoCount, redoCount, undo, redo } = useHistory();
  // console.log('this---canUndo', canUndo, undoCount, redoCount);

  return (
    <TooltipProvider delayDuration={300}>
      <div className='flex items-center gap-1'>
        {/* 撤销按钮 */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant='ghost' size='icon' disabled={!canUndo} onClick={undo} className='h-9 w-9 transition-all hover:scale-105 disabled:opacity-30'>
              <Undo2 className='h-4 w-4' />
            </Button>
          </TooltipTrigger>
          <TooltipContent side='bottom' className='text-xs'>
            <p>
              撤销 ({undoCount}) <kbd className='ml-1'>Ctrl+Z</kbd>
            </p>
          </TooltipContent>
        </Tooltip>

        {/* 重做按钮 */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant='ghost' size='icon' disabled={!canRedo} onClick={redo} className='h-9 w-9 transition-all hover:scale-105 disabled:opacity-30'>
              <Redo2 className='h-4 w-4' />
            </Button>
          </TooltipTrigger>
          <TooltipContent side='bottom' className='text-xs'>
            <p>
              重做 ({redoCount}) <kbd className='ml-1'>Ctrl+Shift+Z</kbd>
            </p>
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}
