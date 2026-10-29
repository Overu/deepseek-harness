import React, { useState, useRef, useEffect } from 'react';
import { motion, useScroll, useTransform, AnimatePresence } from 'framer-motion';
import type { SelectParam } from '../../utils/util';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../../ui/tooltip';
import Check from '../../components/promptControl/Check';

export interface Option {
  label: string;
  description?: string;
  value: string;
  bgUrl?: string;
}

export interface PresetEditorProps {
  optionMap: Array<SelectParam>;
  valueMap: Record<string, string | boolean> | null;

  onSave: (values: Record<string, any>) => void;
}

function PickerItem({
  option,
  index,
  scrollX,
  centerPosition,
  itemWidth,
  onClick,
  isActive,
  itemRef,
}: {
  key?: React.Key;
  option: Option;
  index: number;
  scrollX: any;
  centerPosition?: number;
  itemWidth: number;
  onClick: () => void;
  isActive: boolean;
  itemRef?: (el: HTMLDivElement | null) => void;
}) {
  const resolvedCenterPosition = centerPosition ?? index * itemWidth;

  const opacity = useTransform(
    scrollX,
    [
      resolvedCenterPosition - itemWidth * 1.5,
      resolvedCenterPosition - itemWidth,
      resolvedCenterPosition,
      resolvedCenterPosition + itemWidth,
      resolvedCenterPosition + itemWidth * 1.5,
    ],
    [0.1, 0.3, 1, 0.3, 0.1]
  );

  const scale = useTransform(scrollX, [resolvedCenterPosition - itemWidth, resolvedCenterPosition, resolvedCenterPosition + itemWidth], [0.85, 1, 0.85]);

  // 居中选择项时卡片变宽(220px)、且 scale=1；非居中时宽 100px、scale=0.85。
  // 用 backgroundSize 补偿：使背景图在两种状态下的视觉大小一致（约 42.5px）。
  const nonActiveBgPx = 100 * 0.5 * 0.85; // 非居中时 50% 再经 scale 0.85 的视觉尺寸
  const bgSizePercent = isActive ? `${(nonActiveBgPx / itemWidth) * 100}%` : '50%';

  const showLabel = isActive || !option.bgUrl;
  const showDescription = isActive && !!option.description;

  return (
    <motion.div
      ref={itemRef}
      className='snap-center shrink-0 flex flex-col items-center justify-center h-full cursor-pointer relative overflow-hidden rounded-xl'
      style={{ width: isActive ? itemWidth : 100, opacity, scale }}
      onClick={onClick}
    >
      {option.bgUrl && (
        <div
          className={`absolute inset-0 z-0 bg-center bg-no-repeat transition-opacity filter brightness-125 contrast-110 saturate-110 ${isActive ? 'opacity-100 blur-md' : 'opacity-100 group-hover:opacity-100'}`}
          style={{
            backgroundImage: `url(${option.bgUrl})`,
            backgroundSize: bgSizePercent,
          }}
        />
      )}
      <div className='relative z-10 flex flex-col items-center justify-center text-center'>
        {showLabel && <div className='text-gray-100 font-semibold text-lg tracking-wide whitespace-nowrap drop-shadow-lg'>{option.label}</div>}
        {showDescription && <div className='text-gray-400 text-xs mt-1 font-light px-2 drop-shadow-md'>{option.description}</div>}
      </div>
    </motion.div>
  );
}

