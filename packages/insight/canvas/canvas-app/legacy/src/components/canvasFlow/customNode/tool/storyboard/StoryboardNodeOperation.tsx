import { useEffect, useState, type ReactNode } from 'react';
import { Check, ChevronDown, Copy, Download, Images, LayoutGrid, Loader2, LogOut, Maximize2, Minimize2, Trash2, X } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuPortal, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import pointImage from '@/assets/images/point.png';
import AspectRatioHint from '../../../components/common/AspectRatioHint';
import { MAX_TABLE_COLS, MAX_TABLE_ROWS, STORYBOARD_ASPECT_RATIOS, STORYBOARD_DEFAULT_ASPECT_RATIO, getStoryboardAspectRatioLabel, type StoryboardAspectRatio } from './types';

interface StoryboardNodeOperationProps {
  rowsCount: number;
  colsCount: number;
  editing: boolean;
  expanded: boolean;
  aspectRatio: StoryboardAspectRatio;
  canCompose: boolean;
  composing: boolean;
  /** 仅脚本任务进行中：禁用比例、行列、合成宫格等改表操作（分镜运行中不锁） */
  tableOpsDisabled?: boolean;
  /** 是否处于分镜生成模式 */
  generateMode?: boolean;
  /** 生成分镜按钮 loading（脚本任务 / 分镜任务进行中或创建中） */
  generateLoading?: boolean;
  generatePoint?: number;
  generatePointLoading?: boolean;
  canSubmitGenerate?: boolean;
  /** 生成按钮禁用原因；有值时按钮上方常驻 tooltip */
  generateDisabledReason?: string | null;
  generateParamBar?: ReactNode;
  onEnterGenerateMode?: () => void;
  onCancelGenerateMode?: () => void;
  onSubmitGenerate?: () => void;
  onAspectRatioChange: (ratio: StoryboardAspectRatio) => void;
  onComposeGrid: () => void;
  /** 通知行数变化（失焦/回车）。返回 false 表示待确认，输入保持新值 */
  onRowsCountChange: (next: number) => boolean | void;
  /** 通知列数变化（失焦/回车）。返回 false 表示待确认，输入保持新值 */
  onColsCountChange: (next: number) => boolean | void;
  /** 缩小确认取消时，将对应输入框回退为 value */
  countInputRevert?: { dimension: 'rows' | 'cols'; value: number; token: number };
  onExitEdit: () => void;
  onToggleExpand: () => void;
  onDownloadExcel: () => void;
  onCopy: () => void;
  onDelete: () => void;
}

const numericClamp = (value: number, max: number) => {
  if (Number.isNaN(value)) return 1;
  if (value < 1) return 1;
  if (value > max) return max;
  return Math.floor(value);
};

