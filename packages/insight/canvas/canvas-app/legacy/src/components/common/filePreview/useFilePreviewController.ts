import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { FilePreviewItem } from './types';

type KeyboardDirections = 'horizontal' | 'all';
type PreviewLoadStatus = 'pending' | 'ready' | 'failed';

const PRELOAD_TIMEOUT_MS = 5000;
const MAX_PRELOAD_RETRIES = 3;

interface UseFilePreviewControllerOptions {
  items: FilePreviewItem[];
  initialIndex?: number;
  resetKey?: string | number;
  loop?: boolean;
  enabled?: boolean;
  keyboardDirections?: KeyboardDirections;
  autoAdvanceMs?: number;
  pauseAutoAdvance?: boolean;
  preloadLookAhead?: number;
}

const clampIndex = (index: number, length: number) => {
  if (length <= 0) return 0;
  return Math.min(Math.max(index, 0), length - 1);
};

const isEditableTarget = (target: EventTarget | null) => {
  const element = target as HTMLElement | null;
  return Boolean(element?.closest('input, textarea, select, button, a, [contenteditable="true"], [role="slider"]'));
};

const getPreloadUrl = (item: FilePreviewItem) => {
  if (item.type === 'image') return item.url;
  if (item.type === 'video') return item.thumbnailUrl || '';
  return '';
};

const getFollowingPreloadUrls = (items: FilePreviewItem[], activeIndex: number, loop: boolean, limit: number) => {
  const urls: string[] = [];
  const seen = new Set<string>();

  for (let step = 1; step < items.length && urls.length < limit; step += 1) {
    const rawIndex = activeIndex + step;
    if (!loop && rawIndex >= items.length) break;

    const item = items[rawIndex % items.length];
    const url = getPreloadUrl(item);
    if (url && !seen.has(url)) {
      seen.add(url);
      urls.push(url);
    }
  }

  return urls;
};

const preloadImageOnce = (url: string) =>
  new Promise<HTMLImageElement | null>(resolve => {
    const image = new Image();
    let settled = false;
    const finish = (loadedImage: HTMLImageElement | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      image.onload = null;
      image.onerror = null;
      resolve(loadedImage);
    };
    const timeout = window.setTimeout(() => {
      finish(null);
      image.removeAttribute('src');
    }, PRELOAD_TIMEOUT_MS);

    image.decoding = 'async';
    image.onload = () => {
      if (typeof image.decode !== 'function') {
        finish(image);
        return;
      }

      void image
        .decode()
        .catch(() => undefined)
        .then(() => finish(image));
    };
    image.onerror = () => finish(null);
    image.src = url;
  });

const preloadImage = async (url: string, shouldContinue: () => boolean) => {
  for (let retryCount = 0; retryCount <= MAX_PRELOAD_RETRIES; retryCount += 1) {
    if (!shouldContinue()) return undefined;

    const image = await preloadImageOnce(url);
    if (image) return image;
  }

  return null;
};

