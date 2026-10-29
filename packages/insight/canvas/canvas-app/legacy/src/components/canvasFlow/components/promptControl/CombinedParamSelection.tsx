import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { Volume2, VolumeOff } from 'lucide-react';
import { useMemo, useState, type CSSProperties } from 'react';
import AspectRatioHint from '../common/AspectRatioHint';
import DurationSliderControl from './DurationSliderControl';
import { isMediaParamValueUnavailable, getMediaNodeUnavailableParamsTip } from '../../utils/mediaNodeModelUtil';
import { paramValueLookupKey, paramValuesEqual, shouldShowOptionInDropdown } from '../../utils/modelPermission';
import toolUtil from '../../utils/toolUtil';

export interface CombinedOption {
  value: string | number | boolean;
  label: string;
  description?: string;
}

export interface CombinedSection {
  key: string;
  label: string;
  options: CombinedOption[];
  value: string | number | boolean | undefined;
  /** key 为 paramValueLookupKey(option.value) */
  optionMeta?: Record<string, { hidden?: boolean; disabled?: boolean }>;
}

interface CombinedParamSelectionProps {
  nodeId?: string;
  sections: CombinedSection[];
  onChange: (key: string, value: string | number | boolean) => void;
  /** 摘要按钮整体置灰（权限不可用 / 模式不支持） */
  summaryMuted?: boolean;
}

const ASPECT_RATIO_KEY = 'aspect_ratio';
const ENABLE_AUDIO_KEY = 'enableAudio';
const DURATION_KEY = 'duration';

/** 固定每行 5 个（超过 5 自动换行），列数用 inline style 避免 Tailwind 生成限制 */
function optionGridStyle(count: number): CSSProperties {
  if (count <= 0) return {};
  const cols = Math.min(5, count);
  return {
    display: 'grid',
    gap: 2,
    gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
  };
}

function ratioHintSource(value: string | number | boolean, label: string): string {
  const valueStr = String(value);
  if (toolUtil.parseAspectRatio(valueStr)) return valueStr;
  if (toolUtil.parseAspectRatio(label)) return label;
  return label || valueStr;
}

function parseBooleanLike(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (value == null) return null;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  return null;
}