const StoryboardNodeOperation = ({
  rowsCount,
  colsCount,
  editing,
  expanded,
  aspectRatio,
  canCompose,
  composing,
  tableOpsDisabled = false,
  generateMode = false,
  generateLoading = false,
  generatePoint = 0,
  generatePointLoading = false,
  canSubmitGenerate = false,
  generateDisabledReason = null,
  generateParamBar,
  onEnterGenerateMode,
  onCancelGenerateMode,
  onSubmitGenerate,
  onAspectRatioChange,
  onComposeGrid,
  onRowsCountChange,
  onColsCountChange,
  countInputRevert,
  onExitEdit,
  onToggleExpand,
  onDownloadExcel,
  onCopy,
  onDelete,
}: StoryboardNodeOperationProps) => {
  const [rowsInput, setRowsInput] = useState(String(rowsCount));
  const [colsInput, setColsInput] = useState(String(colsCount));
  const currentRatio = STORYBOARD_ASPECT_RATIOS.includes(aspectRatio) ? aspectRatio : STORYBOARD_DEFAULT_ASPECT_RATIO;

  useEffect(() => {
    setRowsInput(String(rowsCount));
  }, [rowsCount]);

  useEffect(() => {
    setColsInput(String(colsCount));
  }, [colsCount]);

  useEffect(() => {
    if (!countInputRevert) return;
    if (countInputRevert.dimension === 'rows') {
      setRowsInput(String(countInputRevert.value));
    } else {
      setColsInput(String(countInputRevert.value));
    }
  }, [countInputRevert?.token]);

  const commitRows = () => {
    if (tableOpsDisabled) {
      setRowsInput(String(rowsCount));
      return;
    }
    const next = numericClamp(Number(rowsInput), MAX_TABLE_ROWS);
    if (next !== rowsCount) {
      const applied = onRowsCountChange(next);
      if (applied === false) {
        setRowsInput(String(next));
        return;
      }
    }
    setRowsInput(String(next));
  };

  const commitCols = () => {
    if (tableOpsDisabled) {
      setColsInput(String(colsCount));
      return;
    }
    const next = numericClamp(Number(colsInput), MAX_TABLE_COLS);
    if (next !== colsCount) {
      const applied = onColsCountChange(next);
      if (applied === false) {
        setColsInput(String(next));
        return;
      }
    }
    setColsInput(String(next));
  };

  const composeDisabled = !canCompose || composing || tableOpsDisabled;
  const composeButton = (
    <button
      type='button'
      disabled={composeDisabled}
      onClick={e => {
        e.stopPropagation();
        if (composeDisabled) return;
        onComposeGrid();
      }}
      className='h-8 px-2.5 rounded-lg text-xs flex items-center gap-1.5 text-white/85 hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent'
    >
      {composing ? <Loader2 size={16} className='animate-spin' /> : <LayoutGrid size={16} />}
      合成宫格
    </button>
  );

  /** 右侧固定操作：下载 / 复制 / 展开收起 / 删除（常规栏与分镜生成模式共用） */
  const rightActionButtons = (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            onClick={e => {
              e.stopPropagation();
              onDownloadExcel();
            }}
            className='w-8 h-8 flex items-center justify-center cursor-pointer rounded-lg hover:bg-white/10 text-white/85'
          >
            <Download size={20} />
          </div>
        </TooltipTrigger>
        <TooltipContent>下载</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <div
            onClick={e => {
              e.stopPropagation();
              onCopy();
            }}
            className='w-8 h-8 flex items-center justify-center cursor-pointer rounded-lg hover:bg-white/10 text-white/85'
          >
            <Copy size={20} />
          </div>
        </TooltipTrigger>
        <TooltipContent>复制</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <div
            onClick={e => {
              e.stopPropagation();
              onToggleExpand();
            }}
            className='w-8 h-8 flex items-center justify-center cursor-pointer rounded-lg hover:bg-white/10 text-white/85'
          >
            {expanded ? <Minimize2 size={20} /> : <Maximize2 size={20} />}
          </div>
        </TooltipTrigger>
        <TooltipContent>{expanded ? '收起' : '展开'}</TooltipContent>
      </Tooltip>

      <Separator className='mx-1 bg-white/65 h-4 shrink-0' orientation='vertical' />

      <Tooltip>
        <TooltipTrigger asChild>
          <div
            onClick={e => {
              e.stopPropagation();
              onDelete();
            }}
            className='w-8 h-8 flex items-center justify-center cursor-pointer rounded-lg hover:bg-red-500/20 text-red-400'
          >
            <Trash2 size={20} />
          </div>
        </TooltipTrigger>
        <TooltipContent>删除</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );

  if (generateMode) {
    const generateButton = (
      <button
        type='button'
        disabled={!canSubmitGenerate || generateLoading}
        onClick={e => {
          e.stopPropagation();
          if (!canSubmitGenerate || generateLoading) return;
          onSubmitGenerate?.();
        }}
        className='h-8 px-3 rounded-lg bg-[#4155F0] hover:bg-[#4155F0]/90 text-white text-xs flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-[#4155F0]'
      >
        {generateLoading ? <Loader2 size={14} className='animate-spin' /> : <Check size={14} />}
        <span>生成分镜</span>
        <span className='flex items-center gap-0.5 ml-0.5'>
          <img src={pointImage} alt='' className='w-3.5 h-3.5' />
          {generatePointLoading ? <Loader2 size={12} className='animate-spin' /> : <span>{generatePoint}</span>}
        </span>
      </button>
    );

    return (
      <div className='flex items-center nodrag nopan h-10 gap-2 p-1 rounded-lg bg-[#262626] border border-white/10'>
        <span className='h-8 px-3 flex items-center text-white/65 text-xs whitespace-nowrap'>当前模式不支持修改表格内容</span>

        <Separator className='mx-1 bg-white/65 h-4 shrink-0' orientation='vertical' />

        {generateParamBar}

        <Separator className='mx-1 bg-white/65 h-4 shrink-0' orientation='vertical' />

        <button
          type='button'
          onClick={e => {
            e.stopPropagation();
            onCancelGenerateMode?.();
          }}
          className='h-8 px-2.5 rounded-lg text-xs flex items-center gap-1.5 text-white/85 hover:bg-white/10'
        >
          <X size={16} />
          取消
        </button>

        {generateDisabledReason && !generateLoading ? (
          <TooltipProvider>
            <Tooltip open>
              <TooltipTrigger asChild>{generateButton}</TooltipTrigger>
              <TooltipContent side='top' className='bg-black border-white/10 text-white px-3 py-2 shadow-2xl rounded-xl'>
                {generateDisabledReason}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : (
          generateButton
        )}

        <Separator className='mx-1 bg-white/65 h-4 shrink-0' orientation='vertical' />

        {rightActionButtons}
      </div>
    );
  }

  return (
    <div className='flex items-center nodrag nopan h-10 gap-2 p-1 rounded-lg bg-[#262626] border border-white/10'>
      {editing ? (
        <button
          onClick={e => {
            e.stopPropagation();
            onExitEdit();
          }}
          className='h-8 px-3 rounded-lg bg-[#4155F0] hover:bg-[#4155F0]/90 text-white text-xs flex items-center gap-1.5'
        >
          <LogOut size={14} />
          退出编辑
        </button>
      ) : (
        <span className='h-8 px-3 flex items-center text-white/65 text-xs'>双击表格进入编辑状态</span>
      )}

      <Separator className='mx-1 bg-white/65 h-4 shrink-0' orientation='vertical' />

      <div className='flex items-center gap-1.5'>
        <span className='text-white/95 text-xs shrink-0'>比例</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild disabled={tableOpsDisabled}>
            <button
              type='button'
              disabled={tableOpsDisabled}
              onClick={e => e.stopPropagation()}
              className='h-8 min-w-[88px] px-2 rounded-lg bg-black/45 hover:bg-black/55 text-white text-xs flex items-center justify-between gap-1.5 outline-none disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-black/45'
            >
              <span className='flex items-center gap-1.5 min-w-0'>
                {currentRatio !== 'custom' ? <AspectRatioHint ratio={currentRatio} /> : null}
                <span className='truncate'>{getStoryboardAspectRatioLabel(currentRatio)}</span>
              </span>
              <ChevronDown className='w-3 h-3 opacity-40 shrink-0' />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuPortal>
            <DropdownMenuContent
              className='min-w-36 w-auto bg-[#1A1A1A] border border-white/10 rounded-lg shadow-2xl z-[9999] p-1'
              align='start'
              onClick={e => e.stopPropagation()}
            >
              {STORYBOARD_ASPECT_RATIOS.map((ratio, index) => (
                <DropdownMenuItem
                  key={ratio}
                  onSelect={() => {
                    if (tableOpsDisabled) return;
                    onAspectRatioChange(ratio);
                  }}
                  className={`px-3 py-2 hover:bg-white/5 outline-none rounded-md text-sm cursor-pointer flex items-center justify-between gap-2 data-[highlighted]:bg-white/5 ${
                    index === 0 ? 'mb-1 border-b border-dashed border-white/15 rounded-b-none pb-2.5' : ''
                  }`}
                >
                  <span className='flex items-center gap-2 whitespace-nowrap'>
                    {ratio !== 'custom' ? <AspectRatioHint ratio={ratio} /> : <span className='inline-flex h-3.5 w-3.5 shrink-0' />}
                    <span className={currentRatio === ratio ? 'text-[#4155F0]' : 'text-white/90'}>{getStoryboardAspectRatioLabel(ratio)}</span>
                  </span>
                  {currentRatio === ratio ? <Check className='w-3.5 h-3.5 text-[#4155F0] shrink-0' /> : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenuPortal>
        </DropdownMenu>
      </div>

      <div className='flex items-center gap-1'>
        <Input
          value={rowsInput}
          disabled={tableOpsDisabled}
          onChange={e => setRowsInput(e.target.value.replace(/[^0-9]/g, ''))}
          onBlur={commitRows}
          onKeyDown={e => {
            e.stopPropagation();
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
          className='w-12 h-8 text-center bg-black/45 text-white rounded-lg disabled:opacity-40'
        />
        <span className='text-white/95 text-xs'>行</span>
        <Input
          value={colsInput}
          disabled={tableOpsDisabled}
          onChange={e => setColsInput(e.target.value.replace(/[^0-9]/g, ''))}
          onBlur={commitCols}
          onKeyDown={e => {
            e.stopPropagation();
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
          className='w-12 h-8 text-center bg-black/45 text-white rounded-lg disabled:opacity-40'
        />
        <span className='text-white/95 text-xs'>列</span>
      </div>

      <Separator className='mx-1 bg-white/65 h-4 shrink-0' orientation='vertical' />

      {!canCompose && !composing ? (
        <TooltipProvider delayDuration={0}>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className='inline-flex'>{composeButton}</span>
            </TooltipTrigger>
            <TooltipContent side='top' className='bg-black border-white/10 text-white px-3 py-2 shadow-2xl rounded-xl'>
              该功能仅支持表格内，有且只有图片时使用
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        composeButton
      )}

      <button
        type='button'
        disabled={generateLoading}
        onClick={e => {
          e.stopPropagation();
          if (generateLoading) return;
          onEnterGenerateMode?.();
        }}
        className='h-8 px-2.5 rounded-lg text-xs flex items-center gap-1.5 text-white/85 hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent'
      >
        {generateLoading ? <Loader2 size={16} className='animate-spin' /> : <Images size={16} />}
        生成分镜
      </button>

      <Separator className='mx-1 bg-white/65 h-4 shrink-0' orientation='vertical' />

      {rightActionButtons}
    </div>
  );
};

export default StoryboardNodeOperation;
