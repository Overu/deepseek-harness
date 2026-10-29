import { useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight, FileText, Music, Play, Image as ImageIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { FilePreviewItem } from '@/components/common/filePreview';
import { cn } from '@/lib/utils';

interface MediaThumbnailRailProps {
  items: FilePreviewItem[];
  activeIndex: number;
  onSelect: (index: number) => void;
  onPrev: () => void;
  onNext: () => void;
}

const renderFallbackIcon = (item: FilePreviewItem) => {
  if (item.type === 'audio') return <Music className='h-5 w-5' />;
  if (item.type === 'text') return <FileText className='h-5 w-5' />;
  return <ImageIcon className='h-5 w-5' />;
};

export function MediaThumbnailRail({ items, activeIndex, onSelect, onPrev, onNext }: MediaThumbnailRailProps) {
  const railRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    const rail = railRef.current;
    const activeItem = itemRefs.current[activeIndex];
    if (!rail || !activeItem) return;

    const railRect = rail.getBoundingClientRect();
    const itemRect = activeItem.getBoundingClientRect();
    let nextScrollLeft = rail.scrollLeft;

    if (itemRect.left < railRect.left) {
      nextScrollLeft -= railRect.left - itemRect.left;
    } else if (itemRect.right > railRect.right) {
      nextScrollLeft += itemRect.right - railRect.right;
    } else {
      return;
    }

    rail.scrollTo({ left: nextScrollLeft, behavior: 'smooth' });
  }, [activeIndex]);

  return (
    <div className='flex h-28 shrink-0 items-center gap-3 border-t border-white/10 bg-black px-4'>
      <Button
        type='button'
        variant='ghost'
        size='icon'
        className='h-20 w-10 shrink-0 rounded-md bg-white/10 text-white/80 hover:bg-white/15 hover:text-white'
        onClick={onPrev}
        aria-label='上一个资源'
      >
        <ChevronLeft className='h-5 w-5' />
      </Button>

      <div ref={railRef} className='flex min-w-0 flex-1 gap-2 overflow-x-auto py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'>
        {items.map((item, index) => {
          const active = index === activeIndex;
          return (
            <button
              key={item.id}
              ref={element => {
                itemRefs.current[index] = element;
              }}
              type='button'
              className={cn(
                'relative h-20 w-28 shrink-0 overflow-hidden rounded-md border bg-white/10 transition-all duration-200',
                active ? 'border-white' : 'border-white/10 hover:border-white'
              )}
              onClick={() => onSelect(index)}
              aria-label={`查看第 ${index + 1} 个资源`}
              aria-current={active}
            >
              {item.thumbnailUrl ? (
                <img src={item.thumbnailUrl} alt='' loading='lazy' decoding='async' className='h-full w-full object-cover' />
              ) : (
                <span className='flex h-full w-full items-center justify-center text-white/45'>{renderFallbackIcon(item)}</span>
              )}

              {item.type === 'video' && (
                <span className='absolute left-1 top-1 flex h-5 w-5 items-center justify-center rounded bg-black/55 text-white'>
                  <Play className='h-3 w-3 fill-current' />
                </span>
              )}
            </button>
          );
        })}
      </div>

      <Button
        type='button'
        variant='ghost'
        size='icon'
        className='h-20 w-10 shrink-0 rounded-md bg-white/10 text-white/80 hover:bg-white/15 hover:text-white'
        onClick={onNext}
        aria-label='下一个资源'
      >
        <ChevronRight className='h-5 w-5' />
      </Button>
    </div>
  );
}
