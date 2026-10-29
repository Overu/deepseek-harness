import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent } from 'react';
import * as fabric from 'fabric';
import { toast } from 'sonner';
import { autoMatting } from '@/api/editor';
import { useEditorEngine } from '../../hooks/useEditorEngine';
import { MattingActionToolbar } from './MattingActionToolbar';
import { MATTING_MASK_COLORS, type MattingBrushMode } from './constants';
import { runImageInpaintTask } from './runImageInpaintTask';

interface MattingOverlayV2Props {
  targetId: string | null;
  canvasId: string | undefined;
  nodeId: string | undefined;
  onConfirm: () => void;
  onCancel: () => void;
}

interface SourceImage {
  url: string;
  width: number;
  height: number;
  angle: number;
}

interface Point {
  x: number;
  y: number;
}

interface GestureLikeEvent extends Event {
  scale?: number;
}

const MIN_ZOOM = 0.04;
const MAX_ZOOM = 8;
const PAN_WHEEL_FACTOR = 0.45;
const WHEEL_ZOOM_SPEED = 0.002;
const MASK_MAX_SIDE = 2048;
const MAX_EDGE_ESCAPE = 140;
const COMMITTED_MASK_COLORS: Record<MattingBrushMode, string> = {
  remove: 'rgb(255, 255, 255)',
  keep: 'rgb(0, 0, 0)',
};

const fillCommittedCanvasBackground = (canvas: HTMLCanvasElement, mode: MattingBrushMode) => {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const backgroundMode: MattingBrushMode = mode === 'remove' ? 'keep' : 'remove';
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = COMMITTED_MASK_COLORS[backgroundMode];
  ctx.fillRect(0, 0, canvas.width, canvas.height);
};

const imageCache = new Map<string, Promise<HTMLImageElement>>();

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const withoutQuery = (url: string) => {
  if (!url || url.startsWith('data:') || url.startsWith('blob:')) return url;
  const hashIndex = url.indexOf('#');
  const hash = hashIndex >= 0 ? url.slice(hashIndex) : '';
  const urlWithoutHash = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
  const queryIndex = urlWithoutHash.indexOf('?');
  if (queryIndex < 0) return url;

  const path = urlWithoutHash.slice(0, queryIndex);
  const query = urlWithoutHash.slice(queryIndex + 1);
  const nextQuery = query.split('&').filter(item => item.split('=')[0] !== 'x-cors');
  return `${path}${nextQuery.length > 0 ? `?${nextQuery.join('&')}` : ''}${hash}`;
};

const loadImageElement = (url: string) => {
  const cached = imageCache.get(url);
  if (cached) return cached;

  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = async () => {
      try {
        await image.decode?.();
      } catch {
        // Safari may resolve onload after decode has effectively completed.
      }
      resolve(image);
    };
    image.onerror = reject;
    image.src = url;
  });

  imageCache.set(url, promise);
  return promise;
};

const getNaturalSize = (image: fabric.Image) => {
  const element = image.getElement() as HTMLImageElement | undefined;
  return {
    width: element?.naturalWidth || image.width || 1,
    height: element?.naturalHeight || image.height || 1,
  };
};