function parseDurationValue(value: string | number | boolean | undefined): number | undefined {
  if (value == null || value === '') return undefined;
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

const CombinedParamSelection = ({ nodeId = 'tool', sections, onChange, summaryMuted }: CombinedParamSelectionProps) => {
  const [open, setOpen] = useState(false);

  const hasUnavailableSelections = useMemo(() => sections.some(sec => isMediaParamValueUnavailable(sec.value, sec.options)), [sections]);
  const paramBlockTip = useMemo(
    () =>
      getMediaNodeUnavailableParamsTip(
        true,
        sections.map(sec => ({ key: sec.key, label: sec.label, option: sec.options })),
        Object.fromEntries(sections.map(sec => [sec.key, sec.value]))
      ),
    [sections]
  );
  const isSummaryMuted = summaryMuted || hasUnavailableSelections;

  const aspectSection = useMemo(() => sections.find(s => s.key === ASPECT_RATIO_KEY), [sections]);
  const aspectValue = aspectSection?.value;
  const aspectSelected = aspectValue ? aspectSection?.options.find(o => o.value === aspectValue) : undefined;

  const summaryParts = useMemo(() => {
    return sections
      .map(sec => {
        if (sec.key === ENABLE_AUDIO_KEY) return '';
        const v = sec.value;
        if (v == null || v === '') return '';
        return sec.options.find(o => paramValuesEqual(o.value, v))?.label ?? v;
      })
      .filter(Boolean);
  }, [sections]);

  const enableAudio = useMemo(() => {
    const section = sections.find(s => s.key === ENABLE_AUDIO_KEY);
    return parseBooleanLike(section?.value);
  }, [sections]);

  const summaryText = summaryParts.join(' · ');
  const enableAudioTooltipText = useMemo(() => {
    if (enableAudio == null) return '';
    return enableAudio ? '生成音频' : '不生成音频';
  }, [enableAudio]);
  const tooltipText = [summaryText, enableAudioTooltipText].filter(Boolean).join(' · ');

  if (sections.length === 0) {
    return null;
  }

  return (
    <TooltipProvider>
      <Tooltip delayDuration={100}>
        <Popover open={open} onOpenChange={setOpen}>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button
                type='button'
                className={cn(
                  'nodrag inline-flex h-9 max-w-full items-center rounded-lg gap-2',
                  'border-none hover:bg-white/10 px-3 text-left text-sm text-white/90',
                  'outline-none transition-colors hover:bg-white/[0.14]',
                  'focus-visible:ring-2 focus-visible:ring-white/20',
                  isSummaryMuted && 'text-white/40'
                )}
              >
                {aspectValue && aspectSelected ? <AspectRatioHint ratio={ratioHintSource(aspectSelected.value, aspectSelected.label)} /> : null}
                <span className='min-w-0 flex-1 truncate'>{summaryText || '参数'}</span>
                {enableAudio != null ? (
                  <span className='inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center text-white/90'>
                    {enableAudio ? <Volume2 size={14} /> : <VolumeOff size={14} />}
                  </span>
                ) : null}
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          <PopoverContent
            align='center'
            sideOffset={8}
            className={cn('w-[450px] max-w-[450px] border border-white/10 bg-[#262626] p-4 text-white shadow-lg')}
            onOpenAutoFocus={e => e.preventDefault()}
          >
            <div className='flex flex-col gap-4'>
              {sections.map(section => {
                const isDuration = section.key === DURATION_KEY;
                const visibleOpts = section.options.filter(opt => shouldShowOptionInDropdown(section.optionMeta, opt.value, section.value));
                const n = visibleOpts.length;
                const curMeta = section.value != null ? section.optionMeta?.[paramValueLookupKey(section.value)] : undefined;
                const sectionValueUnavailable = isMediaParamValueUnavailable(section.value, section.options);
                const sectionLabelMuted = Boolean(curMeta?.hidden || curMeta?.disabled || sectionValueUnavailable);

                if (isDuration) {
                  return (
                    <DurationSliderControl
                      nodeId={nodeId}
                      key={section.key}
                      label={section.label}
                      value={parseDurationValue(section.value)}
                      options={visibleOpts}
                      optionMeta={section.optionMeta}
                      labelMuted={sectionLabelMuted}
                      onChange={val => onChange(section.key, val)}
                    />
                  );
                }

                return (
                  <div key={section.key} className='flex flex-col gap-2'>
                    <div className={cn('text-sm font-medium', sectionLabelMuted ? 'text-white/40' : 'text-white/65')}>{section.label}</div>
                    <div className='relative flex w-full items-center'>
                      <div className='nowheel w-full rounded-lg bg-black/25 p-0.5' style={optionGridStyle(n)}>
                        {visibleOpts.map(opt => {
                          const selected = section.value === opt.value;
                          const isAspect = section.key === ASPECT_RATIO_KEY;
                          const om = section.optionMeta?.[paramValueLookupKey(opt.value)];
                          const optMuted = Boolean(om?.disabled || om?.hidden);
                          return (
                            <button
                              key={paramValueLookupKey(opt.value)}
                              type='button'
                              disabled={Boolean(om?.disabled)}
                              className={cn(
                                'nodrag flex min-h-9 items-center justify-center gap-2 rounded-md px-2 py-1.5 text-sm',
                                'transition-colors hover:bg-white/10',
                                selected && 'bg-white/[0.15]',
                                optMuted && 'text-white/40 opacity-80',
                                om?.disabled && 'cursor-not-allowed'
                              )}
                              onClick={() => {
                                if (om?.disabled) return;
                                if (opt.value !== section.value) {
                                  onChange(section.key, opt.value);
                                }
                              }}
                            >
                              {isAspect ? <AspectRatioHint ratio={ratioHintSource(opt.value, opt.label)} /> : null}
                              <span className={cn('min-w-0 truncate text-left', optMuted ? 'text-white/40' : 'text-white/95')}>{opt.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </PopoverContent>
        </Popover>
        <TooltipContent>
          <p>{paramBlockTip ?? (tooltipText ? `参数选择：${tooltipText}` : '参数选择')}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

export default CombinedParamSelection;
