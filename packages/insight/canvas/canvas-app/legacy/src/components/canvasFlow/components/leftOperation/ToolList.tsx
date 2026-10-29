import styles from '../index.module.less';
import { cn } from '@/lib/utils';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getToolGiftMediaType, TOOL_LIST } from '../../settings/toolListConfig';
import VipUpgradeOverlay from '../common/VipUpgradeOverlay';
import { useFlowStore } from '@/store/flowStore';
import { isToolUsable, isToolVisibleInList } from '../../utils/modelPermission';
import vipImage from '@/assets/images/vip.png';

interface ToolListProps {
  onAdd: (type: string) => void;
}

/** 暂时屏蔽悬停时的 gif 预览 */
const SHOW_GIF_PREVIEW = true;

const GIF_PREVIEW_GAP = 8;
const GIF_PRELOAD_IDLE_TIMEOUT = 1200;

type IdleWindow = Window &
  typeof globalThis & {
    requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
    cancelIdleCallback?: (handle: number) => void;
  };

type GifPreviewState = {
  src: string;
  top: number;
  left: number;
};

function ensurePreloadedVideo(src: string, cache: Map<string, HTMLVideoElement>) {
  const cachedVideo = cache.get(src);
  if (cachedVideo) return cachedVideo;

  const video = document.createElement('video');
  video.src = src;
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.load();
  cache.set(src, video);
  return video;
}

interface GiftPreviewMediaProps {
  src: string;
  video: HTMLVideoElement | undefined;
}

const GiftPreviewMedia = ({ src, video }: GiftPreviewMediaProps) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !video) return;

    video.className = 'h-full w-full object-contain';
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.autoplay = true;
    container.replaceChildren(video);
    try {
      video.currentTime = 0;
    } catch {
      // Ignore browsers that block seeking before enough metadata is available.
    }
    video.play().catch(() => {});

    return () => {
      video.pause();
      if (container.contains(video)) container.removeChild(video);
    };
  }, [video]);

  if (getToolGiftMediaType(src) === 'video') {
    return <div ref={containerRef} className='h-full w-full' />;
  }

  return <img key={src} src={src} className='h-full w-full object-contain' alt='' loading='eager' decoding='async' draggable={false} />;
};