function PickerScrollRow({ options, value, onChange, itemWidth = 220 }: { options: Option[]; value: string; onChange: (val: string) => void; itemWidth?: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { scrollX } = useScroll({ container: containerRef });
  const itemRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [centerPositions, setCenterPositions] = useState<number[]>([]);

  const initialIndex = options.findIndex(o => o.value === value);
  const [activeIndex, setActiveIndex] = useState(initialIndex >= 0 ? initialIndex : 0);

  const [isDragging, setIsDragging] = useState(false);
  const [hasDragged, setHasDragged] = useState(false);
  const [startX, setStartX] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);

  const getScrollLeftForIndex = (index: number) => {
    const container = containerRef.current;
    const el = itemRefs.current[index];
    if (!container || !el) return index * itemWidth;

    const elCenter = el.offsetLeft + el.offsetWidth / 2;
    const containerCenter = container.clientWidth / 2;
    return elCenter - containerCenter;
  };

  const scrollToIndex = (index: number, behavior: ScrollBehavior = 'smooth') => {
    const container = containerRef.current;
    if (!container) return;

    container.scrollTo({
      left: getScrollLeftForIndex(index),
      behavior,
    });
  };

  const rafId = useRef<number | null>(null);

  const getNearestIndexToCenter = () => {
    const container = containerRef.current;
    if (!container) return 0;

    const targetX = container.scrollLeft + container.clientWidth / 2;

    let bestIndex = 0;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let i = 0; i < options.length; i++) {
      const el = itemRefs.current[i];
      if (!el) continue;
      const elCenter = el.offsetLeft + el.offsetWidth / 2;
      const dist = Math.abs(elCenter - targetX);
      if (dist < bestDist) {
        bestDist = dist;
        bestIndex = i;
      }
    }

    return bestIndex;
  };

  const handleScroll = () => {
    if (!containerRef.current) return;

    if (rafId.current != null) cancelAnimationFrame(rafId.current);
    rafId.current = requestAnimationFrame(() => {
      const bestIndex = getNearestIndexToCenter();

      if (bestIndex !== activeIndex && bestIndex >= 0 && bestIndex < options.length) {
        setActiveIndex(bestIndex);
        onChange(options[bestIndex].value);
      }
    });
  };

  useEffect(() => {
    if (containerRef.current && initialIndex >= 0) {
      scrollToIndex(initialIndex, 'auto');
    }
  }, [initialIndex, itemWidth]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const id = requestAnimationFrame(() => {
      const next = options.map((_, i) => getScrollLeftForIndex(i));
      setCenterPositions(next);
    });

    return () => cancelAnimationFrame(id);
  }, [options.length, activeIndex, itemWidth]);

  useEffect(() => {
    return () => {
      if (rafId.current != null) cancelAnimationFrame(rafId.current);
    };
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!containerRef.current) return;
    setIsDragging(true);
    setHasDragged(false);
    setStartX(e.pageX - containerRef.current.offsetLeft);
    setScrollLeft(containerRef.current.scrollLeft);
  };

  const handleMouseLeave = () => {
    if (!isDragging) return;
    setIsDragging(false);
    snapToNearest();
  };

  const handleMouseUp = () => {
    if (!isDragging) return;
    setIsDragging(false);
    snapToNearest();
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !containerRef.current) return;
    e.preventDefault();
    const x = e.pageX - containerRef.current.offsetLeft;
    const walk = (x - startX) * 1.5;
    if (Math.abs(walk) > 5) {
      setHasDragged(true);
    }
    containerRef.current.scrollLeft = scrollLeft - walk;
  };

  const snapToNearest = () => {
    if (!containerRef.current) return;
    const index = getNearestIndexToCenter();
    if (index !== activeIndex) {
      setActiveIndex(index);
      onChange(options[index].value);
    }
    scrollToIndex(index, 'smooth');
  };

  const handleItemClick = (index: number) => {
    if (hasDragged) return;
    if (index !== activeIndex) {
      setActiveIndex(index);
      onChange(options[index].value);
    }
    scrollToIndex(index, 'smooth');
  };

  const lastWheelTime = useRef(0);
  const handleWheel = (e: React.WheelEvent) => {
    if (!containerRef.current) return;

    const now = Date.now();
    if (now - lastWheelTime.current < 150) return; // 节流，避免滚动太快

    const delta = e.deltaY;
    if (Math.abs(delta) < 10) return;

    const direction = delta > 0 ? 1 : -1;
    const currentIndex = activeIndex;
    const nextIndex = Math.max(0, Math.min(options.length - 1, currentIndex + direction));

    if (nextIndex !== currentIndex) {
      lastWheelTime.current = now;
      setActiveIndex(nextIndex);
      onChange(options[nextIndex].value);
      scrollToIndex(nextIndex, 'smooth');
    }
  };

  return (
    <div className='h-20 relative group w-full' onWheel={handleWheel}>
      {/* Center Highlight Background & Ticks */}
      <div
        className='absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[220px] h-full transition-all duration-300 pointer-events-none z-0
      border-l border-r rounded-2xl border-white/25 group-hover:border-[#4155F0]
      [background:linear-gradient(270deg,rgba(255,255,255,0.05)_0%,rgba(255,255,255,0)_55%,rgba(255,255,255,0.1)_97%)]
      group-hover:[background:linear-gradient(270deg,rgba(65,85,240,0.05)_2%,rgba(255,255,255,0)_48%,rgba(65,85,240,0.1)_99%)]'
      >
        <div className='absolute top-0 left-1/2 -translate-x-1/2 w-[2px] h-3 bg-[#4155F0] shadow-[0_0_8px_rgba(59,130,246,0.3)]' />
        <div className='absolute bottom-0 left-1/2 -translate-x-1/2 w-[2px] h-3 bg-[#4155F0] shadow-[0_0_8px_rgba(59,130,246,0.3)]' />
      </div>

      <div
        ref={containerRef}
        onScroll={handleScroll}
        onMouseDown={handleMouseDown}
        onMouseLeave={handleMouseLeave}
        onMouseUp={handleMouseUp}
        onMouseMove={handleMouseMove}
        className={`flex h-full overflow-x-auto no-scrollbar relative z-10 ${isDragging ? 'cursor-grabbing' : 'snap-x snap-mandatory cursor-grab'} group transition-all duration-300
        [background:linear-gradient(270deg,rgba(255,255,255,0)_0%,rgba(255,255,255,0.03)_48%,rgba(255,255,255,0)_100%)]
        hover:[background:linear-gradient(270deg,rgba(65,85,240,0)_4%,rgba(65,144,240,0.25)_52%,rgba(65,85,240,0)_97%)]
        `}
        style={{
          paddingLeft: `calc(50% - ${itemWidth / 2}px)`,
          paddingRight: `calc(50% - ${itemWidth / 2}px)`,
        }}
      >
        {options.map((option, i) => (
          <PickerItem
            key={option.value}
            option={option}
            index={i}
            scrollX={scrollX}
            centerPosition={centerPositions[i]}
            itemWidth={itemWidth}
            onClick={() => handleItemClick(i)}
            isActive={i === activeIndex}
            itemRef={el => {
              itemRefs.current[i] = el;
            }}
          />
        ))}
      </div>
    </div>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className='flex flex-col space-y-1'>
      <span className='text-white/65 text-sm'>{label}</span>
      <span className='text-white/95 text-sm'>{value}</span>
    </div>
  );
}

