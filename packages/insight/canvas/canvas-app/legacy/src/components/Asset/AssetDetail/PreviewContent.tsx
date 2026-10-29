import React, { useState, useRef, useEffect, useCallback } from 'react';
import type { AssetItem, AssetSetDetailItem } from '../types';
import { ASSET_TYPE_CODE } from '../types';
import AudioPlayer from '@/components/common/fileControl/AudioPlayer';

type Point = { x: number; y: number };

interface PreviewContentProps {
  item: AssetItem | AssetSetDetailItem;
  /** 外层 scale 缩放倍数，用于拖拽边界计算 */
  zoom?: number;
  /** 可拖拽区域视口（一般为左侧预览 flex 容器） */
  panViewportRef?: React.RefObject<HTMLElement | null>;
}

interface DraggableImageProps {
  url: string;
  zoom: number;
  panViewportRef?: React.RefObject<HTMLElement | null>;
  resetKey?: number | string;
}

const DraggableImage: React.FC<DraggableImageProps> = ({ url, zoom, panViewportRef, resetKey }) => {
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);
  const mediaWrapperRef = useRef<HTMLDivElement>(null);
  const baseRectRef = useRef<{ width: number; height: number } | null>(null);
  const dragStateRef = useRef<{
    isDragging: boolean;
    pointerId: number | null;
    startPointer: Point;
    startOffset: Point;
  }>({
    isDragging: false,
    pointerId: null,
    startPointer: { x: 0, y: 0 },
    startOffset: { x: 0, y: 0 },
  });

  useEffect(() => {
    setOffset({ x: 0, y: 0 });
    baseRectRef.current = null;
  }, [url, resetKey]);

  useEffect(() => {
    baseRectRef.current = null;
  }, [zoom]);

  const ensureBaseRect = useCallback(() => {
    if (baseRectRef.current) return;
    const img = imageRef.current;
    if (!img) return;
    const rect = img.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      baseRectRef.current = { width: rect.width / zoom, height: rect.height / zoom };
    }
  }, [zoom]);

  const clampOffset = useCallback(
    (next: Point) => {
      const viewport = panViewportRef?.current;
      const base = baseRectRef.current;
      if (!viewport || !base) return next;

      const containerRect = viewport.getBoundingClientRect();
      const scaledW = base.width * zoom;
      const scaledH = base.height * zoom;
      const safeZoom = zoom || 1;

      const maxX = Math.max(0, Math.abs(scaledW - containerRect.width) / 2 / safeZoom);
      const maxY = Math.max(0, Math.abs(scaledH - containerRect.height) / 2 / safeZoom);

      return {
        x: Math.min(maxX, Math.max(-maxX, next.x)),
        y: Math.min(maxY, Math.max(-maxY, next.y)),
      };
    },
    [panViewportRef, zoom]
  );

  useEffect(() => {
    setOffset(prev => clampOffset(prev));
  }, [clampOffset, zoom]);

  const handlePointerDown = (e: React.PointerEvent) => {
    ensureBaseRect();
    const root = mediaWrapperRef.current;
    if (!root) return;

    dragStateRef.current.isDragging = true;
    dragStateRef.current.pointerId = e.pointerId;
    dragStateRef.current.startPointer = { x: e.clientX, y: e.clientY };
    dragStateRef.current.startOffset = offset;
    setIsDragging(true);

    try {
      root.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const s = dragStateRef.current;
    if (!s.isDragging || s.pointerId !== e.pointerId) return;

    const safeZoom = zoom || 1;
    const dx = (e.clientX - s.startPointer.x) / safeZoom;
    const dy = (e.clientY - s.startPointer.y) / safeZoom;
    setOffset(clampOffset({ x: s.startOffset.x + dx, y: s.startOffset.y + dy }));
  };

  const endDrag = (e: React.PointerEvent) => {
    const s = dragStateRef.current;
    if (!s.isDragging || s.pointerId !== e.pointerId) return;

    s.isDragging = false;
    s.pointerId = null;
    setIsDragging(false);

    const root = mediaWrapperRef.current;
    if (root) {
      try {
        root.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }
  };

  return (
    <div
      ref={mediaWrapperRef}
      className='flex h-full w-full min-h-0 min-w-0 items-center justify-center overflow-hidden touch-none'
      style={{
        transform: `translate3d(${offset.x}px, ${offset.y}px, 0)`,
        transition: isDragging ? 'none' : 'transform 0.2s ease',
        cursor: isDragging ? 'grabbing' : 'grab',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerLeave={endDrag}
    >
      <img
        ref={imageRef}
        src={url}
        alt=''
        draggable={false}
        className='h-full w-full object-contain select-none rounded-sm'
        onLoad={() => {
          baseRectRef.current = null;
          ensureBaseRect();
          setOffset(prev => clampOffset(prev));
        }}
      />
    </div>
  );
};

export const PreviewContent: React.FC<PreviewContentProps> = ({ item, zoom = 1, panViewportRef }) => {
  const t = typeof item.type === 'number' ? item.type : (item as AssetItem).type;
  const url = (item as AssetSetDetailItem).fileUrl ?? (item as AssetItem).fileUrl;

  if (t === ASSET_TYPE_CODE.IMAGE && url) {
    return <DraggableImage url={url} zoom={zoom} panViewportRef={panViewportRef} resetKey={item.id} />;
  }
  if (t === ASSET_TYPE_CODE.VIDEO) {
    return <video src={url} controls className='h-full w-full min-h-0 min-w-0 overflow-hidden rounded-lg' key={item.id} />;
  }
  if (t === ASSET_TYPE_CODE.AUDIO) {
    return (
      <div className='w-[600px]'>
        <AudioPlayer url={url} height={314} />
      </div>
    );
  }
  if (t === ASSET_TYPE_CODE.TEXT_SUB && 'text' in item && item.text) {
    return <div className='max-w-[90vw] max-h-[85vh] overflow-auto p-6 rounded-lg bg-white/5 text-white/90 whitespace-pre-wrap'>{item.text}</div>;
  }
  return null;
};
