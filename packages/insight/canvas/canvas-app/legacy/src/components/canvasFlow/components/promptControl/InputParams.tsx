import { DndContext, closestCenter } from '@dnd-kit/core';
import { arrayMove, SortableContext, rectSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Eye, Music4, Play, X } from 'lucide-react';
import { useMemo, useState, useRef, memo, useCallback, useEffect } from 'react';
import type { FilePreviewItem } from '@/components/common/filePreview';
import { compressImage, formatDuration } from '@/utils';
import type { MediaInputItem, TextInputItem } from '../../utils/util';
import audioIcon from '@/assets/images/audio_black.png';
import { useFlowStore } from '@/store/flowStore';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { getVideoDurationFromUrl } from '@/utils/mediaDuration';
import { getAudioDuration } from '../toolControl/AudioClip';
import { InputParamsPreview } from './InputParamsPreview';

interface ImageMapItem {
  edgeId: string;
  value: string;
}

interface InputParamsProp {
  textMap: TextInputItem[];
  imageMap: ImageMapItem[];
  /** 传入时展示图/视频/音频统一条（竖线分隔）；不传则仅展示 imageMap */
  mediaMap?: MediaInputItem[];
  /** 视频缩略图叠加红色遮罩（如时长不合规） */
  invalidVideoOverlay?: boolean;
  onImageOrderChange?: (newOrder: ImageMapItem[]) => void;
  onMediaOrderChange?: (newOrder: MediaInputItem[]) => void;
}

interface PreviewState {
  items: FilePreviewItem[];
  initialIndex: number;
  videoAutoPlay?: boolean;
}

const getReactFlowGeneratedEdgeId = (edge: { source: string; sourceHandle?: string | null; target: string; targetHandle?: string | null }) =>
  `xy-edge__${edge.source}${edge.sourceHandle || ''}-${edge.target}${edge.targetHandle || ''}`;

const getVideoPoster = (src: string, width = 64) => `${src}?x-oss-process=video/snapshot,t_0,f_jpg,w_${width},m_fast`;

const toPlainText = (markdown: string) =>
  markdown
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#{1,6}\s+|^>\s?|^[-*+]\s+|^\d+\.\s+/gm, '')
    .replace(/(\*\*|__|~~|\*)(.*?)\1/g, '$2')
    .replace(/\s+/g, ' ')
    .trim();

