import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { paramValueLookupKey, paramValuesEqual } from '../../utils/modelPermission';
import styles from '../index.module.less';
import pointImage from '@/assets/images/point.png';
import vipImage from '@/assets/images/vip.png';
import VipUpgradeOverlay from '../common/VipUpgradeOverlay';

interface Option {
  value: string | number | boolean;
  label: string;
  description?: string;
  point?: string;
}

export interface OptionPermissionMeta {
  hidden?: boolean;
  disabled?: boolean;
  /** [media-node-model-unification] B 类：有权限但当前模式不支持，置灰且无 VIP 遮罩 */
  modeUnsupported?: boolean;
}

interface SelectionProps {
  options: Option[];
  label: string;
  value: string | number | boolean | undefined;
  onChange: (value: string | number | boolean) => void;
  /** key 为 paramValueLookupKey(option.value) */
  optionMeta?: Record<string, OptionPermissionMeta>;
  /** 是否显示下拉箭头（默认不显示，保持现状） */
  showDropdownIcon?: boolean;
  /** 强制触发器置灰（如当前模式不支持模型时 gen_count） */
  forceMuted?: boolean;
}

// 粗略字符宽度（px），用于估算下拉宽度，允许一定冗余
const CHARS_PX = { label: 8, point: 8, description: 10 };
const GAP_LABEL_POINT = 8;
const ICON_WIDTH = 16;
const GAP_ICON_POINT = 4;
const CONTENT_HORIZONTAL_PADDING = 56;

const CANVAS_SELECT_OPEN_ATTR = 'data-canvas-param-select-open';

