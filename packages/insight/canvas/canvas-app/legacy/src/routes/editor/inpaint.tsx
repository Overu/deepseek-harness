import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, Paintbrush } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { createExternalTask, calculateExternalTaskCost } from '@/api/tool';
import { syncCanvasVersionNumber } from '@/store/flowStore';
import { uploadFile } from '@/services/upload/uploadFile';
import { InpaintCanvas } from './components/Inpaint/InpaintCanvas';
import { InpaintToolbar, type InpaintResolution, type InpaintToolMode } from './components/Inpaint/InpaintToolbar';
import { useInpaintEngine } from './hooks/useInpaintEngine';

export interface ImageInpaintExtensionProps {
  canvasId?: string;
  nodeId?: string;
  value?: string;
  imageList?: string[];
  onClose?: () => void;
  onPrepareChildNode: () => Promise<string | undefined>;
  onSubmitFailure: (childNodeId: string, message: string) => void;
  onSuccess?: (value: string, meta?: { finalUrl?: boolean; childNodeId?: string }) => void;
}

type Point = { x: number; y: number };
type GestureLikeEvent = Event & { scale?: number };

const MASK_EXPORT_MAX_SIZE = 1024;
const MASK_FILL_STYLE = 'rgb(59, 130, 246)';
const MASK_DISPLAY_FILL_STYLE = 'rgba(59, 130, 246, 0.6)';
const MASK_BORDER_FILL_STYLE = 'rgba(255, 255, 255, 0.9)';
const WHEEL_ZOOM_BASE = 0.999;

const canvasToBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) => {
  return new Promise<Blob | null>(resolve => canvas.toBlob(resolve, type, quality));
};

const isEditableShortcutTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return target.isContentEditable || tagName === 'input' || tagName === 'textarea' || tagName === 'select';
};

const hashBlob = async (blob: Blob) => {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map(value => value.toString(16).padStart(2, '0'))
    .join('');
};

