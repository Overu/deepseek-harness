import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';
import { createAgentEditorDebounce } from '../../../../../../src/agent-editor-debounce';
import { markAgentEditorBusy } from '../../../../../../src/agent-edit-guard';
import { useCallback, useEffect, useMemo, useRef, useState, useId } from 'react';
import { paramValueLookupKey } from '../../utils/modelPermission';
import type { CombinedOption } from './CombinedParamSelection';

function parseDurationValues(options: CombinedOption[]): number[] {
  const nums = options.map(o => Number(o.value)).filter(n => Number.isFinite(n));
  return [...new Set(nums)].sort((a, b) => a - b);
}

function snapToNearest(n: number, values: number[]): number {
  return values.reduce((best, v) => (Math.abs(v - n) < Math.abs(best - n) ? v : best));
}

/** 单选项左侧文案：仅支持*秒，* 优先用选项描述/标签 */
function formatSingleSupportText(option: CombinedOption | undefined, num: number): string {
  const desc = option?.description?.trim();
  const raw = desc || String(option?.label ?? '').trim() || String(num);
  const body = raw.replace(/秒$/u, '');
  return `仅支持${body}秒`;
}

/** 与 ui/slider Thumb（h-4 w-4）一致；Radix 在两端会内收半个 thumb，气泡需同样补偿 */
const SLIDER_THUMB_SIZE_PX = 16;

function thumbCenterLeft(percent: number): string {
  const p = Math.min(100, Math.max(0, percent));
  // center = p% * (W - thumb) + thumb/2  →  calc(p% + (0.5 - p/100) * thumb)
  return `calc(${p}% + ${(0.5 - p / 100) * SLIDER_THUMB_SIZE_PX}px)`;
}

const SLIDER_COMMIT_DELAY_MS = 1000;

interface DurationSliderControlProps {
  nodeId: string;
  label: string;
  value: number | undefined;
  options: CombinedOption[];
  optionMeta?: Record<string, { hidden?: boolean; disabled?: boolean }>;
  labelMuted?: boolean;
  onChange: (value: number) => void;
}