// 可排序的媒体项（图 / 视频首帧预览 / 音频占位图）
const SortableMediaItem = memo(
  ({
    id,
    kind,
    displaySrc,
    displayIndex,
    previewIndex,
    title,
    onPreview,
    onDelete,
    showInvalidOverlay,
  }: {
    id: string;
    kind: MediaInputItem['kind'];
    displaySrc: string;
    displayIndex: number;
    previewIndex: number;
    title?: string;
    onPreview: (kind: MediaInputItem['kind'], src: string, previewIndex: number) => void;
    onDelete: (edgeId: string) => void;
    showInvalidOverlay?: boolean;
  }) => {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });

    const [isHovered, setIsHovered] = useState(false);
    const [isTrashHovered, setIsTrashHovered] = useState(false);
    const [mediaDuration, setMediaDuration] = useState<number | null>(null);
    const mouseDownTimeRef = useRef<number>(0);
    const isClickRef = useRef<boolean>(false);
    const dragStartedRef = useRef<boolean>(false);
    const trashDeletedRef = useRef<boolean>(false);

    const style = {
      transform: CSS.Transform.toString(transform),
      transition,
      opacity: isDragging ? 0.5 : 1,
    };

    // 视频/音频连入：读取时长，用于 Tooltip「mm:ss 节点名」
    useEffect(() => {
      if (kind !== 'video' && kind !== 'audio') {
        setMediaDuration(null);
        return;
      }
      if (!displaySrc) {
        setMediaDuration(null);
        return;
      }

      let cancelled = false;
      setMediaDuration(null);

      if (kind === 'video') {
        getVideoDurationFromUrl(displaySrc).then(duration => {
          if (!cancelled) setMediaDuration(duration && duration > 0 ? duration : null);
        });
      } else {
        getAudioDuration(displaySrc)
          .then((duration: number) => {
            if (!cancelled) setMediaDuration(duration > 0 ? duration : null);
          })
          .catch(() => {
            if (!cancelled) setMediaDuration(null);
          });
      }

      return () => {
        cancelled = true;
      };
    }, [kind, displaySrc]);

    const tooltipLabel = useMemo(() => {
      if (!title) return '';
      if ((kind === 'video' || kind === 'audio') && mediaDuration != null) {
        return `${formatDuration(mediaDuration)} ${title}`;
      }
      return title;
    }, [kind, mediaDuration, title]);

    const handleMouseDown = () => {
      mouseDownTimeRef.current = Date.now();
      isClickRef.current = true;
      dragStartedRef.current = false;
      setTimeout(() => {
        if (isClickRef.current && !dragStartedRef.current) {
          dragStartedRef.current = true;
          isClickRef.current = false;
        }
      }, 200);
    };

    const handleMouseUp = (e: React.MouseEvent) => {
      const mouseUpTime = Date.now();
      const pressDuration = mouseUpTime - mouseDownTimeRef.current;
      if (pressDuration < 200 && isClickRef.current && !dragStartedRef.current) {
        e.stopPropagation();
        e.preventDefault();
        onPreview(kind, displaySrc, previewIndex);
      }
      isClickRef.current = false;
    };

    const handleClick = (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
    };

    const handleTrashPointer = (e: React.SyntheticEvent) => {
      e.stopPropagation();
      e.preventDefault();
      isClickRef.current = false;
    };

    const handleTrashStart = (e: React.SyntheticEvent) => {
      handleTrashPointer(e);
      trashDeletedRef.current = false;
    };

    const handleTrash = (e: React.SyntheticEvent) => {
      handleTrashPointer(e);
      if (trashDeletedRef.current) return;
      trashDeletedRef.current = true;
      onDelete(id);
    };

    const mediaItem = (
      <div className='relative' onMouseEnter={() => setIsHovered(true)} onMouseLeave={() => setIsHovered(false)}>
        <div ref={setNodeRef} style={style} {...attributes} {...listeners} className='cursor-grab' onMouseDown={handleMouseDown} onMouseUp={handleMouseUp} onClick={handleClick}>
          <div className='relative w-[42px] h-[42px]'>
            <div className='relative w-full h-full rounded-lg overflow-hidden bg-black/40'>
              {kind === 'image' ? (
                <img className='w-full h-full object-cover' src={compressImage(displaySrc, 80)} alt='' />
              ) : kind === 'video' ? (
                <img className='w-full h-full object-cover' src={getVideoPoster(displaySrc)} alt='' loading='lazy' decoding='async' />
              ) : (
                <img className='w-full h-full object-cover' src={audioIcon} alt='' />
              )}
            </div>
            {kind === 'video' || kind === 'audio' ? (
              <div className='absolute inset-0 z-[1] pointer-events-none flex items-center justify-center text-white'>
                {kind === 'video' ? <Play size={20} fill='currentColor' strokeWidth={1.5} /> : <Music4 size={20} strokeWidth={2} />}
              </div>
            ) : null}
            {kind === 'video' && showInvalidOverlay ? <div className='absolute inset-0 z-[2] bg-red-500/40 rounded-lg pointer-events-none' /> : null}
            <span className='absolute z-10 -top-1 -right-1 bg-black text-white rounded-full w-4 h-4 border border-white flex items-center justify-center text-[10px]'>
              {displayIndex + 1}
            </span>
            <span
              onMouseEnter={() => setIsTrashHovered(true)}
              onMouseLeave={() => setIsTrashHovered(false)}
              onPointerDown={handleTrashStart}
              onPointerUp={handleTrash}
              onMouseDown={handleTrashStart}
              onMouseUp={handleTrash}
              onClick={handleTrash}
              className='absolute z-10 -bottom-1 -right-1 bg-white text-red-700 rounded-full w-4 h-4 flex items-center justify-center hover:scale-125'
            >
              <X size={12} />
            </span>
          </div>
        </div>
        {!isDragging && isHovered && !isTrashHovered && (
          <div className='absolute z-[1] inset-0 bg-black/45 rounded-lg flex items-center justify-center pointer-events-none'>
            <Eye className='text-white' size={20} />
          </div>
        )}
      </div>
    );

    return (
      <TooltipProvider>
        <Tooltip delayDuration={100} open={!tooltipLabel || isDragging ? false : undefined}>
          <TooltipTrigger asChild>{mediaItem}</TooltipTrigger>
          {tooltipLabel ? (
            <TooltipContent side='top' className='max-w-[300px]'>
              {/* line-clamp 放内层，避免 TooltipContent 的 padding 导致第 3 行顶部露出 */}
              <p className='m-0 max-h-10 overflow-hidden break-all leading-5 line-clamp-2'>{tooltipLabel}</p>
            </TooltipContent>
          ) : null}
        </Tooltip>
      </TooltipProvider>
    );
  }
);

