import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactCrop, { type PercentCrop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import { Check, X, RectangleHorizontal, Square, Smartphone, PanelsTopLeft, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import * as fabric from 'fabric';
import { useEditorEngine } from '../../hooks/useEditorEngine';

export type CropRatio = 'free' | '1:1' | '4:3' | '16:9' | '3:4' | '9:16';

const RATIO_OPTIONS: {
  value: CropRatio;
  label: string;
  icon: React.ReactNode;
  aspect?: number;
}[] = [
  { value: 'free', label: '自由', icon: <PanelsTopLeft size={16} /> },
  { value: '1:1', label: '1:1', icon: <Square size={16} />, aspect: 1 },
  { value: '4:3', label: '4:3', icon: <RectangleHorizontal size={16} />, aspect: 4 / 3 },
  { value: '16:9', label: '16:9', icon: <RectangleHorizontal size={16} />, aspect: 16 / 9 },
  { value: '3:4', label: '3:4', icon: <Smartphone size={16} />, aspect: 3 / 4 },
  { value: '9:16', label: '9:16', icon: <Smartphone size={16} />, aspect: 9 / 16 },
];

interface CropOverlayV2Props {
  targetId: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

interface CropTarget {
  image: fabric.Image;
  src: string;
  naturalWidth: number;
  naturalHeight: number;
  originalControls: boolean;
  originalBorders: boolean;
}

interface PixelCropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface GestureLikeEvent extends Event {
  scale?: number;
}

const MIN_CROP_SIZE = 1;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.1;
const KEYBOARD_ZOOM_FACTOR = 1.12;
const WHEEL_ZOOM_SENSITIVITY = 0.001;
const MAX_WHEEL_ZOOM_DELTA = 0.06;
const STAGE_PADDING = 32;

const decodedImageCache = new Set<string>();

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function percentToPixelCrop(crop: PercentCrop, naturalWidth: number, naturalHeight: number): PixelCropRect {
  const x = clamp((crop.x / 100) * naturalWidth, 0, naturalWidth);
  const y = clamp((crop.y / 100) * naturalHeight, 0, naturalHeight);
  const width = clamp((crop.width / 100) * naturalWidth, 1, naturalWidth - x);
  const height = clamp((crop.height / 100) * naturalHeight, 1, naturalHeight - y);

  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  };
}

function imageCropToPercentCrop(image: fabric.Image, naturalWidth: number, naturalHeight: number): PercentCrop {
  const cropX = clamp(image.cropX || 0, 0, naturalWidth);
  const cropY = clamp(image.cropY || 0, 0, naturalHeight);
  const width = clamp(image.width || naturalWidth, 1, naturalWidth - cropX);
  const height = clamp(image.height || naturalHeight, 1, naturalHeight - cropY);

  return {
    unit: '%',
    x: (cropX / naturalWidth) * 100,
    y: (cropY / naturalHeight) * 100,
    width: (width / naturalWidth) * 100,
    height: (height / naturalHeight) * 100,
  };
}

function makeMaxAspectCrop(aspect: number, naturalWidth: number, naturalHeight: number): PercentCrop {
  const imageAspect = naturalWidth / naturalHeight;
  const cropWidth = imageAspect > aspect ? naturalHeight * aspect : naturalWidth;
  const cropHeight = imageAspect > aspect ? naturalHeight : naturalWidth / aspect;

  return {
    unit: '%',
    x: ((naturalWidth - cropWidth) / 2 / naturalWidth) * 100,
    y: ((naturalHeight - cropHeight) / 2 / naturalHeight) * 100,
    width: (cropWidth / naturalWidth) * 100,
    height: (cropHeight / naturalHeight) * 100,
  };
}

function getNaturalSize(image: fabric.Image) {
  const element = image.getElement() as HTMLImageElement | HTMLCanvasElement | undefined;
  const naturalWidth = element instanceof HTMLImageElement ? element.naturalWidth : element?.width;
  const naturalHeight = element instanceof HTMLImageElement ? element.naturalHeight : element?.height;

  return {
    width: naturalWidth || (image.cropX || 0) + (image.width || 0),
    height: naturalHeight || (image.cropY || 0) + (image.height || 0),
  };
}

function getImageSrc(image: fabric.Image) {
  const element = image.getElement() as HTMLImageElement | undefined;
  return typeof image.getSrc === 'function' ? image.getSrc() : element?.src || '';
}

function getImageElement(image: fabric.Image) {
  const element = image.getElement();
  return element instanceof HTMLImageElement ? element : null;
}

function isDecodedImageAvailable(src: string, element: HTMLImageElement | null) {
  if (decodedImageCache.has(src)) return true;
  if (!element?.complete || !element.naturalWidth || !element.naturalHeight) return false;

  decodedImageCache.add(src);
  return true;
}

function preloadDecodedImage(src: string) {
  if (decodedImageCache.has(src)) return Promise.resolve();

  return new Promise<void>((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = async () => {
      try {
        await image.decode?.();
      } catch {
        // Safari may reject decode for already-loaded images. The load event is enough here.
      }
      decodedImageCache.add(src);
      resolve();
    };
    image.onerror = () => reject(new Error(`Failed to preload crop image: ${src}`));
    image.src = src;
  });
}

function getCanvasCenterForCrop(image: fabric.Image, nextCrop: PixelCropRect) {
  const currentCropX = image.cropX || 0;
  const currentCropY = image.cropY || 0;
  const currentWidth = image.width || nextCrop.width;
  const currentHeight = image.height || nextCrop.height;

  const currentSourceCenter = {
    x: currentCropX + currentWidth / 2,
    y: currentCropY + currentHeight / 2,
  };
  const nextSourceCenter = {
    x: nextCrop.x + nextCrop.width / 2,
    y: nextCrop.y + nextCrop.height / 2,
  };

  const dx = nextSourceCenter.x - currentSourceCenter.x;
  const dy = nextSourceCenter.y - currentSourceCenter.y;
  const matrix = image.calcTransformMatrix();
  const currentCanvasCenter = image.getCenterPoint();

  return new fabric.Point(currentCanvasCenter.x + dx * matrix[0] + dy * matrix[2], currentCanvasCenter.y + dx * matrix[1] + dy * matrix[3]);
}

function fitImageIntoStage(naturalWidth: number, naturalHeight: number, stageWidth: number, stageHeight: number) {
  const availableWidth = Math.max(1, stageWidth - STAGE_PADDING);
  const availableHeight = Math.max(1, stageHeight - STAGE_PADDING);
  const scale = Math.min(availableWidth / naturalWidth, availableHeight / naturalHeight, 1);

  return {
    width: Math.max(1, Math.round(naturalWidth * scale)),
    height: Math.max(1, Math.round(naturalHeight * scale)),
  };
}

/**
 * V2 裁切流程:
 * Fabric Image -> source pixel crop -> ReactCrop percent crop -> Fabric cropX/cropY
 *
 * 裁切交互不再叠加在 Fabric viewport 上，避免 DOM/SVG/canvas 多坐标系在浏览器缩放、
 * Safari 小数像素和旋转对象下出现视觉错位。
 */
export function CropOverlayV2({ targetId, onConfirm, onCancel }: CropOverlayV2Props) {
  const engine = useEditorEngine();
  const [target, setTarget] = useState<CropTarget | null>(null);
  const [crop, setCrop] = useState<PercentCrop>();
  const [cropRatio, setCropRatio] = useState<CropRatio>('free');
  const [zoom, setZoom] = useState(1);
  const [isImageReady, setIsImageReady] = useState(false);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const stageRef = useRef<HTMLDivElement>(null);
  const restoredRef = useRef(false);
  const gestureScaleRef = useRef<number | null>(null);

  const onConfirmRef = useRef(onConfirm);
  const onCancelRef = useRef(onCancel);

  useEffect(() => {
    onConfirmRef.current = onConfirm;
    onCancelRef.current = onCancel;
  }, [onConfirm, onCancel]);

  const restoreTarget = useCallback(() => {
    if (!target || restoredRef.current) return;

    target.image.set({
      hasControls: target.originalControls,
      hasBorders: target.originalBorders,
    });
    target.image.setCoords();

    const historyPlugin = engine.pluginManager.get('HistoryPlugin') as any;
    historyPlugin?.resume?.();
    engine.enableShortcuts();
    engine.getCanvas().requestRenderAll();
    restoredRef.current = true;
  }, [engine, target]);

  useEffect(() => {
    if (!targetId) {
      setTarget(null);
      setCrop(undefined);
      setCropRatio('free');
      setZoom(1);
      setIsImageReady(false);
      return;
    }

    const obj = engine.getObjectById(targetId);
    if (!obj || obj.type !== 'image') return;

    const image = obj as fabric.Image;
    const src = getImageSrc(image);
    const imageElement = getImageElement(image);
    const naturalSize = getNaturalSize(image);
    if (!src || !naturalSize.width || !naturalSize.height) return;

    restoredRef.current = false;

    const historyPlugin = engine.pluginManager.get('HistoryPlugin') as any;
    historyPlugin?.pause?.();
    engine.disableShortcuts();

    const nextTarget: CropTarget = {
      image,
      src,
      naturalWidth: naturalSize.width,
      naturalHeight: naturalSize.height,
      originalControls: image.hasControls ?? true,
      originalBorders: image.hasBorders ?? true,
    };

    image.set({
      hasControls: false,
      hasBorders: false,
    });
    engine.getCanvas().requestRenderAll();

    setTarget(nextTarget);
    setCrop(imageCropToPercentCrop(image, naturalSize.width, naturalSize.height));
    setCropRatio('free');
    setZoom(1);
    setIsImageReady(isDecodedImageAvailable(src, imageElement));

    let isMounted = true;
    preloadDecodedImage(src)
      .then(() => {
        if (isMounted) setIsImageReady(true);
      })
      .catch(() => {
        if (isMounted) setIsImageReady(true);
      });

    return () => {
      isMounted = false;
      image.set({
        hasControls: nextTarget.originalControls,
        hasBorders: nextTarget.originalBorders,
      });
      image.setCoords();
      historyPlugin?.resume?.();
      engine.enableShortcuts();
      engine.getCanvas().requestRenderAll();
      restoredRef.current = true;
    };
  }, [engine, targetId]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const updateStageSize = () => {
      setStageSize({
        width: stage.clientWidth,
        height: stage.clientHeight,
      });
    };

    updateStageSize();
    const resizeObserver = new ResizeObserver(updateStageSize);
    resizeObserver.observe(stage);

    return () => resizeObserver.disconnect();
  }, [target]);

  const aspect = useMemo(() => RATIO_OPTIONS.find(option => option.value === cropRatio)?.aspect, [cropRatio]);

  const handleRatioChange = useCallback(
    (ratio: CropRatio) => {
      setCropRatio(ratio);
      if (!target) return;

      const option = RATIO_OPTIONS.find(item => item.value === ratio);
      if (!option?.aspect) {
        setCrop(imageCropToPercentCrop(target.image, target.naturalWidth, target.naturalHeight));
        return;
      }

      setCrop(makeMaxAspectCrop(option.aspect, target.naturalWidth, target.naturalHeight));
    },
    [target]
  );

  const displaySize = useMemo(() => {
    if (!target || stageSize.width <= 0 || stageSize.height <= 0) return null;

    const fitted = fitImageIntoStage(target.naturalWidth, target.naturalHeight, stageSize.width, stageSize.height);

    return {
      width: Math.max(1, Math.round(fitted.width * zoom)),
      height: Math.max(1, Math.round(fitted.height * zoom)),
    };
  }, [stageSize.height, stageSize.width, target, zoom]);

  const zoomBounds = useMemo(() => {
    if (!target || stageSize.width <= 0 || stageSize.height <= 0) {
      return { min: MIN_ZOOM, max: MAX_ZOOM };
    }

    const fitted = fitImageIntoStage(target.naturalWidth, target.naturalHeight, stageSize.width, stageSize.height);
    const availableWidth = Math.max(1, stageSize.width - STAGE_PADDING);
    const availableHeight = Math.max(1, stageSize.height - STAGE_PADDING);
    const maxVisibleZoom = Math.min(availableWidth / fitted.width, availableHeight / fitted.height);

    return {
      min: MIN_ZOOM,
      max: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, maxVisibleZoom)),
    };
  }, [stageSize.height, stageSize.width, target]);

  useEffect(() => {
    setZoom(current => clamp(current, zoomBounds.min, zoomBounds.max));
  }, [zoomBounds.max, zoomBounds.min]);

  const zoomPercent = Math.round(zoom * 100);

  const updateZoom = useCallback(
    (nextZoom: number) => {
      setZoom(clamp(nextZoom, zoomBounds.min, zoomBounds.max));
    },
    [zoomBounds.max, zoomBounds.min]
  );

  const updateZoomByWheelDelta = useCallback(
    (deltaY: number) => {
      const rawDelta = -deltaY * WHEEL_ZOOM_SENSITIVITY;
      const boundedDelta = clamp(rawDelta, -MAX_WHEEL_ZOOM_DELTA, MAX_WHEEL_ZOOM_DELTA);
      setZoom(current => clamp(current * (1 + boundedDelta), zoomBounds.min, zoomBounds.max));
    },
    [zoomBounds.max, zoomBounds.min]
  );

  const updateZoomByFactor = useCallback(
    (factor: number) => {
      setZoom(current => clamp(current * factor, zoomBounds.min, zoomBounds.max));
    },
    [zoomBounds.max, zoomBounds.min]
  );

  const handleStageWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      event.preventDefault();
      updateZoomByWheelDelta(event.deltaY);
    },
    [updateZoomByWheelDelta]
  );

  const handleZoomOut = useCallback(() => {
    updateZoom(zoom - ZOOM_STEP);
  }, [updateZoom, zoom]);

  const handleZoomIn = useCallback(() => {
    updateZoom(zoom + ZOOM_STEP);
  }, [updateZoom, zoom]);

  const handleResetZoom = useCallback(() => {
    updateZoom(1);
  }, [updateZoom]);

  const handleConfirm = useCallback(() => {
    if (!target || !crop) return;

    const nextCrop = percentToPixelCrop(crop, target.naturalWidth, target.naturalHeight);
    const nextCenter = getCanvasCenterForCrop(target.image, nextCrop);

    target.image.set({
      cropX: nextCrop.x,
      cropY: nextCrop.y,
      width: nextCrop.width,
      height: nextCrop.height,
    });
    target.image.setPositionByOrigin(nextCenter, 'center', 'center');
    target.image.setCoords();

    restoreTarget();

    const canvas = engine.getCanvas();
    canvas.requestRenderAll();
    canvas.fire('object:modified', { target: target.image });

    onConfirmRef.current();
  }, [crop, engine, restoreTarget, target]);

  const handleCancel = useCallback(() => {
    restoreTarget();
    onCancelRef.current();
  }, [restoreTarget]);

  useEffect(() => {
    if (!target) return;

    const blockBrowserZoom = (event: Event) => {
      if (event.cancelable) event.preventDefault();
      event.stopPropagation();
    };

    const handleGlobalWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;

      blockBrowserZoom(event);
      updateZoomByWheelDelta(event.deltaY);
    };

    const getGestureScale = (event: Event) => {
      const scale = (event as GestureLikeEvent).scale;
      return typeof scale === 'number' && Number.isFinite(scale) && scale > 0 ? scale : null;
    };

    const handleGestureStart = (event: Event) => {
      blockBrowserZoom(event);
      gestureScaleRef.current = getGestureScale(event) ?? 1;
    };

    const handleGestureChange = (event: Event) => {
      blockBrowserZoom(event);
      const scale = getGestureScale(event);
      if (!scale) return;

      const previousScale = gestureScaleRef.current ?? scale;
      if (previousScale > 0) {
        updateZoomByFactor(scale / previousScale);
      }
      gestureScaleRef.current = scale;
    };

    const handleGestureEnd = (event: Event) => {
      blockBrowserZoom(event);
      gestureScaleRef.current = null;
    };

    const handleGlobalKeyDown = (event: KeyboardEvent) => {
      const hasZoomModifier = event.ctrlKey || event.metaKey;

      if (event.key === 'Escape') {
        event.preventDefault();
        handleCancel();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        handleConfirm();
      } else if (hasZoomModifier && (event.key === '=' || event.key === '+' || event.code === 'NumpadAdd')) {
        blockBrowserZoom(event);
        updateZoomByFactor(KEYBOARD_ZOOM_FACTOR);
      } else if (hasZoomModifier && (event.key === '-' || event.code === 'Minus' || event.code === 'NumpadSubtract')) {
        blockBrowserZoom(event);
        updateZoomByFactor(1 / KEYBOARD_ZOOM_FACTOR);
      } else if (hasZoomModifier && (event.key === '0' || event.code === 'Digit0' || event.code === 'Numpad0')) {
        blockBrowserZoom(event);
        handleResetZoom();
      }
    };

    document.addEventListener('wheel', handleGlobalWheel, { passive: false, capture: true });
    document.addEventListener('keydown', handleGlobalKeyDown, { passive: false, capture: true });
    window.addEventListener('gesturestart', handleGestureStart, { passive: false, capture: true });
    window.addEventListener('gesturechange', handleGestureChange, { passive: false, capture: true });
    window.addEventListener('gestureend', handleGestureEnd, { passive: false, capture: true });

    return () => {
      document.removeEventListener('wheel', handleGlobalWheel, { capture: true });
      document.removeEventListener('keydown', handleGlobalKeyDown, { capture: true });
      window.removeEventListener('gesturestart', handleGestureStart, { capture: true });
      window.removeEventListener('gesturechange', handleGestureChange, { capture: true });
      window.removeEventListener('gestureend', handleGestureEnd, { capture: true });
    };
  }, [handleCancel, handleConfirm, handleResetZoom, target, updateZoomByFactor, updateZoomByWheelDelta]);

  if (!target) return null;

  return (
    <div className='fixed inset-0 z-[1000] flex flex-col overflow-hidden bg-black/75 text-white' role='dialog' aria-modal='true'>
      <div ref={stageRef} className='relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-zinc-950 p-4' onWheel={handleStageWheel}>
        <div className='max-h-full max-w-full overflow-visible rounded border border-zinc-700 bg-zinc-950 shadow-2xl'>
          {isImageReady ? (
            <ReactCrop
              crop={crop}
              aspect={aspect}
              keepSelection
              minWidth={MIN_CROP_SIZE}
              minHeight={MIN_CROP_SIZE}
              ruleOfThirds
              style={{ display: 'block', lineHeight: 0 }}
              onChange={(_, percentCrop) => setCrop(percentCrop)}
            >
              <img
                src={target.src}
                alt=''
                draggable={false}
                decoding='sync'
                fetchPriority='high'
                className='block select-none'
                style={{
                  width: displaySize?.width || 1,
                  height: displaySize?.height || 1,
                  maxWidth: 'none',
                  maxHeight: 'none',
                }}
                onLoad={() => decodedImageCache.add(target.src)}
              />
            </ReactCrop>
          ) : (
            <div className='flex h-64 w-80 items-center justify-center text-sm text-zinc-400'>加载图片...</div>
          )}
        </div>
      </div>

      <div className='flex items-center justify-center gap-4 border-t border-zinc-800 bg-zinc-950/95 px-4 py-3'>
        <div className='flex items-center gap-1'>
          {RATIO_OPTIONS.map(option => (
            <button
              key={option.value}
              type='button'
              onClick={() => handleRatioChange(option.value)}
              className={`flex h-11 w-10 flex-col items-center justify-center gap-0.5 rounded transition-colors hover:bg-zinc-800 ${
                cropRatio === option.value ? 'bg-zinc-800 text-blue-400' : 'text-white'
              }`}
            >
              {option.icon}
              <span className='text-[10px] font-medium opacity-80'>{option.label}</span>
            </button>
          ))}
        </div>

        <div className='h-8 w-px bg-zinc-700' />

        <div className='flex items-center gap-2'>
          <button
            type='button'
            onClick={handleZoomOut}
            disabled={zoom <= zoomBounds.min}
            className='flex h-10 w-10 items-center justify-center rounded text-zinc-200 transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40'
            aria-label='缩小图片'
          >
            <ZoomOut size={18} />
          </button>
          <input
            type='range'
            min={zoomBounds.min}
            max={zoomBounds.max}
            step={ZOOM_STEP}
            value={zoom}
            onChange={event => updateZoom(Number(event.target.value))}
            className='h-2 w-32 accent-blue-500'
            aria-label='裁切缩放'
          />
          <button
            type='button'
            onClick={handleZoomIn}
            disabled={zoom >= zoomBounds.max}
            className='flex h-10 w-10 items-center justify-center rounded text-zinc-200 transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40'
            aria-label='放大图片'
          >
            <ZoomIn size={18} />
          </button>
          <button
            type='button'
            onClick={handleResetZoom}
            className='flex h-10 min-w-16 items-center justify-center gap-1 rounded px-2 text-xs text-zinc-200 transition-colors hover:bg-zinc-800'
            aria-label='重置缩放'
          >
            <Maximize2 size={15} />
            {zoomPercent}%
          </button>
        </div>

        <div className='h-8 w-px bg-zinc-700' />

        <button
          type='button'
          onClick={handleCancel}
          className='flex h-11 w-10 items-center justify-center rounded text-red-500 transition-colors hover:bg-zinc-800 hover:text-red-400'
          aria-label='取消裁切'
        >
          <X size={20} />
        </button>
        <button
          type='button'
          onClick={handleConfirm}
          className='flex h-11 w-10 items-center justify-center rounded text-green-500 transition-colors hover:bg-zinc-800 hover:text-green-400'
          aria-label='确认裁切'
        >
          <Check size={20} />
        </button>
      </div>
    </div>
  );
}
