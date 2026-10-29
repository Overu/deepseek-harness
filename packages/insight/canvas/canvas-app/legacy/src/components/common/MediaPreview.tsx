import React, { useEffect, useRef, useState, useCallback } from 'react';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import AudioPlayer from '@/components/common/fileControl/AudioPlayer';

type Point = { x: number; y: number };

interface MediaPreviewProps {
  url: string | string[]; // 支持单个URL或URL数组
  visible: boolean;
  onClose: () => void;
  type?: 'image' | 'video' | 'audio' | 'text' | Array<'image' | 'video' | 'audio' | 'text'>;
  initialIndex?: number; // 初始索引
  autoPlay?: boolean;
}

const MediaPreview: React.FC<MediaPreviewProps> = ({ url, visible, onClose, type, initialIndex = 0, autoPlay = false }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [scale, setScale] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);
  const [showControls, setShowControls] = useState(true);
  const mediaWrapperRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });
  const dragStateRef = useRef<{
    isDragging: boolean;
    pointerId: number | null;
    startPointer: Point;
    startOffset: Point;
    hasMoved: boolean;
  }>({
    isDragging: false,
    pointerId: null,
    startPointer: { x: 0, y: 0 },
    startOffset: { x: 0, y: 0 },
    hasMoved: false,
  });
  const swipeStateRef = useRef<{
    isSwiping: boolean;
    pointerId: number | null;
    startPointer: Point;
    latestPointer: Point;
  }>({
    isSwiping: false,
    pointerId: null,
    startPointer: { x: 0, y: 0 },
    latestPointer: { x: 0, y: 0 },
  });
  const baseRectRef = useRef<{ width: number; height: number } | null>(null);

  // 判断是否为URL数组
  const isUrlArray = Array.isArray(url);

  // 获取当前URL
  const currentUrl = isUrlArray ? url[currentIndex] : url;

  // 获取媒体类型
  const getMediaType = (mediaUrl: string, index: number): 'image' | 'video' | 'audio' | 'text' => {
    if (!mediaUrl) return 'image';
    // 如果指定了类型且对应索引有类型定义
    if (Array.isArray(type) && type[index]) {
      return type[index];
    }
    if (type === 'image' || type === 'video' || type === 'audio' || type === 'text') {
      return type;
    }

    // 根据URL后缀自动判断类型
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'];
    const videoExtensions = ['.mp4', '.webm', '.ogg', '.mov', '.avi', '.wmv'];
    const audioExtensions = ['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.wma'];

    const lowerUrl = mediaUrl.toLowerCase();
    if (imageExtensions.some(ext => lowerUrl.includes(ext))) {
      return 'image';
    }
    if (videoExtensions.some(ext => lowerUrl.includes(ext))) {
      return 'video';
    }
    if (audioExtensions.some(ext => lowerUrl.includes(ext))) {
      return 'audio';
    }

    return 'image'; // 默认为图片
  };

  const currentMediaType = getMediaType(currentUrl, currentIndex);
  /** 文本用原生滚动阅读；图片/视频/音频支持滚轮与双击缩放 */
  const supportsZoom = currentMediaType !== 'text';

  useEffect(() => {
    if (!visible || !autoPlay || currentMediaType !== 'video') return;
    videoRef.current?.play().catch(() => {});
  }, [autoPlay, currentMediaType, currentUrl, visible]);

  // 导航功能
  const goToPrevious = useCallback(() => {
    if (isUrlArray && currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
      setScale(1); // 重置缩放
    }
  }, [currentIndex, isUrlArray]);

  const goToNext = useCallback(() => {
    if (isUrlArray && currentIndex < (isUrlArray ? url.length : 1) - 1) {
      setCurrentIndex(currentIndex + 1);
      setScale(1); // 重置缩放
    }
  }, [currentIndex, isUrlArray, url]);

  // 键盘导航支持
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!visible) return;

      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase();
      const isEditable = target?.isContentEditable || tagName === 'input' || tagName === 'textarea' || tagName === 'select';
      if (isEditable) return;

      switch (event.key) {
        case 'Escape':
          onClose();
          break;
        case 'ArrowLeft':
          event.preventDefault();
          goToPrevious();
          break;
        case 'ArrowRight':
          event.preventDefault();
          goToNext();
          break;
      }
    };

    if (visible) {
      window.addEventListener('keydown', handleKeyDown, { capture: true });
    }

    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true } as any);
    };
  }, [visible, onClose, goToPrevious, goToNext]);

  // 关闭时暂停视频（音频由 AudioPlayer 在卸载时自行清理）
  useEffect(() => {
    if (!visible) return;
    return () => {
      videoRef.current?.pause();
    };
  }, [visible]);

  // 控制栏自动隐藏
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (showControls && visible) {
      timer = setTimeout(() => {
        setShowControls(false);
      }, 3000);
    }

    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [showControls, visible]);

  // 显示控制栏
  const handleMouseMove = () => {
    setShowControls(true);
  };

  // 处理鼠标滚轮缩放
  const handleWheel = useCallback(
    (e: WheelEvent) => {
      if (!visible || !supportsZoom) return;
      e.preventDefault();
      if (e.deltaY < 0) {
        // 向上滚动，放大
        setScale(prev => Math.min(prev + 0.1, 3));
      } else {
        // 向下滚动，缩小
        setScale(prev => Math.max(prev - 0.1, 0.5));
      }
    },
    [visible, supportsZoom]
  );

  // 双击缩放
  const handleDoubleClick = () => {
    if (!supportsZoom) return;
    setScale(prev => {
      const next = prev === 1 ? 2 : 1;
      if (next === 1) setOffset({ x: 0, y: 0 });
      return next;
    });
  };

  // 重置状态
  useEffect(() => {
    if (visible) {
      setCurrentIndex(initialIndex);
      setScale(1);
      setOffset({ x: 0, y: 0 });
      baseRectRef.current = null;
      setShowControls(true);
    }
  }, [visible, initialIndex]);

  // 切换媒体时重置平移（避免把上一张的位移带过来）
  useEffect(() => {
    if (!visible) return;
    setOffset({ x: 0, y: 0 });
    baseRectRef.current = null;
  }, [currentIndex, currentUrl, visible]);

  const ensureBaseRect = useCallback(() => {
    if (baseRectRef.current) return;
    const img = imageRef.current;
    if (!img) return;
    const rect = img.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      baseRectRef.current = { width: rect.width, height: rect.height };
    }
  }, []);

  const clampOffset = useCallback(
    (next: Point) => {
      const root = containerRef.current;
      const base = baseRectRef.current;
      if (!root || !base) return next;

      const containerRect = root.getBoundingClientRect();
      const scaledW = base.width * scale;
      const scaledH = base.height * scale;

      const maxX = Math.max(0, Math.abs(scaledW - containerRect.width) / 2);
      const maxY = Math.max(0, Math.abs(scaledH - containerRect.height) / 2);

      return {
        x: Math.min(maxX, Math.max(-maxX, next.x)),
        y: Math.min(maxY, Math.max(-maxY, next.y)),
      };
    },
    [scale]
  );

  // scale变化时，重新收敛偏移到可视边界内
  useEffect(() => {
    setOffset(prev => clampOffset(prev));
  }, [clampOffset, scale]);

  // 设置wheel事件监听器，显式指定passive: false
  useEffect(() => {
    if (!visible) return;

    const listenerOptions: AddEventListenerOptions = {
      passive: false,
      capture: true,
    };

    const handleWheelOnWindow = (e: WheelEvent) => {
      const root = containerRef.current;
      const target = e.target as Node | null;
      if (!root || !target || !root.contains(target)) return;
      handleWheel(e);
    };

    window.addEventListener('wheel', handleWheelOnWindow, listenerOptions);

    // 清理函数
    return () => {
      window.removeEventListener('wheel', handleWheelOnWindow, listenerOptions);
    };
  }, [handleWheel, visible]); // visible 变化时重新绑定

  const handleMaskClick = (e: React.MouseEvent) => {
    if (dragStateRef.current.hasMoved) return;
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  // 计算媒体容器样式
  const mediaContainerStyle: React.CSSProperties = {
    transform: currentMediaType === 'image' ? `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale})` : `scale(${scale})`,
    transition: dragStateRef.current.isDragging ? 'none' : 'transform 0.2s ease',
    cursor: currentMediaType === 'image' ? (dragStateRef.current.isDragging ? 'grabbing' : 'grab') : 'default',
    touchAction: currentMediaType === 'image' ? 'none' : 'auto',
  };

  // 是否可以导航
  const canGoPrevious = isUrlArray && currentIndex > 0;
  const canGoNext = isUrlArray && currentIndex < (isUrlArray ? url.length : 1) - 1;
  const mediaCount = isUrlArray ? url.length : 1;
  const isVideoGallery = currentMediaType === 'video' && isUrlArray && mediaCount > 1;
  const shouldPinControls = currentMediaType === 'video';
  const areControlsVisible = showControls || shouldPinControls;

  const handlePointerDown = (e: React.PointerEvent) => {
    if (currentMediaType === 'video' && isVideoGallery) {
      swipeStateRef.current.isSwiping = true;
      swipeStateRef.current.pointerId = e.pointerId;
      swipeStateRef.current.startPointer = { x: e.clientX, y: e.clientY };
      swipeStateRef.current.latestPointer = { x: e.clientX, y: e.clientY };
      dragStateRef.current.hasMoved = false;

      try {
        mediaWrapperRef.current?.setPointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      return;
    }

    if (currentMediaType !== 'image') return;

    ensureBaseRect();
    const root = mediaWrapperRef.current;
    if (!root) return;

    dragStateRef.current.isDragging = true;
    dragStateRef.current.pointerId = e.pointerId;
    dragStateRef.current.startPointer = { x: e.clientX, y: e.clientY };
    dragStateRef.current.startOffset = offset;
    dragStateRef.current.hasMoved = false;

    try {
      root.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const swipeState = swipeStateRef.current;
    if (swipeState.isSwiping && swipeState.pointerId === e.pointerId) {
      swipeState.latestPointer = { x: e.clientX, y: e.clientY };
      const dx = e.clientX - swipeState.startPointer.x;
      const dy = e.clientY - swipeState.startPointer.y;
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
        dragStateRef.current.hasMoved = true;
      }
      return;
    }

    const s = dragStateRef.current;
    if (!s.isDragging) return;
    if (s.pointerId !== e.pointerId) return;

    const dx = e.clientX - s.startPointer.x;
    const dy = e.clientY - s.startPointer.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      s.hasMoved = true;
    }
    setOffset(clampOffset({ x: s.startOffset.x + dx, y: s.startOffset.y + dy }));
  };

  const handlePointerUpOrCancel = (e: React.PointerEvent) => {
    const swipeState = swipeStateRef.current;
    if (swipeState.isSwiping && swipeState.pointerId === e.pointerId) {
      const dx = swipeState.latestPointer.x - swipeState.startPointer.x;
      const dy = swipeState.latestPointer.y - swipeState.startPointer.y;
      const isHorizontalSwipe = Math.abs(dx) >= 48 && Math.abs(dx) > Math.abs(dy) * 1.2;

      if (isHorizontalSwipe) {
        if (dx < 0) {
          goToNext();
        } else {
          goToPrevious();
        }
      }

      swipeState.isSwiping = false;
      swipeState.pointerId = null;

      setTimeout(() => {
        dragStateRef.current.hasMoved = false;
      }, 100);

      const root = mediaWrapperRef.current;
      if (root) {
        try {
          root.releasePointerCapture(e.pointerId);
        } catch {
          // ignore
        }
      }
      return;
    }

    const s = dragStateRef.current;
    if (!s.isDragging) return;
    if (s.pointerId !== e.pointerId) return;

    s.isDragging = false;
    s.pointerId = null;

    // 延迟重置 hasMoved，以便能被 onClick 拦截到
    setTimeout(() => {
      s.hasMoved = false;
    }, 100);

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
    <Dialog open={visible} onOpenChange={open => !open && onClose()}>
      <DialogContent
        className='fixed inset-0 z-50 w-screen h-screen max-w-none py-4 bg-black/90 border-0 flex justify-center items-center translate-x-0 translate-y-0 left-0 top-0 data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95 media-preview'
        showCloseButton={false}
      >
        <DialogTitle className='sr-only'>媒体预览</DialogTitle>
        <div className='absolute inset-0 flex justify-center items-center py-4' onMouseMove={handleMouseMove} onClick={handleMaskClick} ref={containerRef}>
          {/* 关闭按钮 */}
          <button
            className='absolute top-4 right-4 z-20 flex h-[40px] w-[40px] items-center justify-center rounded-full bg-black/45 text-white transition-all hover:bg-black/65 md:right-6 md:top-6 md:h-[50px] md:w-[50px]'
            onClick={onClose}
            aria-label='关闭预览'
          >
            <X size={24} className='md:w-8 md:h-8' />
          </button>

          {/* 左导航按钮 */}
          {canGoPrevious && (
            <button
              className={`absolute left-2 md:left-6 z-10 w-[40px] h-[40px] md:w-[50px] md:h-[50px] bg-black/30 hover:bg-black/50 rounded-full text-white flex justify-center items-center transition-all ${areControlsVisible ? 'opacity-100' : 'opacity-0'}`}
              onClick={goToPrevious}
              aria-label='上一个媒体'
            >
              <ChevronLeft size={24} className='md:w-8 md:h-8' />
            </button>
          )}

          {/* 右导航按钮 */}
          {canGoNext && (
            <button
              className={`absolute right-2 md:right-6 z-10 w-[40px] h-[40px] md:w-[50px] md:h-[50px] bg-black/30 hover:bg-black/50 rounded-full text-white flex justify-center items-center transition-all ${areControlsVisible ? 'opacity-100' : 'opacity-0'}`}
              onClick={goToNext}
              aria-label='下一个媒体'
            >
              <ChevronRight size={24} className='md:w-8 md:h-8' />
            </button>
          )}

          {/* 媒体容器 */}
          <div className='flex justify-center items-center w-full h-full overflow-hidden' onDoubleClick={handleDoubleClick} onClick={handleMaskClick}>
            <div
              ref={mediaWrapperRef}
              style={mediaContainerStyle}
              className='flex justify-center items-center w-full h-full'
              onClick={handleMaskClick}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUpOrCancel}
              onPointerCancel={handlePointerUpOrCancel}
              onPointerLeave={handlePointerUpOrCancel}
            >
              {currentMediaType === 'image' ? (
                <img
                  ref={imageRef}
                  src={currentUrl}
                  alt={`预览图片 ${currentIndex + 1}`}
                  className='max-w-[90vw] max-h-[90vh] object-contain select-none'
                  draggable={false}
                  onLoad={() => {
                    baseRectRef.current = null;
                    ensureBaseRect();
                  }}
                />
              ) : currentMediaType === 'video' ? (
                <video
                  ref={videoRef}
                  src={currentUrl}
                  className='h-auto max-h-[92vh] w-full max-w-[100vw] object-contain md:max-w-[96vw]'
                  controls
                  playsInline
                  autoPlay={autoPlay}
                />
              ) : currentMediaType === 'text' ? (
                <div className='max-w-[90vw] max-h-[85vh] overflow-auto p-6 rounded-lg bg-white/5 text-white/90 whitespace-pre-wrap' onClick={e => e.stopPropagation()}>
                  {currentUrl}
                </div>
              ) : (
                <div className='relative flex flex-col items-center justify-center p-8 bg-gray-900/80 rounded-lg min-w-[400px] min-h-[120px]'>
                  <AudioPlayer url={currentUrl} height={200} />
                </div>
              )}
            </div>
          </div>

          {/* 底部指示器 */}
          {isUrlArray && url.length > 1 && (
            <div
              className={`absolute bottom-6 z-10 flex items-center space-x-2 rounded-full bg-black/45 px-3 py-2 text-white backdrop-blur transition-opacity ${areControlsVisible ? 'opacity-100' : 'opacity-0'}`}
            >
              {currentMediaType === 'video' ? (
                <span className='min-w-[44px] text-center text-[13px] font-medium tabular-nums'>
                  {currentIndex + 1} / {url.length}
                </span>
              ) : (
                url.map((_, index) => <div key={index} className={`w-2 h-2 rounded-full ${index === currentIndex ? 'bg-white' : 'bg-white/50'}`} />)
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default MediaPreview;