export function MattingOverlayV2({ targetId, canvasId, nodeId, onConfirm, onCancel }: MattingOverlayV2Props) {
  const engine = useEditorEngine();
  const stageRef = useRef<HTMLDivElement>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const committedCanvasRef = useRef<HTMLCanvasElement>(document.createElement('canvas'));
  const restoreEditorStateRef = useRef<(() => void) | null>(null);
  const onConfirmRef = useRef(onConfirm);
  const onCancelRef = useRef(onCancel);
  const gestureScaleRef = useRef<number | null>(null);
  const isDrawingRef = useRef(false);
  const isPanningRef = useRef(false);
  const isSpacePressedRef = useRef(false);
  const hasDrawnRef = useRef(false);
  const lastPointRef = useRef<Point | null>(null);
  const lastPanPointRef = useRef<Point | null>(null);
  const taskAbortControllerRef = useRef<AbortController | null>(null);

  const [sourceImage, setSourceImage] = useState<SourceImage | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [localHistory, setLocalHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [brushSize, setBrushSize] = useState(10);
  const [showBrushPreview, setShowBrushPreview] = useState(false);
  const [brushPreviewPos, setBrushPreviewPos] = useState<Point>({ x: 0, y: 0 });
  const [brushMode, setBrushMode] = useState<MattingBrushMode>('keep');
  const [isSpacePanning, setIsSpacePanning] = useState(false);
  const [isAutoMatting, setIsAutoMatting] = useState(false);
  const [isManualMatting, setIsManualMatting] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [viewportSize, setViewportSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });

  useEffect(() => {
    onConfirmRef.current = onConfirm;
    onCancelRef.current = onCancel;
  }, [onConfirm, onCancel]);

  useEffect(
    () => () => {
      taskAbortControllerRef.current?.abort();
      taskAbortControllerRef.current = null;
    },
    []
  );

  const maskSize = useMemo(() => {
    if (!sourceImage) return { width: 1, height: 1, scale: 1 };
    const maxSide = Math.max(sourceImage.width, sourceImage.height, 1);
    const scale = Math.min(1, MASK_MAX_SIDE / maxSide);
    return {
      width: Math.max(1, Math.round(sourceImage.width * scale)),
      height: Math.max(1, Math.round(sourceImage.height * scale)),
      scale,
    };
  }, [sourceImage]);

  const fitZoom = useMemo(() => {
    if (!sourceImage) return 1;
    const availableWidth = viewportSize.width * 0.82;
    const availableHeight = Math.max(240, viewportSize.height - 180);
    return clamp(Math.min(availableWidth / sourceImage.width, availableHeight / sourceImage.height), MIN_ZOOM, MAX_ZOOM);
  }, [sourceImage, viewportSize]);

  const clampedZoom = useMemo(() => clamp(zoom, Math.min(MIN_ZOOM, fitZoom), MAX_ZOOM), [fitZoom, zoom]);
  const displayWidth = sourceImage ? sourceImage.width * clampedZoom : 0;
  const displayHeight = sourceImage ? sourceImage.height * clampedZoom : 0;

  const clampPan = useCallback(
    (nextPan: Point) => {
      if (!sourceImage) return { x: 0, y: 0 };

      const minVisibleX = Math.min(MAX_EDGE_ESCAPE, viewportSize.width * 0.4, displayWidth * 0.5);
      const minVisibleY = Math.min(MAX_EDGE_ESCAPE, viewportSize.height * 0.4, displayHeight * 0.5);
      const maxX = Math.max(0, (displayWidth + viewportSize.width) / 2 - minVisibleX);
      const maxY = Math.max(0, (displayHeight + viewportSize.height) / 2 - minVisibleY);

      return {
        x: clamp(nextPan.x, -maxX, maxX),
        y: clamp(nextPan.y, -maxY, maxY),
      };
    },
    [displayHeight, displayWidth, sourceImage, viewportSize]
  );

  const resetView = useCallback(() => {
    setZoom(fitZoom);
    setPan({ x: 0, y: 0 });
  }, [fitZoom]);

  useEffect(() => {
    setPan(current => clampPan(current));
  }, [clampPan]);

  const renderMaskPreview = useCallback((withBorder = false) => {
    const maskCanvas = maskCanvasRef.current;
    const previewCanvas = previewCanvasRef.current;
    if (!maskCanvas || !previewCanvas) return;

    const maskCtx = maskCanvas.getContext('2d');
    const previewCtx = previewCanvas.getContext('2d');
    if (!maskCtx || !previewCtx) return;

    previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    if (!withBorder) return;

    const data = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height).data;
    previewCtx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    for (let y = 1; y < maskCanvas.height - 1; y += 1) {
      for (let x = 1; x < maskCanvas.width - 1; x += 1) {
        const idx = (y * maskCanvas.width + x) * 4;
        if (data[idx + 3] <= 10) continue;
        const top = data[((y - 1) * maskCanvas.width + x) * 4 + 3];
        const bottom = data[((y + 1) * maskCanvas.width + x) * 4 + 3];
        const left = data[(y * maskCanvas.width + x - 1) * 4 + 3];
        const right = data[(y * maskCanvas.width + x + 1) * 4 + 3];
        if (top < 10 || bottom < 10 || left < 10 || right < 10) {
          previewCtx.fillRect(x, y, 1, 1);
        }
      }
    }
  }, []);

  const clearMask = useCallback((mode: MattingBrushMode = 'keep') => {
    const maskCanvas = maskCanvasRef.current;
    const previewCanvas = previewCanvasRef.current;
    [maskCanvas, previewCanvas].forEach(canvas => {
      const ctx = canvas?.getContext('2d');
      if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    });
    fillCommittedCanvasBackground(committedCanvasRef.current, mode);
    hasDrawnRef.current = false;
  }, []);

  useEffect(() => {
    taskAbortControllerRef.current?.abort();
    taskAbortControllerRef.current = null;
    setIsManualMatting(false);

    if (!targetId) {
      setSourceImage(null);
      setPreviewUrl('');
      setLocalHistory([]);
      setHistoryIndex(-1);
      setBrushMode('keep');
      clearMask();
      return;
    }

    const obj = engine.getObjectById(targetId) as fabric.Image | undefined;
    if (!obj || obj.type !== 'image') return;

    const canvas = engine.getCanvas();
    const historyPlugin = engine.pluginManager.get('HistoryPlugin') as any;
    const previousControls = obj.hasControls;
    const previousBorders = obj.hasBorders;

    historyPlugin?.pause?.();
    engine.disableShortcuts();
    obj.set({ hasControls: false, hasBorders: false });
    canvas.requestRenderAll();

    let restored = false;
    restoreEditorStateRef.current = () => {
      if (restored) return;
      restored = true;
      obj.set({ hasControls: previousControls, hasBorders: previousBorders });
      historyPlugin?.resume?.();
      engine.enableShortcuts();
      canvas.requestRenderAll();
    };

    const element = obj.getElement() as HTMLImageElement;
    const url = element?.src || (obj as any).getSrc?.() || '';
    const size = getNaturalSize(obj);

    setSourceImage({
      url,
      width: size.width,
      height: size.height,
      angle: obj.angle || 0,
    });
    setPreviewUrl(url);
    setLocalHistory([url]);
    setHistoryIndex(0);
    setBrushMode('keep');
    setPan({ x: 0, y: 0 });
    setZoom(clamp(Math.min((window.innerWidth * 0.82) / size.width, Math.max(240, window.innerHeight - 180) / size.height), MIN_ZOOM, MAX_ZOOM));
    hasDrawnRef.current = false;

    loadImageElement(url).catch(error => {
      console.error('[MattingOverlayV2] load source image failed:', error);
    });

    return () => {
      restoreEditorStateRef.current?.();
      restoreEditorStateRef.current = null;
    };
  }, [clearMask, engine, targetId]);

  useEffect(() => {
    if (!sourceImage) return;
    const canvases = [maskCanvasRef.current, previewCanvasRef.current, committedCanvasRef.current];
    canvases.forEach(canvas => {
      if (!canvas) return;
      canvas.width = maskSize.width;
      canvas.height = maskSize.height;
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      const ctx = canvas.getContext('2d');
      ctx?.clearRect(0, 0, maskSize.width, maskSize.height);
    });
    fillCommittedCanvasBackground(committedCanvasRef.current, 'keep');
    hasDrawnRef.current = false;
  }, [maskSize, sourceImage]);

  useEffect(() => {
    if (!targetId) return;
    document.body.style.overflow = 'hidden';
    const handleResize = () => setViewportSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', handleResize);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('resize', handleResize);
    };
  }, [targetId]);

  const zoomBy = useCallback((factor: number) => {
    if (!Number.isFinite(factor) || factor <= 0) return;
    setZoom(current => clamp(current * factor, MIN_ZOOM, MAX_ZOOM));
  }, []);

  const clientToSourcePoint = useCallback(
    (clientX: number, clientY: number): Point | null => {
      if (!sourceImage || !stageRef.current) return null;
      const rect = stageRef.current.getBoundingClientRect();
      const dx = clientX - (rect.left + rect.width / 2) - pan.x;
      const dy = clientY - (rect.top + rect.height / 2) - pan.y;
      const rad = (-(sourceImage.angle || 0) * Math.PI) / 180;
      const localX = dx * Math.cos(rad) - dy * Math.sin(rad);
      const localY = dx * Math.sin(rad) + dy * Math.cos(rad);
      const sourceX = localX / clampedZoom + sourceImage.width / 2;
      const sourceY = localY / clampedZoom + sourceImage.height / 2;
      if (sourceX < 0 || sourceY < 0 || sourceX > sourceImage.width || sourceY > sourceImage.height) return null;
      return { x: sourceX, y: sourceY };
    },
    [clampedZoom, pan, sourceImage]
  );

  const drawLine = useCallback(
    (from: Point, to: Point) => {
      const committedCtx = committedCanvasRef.current.getContext('2d');
      const maskCtx = maskCanvasRef.current?.getContext('2d');
      if (!sourceImage || !committedCtx || !maskCtx) return;

      const displayBrush = brushSize * (maskSize.width / Math.max(1, displayWidth));
      const drawContexts: Array<[CanvasRenderingContext2D, string]> = [
        [committedCtx, COMMITTED_MASK_COLORS[brushMode]],
        [maskCtx, MATTING_MASK_COLORS[brushMode]],
      ];
      drawContexts.forEach(([ctx, color]) => {
        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = Math.max(1, displayBrush);
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.moveTo(from.x * maskSize.scale, from.y * maskSize.scale);
        ctx.lineTo(to.x * maskSize.scale, to.y * maskSize.scale);
        ctx.stroke();
        ctx.restore();
      });
      hasDrawnRef.current = true;
      renderMaskPreview();
    },
    [brushMode, brushSize, displayWidth, maskSize, renderMaskPreview, sourceImage]
  );

  const drawDot = useCallback(
    (point: Point) => {
      const committedCtx = committedCanvasRef.current.getContext('2d');
      const maskCtx = maskCanvasRef.current?.getContext('2d');
      if (!committedCtx || !maskCtx) return;

      const displayBrush = brushSize * (maskSize.width / Math.max(1, displayWidth));
      const drawContexts: Array<[CanvasRenderingContext2D, string]> = [
        [committedCtx, COMMITTED_MASK_COLORS[brushMode]],
        [maskCtx, MATTING_MASK_COLORS[brushMode]],
      ];
      drawContexts.forEach(([ctx, color]) => {
        ctx.save();
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(point.x * maskSize.scale, point.y * maskSize.scale, Math.max(1, displayBrush) / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      });
      hasDrawnRef.current = true;
      renderMaskPreview();
    },
    [brushMode, brushSize, displayWidth, maskSize, renderMaskPreview]
  );

  const handlePointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (isSpacePanning) {
        isPanningRef.current = true;
        lastPanPointRef.current = { x: event.clientX, y: event.clientY };
        event.currentTarget.setPointerCapture(event.pointerId);
        return;
      }

      if (!brushMode || isAutoMatting || isManualMatting || isApplying) return;
      const point = clientToSourcePoint(event.clientX, event.clientY);
      if (!point) return;
      isDrawingRef.current = true;
      lastPointRef.current = point;
      event.currentTarget.setPointerCapture(event.pointerId);
      drawDot(point);
    },
    [brushMode, clientToSourcePoint, drawDot, isApplying, isAutoMatting, isManualMatting, isSpacePanning]
  );

  const handlePointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      setBrushPreviewPos({ x: event.clientX, y: event.clientY });

      if (isPanningRef.current && lastPanPointRef.current) {
        const nextPoint = { x: event.clientX, y: event.clientY };
        const dx = nextPoint.x - lastPanPointRef.current.x;
        const dy = nextPoint.y - lastPanPointRef.current.y;
        lastPanPointRef.current = nextPoint;
        setPan(current => clampPan({ x: current.x + dx, y: current.y + dy }));
        return;
      }

      if (!isDrawingRef.current || !lastPointRef.current) return;
      const point = clientToSourcePoint(event.clientX, event.clientY);
      if (!point) return;
      drawLine(lastPointRef.current, point);
      lastPointRef.current = point;
    },
    [clientToSourcePoint, drawLine]
  );

  const finishPointerAction = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const shouldRenderBorder = isDrawingRef.current;
      isDrawingRef.current = false;
      isPanningRef.current = false;
      lastPointRef.current = null;
      lastPanPointRef.current = null;
      if (shouldRenderBorder) renderMaskPreview(true);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    },
    [renderMaskPreview]
  );

  const pushHistory = useCallback(
    (url: string) => {
      setLocalHistory(current => {
        const base = current.slice(0, Math.max(0, historyIndex + 1));
        return [...base, url];
      });
      setHistoryIndex(current => current + 1);
      setPreviewUrl(url);
    },
    [historyIndex]
  );

  const handleUndo = useCallback(() => {
    if (historyIndex <= 0) return;
    const nextIndex = historyIndex - 1;
    setHistoryIndex(nextIndex);
    setPreviewUrl(localHistory[nextIndex]);
  }, [historyIndex, localHistory]);

  const handleRedo = useCallback(() => {
    if (historyIndex >= localHistory.length - 1) return;
    const nextIndex = historyIndex + 1;
    setHistoryIndex(nextIndex);
    setPreviewUrl(localHistory[nextIndex]);
  }, [historyIndex, localHistory]);

  const getMaskBlob = useCallback(async () => {
    if (!sourceImage) return null;
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = sourceImage.width;
    exportCanvas.height = sourceImage.height;
    const ctx = exportCanvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(committedCanvasRef.current, 0, 0, maskSize.width, maskSize.height, 0, 0, sourceImage.width, sourceImage.height);
    return new Promise<Blob | null>(resolve => exportCanvas.toBlob(resolve, 'image/png'));
  }, [maskSize, sourceImage]);

  const handleAutoMatting = useCallback(async () => {
    if (!sourceImage || isAutoMatting) return;
    setIsAutoMatting(true);
    try {
      const result: any = await autoMatting(withoutQuery(sourceImage.url));
      const nextUrl = result?.data?.mattingImageUrl;
      if (!nextUrl) return;
      await loadImageElement(nextUrl);
      pushHistory(nextUrl);
    } catch (error) {
      console.error('[MattingOverlayV2] autoMatting failed:', error);
    } finally {
      setIsAutoMatting(false);
    }
  }, [isAutoMatting, pushHistory, sourceImage]);

  const handleManualMatting = useCallback(async () => {
    if (!sourceImage || !brushMode || isManualMatting) return;

    if (!hasDrawnRef.current) {
      toast.warning(`请先涂抹需要${brushMode === 'keep' ? '保留' : '去除'}的区域`);
      return;
    }

    const numericCanvasId = Number(canvasId);
    if (!canvasId || !Number.isInteger(numericCanvasId) || !nodeId) {
      toast.error('画布上下文信息缺失，请刷新后再试');
      return;
    }

    const maskBlob = await getMaskBlob();
    if (!maskBlob) {
      toast.error('蒙版生成失败，请重试');
      return;
    }

    taskAbortControllerRef.current?.abort();
    const controller = new AbortController();
    taskAbortControllerRef.current = controller;
    setIsManualMatting(true);
    try {
      const nextUrl = await runImageInpaintTask({
        mode: brushMode,
        canvasId: numericCanvasId,
        nodeId,
        imageUrl: withoutQuery(previewUrl || sourceImage.url),
        maskBlob,
        signal: controller.signal,
      });
      await loadImageElement(nextUrl);
      pushHistory(nextUrl);
      clearMask(brushMode);
    } catch (error) {
      if (!controller.signal.aborted) {
        console.error('[MattingOverlayV2] image inpaint task failed:', error);
        toast.error(error instanceof Error ? error.message : '抠图任务失败，请重试');
      }
    } finally {
      if (taskAbortControllerRef.current === controller) {
        taskAbortControllerRef.current = null;
        setIsManualMatting(false);
      }
    }
  }, [brushMode, canvasId, clearMask, getMaskBlob, isManualMatting, nodeId, previewUrl, pushHistory, sourceImage]);

  const applyImageUrl = useCallback(
    async (url: string) => {
      if (!targetId) return null;
      const obj = engine.getObjectById(targetId) as fabric.Image | undefined;
      if (!obj) return null;

      const oldWidth = obj.width || 1;
      const oldHeight = obj.height || 1;
      const oldScaleX = obj.scaleX || 1;
      const oldScaleY = obj.scaleY || 1;
      const newImage = await fabric.FabricImage.fromURL(url, { crossOrigin: 'anonymous' });
      const size = getNaturalSize(newImage);

      obj.setElement(newImage.getElement());
      obj.set({
        width: size.width,
        height: size.height,
        scaleX: (oldWidth * oldScaleX) / size.width,
        scaleY: (oldHeight * oldScaleY) / size.height,
      });
      obj.setCoords();
      engine.getCanvas().requestRenderAll();
      return obj;
    },
    [engine, targetId]
  );

  const restoreEditorState = useCallback(() => {
    restoreEditorStateRef.current?.();
    restoreEditorStateRef.current = null;
  }, []);

  const handleCancel = useCallback(() => {
    taskAbortControllerRef.current?.abort();
    taskAbortControllerRef.current = null;
    setIsManualMatting(false);
    restoreEditorState();
    onCancelRef.current();
  }, [restoreEditorState]);

  const handleConfirm = useCallback(async () => {
    if (!sourceImage || isApplying) return;
    setIsApplying(true);
    try {
      const changed = previewUrl && previewUrl !== sourceImage.url;
      const obj = changed ? await applyImageUrl(previewUrl) : targetId ? (engine.getObjectById(targetId) as fabric.Image | undefined) : undefined;
      restoreEditorState();
      if (obj && changed) {
        engine.getCanvas().fire('object:modified', { target: obj });
      }
      setIsApplying(false);
      onConfirmRef.current();
    } catch (error) {
      console.error('[MattingOverlayV2] confirm failed:', error);
      setIsApplying(false);
    }
  }, [applyImageUrl, engine, isApplying, previewUrl, restoreEditorState, sourceImage, targetId]);

  useEffect(() => {
    if (!targetId) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        handleCancel();
        return;
      }

      if (event.code === 'Space' && !isSpacePressedRef.current) {
        event.preventDefault();
        isSpacePressedRef.current = true;
        setIsSpacePanning(true);
        return;
      }

      if (event.key === 'Backspace' || event.key === 'Delete') {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      if (!event.metaKey && !event.ctrlKey) return;
      if (event.key === '=' || event.key === '+') {
        event.preventDefault();
        zoomBy(1.12);
      } else if (event.key === '-') {
        event.preventDefault();
        zoomBy(1 / 1.12);
      } else if (event.key === '0') {
        event.preventDefault();
        resetView();
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return;
      event.preventDefault();
      isSpacePressedRef.current = false;
      setIsSpacePanning(false);
      isPanningRef.current = false;
      lastPanPointRef.current = null;
    };

    const handleWheel = (event: WheelEvent) => {
      if (event.cancelable) event.preventDefault();
      event.stopPropagation();

      if (event.ctrlKey || event.metaKey) {
        const factor = clamp(Math.exp(-event.deltaY * WHEEL_ZOOM_SPEED), 0.86, 1.16);
        zoomBy(factor);
        return;
      }

      setPan(current =>
        clampPan({
          x: current.x - event.deltaX * PAN_WHEEL_FACTOR,
          y: current.y - event.deltaY * PAN_WHEEL_FACTOR,
        })
      );
    };

    const preventGestureDefault = (event: Event) => {
      if (event.cancelable) event.preventDefault();
      event.stopPropagation();
    };

    const handleGestureStart = (event: Event) => {
      preventGestureDefault(event);
      gestureScaleRef.current = (event as GestureLikeEvent).scale || 1;
    };

    const handleGestureChange = (event: Event) => {
      preventGestureDefault(event);
      const scale = (event as GestureLikeEvent).scale;
      if (!scale || !Number.isFinite(scale)) return;
      const previousScale = gestureScaleRef.current || scale;
      zoomBy(clamp(scale / previousScale, 0.86, 1.16));
      gestureScaleRef.current = scale;
    };

    const handleGestureEnd = (event: Event) => {
      preventGestureDefault(event);
      gestureScaleRef.current = null;
    };

    document.addEventListener('keydown', handleKeyDown, { passive: false });
    document.addEventListener('keyup', handleKeyUp);
    document.addEventListener('wheel', handleWheel, { passive: false, capture: true });
    window.addEventListener('gesturestart', handleGestureStart, { passive: false, capture: true });
    window.addEventListener('gesturechange', handleGestureChange, { passive: false, capture: true });
    window.addEventListener('gestureend', handleGestureEnd, { passive: false, capture: true });

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
      document.removeEventListener('wheel', handleWheel, { capture: true });
      window.removeEventListener('gesturestart', handleGestureStart, { capture: true });
      window.removeEventListener('gesturechange', handleGestureChange, { capture: true });
      window.removeEventListener('gestureend', handleGestureEnd, { capture: true });
    };
  }, [clampPan, handleCancel, resetView, targetId, zoomBy]);

  const handleBrushSizeChange = useCallback(
    (value: number[]) => {
      setBrushSize(value[0]);
      if (brushMode) setShowBrushPreview(true);
      setBrushPreviewPos({ x: viewportSize.width / 2, y: viewportSize.height - 118 });
    },
    [brushMode, viewportSize]
  );

  const handleBrushSizeCommit = useCallback(() => {
    window.setTimeout(() => setShowBrushPreview(false), 300);
  }, []);

  const handleBrushModeChange = useCallback(
    (mode: MattingBrushMode) => {
      if (brushMode === mode) return;
      clearMask(mode);
      setShowBrushPreview(false);
      setBrushMode(mode);
    },
    [brushMode, clearMask]
  );

  if (!targetId || !sourceImage) return null;

  const isLoading = isAutoMatting || isManualMatting || isApplying;
  const frameStyle: CSSProperties = {
    position: 'absolute',
    left: `calc(50% + ${pan.x}px)`,
    top: `calc(50% + ${pan.y}px)`,
    width: displayWidth,
    height: displayHeight,
    transform: `translate(-50%, -50%) rotate(${sourceImage.angle}deg)`,
    transformOrigin: 'center center',
    willChange: 'transform, width, height',
  };

  return (
    <div
      ref={stageRef}
      className={`fixed inset-0 z-[1000] overflow-hidden ${isSpacePanning ? 'cursor-grab active:cursor-grabbing' : brushMode ? 'cursor-crosshair' : 'cursor-default'}`}
      style={{
        pointerEvents: 'auto',
        touchAction: 'none',
        backgroundColor: 'rgba(0, 0, 0, 0.9)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishPointerAction}
      onPointerCancel={finishPointerAction}
    >
      <div style={frameStyle}>
        <img src={previewUrl} crossOrigin='anonymous' draggable={false} className='absolute inset-0 h-full w-full select-none' />
        <canvas ref={maskCanvasRef} className='absolute inset-0 h-full w-full opacity-50 pointer-events-none' width={maskSize.width} height={maskSize.height} />
        <canvas ref={previewCanvasRef} className='absolute inset-0 h-full w-full pointer-events-none' width={maskSize.width} height={maskSize.height} />
        {isLoading && (
          <div className='absolute inset-0 z-10 overflow-hidden flex items-center justify-center pointer-events-auto'>
            <div className='absolute inset-0 bg-black/20' />
            <div className='absolute inset-0 pointer-events-none'>
              <div className='absolute inset-0 -skew-x-12 animate-shimmer bg-gradient-to-r from-transparent via-white/60 to-transparent' />
            </div>
            <div className='relative z-10 flex items-center gap-2 px-3 py-1.5 bg-black/80 rounded-full backdrop-blur-sm border border-white/10 shadow-lg'>
              <span className='text-white text-xs font-medium tracking-wide'>{isAutoMatting ? 'AI 自动识别中...' : 'AI 处理中...'}</span>
            </div>
          </div>
        )}
      </div>

      {showBrushPreview && (
        <div
          className={`fixed pointer-events-none rounded-full border-2 ${brushMode === 'keep' ? 'border-emerald-400 bg-emerald-400/10' : 'border-blue-400 bg-blue-400/10'}`}
          style={{
            left: brushPreviewPos.x - brushSize / 2,
            top: brushPreviewPos.y - brushSize / 2,
            width: brushSize,
            height: brushSize,
          }}
        />
      )}

      <MattingActionToolbar
        isLoading={isLoading}
        brushSize={brushSize}
        brushMode={brushMode}
        historyIndex={historyIndex}
        localHistoryLength={localHistory.length}
        onAutoMatting={handleAutoMatting}
        onBrushModeChange={handleBrushModeChange}
        onBrushSizeChange={handleBrushSizeChange}
        onBrushSizeCommit={handleBrushSizeCommit}
        onRefresh={() => clearMask(brushMode)}
        onManualMatting={handleManualMatting}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onCancel={handleCancel}
        onConfirm={handleConfirm}
      />
    </div>
  );
}