const CameraControl = ({ optionMap, valueMap, onSave }: PresetEditorProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isEnabled, setIsEnabled] = useState(false);

  // 动态存储各选项的值
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    const initialValues: Record<string, string> = {};
    optionMap.forEach(item => {
      if (valueMap != null && valueMap[item.key] !== undefined) {
        initialValues[item.key] = valueMap[item.key] as string;
      } else if (item.option && item.option.length > 0) {
        // 优先寻找默认值，否则取第一个
        const defaultOpt = item.option.find(o => o.isDefault === 'true' || (o as any).isDefult);
        initialValues[item.key] = defaultOpt ? defaultOpt.value : item.option[0].value;
      }
    });
    setValues(initialValues);

    if (valueMap != null && valueMap['enable'] !== undefined) {
      setIsEnabled(valueMap['enable'] as boolean);
    }
  }, [optionMap, valueMap]);

  const handleValueChange = (key: string, val: string) => {
    setValues(prev => ({ ...prev, [key]: val }));
  };

  const handleSave = () => {
    onSave({
      enable: true,
      ...values,
    });
    setIsEnabled(true);
    setIsOpen(false);
  };

  const handleToggleEnable = (e: React.MouseEvent) => {
    e.stopPropagation();
    const newEnabled = !isEnabled;
    setIsEnabled(newEnabled);
    onSave({
      enable: newEnabled,
      ...values,
    });
  };

  const getOptionName = (options: Option[], val: string) => {
    return options.find(o => o.value === val)?.label || '-';
  };

  return (
    <div className='relative inline-flex flex-col items-center'>
      {/* Trigger Button */}
      <TooltipProvider>
        <Tooltip delayDuration={100}>
          <TooltipTrigger asChild>
            <Check checked={isEnabled} label='摄影参数' onClick={() => setIsOpen(true)} onSwitchClick={handleToggleEnable} activeColor='bg-blue-500' />
          </TooltipTrigger>
          <TooltipContent side='top' className='bg-black border-white/10 text-white px-4 py-2 shadow-2xl mb-2 rounded-xl'>
            <div className='flex items-center text-[13px] whitespace-nowrap tracking-wide'>
              <div className='flex items-center text-gray-200'>
                {optionMap.map((row, index) => {
                  const rawValue = valueMap != null && valueMap[row.key] !== undefined ? String(valueMap[row.key]) : values[row.key] || '';
                  return (
                    <React.Fragment key={row.key}>
                      <span>{getOptionName(row.option as Option[], rawValue)}</span>
                      {index < optionMap.length - 1 && <span className='mx-2 text-gray-500 font-bold'>·</span>}
                    </React.Fragment>
                  );
                })}
              </div>
              <span className={`ml-6 ${isEnabled ? 'text-blue-500' : 'text-gray-500'}`}>{isEnabled ? '已开启' : '未开启'}</span>
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {/* Popover */}
      <AnimatePresence mode='popLayout'>
        {isOpen && <div className='fixed inset-0 z-40' onClick={() => setIsOpen(false)} />}
        {isOpen && (
          <motion.div
            key='popover'
            initial={{ scale: 0.95, opacity: 0, y: 20, x: '-50%' }}
            animate={{ scale: 1, opacity: 1, y: 0, x: '-50%' }}
            exit={{ scale: 0.95, opacity: 0, y: 20, x: '-50%' }}
            style={{ left: '50%' }}
            transition={{ type: 'spring', bounce: 0, duration: 0.4 }}
            className='absolute bottom-full mb-4 z-50 w-[614px] max-w-[90vw] bg-[#0f0f0f] border border-white/20 rounded-2xl flex flex-col shadow-2xl shadow-black/80 overflow-hidden select-none origin-bottom nowheel'
            onClick={e => e.stopPropagation()}
          >
            {/* Picker Area with Row-based structure */}
            <div className='flex flex-col relative gap-3'>
              {optionMap.map(row => (
                <div key={row.key} className='flex group/row relative transition-colors duration-300 hover:bg-white/[0.01]'>
                  <div className='flex-1 overflow-hidden relative'>
                    <PickerScrollRow options={row.option as Option[]} value={values[row.key] || ''} onChange={val => handleValueChange(row.key, val)} itemWidth={220} />
                  </div>
                </div>
              ))}
            </div>

            {/* Bottom Bar */}
            <div className='flex items-center justify-between p-4 bg-[#262626]'>
              <div className='flex space-x-6 overflow-x-auto no-scrollbar max-w-[420px]'>
                {optionMap.map(row => (
                  <SummaryItem key={row.key} label={row.label} value={getOptionName(row.option as Option[], values[row.key] || '')} />
                ))}
              </div>
              <button
                onClick={handleSave}
                className='bg-[#4f46e5] hover:bg-[#4338ca] text-white px-8 py-1.5 rounded-xl font-medium transition-colors shadow-lg shadow-indigo-500/20 active:scale-95 shrink-0'
              >
                保存预设
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default CameraControl;
