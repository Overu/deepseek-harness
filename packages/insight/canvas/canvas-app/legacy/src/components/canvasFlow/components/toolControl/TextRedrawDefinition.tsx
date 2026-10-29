import React, { useEffect, useMemo, useRef, useState } from 'react';
import SendButton from '../promptControl/SendButton';
import Selection from '../promptControl/Selection';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { LoaderCircle, RotateCcw, Trash2 } from 'lucide-react';
import type { OcrInfo, OcrResult } from '../../utils/type';

const resolutionOptions = [
  { value: '1K', label: '1K' },
  { value: '2K', label: '2K' },
  { value: '4K', label: '4K' },
];

interface TextRedrawDefinitionProps {
  ocrInfo?: OcrInfo;
  status: string;
  resolution?: string;
  execute: boolean;
  caculatePoint: number;
  hasImage: boolean;
  onParamsChange?: (params: { resolution?: string }) => void;
  onEditTextsChange: (editTexts: string[]) => void;
  onHoverIndex: (index: number | null) => void;
  onGenerate: () => void;
  permissionDisabled?: boolean;
}

const TextRedrawDefinition: React.FC<TextRedrawDefinitionProps> = ({
  ocrInfo,
  status,
  resolution = '1K',
  execute,
  caculatePoint,
  hasImage,
  onParamsChange,
  onEditTextsChange,
  onHoverIndex,
  onGenerate,
  permissionDisabled = false,
}) => {
  const [selectValue, setSelectValue] = useState<string>(resolution);

  useEffect(() => {
    setSelectValue(resolution);
  }, [resolution]);

  const ocrResult: OcrResult | undefined = ocrInfo?.result;
  const editTexts = ocrResult?.editTexts ?? [];
  const recTexts = ocrResult?.recTexts ?? [];
  const isOcrRunning = ocrInfo?.status === 'running';
  const hasOcrResult = ocrInfo?.status === 'success' && editTexts.length > 0;

  const [draftEditTexts, setDraftEditTexts] = useState<string[]>(editTexts);
  const dirtyRef = useRef(false);

  useEffect(() => {
    // OCR 结果更新时同步草稿；用户正在编辑时不覆盖
    if (dirtyRef.current) return;
    const same = draftEditTexts.length === editTexts.length && draftEditTexts.every((v, i) => v === editTexts[i]);
    if (!same) setDraftEditTexts(editTexts);
  }, [editTexts, draftEditTexts]);

  const allowSend = useMemo(() => {
    if (permissionDisabled || status === 'running' || execute || !hasImage || !hasOcrResult) {
      return false;
    }
    return true;
  }, [permissionDisabled, status, execute, hasImage, hasOcrResult]);

  const handleEditChange = (index: number, value: string) => {
    dirtyRef.current = true;
    const next = [...draftEditTexts];
    next[index] = value;
    setDraftEditTexts(next);
    onEditTextsChange(next);
  };

  const handleClear = (index: number) => {
    dirtyRef.current = true;
    const next = [...draftEditTexts];
    next[index] = '';
    setDraftEditTexts(next);
    onEditTextsChange(next);
  };

  const handleReset = (index: number) => {
    dirtyRef.current = true;
    const next = [...draftEditTexts];
    next[index] = recTexts[index] ?? '';
    setDraftEditTexts(next);
    onEditTextsChange(next);
  };

  const handleResetAll = () => {
    dirtyRef.current = true;
    const next = draftEditTexts.map((_, index) => recTexts[index] ?? '');
    setDraftEditTexts(next);
    onEditTextsChange(next);
  };

  const rowActionBtnClass = 'flex h-5 w-5 shrink-0 items-center justify-center text-white/50 opacity-0 transition-opacity group-hover:opacity-100 hover:text-white';

  const handleResolutionChange = (value: string | number | boolean) => {
    const next = String(value);
    setSelectValue(next);
    onParamsChange?.({ resolution: next });
  };

  return (
    <div className='flex flex-col w-[400px] p-4 gap-3' style={{ userSelect: 'none' }} onMouseLeave={() => onHoverIndex(null)}>
      {(isOcrRunning || hasOcrResult) && (
        <div className='min-h-[48px]'>
          {isOcrRunning ? (
            <div className='flex items-center justify-center gap-2 py-6 rounded-lg bg-white/5 text-white/90 text-sm'>
              <LoaderCircle size={16} className='animate-spin shrink-0' />
              <span>文字解析中...</span>
            </div>
          ) : (
            <div className='max-h-[240px] overflow-y-auto nowheel flex flex-col gap-2 pr-0.5 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/20'>
              {draftEditTexts.map((text, index) => (
                <div
                  key={index}
                  className='group flex items-start rounded-lg border border-white/10 bg-white/[0.06] focus-within:border-white/20 focus-within:bg-white/[0.08] min-h-[40px]'
                  onMouseEnter={() => onHoverIndex(index)}
                  onMouseLeave={() => onHoverIndex(null)}
                >
                  <textarea
                    value={text}
                    rows={1}
                    onKeyDown={e => e.stopPropagation()}
                    className='min-w-0 flex-1 resize-none overflow-hidden border-0 bg-transparent text-white/95 text-sm leading-5 pl-3 py-2.5 pr-1 focus:outline-none'
                    onChange={e => handleEditChange(index, e.target.value)}
                    onBlur={() => {
                      dirtyRef.current = false;
                      onEditTextsChange(draftEditTexts);
                    }}
                    onInput={e => {
                      const target = e.currentTarget;
                      target.style.height = 'auto';
                      target.style.height = `${target.scrollHeight}px`;
                    }}
                  />
                  <div className='mt-2.5 mr-2 flex shrink-0 items-center gap-0.5'>
                    <button type='button' className={rowActionBtnClass} onClick={() => handleReset(index)}>
                      <RotateCcw size={16} />
                    </button>
                    {text.trim() ? (
                      <button type='button' className={rowActionBtnClass} onClick={() => handleClear(index)}>
                        <Trash2 size={16} />
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {(hasOcrResult || isOcrRunning) && (
        <div className='flex items-center justify-between gap-2 pt-1'>
          <div className='flex flex-wrap items-center gap-1 min-w-0'>
            <span className='text-sm text-white/65 whitespace-nowrap'>输出分辨率</span>
            <Selection options={resolutionOptions} label='输出分辨率' value={selectValue} onChange={handleResolutionChange} showDropdownIcon />
          </div>
          {hasOcrResult && (
            <div className='flex shrink-0 items-center gap-2'>
              <TooltipProvider delayDuration={100}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type='button'
                      onClick={handleResetAll}
                      className='flex h-8 w-8 items-center justify-center text-white/65 hover:text-white rounded-lg hover:bg-white/5 transition-colors'
                    >
                      <RotateCcw size={16} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side='top' className='bg-black border-white/10 text-white px-3 py-1.5 text-xs'>
                    重置
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <SendButton isExcute={execute} allowSend={allowSend} caculatePoint={caculatePoint} onClick={onGenerate} />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default TextRedrawDefinition;