const ToolList: React.FC<ToolListProps> = ({ onAdd }) => {
  const toolNodePermission = useFlowStore(s => s.toolNodePermission);
  const panelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const hoveredItemRef = useRef<HTMLElement | null>(null);
  const hoveredPreviewSrcRef = useRef<string | null>(null);
  const preloadedImagesRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const preloadedVideosRef = useRef<Map<string, HTMLVideoElement>>(new Map());
  const [gifPreview, setGifPreview] = useState<GifPreviewState | null>(null);

  const visibleTools = useMemo(() => TOOL_LIST.filter(item => isToolVisibleInList(toolNodePermission, item.type)), [toolNodePermission]);
  const previewUrls = useMemo(() => Array.from(new Set(visibleTools.map(item => item.gift).filter(Boolean))), [visibleTools]);

  const syncGifPreviewPosition = useCallback(() => {
    const el = hoveredItemRef.current;
    const src = hoveredPreviewSrcRef.current;
    const panel = panelRef.current;
    if (!el || !src || !panel) return;

    const itemRect = el.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const previewWidth = 240;
    const hasSpaceOnRight = typeof window !== 'undefined' && panelRect.right + GIF_PREVIEW_GAP + previewWidth <= window.innerWidth;
    setGifPreview({
      src,
      top: itemRect.top + itemRect.height / 2,
      left: hasSpaceOnRight
        ? panelRect.right + GIF_PREVIEW_GAP
        : Math.max(8, panelRect.left - GIF_PREVIEW_GAP - previewWidth),
    });
  }, []);

  const showGifPreview = useCallback(
    (el: HTMLElement, gift: string) => {
      if (getToolGiftMediaType(gift) === 'video') ensurePreloadedVideo(gift, preloadedVideosRef.current);
      hoveredItemRef.current = el;
      hoveredPreviewSrcRef.current = gift;
      syncGifPreviewPosition();
    },
    [syncGifPreviewPosition]
  );

  const hideGifPreview = useCallback(() => {
    hoveredItemRef.current = null;
    hoveredPreviewSrcRef.current = null;
    setGifPreview(null);
  }, []);

  useEffect(() => {
    if (!SHOW_GIF_PREVIEW || !previewUrls.length) return;

    let cancelled = false;
    const preload = () => {
      if (cancelled) return;

      previewUrls.forEach(src => {
        if (getToolGiftMediaType(src) === 'video') {
          ensurePreloadedVideo(src, preloadedVideosRef.current);
          return;
        }

        if (preloadedImagesRef.current.has(src)) return;
        const img = new Image();
        img.decoding = 'async';
        img.src = src;
        preloadedImagesRef.current.set(src, img);
      });
    };

    const idleWindow = window as IdleWindow;
    if (idleWindow.requestIdleCallback) {
      const idleId = idleWindow.requestIdleCallback(preload, { timeout: GIF_PRELOAD_IDLE_TIMEOUT });
      return () => {
        cancelled = true;
        idleWindow.cancelIdleCallback?.(idleId);
      };
    }

    const timer = window.setTimeout(preload, GIF_PRELOAD_IDLE_TIMEOUT);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [previewUrls]);

  useEffect(() => {
    if (!gifPreview) return;

    const scrollEl = scrollRef.current;
    const onReposition = () => syncGifPreviewPosition();

    scrollEl?.addEventListener('scroll', onReposition, { passive: true });
    window.addEventListener('scroll', onReposition, true);
    window.addEventListener('resize', onReposition);

    return () => {
      scrollEl?.removeEventListener('scroll', onReposition);
      window.removeEventListener('scroll', onReposition, true);
      window.removeEventListener('resize', onReposition);
    };
  }, [gifPreview, syncGifPreviewPosition]);

  return (
    <div ref={panelRef} className={`tool-list flex flex-col rounded-lg w-[272px] border border-[#595959] ${styles.bg}`}>
      <div className='px-4 py-3 border-b border-white/5 bg-[#262626] text-white text-sm rounded-t-lg'>工具节点</div>
      <div ref={scrollRef} className='flex max-h-[468px] flex-col overflow-y-auto overflow-x-hidden rounded-b-lg'>
        {visibleTools.length === 0 ? (
          <div className='flex flex-col items-center justify-center gap-2 px-6 py-10 text-center bg-[#262626]'>
            <p className='text-sm text-white/50'>暂无可用的工具节点</p>
            <p className='text-xs text-white/35 leading-relaxed'>当前账号暂无工具权限，或请联系管理员开通</p>
          </div>
        ) : (
          visibleTools.map(item => {
            const greyDisabled = !isToolUsable(toolNodePermission, item.type);

            return (
              <button
                type='button'
                className={cn(`${styles.nodeItem} group relative w-full`, greyDisabled && 'nodeItemDisabled cursor-not-allowed')}
                onClick={() => {
                  if (!greyDisabled) onAdd(item.type);
                }}
                key={item.type}
                aria-disabled={greyDisabled}
                onMouseEnter={e => {
                  if (!greyDisabled && SHOW_GIF_PREVIEW) showGifPreview(e.currentTarget, item.gift);
                }}
                onMouseLeave={() => {
                  if (SHOW_GIF_PREVIEW) hideGifPreview();
                }}
              >
                {item.icon}
                <div className='min-w-0 flex flex-1 items-center justify-between gap-3'>
                  <div className='flex min-w-0 flex-col gap-1'>
                    <div className={cn('flex min-w-0 items-center gap-2 text-sm', greyDisabled ? 'text-white/50' : 'text-white')}>
                      <span className='truncate'>{item.title}</span>
                      {greyDisabled && <img src={vipImage} alt='VIP' className='h-4 w-auto shrink-0' />}
                    </div>
                    <div className={cn('text-xs text-white/65', greyDisabled && 'text-white/35')}>{item.tip}</div>
                  </div>
                </div>

                {greyDisabled && <VipUpgradeOverlay variant='toolList' />}
              </button>
            );
          })
        )}
      </div>
      {SHOW_GIF_PREVIEW &&
        gifPreview &&
        createPortal(
          <div
            className='pointer-events-none fixed z-[100] h-[240px] w-[240px] -translate-y-1/2 overflow-hidden rounded-lg border-2 border-white/15 bg-[#262626] shadow-[0_4px_16px_rgba(0,0,0,0.3)]'
            style={{ top: gifPreview.top, left: gifPreview.left }}
          >
            <GiftPreviewMedia src={gifPreview.src} video={preloadedVideosRef.current.get(gifPreview.src)} />
          </div>,
          document.body
        )}
    </div>
  );
};

export default ToolList;