export default function ImageInpaintExtension(props: ImageInpaintExtensionProps) {
  const initialPropsRef = useRef(props);
  const { canvasId, nodeId, value, imageList, onClose, onPrepareChildNode, onSubmitFailure, onSuccess } = initialPropsRef.current;
  const targetImageUrl = imageList && imageList.length > 0 ? imageList[0] : value;
  const { canvasRef, containerRef, isReady, imageInfo, recenter, zoomBy, panBy } = useInpaintEngine(targetImageUrl);
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const committedCanvasRef = useRef<HTMLCanvasElement>(document.createElement('canvas'));
  const tintCanvasRef = useRef<HTMLCanvasElement>(document.createElement('canvas'));
  const borderCanvasRef = useRef<HTMLCanvasElement>(document.createElement('canvas'));
  const isDrawingRef = useRef(false);
  const startPointRef = useRef<Point | null>(null);
  const snapshotRef = useRef<ImageData | null>(null);
  const lastPointRef = useRef<Point | null>(null);
  const lastPanPointRef = useRef<Point | null>(null);
  const pendingZoomFactorRef = useRef(1);
  const zoomFrameRef = useRef<number | null>(null);
  const gestureScaleRef = useRef<number | null>(null);
  const pointsCacheRef = useRef<Partial<Record<InpaintResolution, number | string>>>({});

  const [mode, setMode] = useState<InpaintToolMode>('default');
  const [isPanning, setIsPanning] = useState(false);
  const [brushSize, setBrushSize] = useState(36);
  const [prompt, setPrompt] = useState('');
  const [resolution, setResolution] = useState<InpaintResolution>('1K');
  const [isSending, setIsSending] = useState(false);
  const [points, setPoints] = useState<number | string | null>(null);
  const [isPointsLoading, setIsPointsLoading] = useState(true);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [brushCursorPoint, setBrushCursorPoint] = useState<Point | null>(null);

  const editWidth = imageInfo?.editWidth;
  const editHeight = imageInfo?.editHeight;
  const canUndo = historyIndex > 0;
  const canRedo = historyIndex >= 0 && historyIndex < history.length - 1;

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  useEffect(() => {
    if (!canvasId || !nodeId || !targetImageUrl) {
      setPoints(0);
      setIsPointsLoading(false);
      return;
    }

    const cachedPoints = pointsCacheRef.current[resolution];
    if (cachedPoints !== undefined) {
      setPoints(cachedPoints);
      setIsPointsLoading(false);
      return;
    }

    let cancelled = false;
    setPoints(null);
    setIsPointsLoading(true);

    const timer = window.setTimeout(async () => {
      try {
        const { code, data }: any = await calculateExternalTaskCost({
          type: 'PARTIAL_REDRAWING',
          canvasId,
          nodeId,
          data: {
            imageUrl: targetImageUrl,
            imageParam: {
              resolution,
            },
          },
        });

        if (cancelled) return;
        if (code === 'SUCCESS' && data !== undefined && data !== null) {
          pointsCacheRef.current[resolution] = data;
          setPoints(data);
          return;
        }
        setPoints(null);
      } catch (error) {
        if (!cancelled) {
          console.error('[ImageInpaint] fetch points failed:', error);
          setPoints(0);
        }
      } finally {
        if (!cancelled) setIsPointsLoading(false);
      }
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [canvasId, nodeId, resolution, targetImageUrl]);

  const queueZoom = useCallback(
    (factor: number) => {
      if (!Number.isFinite(factor) || factor <= 0) return;
      pendingZoomFactorRef.current *= factor;
      if (zoomFrameRef.current !== null) return;

      zoomFrameRef.current = requestAnimationFrame(() => {
        zoomFrameRef.current = null;
        const nextFactor = pendingZoomFactorRef.current;
        pendingZoomFactorRef.current = 1;
        zoomBy(nextFactor);
      });
    },
    [zoomBy]
  );

  useEffect(() => {
    return () => {
      if (zoomFrameRef.current !== null) {
        cancelAnimationFrame(zoomFrameRef.current);
        zoomFrameRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const handleWheel = (event: WheelEvent) => {
      if (event.cancelable) event.preventDefault();
      event.stopPropagation();
      queueZoom(WHEEL_ZOOM_BASE ** event.deltaY);
    };

    const preventGestureDefault = (event: Event) => {
      if (event.cancelable) event.preventDefault();
      event.stopPropagation();
    };

    const getGestureScale = (event: Event) => {
      const scale = (event as GestureLikeEvent).scale;
      return typeof scale === 'number' && Number.isFinite(scale) && scale > 0 ? scale : null;
    };

    const handleGestureStart = (event: Event) => {
      preventGestureDefault(event);
      gestureScaleRef.current = getGestureScale(event) ?? 1;
    };

    const handleGestureChange = (event: Event) => {
      preventGestureDefault(event);
      const scale = getGestureScale(event);
      if (!scale) return;

      const previousScale = gestureScaleRef.current ?? scale;
      if (previousScale > 0) {
        queueZoom(scale / previousScale);
      }
      gestureScaleRef.current = scale;
    };

    const handleGestureEnd = (event: Event) => {
      preventGestureDefault(event);
      gestureScaleRef.current = null;
    };

    document.addEventListener('wheel', handleWheel, { passive: false, capture: true });
    window.addEventListener('gesturestart', handleGestureStart, { passive: false, capture: true });
    window.addEventListener('gesturechange', handleGestureChange, { passive: false, capture: true });
    window.addEventListener('gestureend', handleGestureEnd, { passive: false, capture: true });
    return () => {
      document.removeEventListener('wheel', handleWheel, { capture: true });
      window.removeEventListener('gesturestart', handleGestureStart, { capture: true });
      window.removeEventListener('gesturechange', handleGestureChange, { capture: true });
      window.removeEventListener('gestureend', handleGestureEnd, { capture: true });
    };
  }, [queueZoom]);

  const syncMaskCanvasSize = useCallback(() => {
    const canvas = maskCanvasRef.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) return;

    const width = parent.clientWidth;
    const height = parent.clientHeight;
    if (width <= 0 || height <= 0 || (canvas.width === width && canvas.height === height)) return;

    canvas.width = width;
    canvas.height = height;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    tintCanvasRef.current.width = width;
    tintCanvasRef.current.height = height;
    borderCanvasRef.current.width = width;
    borderCanvasRef.current.height = height;
  }, []);

  const syncCommittedCanvasSize = useCallback(() => {
    if (!editWidth || !editHeight) return false;
    const canvas = committedCanvasRef.current;
    if (canvas.width === editWidth && canvas.height === editHeight) return false;

    canvas.width = editWidth;
    canvas.height = editHeight;
    return true;
  }, [editHeight, editWidth]);

  const renderDisplayMask = useCallback(() => {
    const canvas = maskCanvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    if (!imageInfo) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    const tintCanvas = tintCanvasRef.current;
    tintCanvas.width = canvas.width;
    tintCanvas.height = canvas.height;
    const tintCtx = tintCanvas.getContext('2d');
    const borderCanvas = borderCanvasRef.current;
    borderCanvas.width = canvas.width;
    borderCanvas.height = canvas.height;
    const borderCtx = borderCanvas.getContext('2d');
    if (!tintCtx || !borderCtx) return;

    const drawMask = (targetCtx: CanvasRenderingContext2D, offsetX = 0, offsetY = 0) => {
      targetCtx.drawImage(
        committedCanvasRef.current,
        imageInfo.screenRect.left + offsetX,
        imageInfo.screenRect.top + offsetY,
        imageInfo.screenRect.width,
        imageInfo.screenRect.height
      );
    };

    const paintTintCanvas = (color: string) => {
      tintCtx.globalCompositeOperation = 'source-in';
      tintCtx.fillStyle = color;
      tintCtx.fillRect(0, 0, tintCanvas.width, tintCanvas.height);
      tintCtx.globalCompositeOperation = 'source-over';

      ctx.save();
      ctx.drawImage(tintCanvas, 0, 0);
      ctx.restore();
    };

    const drawTintedCanvas = (sourceCanvas: HTMLCanvasElement, color: string) => {
      tintCtx.clearRect(0, 0, tintCanvas.width, tintCanvas.height);
      tintCtx.globalAlpha = 1;
      tintCtx.globalCompositeOperation = 'source-over';
      tintCtx.drawImage(sourceCanvas, 0, 0);
      paintTintCanvas(color);
    };

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    tintCtx.clearRect(0, 0, tintCanvas.width, tintCanvas.height);
    tintCtx.globalCompositeOperation = 'source-over';
    drawMask(tintCtx);
    paintTintCanvas(MASK_DISPLAY_FILL_STYLE);

    borderCtx.clearRect(0, 0, borderCanvas.width, borderCanvas.height);
    borderCtx.globalCompositeOperation = 'source-over';
    [-1, 0, 1].forEach(offsetX => {
      [-1, 0, 1].forEach(offsetY => {
        if (offsetX !== 0 || offsetY !== 0) drawMask(borderCtx, offsetX, offsetY);
      });
    });
    borderCtx.globalCompositeOperation = 'destination-out';
    drawMask(borderCtx);
    borderCtx.globalCompositeOperation = 'source-over';
    drawTintedCanvas(borderCanvas, MASK_BORDER_FILL_STYLE);
  }, [imageInfo]);

  const clearMask = useCallback(() => {
    const canvas = maskCanvasRef.current;
    const ctx = canvas?.getContext('2d');
    const committedCtx = committedCanvasRef.current.getContext('2d');
    if (!canvas || !ctx || !committedCtx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    committedCtx.clearRect(0, 0, committedCanvasRef.current.width, committedCanvasRef.current.height);
  }, []);

  const pushHistory = useCallback(() => {
    const next = committedCanvasRef.current.toDataURL('image/png');
    setHistory(prev => {
      const trimmed = prev.slice(0, historyIndex + 1);
      trimmed.push(next);
      return trimmed;
    });
    setHistoryIndex(prev => prev + 1);
  }, [historyIndex]);

  useEffect(() => {
    if (!isReady || !editWidth || !editHeight) return;
    syncMaskCanvasSize();
    syncCommittedCanvasSize();
    clearMask();
    requestAnimationFrame(() => {
      setHistory([committedCanvasRef.current.toDataURL('image/png')]);
      setHistoryIndex(0);
    });
  }, [clearMask, editHeight, editWidth, isReady, syncCommittedCanvasSize, syncMaskCanvasSize, targetImageUrl]);

  useEffect(() => {
    syncMaskCanvasSize();
    renderDisplayMask();
  }, [imageInfo, renderDisplayMask, syncMaskCanvasSize]);

  const restoreHistory = useCallback(
    (index: number) => {
      const committedCtx = committedCanvasRef.current.getContext('2d');
      const src = history[index];
      if (!committedCtx || !src) return;

      const image = new Image();
      image.onload = () => {
        committedCtx.clearRect(0, 0, committedCanvasRef.current.width, committedCanvasRef.current.height);
        committedCtx.drawImage(image, 0, 0, committedCanvasRef.current.width, committedCanvasRef.current.height);
        renderDisplayMask();
      };
      image.src = src;
      setHistoryIndex(index);
    },
    [history, renderDisplayMask]
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.altKey) return;
      if (!event.metaKey && !event.ctrlKey) return;
      const key = event.key.toLowerCase();

      if (key === 'z') {
        if (isEditableShortcutTarget(event.target)) return;
        event.preventDefault();
        if (event.shiftKey) {
          if (!canRedo) return;
          restoreHistory(historyIndex + 1);
          return;
        }
        if (!canUndo) return;
        restoreHistory(historyIndex - 1);
        return;
      }

      if (key === 'y') {
        if (isEditableShortcutTarget(event.target)) return;
        event.preventDefault();
        if (!canRedo) return;
        restoreHistory(historyIndex + 1);
        return;
      }

      if (event.key === '=' || event.key === '+') {
        event.preventDefault();
        queueZoom(1.12);
      } else if (event.key === '-') {
        event.preventDefault();
        queueZoom(1 / 1.12);
      } else if (event.key === '0') {
        event.preventDefault();
        recenter();
      }
    };

    document.addEventListener('keydown', handleKeyDown, { passive: false });
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [canRedo, canUndo, historyIndex, queueZoom, recenter, restoreHistory]);

  const pointFromEvent = (event: React.PointerEvent<HTMLCanvasElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  };

  const isPointInImage = useCallback(
    (point: Point) => {
      if (!imageInfo) return false;
      const { screenRect } = imageInfo;
      return point.x >= screenRect.left && point.x <= screenRect.left + screenRect.width && point.y >= screenRect.top && point.y <= screenRect.top + screenRect.height;
    },
    [imageInfo]
  );

  const updateBrushCursorPoint = useCallback(
    (point: Point) => {
      if ((mode !== 'brush' && mode !== 'eraser') || isSending || !isPointInImage(point)) {
        setBrushCursorPoint(null);
        return;
      }
      setBrushCursorPoint(point);
    },
    [isPointInImage, isSending, mode]
  );

  const pointToImagePoint = useCallback(
    (point: Point): Point | null => {
      if (!imageInfo) return null;
      const { screenRect } = imageInfo;
      if (screenRect.width <= 0 || screenRect.height <= 0) return null;
      return {
        x: ((point.x - screenRect.left) / screenRect.width) * imageInfo.editWidth,
        y: ((point.y - screenRect.top) / screenRect.height) * imageInfo.editHeight,
      };
    },
    [imageInfo]
  );

  const getLocalBrushSize = useCallback(() => {
    if (!imageInfo || imageInfo.screenRect.width <= 0) return brushSize;
    return brushSize * (imageInfo.editWidth / imageInfo.screenRect.width);
  }, [brushSize, imageInfo]);

  const applyImageClip = useCallback((ctx: CanvasRenderingContext2D) => {
    const canvas = committedCanvasRef.current;
    if (canvas.width <= 0 || canvas.height <= 0) return false;
    ctx.beginPath();
    ctx.rect(0, 0, canvas.width, canvas.height);
    ctx.clip();
    return true;
  }, []);

  const drawLine = useCallback(
    (from: Point, to: Point) => {
      const ctx = committedCanvasRef.current.getContext('2d');
      if (!ctx) return;

      ctx.save();
      if (!applyImageClip(ctx)) {
        ctx.restore();
        return;
      }
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = getLocalBrushSize();
      if (mode === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.strokeStyle = 'rgba(0,0,0,1)';
      } else {
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = MASK_FILL_STYLE;
      }
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
      ctx.restore();
      renderDisplayMask();
    },
    [applyImageClip, getLocalBrushSize, mode, renderDisplayMask]
  );

  const drawDot = useCallback(
    (point: Point) => {
      const ctx = committedCanvasRef.current.getContext('2d');
      if (!ctx) return;

      ctx.save();
      if (!applyImageClip(ctx)) {
        ctx.restore();
        return;
      }
      ctx.beginPath();
      if (mode === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = 'rgba(0,0,0,1)';
      } else {
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = MASK_FILL_STYLE;
      }
      ctx.arc(point.x, point.y, getLocalBrushSize() / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      renderDisplayMask();
    },
    [applyImageClip, getLocalBrushSize, mode, renderDisplayMask]
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (!isReady || isSending) return;
      syncMaskCanvasSize();
      syncCommittedCanvasSize();

      const screenPoint = pointFromEvent(event);
      updateBrushCursorPoint(screenPoint);
      if (!isPointInImage(screenPoint)) return;
      event.currentTarget.setPointerCapture(event.pointerId);

      if (mode === 'default') {
        lastPanPointRef.current = screenPoint;
        setIsPanning(true);
        return;
      }

      const point = pointToImagePoint(screenPoint);
      if (!point) return;
      isDrawingRef.current = true;
      startPointRef.current = point;
      lastPointRef.current = point;
      const committedCtx = committedCanvasRef.current.getContext('2d');
      snapshotRef.current = committedCtx?.getImageData(0, 0, committedCanvasRef.current.width, committedCanvasRef.current.height) || null;

      if (mode !== 'box') {
        drawDot(point);
      }
    },
    [drawDot, isPointInImage, isReady, isSending, mode, pointToImagePoint, syncCommittedCanvasSize, syncMaskCanvasSize, updateBrushCursorPoint]
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (mode === 'default') {
        if (!lastPanPointRef.current) return;
        const point = pointFromEvent(event);
        setBrushCursorPoint(null);
        panBy(point.x - lastPanPointRef.current.x, point.y - lastPanPointRef.current.y);
        lastPanPointRef.current = point;
        return;
      }

      const screenPoint = pointFromEvent(event);
      updateBrushCursorPoint(screenPoint);
      if (!isDrawingRef.current || !startPointRef.current) return;

      const ctx = committedCanvasRef.current.getContext('2d');
      const point = pointToImagePoint(screenPoint);
      if (!ctx) return;
      if (!point) return;

      if (mode === 'box') {
        if (snapshotRef.current) {
          ctx.putImageData(snapshotRef.current, 0, 0);
        }
        const start = startPointRef.current;
        ctx.save();
        if (!applyImageClip(ctx)) {
          ctx.restore();
          return;
        }
        ctx.fillStyle = MASK_FILL_STYLE;
        ctx.fillRect(start.x, start.y, point.x - start.x, point.y - start.y);
        ctx.restore();
        renderDisplayMask();
        return;
      }

      if (lastPointRef.current) {
        drawLine(lastPointRef.current, point);
      }
      lastPointRef.current = point;
    },
    [applyImageClip, drawLine, mode, panBy, pointToImagePoint, renderDisplayMask, updateBrushCursorPoint]
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (lastPanPointRef.current) {
        lastPanPointRef.current = null;
        setIsPanning(false);
        setBrushCursorPoint(null);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        return;
      }

      if (!isDrawingRef.current) return;
      isDrawingRef.current = false;
      startPointRef.current = null;
      lastPointRef.current = null;
      snapshotRef.current = null;

      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }

      pushHistory();
    },
    [pushHistory]
  );

  const handleModeChange = useCallback((nextMode: InpaintToolMode) => {
    lastPanPointRef.current = null;
    setIsPanning(false);
    setBrushCursorPoint(null);
    setMode(nextMode);
  }, []);

  const handlePointerLeave = useCallback(() => {
    setBrushCursorPoint(null);
  }, []);

  const exportMaskBlob = useCallback(async () => {
    if (!imageInfo) return null;

    const sourceCanvas = committedCanvasRef.current;
    if (sourceCanvas.width <= 0 || sourceCanvas.height <= 0) return null;

    const { editWidth, editHeight } = imageInfo;
    const maxSide = Math.min(MASK_EXPORT_MAX_SIZE, Math.max(editWidth, editHeight));
    const ratio = maxSide / Math.max(editWidth, editHeight);
    const exportWidth = Math.max(1, Math.round(editWidth * ratio));
    const exportHeight = Math.max(1, Math.round(editHeight * ratio));

    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = exportWidth;
    exportCanvas.height = exportHeight;
    const exportCtx = exportCanvas.getContext('2d', { willReadFrequently: true });
    if (!exportCtx) return null;

    exportCtx.drawImage(sourceCanvas, 0, 0, sourceCanvas.width, sourceCanvas.height, 0, 0, exportWidth, exportHeight);
    const imageData = exportCtx.getImageData(0, 0, exportWidth, exportHeight);
    let hasMask = false;
    for (let i = 0; i < imageData.data.length; i += 4) {
      const alpha = imageData.data[i + 3];
      if (alpha > 10) {
        imageData.data[i] = 255;
        imageData.data[i + 1] = 255;
        imageData.data[i + 2] = 255;
        imageData.data[i + 3] = 255;
        hasMask = true;
      } else {
        imageData.data[i] = 0;
        imageData.data[i + 1] = 0;
        imageData.data[i + 2] = 0;
        imageData.data[i + 3] = 255;
      }
    }
    if (!hasMask) return null;

    exportCtx.putImageData(imageData, 0, 0);
    return canvasToBlob(exportCanvas, 'image/jpeg', 1);
  }, [imageInfo]);

  const handleSend = useCallback(async () => {
    if (!isReady) {
      toast.error('编辑器尚未初始化完成，请稍后');
      return;
    }
    if (isSending) return;
    if (!targetImageUrl) {
      toast.error('未获取到有效的原图地址');
      return;
    }
    if (!canvasId || !nodeId) {
      toast.error('画板上下文信息缺失，请刷新后再试');
      return;
    }
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      toast.error('请输入重绘描述');
      return;
    }

    setIsSending(true);
    let childNodeId = '';
    try {
      const maskBlob = await exportMaskBlob();
      if (!maskBlob) {
        toast.error('请先标注需要重绘的区域');
        return;
      }

      const maskHash = await hashBlob(maskBlob);
      const maskFile = new File([maskBlob], `${maskHash}.jpg`, { type: 'image/jpeg' });
      const maskImageUrl = (await uploadFile(maskFile)).url;
      childNodeId = (await onPrepareChildNode()) || '';
      if (!childNodeId) {
        toast.error('创建输出节点失败');
        return;
      }

      const submitParams: any = {
        type: 'PARTIAL_REDRAWING',
        canvasId,
        nodeId,
        data: {
          prompt: trimmedPrompt,
          imageUrl: targetImageUrl,
          imageParam: {
            resolution,
            maskImageUrl,
          },
          childNodeIds: [childNodeId],
        },
      };

      console.log('[ImageInpaint] submit params:', submitParams);
      const { code, data, message, msg }: any = await createExternalTask(submitParams);
      syncCanvasVersionNumber(canvasId, data?.versionNumber);

      if (code !== 'SUCCESS') {
        const errorMessage = message || msg || '局部重绘任务提交失败';
        onSubmitFailure(childNodeId, errorMessage);
        toast.error(errorMessage);
        return;
      }

      if (data?.taskId) {
        toast.success('局部重绘任务提交成功');
        onSuccess?.(data.taskId, { childNodeId });
        onClose?.();
        return;
      }

      onSubmitFailure(childNodeId, '未获取到局部重绘任务 ID，请重试');
      toast.error('未获取到局部重绘任务 ID，请重试');
    } catch (error: any) {
      console.error('[ImageInpaint] submit failed:', error);
      const errorMessage = error?.message || '局部重绘任务提交失败，请重试';
      if (childNodeId) {
        onSubmitFailure(childNodeId, errorMessage);
      }
      toast.error(errorMessage);
    } finally {
      setIsSending(false);
    }
  }, [canvasId, exportMaskBlob, isReady, isSending, nodeId, onClose, onPrepareChildNode, onSubmitFailure, onSuccess, prompt, resolution, targetImageUrl]);

  return (
    <Dialog open modal={false} onOpenChange={open => !open && onClose?.()}>
      <DialogTitle className='sr-only'>图像局部重绘编辑器</DialogTitle>
      <DialogContent
        showCloseButton={false}
        overlayClassName='z-[39]'
        className='z-[40] h-screen w-screen max-w-none rounded-none border-none bg-black p-0 overflow-hidden'
        onInteractOutside={event => event.preventDefault()}
        onEscapeKeyDown={event => event.preventDefault()}
      >
        <InpaintCanvas
          canvasRef={canvasRef}
          maskCanvasRef={node => {
            maskCanvasRef.current = node;
            if (node) requestAnimationFrame(syncMaskCanvasSize);
          }}
          containerRef={containerRef}
          isReady={isReady}
          cursorClassName={
            mode === 'default'
              ? isPanning
                ? 'cursor-grabbing'
                : 'cursor-grab'
              : mode === 'box'
                ? 'cursor-crosshair'
                : mode === 'brush' || mode === 'eraser'
                  ? brushCursorPoint
                    ? 'cursor-none'
                    : 'cursor-default'
                  : 'cursor-crosshair'
          }
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerLeave}
        />

        {imageInfo && (
          <div
            className='pointer-events-none absolute z-[41] border-2 border-white'
            style={{
              left: imageInfo.screenRect.left,
              top: imageInfo.screenRect.top,
              width: imageInfo.screenRect.width,
              height: imageInfo.screenRect.height,
            }}
          />
        )}

        {brushCursorPoint && (mode === 'brush' || mode === 'eraser') && (
          <div
            className='pointer-events-none absolute z-[42] flex items-center justify-center rounded-full border-2 border-white bg-[#2e2d74]'
            style={{
              left: brushCursorPoint.x - brushSize / 2,
              top: brushCursorPoint.y - brushSize / 2,
              width: brushSize,
              height: brushSize,
            }}
          >
            {mode === 'eraser' ? <Paintbrush size={16} /> : <Plus size={16} />}
          </div>
        )}

        <InpaintToolbar
          mode={mode}
          brushSize={brushSize}
          prompt={prompt}
          resolution={resolution}
          isLoading={isSending}
          isPointsLoading={isPointsLoading}
          points={points}
          canUndo={canUndo}
          canRedo={canRedo}
          onModeChange={handleModeChange}
          onBrushSizeChange={setBrushSize}
          onPromptChange={setPrompt}
          onResolutionChange={setResolution}
          onUndo={() => canUndo && restoreHistory(historyIndex - 1)}
          onRedo={() => canRedo && restoreHistory(historyIndex + 1)}
          onRecenter={recenter}
          onClose={onClose || (() => undefined)}
          onSend={handleSend}
        />
      </DialogContent>
    </Dialog>
  );
}
