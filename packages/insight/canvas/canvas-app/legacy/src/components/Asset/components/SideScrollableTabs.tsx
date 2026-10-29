import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

type OverflowState = { left: boolean; right: boolean };

export type SideScrollableTabsOption<T extends React.Key | null> = {
  label: string;
  value: T;
};

export type SideScrollableTabsProps<T extends React.Key | null> = {
  options: SideScrollableTabsOption<T>[];
  value: T;
  onChange: (val: T) => void;
  showAll?: boolean;
  variant?: 'level1' | 'level2';
};

export function SideScrollableTabs<T extends React.Key | null>({ options, value, onChange, showAll = false, variant = 'level1' }: SideScrollableTabsProps<T>) {
  const tabsRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState<OverflowState>({ left: false, right: false });

  const style = useMemo(() => {
    if (variant === 'level2') {
      return {
        outerClassName: 'relative flex items-center bg-white/10 rounded-lg h-8',
        leftArrowClassName:
          'absolute left-0 top-0 bottom-0 z-10 flex items-center justify-center w-8 pl-0.5 pr-1 cursor-pointer rounded-l-lg bg-[linear-gradient(90deg,_#3c3f57_28%,_#3c3f57_67%,_#3c3f5700_100%)]',
        rightArrowClassName:
          'absolute right-0 top-0 bottom-0 z-10 flex items-center justify-center w-8 pl-1 pr-0.5 cursor-pointer rounded-r-lg bg-[linear-gradient(270deg,_#3c3f57_28%,_#3c3f57_67%,_#3c3f5700_100%)]',
        activeClass: 'text-white',
      };
    }
    return {
      outerClassName: 'relative flex items-center h-8',
      leftArrowClassName:
        'absolute left-0 top-0 bottom-0 z-10 flex items-center justify-center w-8 pl-0.5 pr-1 cursor-pointer bg-[linear-gradient(90deg,_#3c3f57_28%,_#3c3f57_67%,_#3c3f5700_100%)]',
      rightArrowClassName:
        'absolute right-0 top-0 bottom-0 z-10 flex items-center justify-center w-8 pl-1 pr-0.5 cursor-pointer bg-[linear-gradient(270deg,_#3c3f57_28%,_#3c3f57_67%,_#3c3f5700_100%)]',
      activeClass: 'bg-white/10 text-white',
    };
  }, [variant]);

  const activeClass = useMemo(() => style.activeClass, [style.activeClass]);
  const inactiveClass = 'text-white/40 hover:text-white/60';

  const updateOverflow = useCallback(() => {
    const el = tabsRef.current;
    if (!el) {
      setOverflow({ left: false, right: false });
      return;
    }
    setOverflow({
      left: el.scrollLeft > 1,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - 1,
    });
  }, []);

  useEffect(() => {
    updateOverflow();

    const el = tabsRef.current;
    if (!el) return;

    el.addEventListener('scroll', updateOverflow);
    const ro = new ResizeObserver(() => updateOverflow());
    ro.observe(el);

    return () => {
      el.removeEventListener('scroll', updateOverflow);
      ro.disconnect();
    };
  }, [options, updateOverflow]);

  const scrollTabs = useCallback((direction: 'left' | 'right') => {
    const el = tabsRef.current;
    if (!el) return;
    const delta = direction === 'left' ? -200 : 200;
    el.scrollBy({ left: delta, behavior: 'smooth' });
  }, []);

  return (
    <div className={style.outerClassName}>
      <div ref={tabsRef} className='flex-1 min-w-0 flex items-center gap-1 overflow-x-auto no-scrollbar relative group/tabs'>
        {showAll && (
          <button
            onClick={() => onChange(null as T)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${value === null ? activeClass : inactiveClass}`}
          >
            全部
          </button>
        )}
        {options.map(opt => (
          <button
            key={String(opt.value)}
            onClick={() => onChange(opt.value)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${value === opt.value ? activeClass : inactiveClass}`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {overflow.left && (
        <div onClick={() => scrollTabs('left')} className={style.leftArrowClassName}>
          <ChevronLeft size={16} className='text-white/65 hover:text-white/95' />
        </div>
      )}
      {overflow.right && (
        <div onClick={() => scrollTabs('right')} className={style.rightArrowClassName}>
          <ChevronRight size={16} className='text-white/65 hover:text-white/95' />
        </div>
      )}
    </div>
  );
}
