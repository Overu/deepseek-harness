import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { DndContext, DragOverlay, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import { restrictToHorizontalAxis } from '@dnd-kit/modifiers';
import { SortableContext, arrayMove, rectSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ChevronLeft, ChevronRight, Eye, GripVerticalIcon, Plus, Trash2 } from 'lucide-react';

import type { CommunityWorkMedia } from '@/api/community';
import MediaPreview from '@/components/common/MediaPreview';
import { cn } from '@/lib/utils';
import { compressImage } from '@/utils';

import { getThumbnailScrollState } from './imageWorkUploadScroll';
import type { ThumbnailScrollState } from './imageWorkUploadScroll';

interface ImageWorkUploadAreaProps {
  mediaList: CommunityWorkMedia[];
  readonly?: boolean;
  onMediaListChange: (items: CommunityWorkMedia[]) => void;
  onAddClick: () => void;
}

interface SortableImageThumbProps {
  id: string;
  item: CommunityWorkMedia;
  selected: boolean;
  onSelect: (id: string) => void;
}

const getSortableId = (item: CommunityWorkMedia) => item.id || item.media_url;

const normalizeSortOrder = (items: CommunityWorkMedia[]) => items.map((item, index) => ({ ...item, sort_order: index }));

const THUMBNAIL_SCROLL_DISTANCE = (44 + 8) * 2;
const THUMBNAIL_SCROLL_END_DELAY = 600;

function ImageThumbView({ item, selected = false, active = false }: { item: CommunityWorkMedia; selected?: boolean; active?: boolean }) {
  return (
    <div
      className={cn(
        'group/thumb h-11 w-11 shrink-0 overflow-hidden rounded-lg border transition-[transform,border-color,background-color,padding] duration-150',
        selected ? 'border-white bg-white p-[2px]' : 'border-white/18 bg-black/45 hover:border-white/70',
        active && 'scale-105 border-white'
      )}
    >
      <div className={cn('relative h-full w-full overflow-hidden rounded-md border', selected ? 'border-black' : 'border-transparent')}>
        <img
          src={compressImage(item.media_url, 96)}
          alt=''
          className={cn('h-full w-full select-none object-cover group-hover/thumb:brightness-75', active && 'brightness-75')}
          draggable={false}
          loading='lazy'
          decoding='async'
          crossOrigin='anonymous'
        />
        <div
          className={cn(
            'pointer-events-none absolute inset-0 flex items-center justify-center bg-black/35 text-white opacity-0 transition-opacity duration-150 group-hover/thumb:opacity-100',
            active && 'bg-black/25 opacity-100'
          )}
        >
          <GripVerticalIcon className='h-4 w-4 drop-shadow' />
        </div>
      </div>
    </div>
  );
}

const SortableImageThumb = memo(function SortableImageThumb({ id, item, selected, onSelect }: SortableImageThumbProps) {
  const [pressed, setPressed] = useState(false);
  const draggedRef = useRef(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: 1,
    zIndex: isDragging ? 30 : undefined,
    willChange: isDragging ? 'transform' : undefined,
  };

  useEffect(() => {
    if (isDragging) {
      draggedRef.current = true;
    }
    if (!isDragging) setPressed(false);
  }, [isDragging]);

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className='cursor-grab select-none touch-none active:cursor-grabbing'
      aria-label='选择图片或拖拽调整顺序'
      aria-pressed={selected}
      onPointerDown={event => {
        draggedRef.current = false;
        setPressed(true);
        listeners?.onPointerDown?.(event);
      }}
      onPointerUp={() => setPressed(false)}
      onPointerCancel={() => setPressed(false)}
      onPointerLeave={() => {
        if (!isDragging) setPressed(false);
      }}
      onClick={() => {
        if (draggedRef.current) {
          draggedRef.current = false;
          return;
        }
        onSelect(id);
      }}
      onKeyDown={event => {
        if (event.key === 'Enter') {
          event.preventDefault();
          onSelect(id);
          return;
        }
        listeners?.onKeyDown?.(event);
      }}
    >
      <ImageThumbView item={item} selected={selected} active={isDragging || pressed} />
    </div>
  );
});

