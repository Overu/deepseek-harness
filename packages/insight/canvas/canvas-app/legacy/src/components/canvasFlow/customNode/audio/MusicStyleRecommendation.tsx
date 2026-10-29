import { getRandomConfigOptions, type ConfigOption } from '@/api/workflow';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { RefreshCcw } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MusicStyleOption } from './types';

interface MusicStyleRecommendationProps {
  selectedStyleIds: number[];
  onSelect: (item: MusicStyleOption) => void;
}

const REQUEST_COUNT = 12;
const REFRESH_WIDTH = 34;
const ITEM_GAP = 8;
const ITEM_HORIZONTAL_PADDING = 20;

const estimateItemWidth = (name: string) => {
  let width = ITEM_HORIZONTAL_PADDING;
  for (const char of name) width += (char.codePointAt(0) || 0) <= 0xff ? 7 : 14;
  return width;
};

const MusicStyleRecommendation = ({ selectedStyleIds, onSelect }: MusicStyleRecommendationProps) => {
  const [cachedItems, setCachedItems] = useState<MusicStyleOption[]>([]);
  const [containerWidth, setContainerWidth] = useState(0);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const requestIdRef = useRef(0);
  const selectedStyleIdsRef = useRef(selectedStyleIds);
  selectedStyleIdsRef.current = selectedStyleIds;

  const loadStyles = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    const selectedIds = selectedStyleIdsRef.current;
    setLoading(true);
    try {
      const response: any = await getRandomConfigOptions({ type: 'music-style', selectedIds, count: REQUEST_COUNT });
      if (requestId !== requestIdRef.current) return;
      const source = (response?.data || response?.body || []) as ConfigOption[];
      const unique = new Map<number, MusicStyleOption>();
      source.forEach(item => {
        if (selectedIds.includes(item.id)) return;
        unique.set(item.id, { id: item.id, name: item.nameZh, value: item.nameEn });
      });
      setCachedItems(Array.from(unique.values()));
    } catch {
      return;
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStyles();
  }, [loadStyles]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const updateWidth = () => setContainerWidth(element.clientWidth);
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setCachedItems(items => items.filter(item => !selectedStyleIds.includes(item.id)));
  }, [selectedStyleIds]);

  const visibleItems = useMemo(() => {
    const availableWidth = Math.max(0, containerWidth - REFRESH_WIDTH);
    let usedWidth = 0;
    return cachedItems.filter(item => {
      const nextWidth = estimateItemWidth(item.name) + (usedWidth ? ITEM_GAP : 0);
      if (usedWidth + nextWidth > availableWidth) return false;
      usedWidth += nextWidth;
      return true;
    });
  }, [cachedItems, containerWidth]);

  const handleSelect = (item: MusicStyleOption) => {
    setCachedItems(items => items.filter(candidate => candidate.id !== item.id));
    onSelect(item);
  };

  return (
    <section className='border-t border-white/25 px-4 py-4' aria-labelledby='music-style-recommendation-title'>
      <h3 id='music-style-recommendation-title' className='mb-2 text-sm text-white/90'>
        音乐风格推荐(多选)
      </h3>
      <div ref={containerRef} className='flex min-w-0 items-center gap-2 overflow-hidden'>
        <TooltipProvider delayDuration={100}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type='button'
                className='flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white/10 text-white/80 transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 disabled:cursor-not-allowed disabled:opacity-40'
                disabled={loading}
                onClick={() => void loadStyles()}
                aria-label='换一批音乐风格'
              >
                <RefreshCcw className={cn('h-4 w-4', loading && 'animate-spin')} />
              </button>
            </TooltipTrigger>
            <TooltipContent>换一批</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        {visibleItems.map(item => (
          <button
            key={item.id}
            type='button'
            className='h-6 shrink-0 rounded-md bg-white/15 px-2 text-xs text-white/90 transition-colors hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60'
            onClick={() => handleSelect(item)}
          >
            {item.name}
          </button>
        ))}
      </div>
    </section>
  );
};

export default memo(MusicStyleRecommendation);