const Selection = ({ options, label, value, onChange, optionMeta, showDropdownIcon = false, forceMuted = false }: SelectionProps) => {
  const [isHovering, setIsHovering] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [contentWidth, setContentWidth] = useState<number | undefined>(undefined);

  const dropdownOptions = useMemo(() => {
    // 需求：若当前选中的选项在权限中不可见（visible=0 -> hidden=true），下拉列表中也不要展示该选项
    return options.filter(o => !optionMeta?.[paramValueLookupKey(o.value)]?.hidden);
  }, [options, optionMeta, value]);

  const selectValue = value != null && value !== '' ? paramValueLookupKey(value) : '';

  useLayoutEffect(() => {
    const firstLine = (l: string, p: string) => l.length * CHARS_PX.label + (p ? GAP_LABEL_POINT + ICON_WIDTH + GAP_ICON_POINT + p.length * CHARS_PX.point : 0);
    const secondLine = (d: string) => d.length * CHARS_PX.description;

    const maxOptionWidth = dropdownOptions.reduce((acc, option) => {
      const l = option.label ?? '';
      const p = (option.point ?? '').trim();
      const d = option.description ?? '';
      const w1 = firstLine(l, p);
      const w2 = d ? secondLine(d) : 0;
      return Math.max(acc, Math.max(w1, w2));
    }, 0);

    const triggerWidth = triggerRef.current?.offsetWidth ?? 0;
    const w = Math.ceil(Math.max(triggerWidth, maxOptionWidth + CONTENT_HORIZONTAL_PADDING));
    setContentWidth(w > 0 ? w : undefined);
  }, [dropdownOptions]);

  const currentMeta = value != null && value !== '' ? optionMeta?.[paramValueLookupKey(value)] : undefined;
  const triggerMuted = forceMuted || Boolean(currentMeta?.hidden || currentMeta?.disabled);

  useEffect(() => () => document.body.removeAttribute(CANVAS_SELECT_OPEN_ATTR), []);

  const handleOpenChange = (open: boolean) => {
    if (open) {
      document.body.setAttribute(CANVAS_SELECT_OPEN_ATTR, '');
      setIsHovering(false);
    } else {
      document.body.removeAttribute(CANVAS_SELECT_OPEN_ATTR);
    }
  };

  return (
    <TooltipProvider>
      <Tooltip delayDuration={100} open={isHovering}>
        <Select
          value={selectValue}
          onOpenChange={handleOpenChange}
          onValueChange={next => {
            const opt = options.find(o => paramValueLookupKey(o.value) === next);
            if (opt) onChange(opt.value);
          }}
        >
          <TooltipTrigger asChild>
            <SelectTrigger
              ref={triggerRef}
              className={cn(`${styles.customSelect} ${showDropdownIcon ? '' : styles.hideSelectIcon}`, triggerMuted && 'text-white/40')}
              onPointerEnter={() => setIsHovering(true)}
              onPointerLeave={() => setIsHovering(false)}
            >
              {value != null && value !== '' ? (
                <span className={cn('min-w-0 flex-1 truncate text-left', triggerMuted && 'text-white/40')}>
                  {options.find(o => paramValuesEqual(o.value, value))?.label ?? String(value)}
                </span>
              ) : (
                <SelectValue placeholder={label} />
              )}
            </SelectTrigger>
          </TooltipTrigger>
          <SelectContent onCloseAutoFocus={e => e.preventDefault()} style={contentWidth ? { minWidth: contentWidth } : undefined}>
            {dropdownOptions.map(option => {
              const hasRichContent = option.description != null || option.point != null;
              const om = optionMeta?.[paramValueLookupKey(option.value)];
              const itemDisabled = Boolean(om?.disabled);
              const modeUnsupported = Boolean(om?.modeUnsupported);
              const showVipPadding = itemDisabled && !modeUnsupported;
              const pointNode =
                option.point != null && option.point !== '' ? (
                  <span className={cn('flex shrink-0 items-center gap-2 text-xs tabular-nums', itemDisabled ? 'text-white/35' : 'text-white/25')}>
                    <img src={pointImage} alt='' className='h-3 w-3 object-contain opacity-75' />
                    {option.point}
                  </span>
                ) : null;
              return (
                <SelectItem
                  key={paramValueLookupKey(option.value)}
                  value={paramValueLookupKey(option.value)}
                  disabled={itemDisabled}
                  className={cn(
                    'w-full [&>span:first-child]:top-1/2 [&>span:first-child]:-translate-y-1/2',
                    hasRichContent && !itemDisabled && 'py-2',
                    itemDisabled && 'relative !flex items-stretch overflow-hidden !p-0 focus:bg-transparent data-[disabled]:opacity-100 data-[disabled]:focus:bg-transparent'
                  )}
                >
                  <div className={cn('group relative w-full', itemDisabled && 'flex flex-1 flex-col justify-center py-2 pl-8 pr-3', !itemDisabled && hasRichContent && 'py-0')}>
                    {hasRichContent ? (
                      <div
                        className={cn('grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 text-left', showVipPadding && 'pr-6')}
                        style={contentWidth ? { minWidth: contentWidth, width: 'max-content' } : undefined}
                      >
                        <div className='flex min-w-0 items-center gap-2'>
                          <span className={cn('min-w-0 truncate text-sm', itemDisabled ? 'text-white/50' : 'text-white/95')}>{option.label}</span>
                          {showVipPadding && <img src={vipImage} alt='VIP' className='h-4 w-auto shrink-0' />}
                        </div>
                        {pointNode}
                        {option.description != null && option.description !== '' && (
                          <p className={cn('col-span-2 whitespace-nowrap text-xs', itemDisabled ? 'text-white/35' : 'text-white/25')}>{option.description}</p>
                        )}
                      </div>
                    ) : (
                      <div className={cn('grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 text-left', showVipPadding && 'pr-6')}>
                        <div className='flex min-w-0 items-center gap-2'>
                          <span className={cn('min-w-0 truncate', itemDisabled && 'text-white/50')}>{option.label}</span>
                          {showVipPadding && <img src={vipImage} alt='VIP' className='h-4 w-auto shrink-0' />}
                        </div>
                        {pointNode}
                      </div>
                    )}

                    {showVipPadding && <VipUpgradeOverlay variant='select' />}
                  </div>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
        <TooltipContent>
          <p>{label}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

export default Selection;