export function ImageWorkUploadArea({ mediaList, readonly = false, onMediaListChange, onAddClick }: ImageWorkUploadAreaProps) {
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedPreviewId, setSelectedPreviewId] = useState<string | null>(() => (mediaList[0] ? getSortableId(mediaList[0]) : null));
  const [thumbAreaHovered, setThumbAreaHovered] = useState(false);
  const [thumbnailScrollState, setThumbnailScrollState] = useState<ThumbnailScrollState>({
    hasOverflow: false,
    canScrollLeft: false,
    canScrollRight: false,
  });
  const [thumbnailScrolling, setThumbnailScrolling] = useState(false);
  const thumbnailScrollRef = useRef<HTMLDivElement>(null);
  const thumbnailScrollEndTimerRef = useRef<number | null>(null);
  const primaryMedia = mediaList[0];
  const sortableIds = useMemo(() => mediaList.map(getSortableId), [mediaList]);
  const previewUrls = useMemo(() => mediaList.map(item => item.media_url), [mediaList]);
  const activeItem = useMemo(() => mediaList.find(item => getSortableId(item) === activeId), [activeId, mediaList]);
  const selectedPreviewIndex = useMemo(() => {
    const index = selectedPreviewId ? sortableIds.indexOf(selectedPreviewId) : -1;
    return index >= 0 ? index : 0;
  }, [selectedPreviewId, sortableIds]);
  const thumbAreaActive = thumbAreaHovered || Boolean(activeId);
  const showMainActions = !thumbAreaActive;
  const mainActionsVisible = showMainActions && !readonly;
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 1,
      },
    })
  );

  useEffect(() => {
    setSelectedPreviewId(current => {
      if (current && mediaList.some(item => getSortableId(item) === current)) {
        return current;
      }
      return mediaList[0] ? getSortableId(mediaList[0]) : null;
    });
  }, [mediaList]);

  const updateThumbnailScrollState = useCallback(() => {
    const scrollContainer = thumbnailScrollRef.current;
    if (!scrollContainer) return;

    const nextState = getThumbnailScrollState(scrollContainer.scrollLeft, scrollContainer.clientWidth, scrollContainer.scrollWidth);

    setThumbnailScrollState(current => {
      if (current.hasOverflow === nextState.hasOverflow && current.canScrollLeft === nextState.canScrollLeft && current.canScrollRight === nextState.canScrollRight) {
        return current;
      }
      return nextState;
    });
  }, []);

  useEffect(() => {
    updateThumbnailScrollState();
    window.addEventListener('resize', updateThumbnailScrollState);
    return () => window.removeEventListener('resize', updateThumbnailScrollState);
  }, [mediaList.length, updateThumbnailScrollState]);

  useEffect(
    () => () => {
      if (thumbnailScrollEndTimerRef.current !== null) {
        window.clearTimeout(thumbnailScrollEndTimerRef.current);
      }
    },
    []
  );

  const handlePreview = useCallback(
    (index: number) => {
      if (!previewUrls[index]) return;
      setPreviewIndex(index);
    },
    [previewUrls]
  );

  const handleDelete = useCallback(
    (index: number) => {
      onMediaListChange(normalizeSortOrder(mediaList.filter((_, itemIndex) => itemIndex !== index)));
    },
    [mediaList, onMediaListChange]
  );

  const handleThumbnailContainerScroll = useCallback(() => {
    updateThumbnailScrollState();
    setThumbnailScrolling(true);

    if (thumbnailScrollEndTimerRef.current !== null) {
      window.clearTimeout(thumbnailScrollEndTimerRef.current);
    }
    thumbnailScrollEndTimerRef.current = window.setTimeout(() => {
      setThumbnailScrolling(false);
      thumbnailScrollEndTimerRef.current = null;
    }, THUMBNAIL_SCROLL_END_DELAY);
  }, [updateThumbnailScrollState]);

  const handleThumbnailScroll = useCallback((direction: 'left' | 'right') => {
    thumbnailScrollRef.current?.scrollBy({
      left: direction === 'left' ? -THUMBNAIL_SCROLL_DISTANCE : THUMBNAIL_SCROLL_DISTANCE,
      behavior: 'smooth',
    });
  }, []);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setThumbAreaHovered(true);
    setActiveId(String(event.active.id));
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveId(null);
      if (readonly) return;
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const oldIndex = sortableIds.indexOf(String(active.id));
      const newIndex = sortableIds.indexOf(String(over.id));
      if (oldIndex < 0 || newIndex < 0) return;

      onMediaListChange(normalizeSortOrder(arrayMove(mediaList, oldIndex, newIndex)));
    },
    [mediaList, onMediaListChange, readonly, sortableIds]
  );

  const handleDragCancel = useCallback(() => {
    setActiveId(null);
  }, []);

  if (!primaryMedia) return null;

  const selectedMedia = mediaList[selectedPreviewIndex] || primaryMedia;

  const dragOverlay =
    typeof document === 'undefined'
      ? null
      : createPortal(
          <DragOverlay dropAnimation={null} zIndex={10000}>
            {activeItem ? <ImageThumbView item={activeItem} selected={getSortableId(activeItem) === selectedPreviewId} active /> : null}
          </DragOverlay>,
          document.body
        );

  return (
    <>
      <div className='group relative aspect-video w-full overflow-hidden rounded-md bg-black/80'>
        <img
          src={selectedMedia.media_url + '?x-oss-process=image/auto-orient,1/resize,l_450,limit_1/format,webp'}
          alt='作品预览'
          className={cn('h-full w-full object-cover transition-[filter,transform] duration-200', mainActionsVisible && 'group-hover:scale-[1.03] group-hover:blur-[2px]')}
          draggable={false}
        />
        <div className={cn('pointer-events-none absolute inset-0 bg-black/45 opacity-0 transition-opacity duration-200', mainActionsVisible && 'group-hover:opacity-100')} />

        <div
          className={cn(
            'pointer-events-none absolute right-3 top-3 flex gap-2 opacity-0 transition-opacity duration-200 focus-within:pointer-events-auto focus-within:opacity-100',
            mainActionsVisible && 'group-hover:pointer-events-auto group-hover:opacity-100'
          )}
        >
          <button
            type='button'
            className='inline-flex h-9 w-9 items-center justify-center rounded-md bg-black/55 text-white backdrop-blur-sm transition-colors hover:bg-black/72'
            onClick={() => handlePreview(selectedPreviewIndex)}
            aria-label='预览图片'
          >
            <Eye className='h-4 w-4' />
          </button>
          <button
            type='button'
            className='inline-flex h-9 w-9 items-center justify-center rounded-md bg-black/55 text-white backdrop-blur-sm transition-colors hover:bg-black/72'
            onClick={() => handleDelete(selectedPreviewIndex)}
            aria-label='删除图片'
          >
            <Trash2 className='h-4 w-4' />
          </button>
        </div>

        <button
          type='button'
          className={cn(
            'pointer-events-none absolute -mt-5 left-1/2 top-1/2 inline-flex -translate-x-1/2 -translate-y-1/2 flex-col items-center text-base text-white opacity-0 transition-opacity duration-200 focus-visible:pointer-events-auto focus-visible:opacity-100',
            mainActionsVisible && 'group-hover:pointer-events-auto group-hover:opacity-100'
          )}
          onClick={onAddClick}
        >
          <Plus className='h-8 w-8' />
          继续添加
        </button>

        {mediaList.length > 1 && !readonly && (
          <div
            className='absolute bottom-4 left-1/2 z-20 flex max-w-[calc(100%-32px)] -translate-x-1/2 items-center rounded-xl bg-black/85 px-2 py-2 backdrop-blur-md'
            onPointerEnter={() => setThumbAreaHovered(true)}
            onPointerLeave={() => setThumbAreaHovered(false)}
          >
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              modifiers={[restrictToHorizontalAxis]}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onDragCancel={handleDragCancel}
            >
              <SortableContext items={sortableIds} strategy={rectSortingStrategy}>
                <SortableImageThumb id={sortableIds[0]} item={mediaList[0]} selected={selectedPreviewId === sortableIds[0]} onSelect={setSelectedPreviewId} />
                <span className='mx-3 h-8 w-px shrink-0 bg-white/65' />
                <div className='relative max-w-[195px] min-w-0 overflow-hidden'>
                  <div
                    ref={thumbnailScrollRef}
                    className={cn(
                      'flex max-w-[195px] min-w-0 gap-2 overflow-x-auto scroll-smooth [scrollbar-color:transparent_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-transparent [&::-webkit-scrollbar-thumb]:transition-colors [&::-webkit-scrollbar-track]:bg-transparent',
                      thumbnailScrollState.hasOverflow && thumbnailScrolling && '[scrollbar-color:rgba(255,255,255,0.55)_transparent] [&::-webkit-scrollbar-thumb]:bg-white/55'
                    )}
                    onScroll={handleThumbnailContainerScroll}
                  >
                    {mediaList.slice(1).map((item, index) => {
                      const realIndex = index + 1;
                      return (
                        <SortableImageThumb
                          key={sortableIds[realIndex]}
                          id={sortableIds[realIndex]}
                          item={item}
                          selected={selectedPreviewId === sortableIds[realIndex]}
                          onSelect={setSelectedPreviewId}
                        />
                      );
                    })}
                  </div>
                  {thumbnailScrollState.hasOverflow && (
                    <>
                      <button
                        type='button'
                        className={cn(
                          'absolute inset-y-0 left-0 z-10 inline-flex w-6 items-center justify-center bg-gradient-to-l from-transparent via-black/70 to-black text-white transition-opacity duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/80',
                          thumbnailScrollState.canScrollLeft ? 'opacity-100' : 'pointer-events-none opacity-0'
                        )}
                        onClick={() => handleThumbnailScroll('left')}
                        disabled={!thumbnailScrollState.canScrollLeft}
                        aria-label='向左查看更多图片'
                      >
                        <ChevronLeft className='h-[18px] w-[18px]' />
                      </button>
                      <button
                        type='button'
                        className={cn(
                          'absolute inset-y-0 right-0 z-10 inline-flex w-6 items-center justify-center bg-gradient-to-r from-transparent via-black/70 to-black text-white transition-opacity duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/80',
                          thumbnailScrollState.canScrollRight ? 'opacity-100' : 'pointer-events-none opacity-0'
                        )}
                        onClick={() => handleThumbnailScroll('right')}
                        disabled={!thumbnailScrollState.canScrollRight}
                        aria-label='向右查看更多图片'
                      >
                        <ChevronRight className='h-[18px] w-[18px]' />
                      </button>
                    </>
                  )}
                </div>
              </SortableContext>
              {dragOverlay}
            </DndContext>
          </div>
        )}
      </div>

      <MediaPreview url={previewUrls} type='image' visible={previewIndex !== null} initialIndex={previewIndex ?? 0} onClose={() => setPreviewIndex(null)} />
    </>
  );
}