export function useFilePreviewController({
  items,
  initialIndex = 0,
  resetKey,
  loop = false,
  enabled = true,
  keyboardDirections = 'horizontal',
  autoAdvanceMs,
  pauseAutoAdvance = false,
  preloadLookAhead = 2,
}: UseFilePreviewControllerOptions) {
  const [activeIndex, setActiveIndexState] = useState(() => clampIndex(initialIndex, items.length));
  const [activeItemLoadState, setActiveItemLoadState] = useState<{ key: string; status: PreviewLoadStatus }>({ key: '', status: 'pending' });
  const [, refreshPreloadStatus] = useState(0);
  const preloadGenerationRef = useRef(0);
  const decodedImagesRef = useRef(new Map<string, HTMLImageElement>());
  const preloadStatusRef = useRef(new Map<string, PreviewLoadStatus>());

  const activeItem = items[activeIndex];
  const activeItemKey = activeItem ? JSON.stringify([activeItem.id, activeItem.url]) : '';
  const activeItemStatus = activeItemLoadState.key === activeItemKey ? activeItemLoadState.status : 'pending';
  const multiple = items.length > 1;
  const hasPrevious = multiple && (loop || activeIndex > 0);
  const hasNext = multiple && (loop || activeIndex < items.length - 1);

  const setActiveIndex = useCallback(
    (nextIndex: number) => {
      setActiveIndexState(clampIndex(nextIndex, items.length));
    },
    [items.length]
  );

  const goPrevious = useCallback(() => {
    if (!multiple) return;
    setActiveIndexState(current => (current <= 0 ? (loop ? items.length - 1 : 0) : current - 1));
  }, [items.length, loop, multiple]);

  const goNext = useCallback(() => {
    if (!multiple) return;
    setActiveIndexState(current => (current >= items.length - 1 ? (loop ? 0 : items.length - 1) : current + 1));
  }, [items.length, loop, multiple]);

  useEffect(() => {
    setActiveIndexState(clampIndex(initialIndex, items.length));
  }, [initialIndex, items.length, resetKey]);

  useEffect(() => {
    setActiveIndexState(current => clampIndex(current, items.length));
  }, [items.length]);

  useEffect(() => {
    if (!enabled || !multiple) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;

      const previousPressed = event.key === 'ArrowLeft' || (keyboardDirections === 'all' && event.key === 'ArrowUp');
      const nextPressed = event.key === 'ArrowRight' || (keyboardDirections === 'all' && event.key === 'ArrowDown');

      if (previousPressed) {
        event.preventDefault();
        goPrevious();
      } else if (nextPressed) {
        event.preventDefault();
        goNext();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled, goNext, goPrevious, keyboardDirections, multiple]);

  const markActiveItemReady = useCallback(
    (itemId: string) => {
      if (itemId === activeItem?.id) {
        setActiveItemLoadState({ key: activeItemKey, status: 'ready' });
      }
    },
    [activeItem?.id, activeItemKey]
  );

  const markActiveItemFailed = useCallback(
    (itemId: string) => {
      if (itemId === activeItem?.id) {
        setActiveItemLoadState({ key: activeItemKey, status: 'failed' });
      }
    },
    [activeItem?.id, activeItemKey]
  );

  const preloadUrls = useMemo(() => getFollowingPreloadUrls(items, activeIndex, loop, Math.max(0, preloadLookAhead)), [activeIndex, items, loop, preloadLookAhead]);
  const nextItem = hasNext ? items[(activeIndex + 1) % items.length] : undefined;
  const nextPreloadUrl = nextItem ? getPreloadUrl(nextItem) : '';
  const nextPreloadStatus = nextPreloadUrl ? preloadStatusRef.current.get(nextPreloadUrl) || 'pending' : 'ready';
  const canAutoAdvance = activeItemStatus !== 'pending' && nextPreloadStatus !== 'pending';

  useEffect(() => {
    if (!enabled || !autoAdvanceMs || autoAdvanceMs <= 0 || pauseAutoAdvance || !multiple || !hasNext || !canAutoAdvance) return;

    const timer = window.setTimeout(goNext, autoAdvanceMs);
    return () => window.clearTimeout(timer);
  }, [activeIndex, autoAdvanceMs, canAutoAdvance, enabled, goNext, hasNext, multiple, pauseAutoAdvance]);

  useEffect(() => {
    if (!enabled || !activeItemKey || activeItemStatus === 'pending' || preloadUrls.length === 0) return;

    /*
     * 预请求状态机：
     * active settled -> 单通道准备后续 2 张 -> generation 变化后停止旧队列。
     * 已发出的单个 Image 请求允许完成，但失效任务不再回写或继续调度。
     */
    const generation = ++preloadGenerationRef.current;

    const run = async () => {
      for (const url of preloadUrls) {
        if (preloadGenerationRef.current !== generation) return;
        const currentStatus = preloadStatusRef.current.get(url);
        if (currentStatus === 'ready' || currentStatus === 'failed') continue;

        preloadStatusRef.current.set(url, 'pending');
        const decodedImage = await preloadImage(url, () => preloadGenerationRef.current === generation);
        if (preloadGenerationRef.current !== generation) return;
        if (decodedImage === undefined) return;

        if (decodedImage) {
          decodedImagesRef.current.set(url, decodedImage);
          preloadStatusRef.current.set(url, 'ready');
        } else {
          preloadStatusRef.current.set(url, 'failed');
        }
        refreshPreloadStatus(current => current + 1);
      }
    };

    void run();

    return () => {
      if (preloadGenerationRef.current === generation) {
        preloadGenerationRef.current += 1;
      }
    };
  }, [activeItemKey, activeItemStatus, enabled, preloadUrls]);

  useEffect(() => {
    const retainedPreloadUrls = new Set(preloadUrls);
    for (const url of decodedImagesRef.current.keys()) {
      if (!retainedPreloadUrls.has(url)) {
        decodedImagesRef.current.delete(url);
      }
    }
    for (const url of preloadStatusRef.current.keys()) {
      if (!retainedPreloadUrls.has(url)) {
        preloadStatusRef.current.delete(url);
      }
    }
  }, [preloadUrls]);

  return {
    activeIndex,
    activeItem,
    multiple,
    hasPrevious,
    hasNext,
    setActiveIndex,
    goPrevious,
    goNext,
    markActiveItemReady,
    markActiveItemFailed,
  };
}