// 可排序的图片项组件（仅 imageMap 模式）
const SortableImageItem = memo(
  ({
    id,
    edgeId,
    src,
    index,
    onPreview,
    onDelete,
  }: {
    id: string;
    edgeId: string;
    src: string;
    index: number;
    onPreview: (index: number) => void;
    onDelete: (edgeId: string) => void;
  }) => {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });

    const [isHovered, setIsHovered] = useState(false);
    const [isTrashHovered, setIsTrashHovered] = useState(false);
    const mouseDownTimeRef = useRef<number>(0);
    const isClickRef = useRef<boolean>(false);
    const dragStartedRef = useRef<boolean>(false);
    const trashDeletedRef = useRef<boolean>(false);

    const style = {
      transform: CSS.Transform.toString(transform),
      transition,
      opacity: isDragging ? 0.5 : 1,
    };

    const handleMouseDown = () => {
      mouseDownTimeRef.current = Date.now();
      isClickRef.current = true;
      dragStartedRef.current = false;
      setTimeout(() => {
        if (isClickRef.current && !dragStartedRef.current) {
          dragStartedRef.current = true;
          isClickRef.current = false;
        }
      }, 200);
    };

    const handleMouseUp = (e: React.MouseEvent) => {
      const mouseUpTime = Date.now();
      const pressDuration = mouseUpTime - mouseDownTimeRef.current;
      if (pressDuration < 200 && isClickRef.current && !dragStartedRef.current) {
        e.stopPropagation();
        e.preventDefault();
        onPreview(index);
      }
      isClickRef.current = false;
    };

    const handleClick = (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
    };

    const handleTrashPointer = (e: React.SyntheticEvent) => {
      e.stopPropagation();
      e.preventDefault();
      isClickRef.current = false;
    };

    const handleTrashStart = (e: React.SyntheticEvent) => {
      handleTrashPointer(e);
      trashDeletedRef.current = false;
    };

    const handleTrash = (e: React.SyntheticEvent) => {
      handleTrashPointer(e);
      if (trashDeletedRef.current) return;
      trashDeletedRef.current = true;
      onDelete(edgeId);
    };

    return (
      <div className='relative' onMouseEnter={() => setIsHovered(true)} onMouseLeave={() => setIsHovered(false)}>
        <div ref={setNodeRef} style={style} {...attributes} {...listeners} className='cursor-grab' onMouseDown={handleMouseDown} onMouseUp={handleMouseUp} onClick={handleClick}>
          <img className='w-[42px] h-[42px] rounded-lg object-cover' src={compressImage(src, 80)} alt='' />
          <span className='absolute z-10 -top-1 -right-1 bg-black text-white rounded-full w-4 h-4 border border-white flex items-center justify-center text-[10px]'>
            {index + 1}
          </span>
          <span
            onMouseEnter={() => setIsTrashHovered(true)}
            onMouseLeave={() => setIsTrashHovered(false)}
            onPointerDown={handleTrashStart}
            onPointerUp={handleTrash}
            onMouseDown={handleTrashStart}
            onMouseUp={handleTrash}
            onClick={handleTrash}
            className='absolute z-10 -bottom-1 -right-1 bg-white text-red-700 rounded-full w-4 h-4 flex items-center justify-center hover:scale-125'
          >
            <X size={12} />
          </span>
        </div>
        {!isDragging && isHovered && !isTrashHovered && (
          <div className='absolute z-[1] inset-0 bg-black/45 rounded-lg flex items-center justify-center pointer-events-none'>
            <Eye className='text-white' size={20} />
          </div>
        )}
      </div>
    );
  }
);

