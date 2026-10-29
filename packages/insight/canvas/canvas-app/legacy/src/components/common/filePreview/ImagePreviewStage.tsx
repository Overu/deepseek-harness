import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import { ImageIcon, Loader2 } from 'lucide-react';

import { cn } from '@/lib/utils';
import { clampImageOffset, getImageFit, getImagePreviewStyle, isSafariUserAgent } from './filePreviewUtils';

interface ImagePreviewStageProps {
  src: string;
  alt: string;
  onReady?: () => void;
  onError?: () => void;
}

type Point = { x: number; y: number };

const ZOOM_STEP = 0.12;
const MIN_ZOOM = 1;
const MIN_MAX_ZOOM = 2;

type GestureLikeEvent = Event & {
  clientX?: number;
  clientY?: number;
  scale?: number;
};

function getPointerDistance(first: Point, second: Point) {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

export function ImagePreviewStage({ src, alt, onReady, onError }: ImagePreviewStageProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const onReadyRef = useRef(onReady);
  const onErrorRef = useRef(onError);
  const settledNotifiedRef = useRef(false);
  onReadyRef.current = onReady;
  onErrorRef.current = onError;
  const dragStateRef = useRef<{
    dragging: boolean;
    pointerId: number | null;
    startPoint: Point;
    startOffset: Point;
  }>({
    dragging: false,
    pointerId: null,
    startPoint: { x: 0, y: 0 },
    startOffset: { x: 0, y: 0 },
  });
  const gestureScaleRef = useRef(1);
  const pointersRef = useRef(new Map<number, Point>());
  const pinchStateRef = useRef<{ initialDistance: number; initialZoom: number } | null>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const useNativeImageSizing = useMemo(() => isSafariUserAgent(), []);

  const fit = useMemo(
    () => getImageFit(containerSize.width, containerSize.height, naturalSize.width, naturalSize.height),
    [containerSize.height, containerSize.width, naturalSize.height, naturalSize.width]
  );
  const maxZoom = Math.max(MIN_MAX_ZOOM, fit.naturalSizeZoom);
  const clampCurrentOffset = useCallback(
    (nextOffset: Point, nextZoom = zoom) =>
      clampImageOffset({
        offset: nextOffset,
        containerWidth: containerSize.width,
        containerHeight: containerSize.height,
        baseWidth: fit.width,
        baseHeight: fit.height,
        zoom: nextZoom,
      }),
    [containerSize.height, containerSize.width, fit.height, fit.width, zoom]
  );

  const updateZoom = useCallback(
    (nextZoom: number) => {
      const clampedZoom = Math.min(maxZoom, Math.max(MIN_ZOOM, nextZoom));
      setZoom(clampedZoom);
      setOffset(current => clampCurrentOffset(current, clampedZoom));
    },
    [clampCurrentOffset, maxZoom]
  );

  const zoomByWheelDelta = useCallback(
    (deltaY: number) => {
      const direction = deltaY < 0 ? 1 : -1;
      updateZoom(zoom + direction * ZOOM_STEP * Math.max(1, zoom));
    },
    [updateZoom, zoom]
  );

  const isEventInsideStage = useCallback((event: Event) => {
    const container = containerRef.current;
    const target = event.target;
    if (!container) return false;
    if (target instanceof Node) return container.contains(target);

    const pointerEvent = event as GestureLikeEvent;
    if (typeof pointerEvent.clientX !== 'number' || typeof pointerEvent.clientY !== 'number') {
      return false;
    }

    const rect = container.getBoundingClientRect();
    return pointerEvent.clientX >= rect.left && pointerEvent.clientX <= rect.right && pointerEvent.clientY >= rect.top && pointerEvent.clientY <= rect.bottom;
  }, []);

  const blockBrowserZoom = useCallback((event: Event) => {
    if (event.cancelable) {
      event.preventDefault();
    }
    event.stopPropagation();
  }, []);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateSize = () => {
      const rect = container.getBoundingClientRect();
      setContainerSize({ width: rect.width, height: rect.height });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(container);

    return () => observer.disconnect();
  }, []);

  const handleImageReady = useCallback((image: HTMLImageElement) => {
    if (!image.naturalWidth || !image.naturalHeight) return;
    if (settledNotifiedRef.current) return;

    setNaturalSize({
      width: image.naturalWidth,
      height: image.naturalHeight,
    });
    setLoading(false);
    setFailed(false);

    settledNotifiedRef.current = true;
    onReadyRef.current?.();
  }, []);

  const handleImageError = useCallback(() => {
    if (settledNotifiedRef.current) return;

    setLoading(false);
    setFailed(true);
    settledNotifiedRef.current = true;
    onErrorRef.current?.();
  }, []);

  useLayoutEffect(() => {
    const image = imageRef.current;
    if (!image?.complete) return;

    if (image.naturalWidth > 0 && image.naturalHeight > 0) {
      handleImageReady(image);
    } else {
      handleImageError();
    }
  }, [handleImageError, handleImageReady]);

  useEffect(() => {
    setOffset(current => clampCurrentOffset(current));
  }, [clampCurrentOffset]);

  useEffect(() => {
    const getGestureScale = (event: Event) => {
      const scale = (event as GestureLikeEvent).scale;
      return typeof scale === 'number' && Number.isFinite(scale) && scale > 0 ? scale : null;
    };

    const handleGlobalWheel = (event: globalThis.WheelEvent) => {
      if (!isEventInsideStage(event)) return;

      blockBrowserZoom(event);
      zoomByWheelDelta(event.deltaY);
    };

    const handleGestureStart = (event: Event) => {
      if (!isEventInsideStage(event)) return;

      blockBrowserZoom(event);
      gestureScaleRef.current = zoom;
    };

    const handleGestureChange = (event: Event) => {
      if (!isEventInsideStage(event)) return;

      blockBrowserZoom(event);
      updateZoom(gestureScaleRef.current * (getGestureScale(event) || 1));
    };

    const handleGestureEnd = (event: Event) => {
      if (!isEventInsideStage(event)) return;

      blockBrowserZoom(event);
      gestureScaleRef.current = zoom;
    };

    document.addEventListener('wheel', handleGlobalWheel, { passive: false, capture: true });
    window.addEventListener('gesturestart', handleGestureStart, { passive: false, capture: true });
    window.addEventListener('gesturechange', handleGestureChange, { passive: false, capture: true });
    window.addEventListener('gestureend', handleGestureEnd, { passive: false, capture: true });

    return () => {
      document.removeEventListener('wheel', handleGlobalWheel, { capture: true });
      window.removeEventListener('gesturestart', handleGestureStart, { capture: true });
      window.removeEventListener('gesturechange', handleGestureChange, { capture: true });
      window.removeEventListener('gestureend', handleGestureEnd, { capture: true });
    };
  }, [blockBrowserZoom, isEventInsideStage, updateZoom, zoom, zoomByWheelDelta]);

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointersRef.current.size === 2) {
      const [first, second] = [...pointersRef.current.values()];
      pinchStateRef.current = {
        initialDistance: getPointerDistance(first, second),
        initialZoom: zoom,
      };
      dragStateRef.current.dragging = false;
      return;
    }

    if (zoom <= 1) return;

    dragStateRef.current = {
      dragging: true,
      pointerId: event.pointerId,
      startPoint: { x: event.clientX, y: event.clientY },
      startOffset: offset,
    };
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (pointersRef.current.has(event.pointerId)) {
      pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }

    const pinchState = pinchStateRef.current;
    if (pinchState && pointersRef.current.size === 2) {
      const [first, second] = [...pointersRef.current.values()];
      const distance = getPointerDistance(first, second);
      if (pinchState.initialDistance > 0) {
        updateZoom(pinchState.initialZoom * (distance / pinchState.initialDistance));
      }
      return;
    }

    const dragState = dragStateRef.current;
    if (!dragState.dragging || dragState.pointerId !== event.pointerId) return;

    const nextOffset = {
      x: dragState.startOffset.x + event.clientX - dragState.startPoint.x,
      y: dragState.startOffset.y + event.clientY - dragState.startPoint.y,
    };
    setOffset(clampCurrentOffset(nextOffset));
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) {
      pinchStateRef.current = null;
    }

    const dragState = dragStateRef.current;
    if (dragState.pointerId === event.pointerId) {
      dragStateRef.current.dragging = false;
      dragStateRef.current.pointerId = null;
    }
  };

  const handleStageClick = () => {
    if (zoom > MIN_ZOOM || fit.naturalSizeZoom <= MIN_ZOOM) return;

    setOffset({ x: 0, y: 0 });
    updateZoom(fit.naturalSizeZoom);
  };

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative flex h-full w-full touch-none select-none items-center justify-center overflow-hidden bg-[#050505]',
        zoom > 1 ? 'cursor-grab active:cursor-grabbing' : 'cursor-zoom-in'
      )}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onClick={handleStageClick}
    >
      {loading && !failed && (
        <div className='absolute inset-0 flex flex-col items-center justify-center gap-3 text-white/55'>
          <Loader2 className='h-7 w-7 animate-spin' />
        </div>
      )}

      {failed ? (
        <div className='flex flex-col items-center gap-3 text-white/45'>
          <ImageIcon className='h-10 w-10' />
          <span className='text-sm'>图片加载失败</span>
        </div>
      ) : (
        <img
          ref={imageRef}
          src={src}
          alt={alt}
          draggable={false}
          decoding='async'
          className={cn('object-contain transition-opacity duration-200', naturalSize.width ? 'max-w-none' : 'max-h-full max-w-full', loading ? 'opacity-0' : 'opacity-100')}
          style={getImagePreviewStyle({
            baseWidth: fit.width,
            baseHeight: fit.height,
            zoom,
            offset,
            useNativeImageSizing,
          })}
          onLoad={event => handleImageReady(event.currentTarget)}
          onError={handleImageError}
        />
      )}
    </div>
  );
}