const DurationSliderControl = ({ nodeId, label, value, options, optionMeta, labelMuted, onChange }: DurationSliderControlProps) => {
  const inputEditorId = `${nodeId}:duration:input:${useId()}`;
  const values = useMemo(() => parseDurationValues(options), [options]);
  const [isFocused, setIsFocused] = useState(false);
  const [draft, setDraft] = useState('');

  const hasValues = values.length > 0;
  const isSingle = values.length === 1;
  const min = values[0] ?? 0;
  const max = values[values.length - 1] ?? 0;

  const rawNum = Number(value);
  const committed = hasValues ? (Number.isFinite(rawNum) ? snapToNearest(rawNum, values) : min) : min;

  /** 滑条拖动即时 UI；停拖 1s 后再写入 params */
  const [localValue, setLocalValue] = useState(committed);
  const localValueRef = useRef(localValue);
  const committedRef = useRef(committed);
  const onChangeRef = useRef(onChange);
  localValueRef.current = localValue;
  committedRef.current = committed;
  onChangeRef.current = onChange;

  const pendingCommitRef = useRef(false);

  type DebouncedCommit = ((next: number) => void | undefined) & {
    cancel: () => void;
    flush: (next: number) => void | undefined;
  };

  // onChange 经 ref 调用，避免父组件内联函数导致防抖实例反复重建
  const debouncedCommit = useMemo(
    () =>
      createAgentEditorDebounce(`${nodeId}:duration`, (next: number) => {
        pendingCommitRef.current = false;
        onChangeRef.current(next);
      }, SLIDER_COMMIT_DELAY_MS) as DebouncedCommit,
    [nodeId]
  );

  // 外部 value 不在正式选项中时吸附到最近合法值
  useEffect(() => {
    if (!hasValues) return;
    const num = Number(value);
    if (value == null || !Number.isFinite(num) || num !== committed) {
      onChange(committed);
    }
  }, [hasValues, value, committed, onChange]);

  // 外部 committed 变化且无待提交防抖时，同步本地展示
  useEffect(() => {
    if (pendingCommitRef.current) return;
    setLocalValue(committed);
  }, [committed]);

  useEffect(() => {
    if (!isFocused) {
      setDraft(String(localValue));
    }
  }, [localValue, isFocused]);

  // 卸载时 flush，避免关闭 Popover 丢失最后一次滑条选择
  useEffect(() => {
    return () => {
      if (localValueRef.current !== committedRef.current) {
        debouncedCommit.flush(localValueRef.current);
      } else {
        debouncedCommit.cancel();
      }
      pendingCommitRef.current = false;
      markAgentEditorBusy(inputEditorId, false);
    };
  }, [debouncedCommit, inputEditorId]);

  const disabled = useMemo(() => {
    if (!hasValues) return true;
    if (value != null) {
      const meta = optionMeta?.[paramValueLookupKey(value)];
      if (meta?.disabled) return true;
    }
    return false;
  }, [hasValues, value, optionMeta]);

  const localIndex = hasValues ? Math.max(0, values.indexOf(localValue)) : 0;
  const sliderDisabled = disabled || isSingle;
  const thumbPercent = isSingle || values.length <= 1 ? 100 : (localIndex / (values.length - 1)) * 100;

  const singleOption = isSingle ? options.find(o => Number(o.value) === values[0]) : undefined;
  const singleSupportText = isSingle ? formatSingleSupportText(singleOption, values[0]) : '';

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value.replace(/\D/g, '').slice(0, 2);
    setDraft(next);
    markAgentEditorBusy(inputEditorId, true);
  }, [inputEditorId]);

  const handleInputBlur = useCallback(() => {
    setIsFocused(false);
    if (!hasValues) { markAgentEditorBusy(inputEditorId, false); return; }

    // 取消防抖，避免稍后滑条提交覆盖输入框结果
    debouncedCommit.cancel();
    pendingCommitRef.current = false;

    const parsed = parseInt(draft, 10);
    const next = draft === '' || Number.isNaN(parsed) ? committed : snapToNearest(parsed, values);

    setLocalValue(next);
    setDraft(String(next));
    if (next !== committed) {
      onChange(next);
    }
    markAgentEditorBusy(inputEditorId, false);
  }, [draft, hasValues, values, committed, onChange, debouncedCommit, inputEditorId]);

  /** 阻止方向键冒泡，避免画布微平移 */
  const handleInputKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.stopPropagation();
    }
  }, []);

  const handleSliderChange = useCallback(
    (next: number[]) => {
      const idx = next[0];
      const snapped = values[idx];
      if (snapped == null) return;
      setLocalValue(snapped);
      if (!isFocused) {
        setDraft(String(snapped));
      }
      if (snapped !== committedRef.current) {
        pendingCommitRef.current = true;
        debouncedCommit(snapped);
      } else {
        debouncedCommit.cancel();
        pendingCommitRef.current = false;
      }
    },
    [values, isFocused, debouncedCommit]
  );

  if (!hasValues) {
    return (
      <div className='flex flex-col gap-2'>
        <div className={cn('text-sm font-medium', labelMuted ? 'text-white/40' : 'text-white/65')}>{label}</div>
        <div className='text-sm text-white/40'>暂无可选时长</div>
      </div>
    );
  }

  return (
    <div className='flex flex-col gap-2'>
      <div className={cn('text-sm font-medium', labelMuted ? 'text-white/40' : 'text-white/65')}>{label}</div>
      <div className='flex items-center gap-3'>
        <div className='relative min-w-0 flex-1 pt-5 pb-1'>
          <div className='pointer-events-none absolute top-0 z-10 -translate-x-1/2' style={{ left: thumbCenterLeft(thumbPercent) }}>
            <div className='relative rounded bg-black px-1.5 py-0.5 text-xs tabular-nums text-white'>
              {localValue}
              <span className='absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-black' />
            </div>
          </div>
          {isSingle ? (
            <Slider className='nodrag nowheel' value={[1]} min={0} max={1} step={1} disabled={sliderDisabled} />
          ) : (
            <Slider className='nodrag nowheel' value={[localIndex]} min={0} max={values.length - 1} step={1} disabled={sliderDisabled} onValueChange={handleSliderChange} />
          )}
          <div className='mt-1 flex justify-between text-xs text-white/40'>
            <span>{isSingle ? singleSupportText : min}</span>
            <span>{max}</span>
          </div>
        </div>
        <div className={cn('flex h-9 shrink-0 items-center rounded-lg bg-black/25 px-2.5', disabled && 'opacity-50')}>
          <input
            type='text'
            inputMode='numeric'
            maxLength={2}
            disabled={disabled}
            value={draft}
            className='nodrag w-6 bg-transparent text-right text-sm tabular-nums text-white/95 outline-none disabled:cursor-not-allowed'
            onFocus={() => setIsFocused(true)}
            onChange={handleInputChange}
            onBlur={handleInputBlur}
            onKeyDown={handleInputKeyDown}
          />
          <span className='ml-0.5 text-sm text-white/40'>s</span>
        </div>
      </div>
    </div>
  );
};

export default DurationSliderControl;