const InputParams = ({ textMap, imageMap, mediaMap, invalidVideoOverlay, onImageOrderChange, onMediaOrderChange }: InputParamsProp) => {
  const [previewState, setPreviewState] = useState<PreviewState | null>(null);
  const edges = useFlowStore(state => state.edges);
  const deleteEdge = useFlowStore(state => state.actions.deleteEdges);

  const unifiedMode = mediaMap !== undefined;

  const previewList = useMemo(() => {
    if (!unifiedMode) return undefined;
    const all = (mediaMap as MediaInputItem[]) ?? [];
    if (!all.length) return [];

    const images: MediaInputItem[] = [];
    const videos: MediaInputItem[] = [];
    const audios: MediaInputItem[] = [];

    // 稳定分组：同类型内保持原顺序
    for (const item of all) {
      if (item.kind === 'image') images.push(item);
      else if (item.kind === 'video') videos.push(item);
      else audios.push(item);
    }
    return [...images, ...videos, ...audios];
  }, [unifiedMode, mediaMap]);

  const mediaPreviewList = useMemo(() => {
    if (!unifiedMode) return undefined;
    return (previewList ?? []).filter(item => item.kind !== 'video');
  }, [unifiedMode, previewList]);

  const mediaPreviewIndexByEdgeId = useMemo(() => {
    if (!unifiedMode) return undefined;
    const list = mediaPreviewList ?? [];
    return new Map(list.map((item, idx) => [item.edgeId, idx]));
  }, [unifiedMode, mediaPreviewList]);

  const handleImagePreview = useCallback(
    (index: number) => {
      setPreviewState({
        items: imageMap.map(item => ({
          id: item.edgeId,
          type: 'image',
          url: item.value,
          thumbnailUrl: compressImage(item.value, 240),
        })),
        initialIndex: index,
      });
    },
    [imageMap]
  );

  const handleMediaPreview = useCallback(
    (kind: MediaInputItem['kind'], src: string, index: number) => {
      if (kind === 'video') {
        setPreviewState({
          items: [
            {
              id: src,
              type: 'video',
              url: src,
              thumbnailUrl: getVideoPoster(src, 480),
            },
          ],
          initialIndex: 0,
          videoAutoPlay: true,
        });
        return;
      }

      setPreviewState({
        items: (mediaPreviewList ?? []).map(item => ({
          id: item.edgeId,
          type: item.kind === 'audio' ? 'audio' : 'image',
          url: item.value,
          thumbnailUrl: item.kind === 'image' ? compressImage(item.value, 240) : undefined,
          name: item.title,
        })),
        initialIndex: index,
      });
    },
    [mediaPreviewList]
  );

  const handleTextPreview = useCallback(
    (index: number) => {
      setPreviewState({
        items: textMap.map((item, itemIndex) => ({
          id: item.edgeId || `text-${itemIndex}`,
          type: 'text',
          url: '',
          name: item.title,
          text: item.value,
        })),
        initialIndex: index,
      });
    },
    [textMap]
  );

  const handlePreviewClose = useCallback(() => setPreviewState(null), []);

  const handleDeleteInput = useCallback(
    (edgeId: string) => {
      const edge = edges.find(item => item.id === edgeId || getReactFlowGeneratedEdgeId(item) === edgeId);
      if (!edge) return;
      deleteEdge([edge.id]);
    },
    [deleteEdge, edges]
  );

  const handleImageDragEnd = (event: any) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const activeIndex = imageMap.findIndex((item, idx) => `${item.value}-${idx}` === active.id);
    const overIndex = imageMap.findIndex((item, idx) => `${item.value}-${idx}` === over.id);
    if (activeIndex !== -1 && overIndex !== -1) {
      onImageOrderChange?.(arrayMove(imageMap, activeIndex, overIndex));
    }
  };

  const reorderWithinKind = useCallback(
    (kind: MediaInputItem['kind'], subset: MediaInputItem[], fromIndex: number, toIndex: number) => {
      if (!mediaMap) return;
      if (fromIndex === toIndex) return;
      if (!subset.length) return;

      const movedSubset = arrayMove(subset, fromIndex, toIndex);
      // 关键：必须调整 mediaMap 的“数组顺序”，而不是仅替换同 edgeId 的对象。
      // 否则从 mediaMap.map(...) 写回时顺序仍保持原样，导致 store 的连线顺序无法更新。
      const result = [...mediaMap];
      let cursor = 0;
      for (let i = 0; i < result.length; i++) {
        if (result[i].kind !== kind) continue;
        result[i] = movedSubset[cursor++];
      }
      onMediaOrderChange?.(result);
    },
    [mediaMap, onMediaOrderChange]
  );

  const hasMediaRow = unifiedMode ? (mediaMap?.length ?? 0) > 0 : imageMap.length > 0;
  const showDivider = hasMediaRow || textMap.length > 0;

  return (
    <div className='w-full min-w-0 [contain:inline-size]'>
      {unifiedMode ? (
        (() => {
          const all = mediaMap ?? [];
          const videoMedias = all.filter(item => item.kind === 'video');
          const audioMedias = all.filter(item => item.kind === 'audio');
          const imageMedias = all.filter(item => item.kind === 'image');

          const indexByEdgeId = mediaPreviewIndexByEdgeId ?? new Map(all.filter(item => item.kind !== 'video').map((item, idx) => [item.edgeId, idx]));

          const hasVideo = videoMedias.length > 0;
          const hasAudio = audioMedias.length > 0;
          const hasImage = imageMedias.length > 0;

          const Separator = () => (
            <span className='px-4 select-none flex items-center'>
              <span className='block h-8 w-px bg-white/10' />
            </span>
          );

          const renderKindBlock = (kind: MediaInputItem['kind'], subset: MediaInputItem[]) => {
            if (!subset.length) return null;

            const handleKindDragEnd = (event: any) => {
              const { active, over } = event;
              if (!over || active.id === over.id) return;
              const activeIndex = subset.findIndex(item => item.edgeId === String(active.id));
              const overIndex = subset.findIndex(item => item.edgeId === String(over.id));
              if (activeIndex !== -1 && overIndex !== -1) {
                reorderWithinKind(kind, subset, activeIndex, overIndex);
              }
            };

            return (
              <DndContext collisionDetection={closestCenter} onDragEnd={handleKindDragEnd}>
                <SortableContext items={subset.map(item => item.edgeId)} strategy={rectSortingStrategy}>
                  <div className='flex flex-wrap items-center gap-x-2 gap-y-2'>
                    {subset.map((item, displayIndex) => (
                      <SortableMediaItem
                        key={item.edgeId}
                        id={item.edgeId}
                        kind={kind}
                        displaySrc={item.value}
                        displayIndex={displayIndex}
                        previewIndex={indexByEdgeId.get(item.edgeId) ?? 0}
                        title={item.title}
                        onPreview={handleMediaPreview}
                        onDelete={handleDeleteInput}
                        showInvalidOverlay={kind === 'video' && invalidVideoOverlay}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            );
          };

          return (
            <div className={`flex flex-wrap items-center gap-y-2 ${(mediaMap?.length ?? 0) ? 'mb-2' : ''}`}>
              {renderKindBlock('image', imageMedias)}
              {hasImage && (hasVideo || hasAudio) ? <Separator /> : null}
              {renderKindBlock('video', videoMedias)}
              {hasVideo && hasAudio ? <Separator /> : null}
              {renderKindBlock('audio', audioMedias)}
            </div>
          );
        })()
      ) : (
        <DndContext collisionDetection={closestCenter} onDragEnd={handleImageDragEnd}>
          <SortableContext items={imageMap.map((item, index) => `${item.value}-${index}`)} strategy={rectSortingStrategy}>
            <div className={`flex flex-wrap gap-2 ${imageMap.length ? 'mb-2' : ''}`}>
              {imageMap.map((item, index) => (
                <SortableImageItem
                  key={`${item.value}-${index}`}
                  id={`${item.value}-${index}`}
                  edgeId={item.edgeId}
                  src={item.value}
                  index={index}
                  onPreview={handleImagePreview}
                  onDelete={handleDeleteInput}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
      <div className='flex flex-col'>
        {textMap.map((item, index) => {
          const value = item.value;
          const displayValue = toPlainText(value);
          const len = value?.length ?? 0;
          const title = item.title?.trim();
          const row = (
            <div
              key={item.edgeId || index}
              className='group nodrag mb-2 flex w-full items-center justify-between gap-2 overflow-hidden rounded-md bg-black/45 px-2 py-1 text-left text-sm transition-colors hover:bg-black/55'
            >
              <span className='min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap'>{displayValue}</span>
              <div className='flex flex-shrink-0 items-center gap-1.5'>
                <button
                  type='button'
                  onClick={e => {
                    e.stopPropagation();
                    handleTextPreview(index);
                  }}
                  className='flex items-center justify-center text-white/70 hover:text-white transition-opacity opacity-0 group-hover:opacity-100 cursor-pointer focus-visible:outline-none focus-visible:opacity-100'
                  title='预览'
                >
                  <Eye size={14} />
                </button>
                <span className='text-xs text-white/60'>{len}字</span>
              </div>
            </div>
          );
          if (!title) return row;
          return (
            <TooltipProvider key={item.edgeId || index}>
              <Tooltip delayDuration={100}>
                <TooltipTrigger asChild>{row}</TooltipTrigger>
                <TooltipContent side='top' className='max-w-[300px]'>
                  {/* line-clamp 放内层，避免 TooltipContent 的 padding 导致第 3 行顶部露出 */}
                  <p className='m-0 max-h-10 overflow-hidden break-all leading-5 line-clamp-2'>{title}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          );
        })}
      </div>
      {showDivider ? <div className='w-full h-[1px] bg-white/25 mb-1'></div> : null}
      <InputParamsPreview
        visible={Boolean(previewState)}
        items={previewState?.items ?? []}
        initialIndex={previewState?.initialIndex ?? 0}
        videoAutoPlay={previewState?.videoAutoPlay}
        onClose={handlePreviewClose}
      />
    </div>
  );
};

export default memo(InputParams);
