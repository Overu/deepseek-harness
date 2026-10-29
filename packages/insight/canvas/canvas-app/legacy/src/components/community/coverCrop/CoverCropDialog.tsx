import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type SyntheticEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import { ImageIcon, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { uploadFile } from '@/services/upload/uploadFile';
import { CoverCropPreviewSkeleton } from './CoverCropSkeleton';
import { CoverCropTimeline } from './CoverCropTimeline';
import { CoverCropZoomControls } from './CoverCropZoomControls';
import {
  canvasToBlob,
  getCropMediaUrl,
  getTimelineFrames,
  getVideoSnapshotUrl,
  isAliyunOssUrl,
  loadCrossOriginImage,
  seekVideo,
  waitForEvent,
  waitForVideoSeek,
} from './coverCropMedia';
import {
  COVER_OUTPUT_HEIGHT,
  COVER_OUTPUT_WIDTH,
  clampPan,
  getExportCropRect,
  getInitialTransform,
  isValidSize,
  type CoverCropPoint,
  type CoverCropSize,
  type CoverCropTransform,
} from './coverCropUtils';
import type { CoverCropDialogProps, CoverCropRect } from './types';

const TIMELINE_SEEK_INTERVAL = 90;
const TIMELINE_SNAPSHOT_INTERVAL = 250;
const TIMELINE_SNAPSHOT_WIDTH = 180;
const ZOOM_MAX = 100;
const ZOOM_BUTTON_STEP = 10;

const getDistance = (first: CoverCropPoint, second: CoverCropPoint) => Math.hypot(first.x - second.x, first.y - second.y);

interface CoverCropExportResult {
  file: File;
  crop: CoverCropRect;
  captureTime?: number;
}

export function CoverCropDialog({ open, source, onOpenChange, onConfirm }: CoverCropDialogProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    startPointer: CoverCropPoint;
    startPan: CoverCropPoint;
  } | null>(null);
  const activePointersRef = useRef<Map<number, CoverCropPoint>>(new Map());
  const pinchRef = useRef<{
    startDistance: number;
    startZoom: number;
  } | null>(null);
  const frozenFrameUrlRef = useRef('');
  const freezeRequestIdRef = useRef(0);
  const initialFreezeRequestedRef = useRef(false);
  const pendingSeekTimeRef = useRef<number | null>(null);
  const seekTimerRef = useRef<number | null>(null);
  const timelineSnapshotTimerRef = useRef<number | null>(null);
  const timelineSnapshotRequestIdRef = useRef(0);
  const pendingTimelineSnapshotRef = useRef<{ time: number; duration: number; requestId: number } | null>(null);
  const committedSnapshotImageRef = useRef<HTMLImageElement | null>(null);
  const sliderTimeRef = useRef(0);

  const [frameSize, setFrameSize] = useState<CoverCropSize>({ width: 0, height: 0 });
  const [frameNode, setFrameNode] = useState<HTMLDivElement | null>(null);
  const [mediaSize, setMediaSize] = useState<CoverCropSize | null>(null);
  const [transform, setTransform] = useState<CoverCropTransform | null>(null);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [mediaError, setMediaError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [videoDuration, setVideoDuration] = useState(0);
  const [sliderTime, setSliderTime] = useState(0);
  const [timelineDragging, setTimelineDragging] = useState(false);
  const [freezePending, setFreezePending] = useState(false);
  const [seekingPreview, setSeekingPreview] = useState(false);
  const [frozenFrameUrl, setFrozenFrameUrl] = useState('');
  const [committedSnapshotTime, setCommittedSnapshotTime] = useState<number | null>(null);
  const [snapshotError, setSnapshotError] = useState('');
  const [timelinePreviewUrl, setTimelinePreviewUrl] = useState('');
  const [timelinePreviewLoading, setTimelinePreviewLoading] = useState(false);
  const [zoomValue, setZoomValue] = useState(0);
  const [timelineFrameSettledCount, setTimelineFrameSettledCount] = useState(0);

  const isVideo = source?.type === 'video';
  const cropMediaUrl = useMemo(() => getCropMediaUrl(source?.url || ''), [source?.url]);
  const isAliyunVideo = source?.type === 'video' && isAliyunOssUrl(cropMediaUrl);
  const sourceInitialTime = source?.type === 'video' ? source.initialTime : undefined;
  const ready = Boolean(source && mediaSize && transform && isValidSize(frameSize));
  const canUseTimeline = isVideo && videoDuration > 0;
  const timelinePercent = videoDuration > 0 ? Math.min(Math.max((sliderTime / videoDuration) * 100, 0), 100) : 0;
  const posterUrl = useMemo(() => (source?.type === 'video' ? getVideoSnapshotUrl(cropMediaUrl, 0, videoDuration, 1200) : ''), [cropMediaUrl, source?.type, videoDuration]);
  const timelineFrames = useMemo(() => (source?.type === 'video' ? getTimelineFrames(cropMediaUrl, videoDuration) : []), [cropMediaUrl, source?.type, videoDuration]);
  const timelineFramesReady = !isVideo || (timelineFrames.length > 0 && timelineFrameSettledCount >= timelineFrames.length);
  const hasCommittedSnapshot = !isAliyunVideo || committedSnapshotTime !== null;
  const committedSnapshotReady = !isAliyunVideo || (committedSnapshotTime !== null && Math.abs(committedSnapshotTime - sliderTime) < 0.005);
  const videoSeekBlocksInteraction = seekingPreview && !isAliyunVideo;
  const showInitialSkeleton = Boolean(source && !mediaError && !snapshotError && (mediaLoading || !ready || !timelineFramesReady || !hasCommittedSnapshot));
  const showFrozenFrame = Boolean(isVideo && frozenFrameUrl && (isAliyunVideo || (!timelineDragging && !seekingPreview)));
  const mediaStyle = useMemo<CSSProperties | undefined>(
    () =>
      transform
        ? {
            width: `${transform.displayWidth}px`,
            height: `${transform.displayHeight}px`,
            transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
          }
        : undefined,
    [transform]
  );

  const setCropFrameNode = useCallback((node: HTMLDivElement | null) => {
    frameRef.current = node;
    setFrameNode(node);
  }, []);

  const replaceFrozenFrameUrl = (url: string) => {
    if (frozenFrameUrlRef.current.startsWith('blob:')) {
      URL.revokeObjectURL(frozenFrameUrlRef.current);
    }

    frozenFrameUrlRef.current = url;
    setFrozenFrameUrl(url);
  };

  const clearScheduledSeek = () => {
    if (seekTimerRef.current !== null) {
      window.clearTimeout(seekTimerRef.current);
      seekTimerRef.current = null;
    }
    pendingSeekTimeRef.current = null;
  };

  const clearScheduledTimelineSnapshot = () => {
    if (timelineSnapshotTimerRef.current !== null) {
      window.clearTimeout(timelineSnapshotTimerRef.current);
      timelineSnapshotTimerRef.current = null;
    }
    pendingTimelineSnapshotRef.current = null;
  };

  useEffect(() => {
    sliderTimeRef.current = sliderTime;
  }, [sliderTime]);

  useEffect(() => {
    if (!open) {
      clearScheduledSeek();
      clearScheduledTimelineSnapshot();
      freezeRequestIdRef.current += 1;
      timelineSnapshotRequestIdRef.current += 1;
      return;
    }

    clearScheduledSeek();
    clearScheduledTimelineSnapshot();
    freezeRequestIdRef.current += 1;
    timelineSnapshotRequestIdRef.current += 1;
    initialFreezeRequestedRef.current = false;
    committedSnapshotImageRef.current = null;
    replaceFrozenFrameUrl('');
    setMediaSize(null);
    setTransform(null);
    setMediaLoading(Boolean(source));
    setMediaError(source ? '' : '缺少可编辑的作品素材');
    setSubmitting(false);
    setVideoDuration(0);
    setSliderTime(sourceInitialTime || 0);
    setTimelineDragging(false);
    setFreezePending(false);
    setSeekingPreview(false);
    setCommittedSnapshotTime(null);
    setSnapshotError('');
    setTimelinePreviewUrl('');
    setTimelinePreviewLoading(false);
    setZoomValue(0);
    setTimelineFrameSettledCount(0);
    activePointersRef.current.clear();
    pinchRef.current = null;
    dragRef.current = null;
  }, [open, source?.type, source?.url, sourceInitialTime]);

  useEffect(() => {
    setTimelineFrameSettledCount(0);
  }, [timelineFrames]);

  useEffect(() => {
    if (!isVideo || timelineFrames.length === 0 || timelineFramesReady) return;

    const timer = window.setTimeout(() => {
      setTimelineFrameSettledCount(timelineFrames.length);
    }, 4000);

    return () => {
      window.clearTimeout(timer);
    };
  }, [isVideo, timelineFrames.length, timelineFramesReady]);

  useEffect(
    () => () => {
      clearScheduledSeek();
      clearScheduledTimelineSnapshot();
      timelineSnapshotRequestIdRef.current += 1;
      if (frozenFrameUrlRef.current) {
        if (frozenFrameUrlRef.current.startsWith('blob:')) {
          URL.revokeObjectURL(frozenFrameUrlRef.current);
        }
      }
    },
    []
  );

  useEffect(() => {
    if (!open) return;

    const node = frameNode;
    if (!node) return;

    const updateFrameSize = () => {
      setFrameSize(prev => {
        const nextSize = {
          width: node.clientWidth,
          height: node.clientHeight,
        };

        return prev.width === nextSize.width && prev.height === nextSize.height ? prev : nextSize;
      });
    };

    updateFrameSize();
    const observer = new ResizeObserver(updateFrameSize);
    observer.observe(node);

    return () => {
      observer.disconnect();
    };
  }, [open, frameNode]);

  useEffect(() => {
    if (!mediaSize || !isValidSize(frameSize)) return;

    setZoomValue(0);
    setTransform(getInitialTransform(mediaSize, frameSize));
  }, [frameSize, mediaSize, source?.url]);

  useEffect(() => {
    if (!open || source?.type !== 'video') return;

    const video = videoRef.current;
    if (!video) return;

    video.preload = isAliyunOssUrl(cropMediaUrl) ? 'metadata' : 'auto';
    try {
      video.load();
    } catch {
      // The browser may reject load() while source attachment is still settling.
    }
  }, [cropMediaUrl, open, source?.type]);

  useEffect(() => {
    if (!open) return;

    const isInsideStage = (event: Event) => {
      const stage = stageRef.current;
      const target = event.target;

      return Boolean(stage && target instanceof Node && stage.contains(target));
    };
    const preventBrowserZoom = (event: Event) => {
      if (!isInsideStage(event)) return;

      event.preventDefault();
    };
    const preventGestureZoom = (event: Event) => {
      event.preventDefault();
    };
    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;

      preventBrowserZoom(event);
    };

    document.addEventListener('wheel', handleWheel, { passive: false, capture: true });
    window.addEventListener('gesturestart', preventGestureZoom, { passive: false, capture: true });
    window.addEventListener('gesturechange', preventGestureZoom, { passive: false, capture: true });
    window.addEventListener('gestureend', preventGestureZoom, { passive: false, capture: true });

    return () => {
      document.removeEventListener('wheel', handleWheel, { capture: true });
      window.removeEventListener('gesturestart', preventGestureZoom, { capture: true });
      window.removeEventListener('gesturechange', preventGestureZoom, { capture: true });
      window.removeEventListener('gestureend', preventGestureZoom, { capture: true });
    };
  }, [open]);

  const requestClose = () => {
    if (submitting) return;
    onOpenChange(false);
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!mediaSize || !transform || showInitialSkeleton || submitting || timelineDragging) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    activePointersRef.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });

    if (activePointersRef.current.size >= 2) {
      const [first, second] = Array.from(activePointersRef.current.values());
      pinchRef.current = {
        startDistance: getDistance(first, second),
        startZoom: zoomValue,
      };
      dragRef.current = null;
      return;
    }

    dragRef.current = {
      pointerId: event.pointerId,
      startPointer: {
        x: event.clientX,
        y: event.clientY,
      },
      startPan: {
        x: transform.x,
        y: transform.y,
      },
    };
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (activePointersRef.current.has(event.pointerId)) {
      activePointersRef.current.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
      });
    }

    if (pinchRef.current && activePointersRef.current.size >= 2) {
      const [first, second] = Array.from(activePointersRef.current.values());
      const distance = getDistance(first, second);
      if (pinchRef.current.startDistance > 0) {
        const startScaleRatio = 1 + pinchRef.current.startZoom / ZOOM_MAX;
        const nextZoom = (startScaleRatio * (distance / pinchRef.current.startDistance) - 1) * ZOOM_MAX;
        applyZoom(nextZoom);
      }
      return;
    }

    const drag = dragRef.current;
    if (!drag || !mediaSize || !transform) return;

    const nextPan = clampPan(
      {
        x: drag.startPan.x + event.clientX - drag.startPointer.x,
        y: drag.startPan.y + event.clientY - drag.startPointer.y,
      },
      mediaSize,
      frameSize,
      transform.scale
    );

    setTransform({
      ...transform,
      ...nextPan,
    });
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    activePointersRef.current.delete(event.pointerId);
    if (activePointersRef.current.size < 2) {
      pinchRef.current = null;
    }

    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      return;
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
  };

  const applyZoom = (value: number) => {
    const nextZoom = Math.min(Math.max(value, 0), ZOOM_MAX);
    setZoomValue(nextZoom);

    if (!mediaSize || !transform || !isValidSize(frameSize)) return;

    const center = {
      x: (frameSize.width / 2 - transform.x) / transform.scale,
      y: (frameSize.height / 2 - transform.y) / transform.scale,
    };
    const baseScale = Math.max(frameSize.width / mediaSize.width, frameSize.height / mediaSize.height);
    const nextScale = baseScale * (1 + nextZoom / ZOOM_MAX);
    const nextPan = clampPan(
      {
        x: frameSize.width / 2 - center.x * nextScale,
        y: frameSize.height / 2 - center.y * nextScale,
      },
      mediaSize,
      frameSize,
      nextScale
    );

    setTransform({
      ...nextPan,
      scale: nextScale,
      displayWidth: mediaSize.width * nextScale,
      displayHeight: mediaSize.height * nextScale,
    });
  };

  const resetZoom = () => {
    applyZoom(0);
  };

  const handleWheelZoom = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (!ready || showInitialSkeleton || submitting || freezePending) return;

    event.preventDefault();
    const nextZoom = zoomValue + (event.deltaY < 0 ? ZOOM_BUTTON_STEP : -ZOOM_BUTTON_STEP);
    applyZoom(nextZoom);
  };

  const handleImageLoad = (event: SyntheticEvent<HTMLImageElement>) => {
    const image = event.currentTarget;
    setMediaSize({
      width: image.naturalWidth,
      height: image.naturalHeight,
    });
    setMediaLoading(false);
  };

  const updateVideoMediaSize = (video: HTMLVideoElement) => {
    const nextMediaSize = {
      width: video.videoWidth,
      height: video.videoHeight,
    };

    if (!isValidSize(nextMediaSize)) {
      return false;
    }

    setMediaSize(prev => (prev?.width === nextMediaSize.width && prev.height === nextMediaSize.height ? prev : nextMediaSize));
    setMediaLoading(false);
    return true;
  };

  const createVideoFrameObjectUrl = async (video: HTMLVideoElement) => {
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('当前浏览器不支持封面截图');
    }

    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await canvasToBlob(canvas, 'image/jpeg', 0.9);
    return URL.createObjectURL(blob);
  };

  const freezeVideoFrame = async (time: number, silent = false) => {
    const video = videoRef.current;
    if (!video || !isValidSize({ width: video.videoWidth, height: video.videoHeight })) {
      setTimelineDragging(false);
      setFreezePending(false);
      setSeekingPreview(false);
      return;
    }

    const requestId = ++freezeRequestIdRef.current;
    if (!silent) {
      setFreezePending(true);
    }

    try {
      await waitForVideoSeek(video, time);
      if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        await waitForEvent(video, 'loadeddata');
      }

      const nextUrl = await createVideoFrameObjectUrl(video);
      if (requestId !== freezeRequestIdRef.current) {
        URL.revokeObjectURL(nextUrl);
        return;
      }

      replaceFrozenFrameUrl(nextUrl);
      setSliderTime(video.currentTime);
    } catch {
      // If the OSS bucket does not allow CORS, canvas extraction is blocked.
      // Keep the video visible so the user can still drag the current frame.
    } finally {
      if (requestId === freezeRequestIdRef.current) {
        setTimelineDragging(false);
        setFreezePending(false);
        setSeekingPreview(false);
      }
    }
  };

  const flushScheduledSeek = (fast = true) => {
    const video = videoRef.current;
    const nextTime = pendingSeekTimeRef.current;
    clearScheduledSeek();

    if (!video || nextTime === null || !Number.isFinite(nextTime)) return;

    try {
      setSeekingPreview(true);
      seekVideo(video, nextTime, fast);
    } catch {
      // Browser may reject seeking before enough metadata is available.
      setSeekingPreview(false);
    }
  };

  const scheduleVideoSeek = (time: number) => {
    pendingSeekTimeRef.current = time;

    if (seekTimerRef.current !== null) return;

    seekTimerRef.current = window.setTimeout(() => {
      flushScheduledSeek(true);
    }, TIMELINE_SEEK_INTERVAL);
  };

  const flushTimelineSnapshot = () => {
    const pending = pendingTimelineSnapshotRef.current;
    if (timelineSnapshotTimerRef.current !== null) {
      window.clearTimeout(timelineSnapshotTimerRef.current);
      timelineSnapshotTimerRef.current = null;
    }
    pendingTimelineSnapshotRef.current = null;

    if (!pending || source?.type !== 'video') return;

    const snapshotUrl = getVideoSnapshotUrl(cropMediaUrl, pending.time, pending.duration, TIMELINE_SNAPSHOT_WIDTH);
    void loadCrossOriginImage(snapshotUrl)
      .then(() => {
        if (pending.requestId !== timelineSnapshotRequestIdRef.current) return;

        setTimelinePreviewUrl(snapshotUrl);
        setTimelinePreviewLoading(false);
      })
      .catch(() => {
        if (pending.requestId === timelineSnapshotRequestIdRef.current) {
          setTimelinePreviewLoading(false);
        }
      });
  };

  const scheduleTimelineSnapshot = (time: number, duration: number, immediate = false) => {
    if (source?.type !== 'video') return;

    const requestId = ++timelineSnapshotRequestIdRef.current;
    pendingTimelineSnapshotRef.current = { time, duration, requestId };
    setTimelinePreviewLoading(true);

    if (immediate) {
      flushTimelineSnapshot();
      return;
    }

    if (timelineSnapshotTimerRef.current !== null) {
      window.clearTimeout(timelineSnapshotTimerRef.current);
    }
    timelineSnapshotTimerRef.current = window.setTimeout(flushTimelineSnapshot, TIMELINE_SNAPSHOT_INTERVAL);
  };

  const loadCommittedSnapshot = async (time: number, duration: number, silent = false) => {
    const video = videoRef.current;
    if (source?.type !== 'video' || !isAliyunOssUrl(cropMediaUrl) || !video) return false;

    const requestId = ++freezeRequestIdRef.current;
    const snapshotWidth = Math.max(video.videoWidth || 0, COVER_OUTPUT_WIDTH);
    const snapshotUrl = getVideoSnapshotUrl(cropMediaUrl, time, duration, snapshotWidth);
    setTimelinePreviewLoading(true);
    if (!silent) {
      setFreezePending(true);
    }
    setSnapshotError('');

    try {
      const snapshotImage = await loadCrossOriginImage(snapshotUrl);
      if (requestId !== freezeRequestIdRef.current) return false;

      committedSnapshotImageRef.current = snapshotImage;
      replaceFrozenFrameUrl(snapshotUrl);
      setCommittedSnapshotTime(time);
      setTimelinePreviewUrl(snapshotUrl);
      setTimelinePreviewLoading(false);
      return true;
    } catch {
      if (requestId === freezeRequestIdRef.current) {
        committedSnapshotImageRef.current = null;
        setCommittedSnapshotTime(null);
        setSnapshotError('画面获取失败，请调整时间后重试');
        setTimelinePreviewLoading(false);
      }
      return false;
    } finally {
      if (requestId === freezeRequestIdRef.current) {
        setTimelineDragging(false);
        setFreezePending(false);
        setSeekingPreview(false);
      }
    }
  };

  const commitVideoTime = (time: number) => {
    if (!canUseTimeline) return;

    const nextTime = Math.min(Math.max(time, 0), videoDuration);
    setSliderTime(nextTime);
    sliderTimeRef.current = nextTime;
    if (source?.type === 'video' && isAliyunOssUrl(cropMediaUrl)) {
      clearScheduledTimelineSnapshot();
      timelineSnapshotRequestIdRef.current += 1;
      clearScheduledSeek();
      void loadCommittedSnapshot(nextTime, videoDuration);
    } else {
      scheduleTimelineSnapshot(nextTime, videoDuration, true);
      pendingSeekTimeRef.current = nextTime;
      flushScheduledSeek(false);
      void freezeVideoFrame(nextTime, true);
    }
  };

  const handleVideoMetadata = (event: SyntheticEvent<HTMLVideoElement>) => {
    const video = event.currentTarget;
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const initialTime = Math.min(Math.max(sourceInitialTime || 0, 0), duration || 0);

    setVideoDuration(duration);
    setSliderTime(initialTime);
    sliderTimeRef.current = initialTime;
    updateVideoMediaSize(video);

    if (source?.type === 'video' && isAliyunOssUrl(cropMediaUrl)) {
      initialFreezeRequestedRef.current = true;
      void loadCommittedSnapshot(initialTime, duration, true);
    } else {
      scheduleTimelineSnapshot(initialTime, duration, true);
      if (initialTime > 0) {
        initialFreezeRequestedRef.current = true;
        void freezeVideoFrame(initialTime, true);
      }
    }
  };

  const handleVideoFrameReady = (event: SyntheticEvent<HTMLVideoElement>) => {
    const video = event.currentTarget;
    const hasSize = updateVideoMediaSize(video);
    if (!video.seeking) {
      setSeekingPreview(false);
    }
    if (!hasSize || initialFreezeRequestedRef.current || timelineDragging) return;

    initialFreezeRequestedRef.current = true;
    void freezeVideoFrame(sliderTimeRef.current, true);
  };

  const handleMediaError = () => {
    setMediaLoading(false);
    setMediaError('素材加载失败，请重新选择作品资源');
  };

  const handleTimelineFrameError = (event: SyntheticEvent<HTMLImageElement>) => {
    event.currentTarget.style.visibility = 'hidden';
    setTimelineFrameSettledCount(count => count + 1);
  };

  const handleTimelineFrameLoad = () => {
    setTimelineFrameSettledCount(count => count + 1);
  };

  const handleVideoSeeked = (event: SyntheticEvent<HTMLVideoElement>) => {
    setSeekingPreview(false);
    if (timelineDragging || isAliyunVideo) return;

    setSliderTime(event.currentTarget.currentTime);
  };

  const handleVideoSeeking = () => {
    if (!showInitialSkeleton) {
      setSeekingPreview(true);
    }
  };

  const handleVideoWaiting = () => {
    if (!showInitialSkeleton) {
      setSeekingPreview(true);
    }
  };

  const handleTimelineStart = () => {
    if (submitting || !canUseTimeline) return;

    freezeRequestIdRef.current += 1;
    resetZoom();
    setFreezePending(false);
    setTimelineDragging(true);
    setSnapshotError('');
  };

  const handleTimelineChange = (time: number) => {
    if (!canUseTimeline) return;

    if (zoomValue !== 0) {
      resetZoom();
    }

    const nextTime = Math.min(Math.max(time, 0), videoDuration);
    setSliderTime(nextTime);
    sliderTimeRef.current = nextTime;
    if (!isAliyunVideo) {
      setSeekingPreview(true);
      scheduleVideoSeek(nextTime);
    }
    scheduleTimelineSnapshot(nextTime, videoDuration);
  };

  const createCoverFile = async (): Promise<CoverCropExportResult> => {
    if (!source || !mediaSize || !transform || !isValidSize(frameSize)) {
      throw new Error('素材尚未准备好');
    }

    const media = source.type === 'video' ? videoRef.current : imageRef.current;
    if (!media) {
      throw new Error('素材尚未准备好');
    }

    let captureTime: number | undefined;
    if (source.type === 'video') {
      const targetTime = Math.min(Math.max(sliderTimeRef.current, 0), videoDuration || sliderTimeRef.current);
      if (isAliyunOssUrl(cropMediaUrl)) {
        if (!committedSnapshotImageRef.current || committedSnapshotTime === null || Math.abs(committedSnapshotTime - targetTime) >= 0.005) {
          throw new Error('当前画面尚未准备好，请稍后重试');
        }
        captureTime = committedSnapshotTime;
      } else {
        const video = media as HTMLVideoElement;
        if (Number.isFinite(targetTime)) {
          await waitForVideoSeek(video, targetTime);
        }
        if (video.seeking) {
          await waitForEvent(video, 'seeked');
        }
        if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
          await waitForEvent(video, 'loadeddata');
        }
        captureTime = video.currentTime;
      }
    }

    const crop = getExportCropRect(transform, mediaSize, frameSize);
    const canvas = document.createElement('canvas');
    canvas.width = COVER_OUTPUT_WIDTH;
    canvas.height = COVER_OUTPUT_HEIGHT;

    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('当前浏览器不支持封面截图');
    }

    const drawCrop = (mediaSource: CanvasImageSource, scaleX = 1, scaleY = 1) => {
      context.drawImage(
        mediaSource,
        crop.sourceX * scaleX,
        crop.sourceY * scaleY,
        crop.sourceWidth * scaleX,
        crop.sourceHeight * scaleY,
        0,
        0,
        crop.outputWidth,
        crop.outputHeight
      );
    };

    let blob: Blob;
    try {
      if (source.type === 'video' && isAliyunOssUrl(cropMediaUrl)) {
        const snapshotImage = committedSnapshotImageRef.current;
        if (!snapshotImage) {
          throw new Error('当前画面尚未准备好，请稍后重试');
        }
        const scaleX = snapshotImage.naturalWidth / mediaSize.width;
        const scaleY = snapshotImage.naturalHeight / mediaSize.height;

        drawCrop(snapshotImage, scaleX, scaleY);
      } else {
        drawCrop(media);
      }
      blob = await canvasToBlob(canvas);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'SecurityError') {
        throw new Error('当前素材未开放跨域，浏览器无法导出裁切封面');
      }

      throw new Error('该素材暂不支持封面截图，请重新上传或选择资产库素材');
    }
    const file = new File([blob], `community-cover-${Date.now()}.jpg`, {
      type: 'image/jpeg',
    });

    return {
      file,
      crop,
      captureTime,
    };
  };

  const handleConfirm = async () => {
    if (!ready || videoSeekBlocksInteraction || submitting || freezePending || !committedSnapshotReady || snapshotError) return;

    setSubmitting(true);
    try {
      const { file, crop, captureTime } = await createCoverFile();
      const coverUrl = (await uploadFile(file)).url;
      if (!coverUrl || typeof coverUrl !== 'string') {
        throw new Error('封面上传失败');
      }

      onConfirm({
        coverUrl,
        sourceTime: source?.type === 'video' ? captureTime : undefined,
        crop,
      });
      onOpenChange(false);
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : '封面设置失败，请稍后重试';
      toast.error(message);
      setSubmitting(false);
    }
  };

  const renderMedia = () => {
    if (!source) return null;

    if (source.type === 'video') {
      return (
        <>
          <video
            ref={videoRef}
            src={cropMediaUrl}
            crossOrigin='anonymous'
            poster={posterUrl}
            preload={isAliyunVideo ? 'metadata' : 'auto'}
            muted
            playsInline
            disablePictureInPicture
            controlsList='nodownload nofullscreen noremoteplayback'
            className={`pointer-events-none absolute left-0 top-0 z-0 max-w-none select-none object-fill ${showFrozenFrame ? 'opacity-0' : 'opacity-100'}`}
            style={mediaStyle}
            onLoadedMetadata={handleVideoMetadata}
            onLoadedData={handleVideoFrameReady}
            onCanPlay={handleVideoFrameReady}
            onSeeked={handleVideoSeeked}
            onSeeking={handleVideoSeeking}
            onWaiting={handleVideoWaiting}
            onError={handleMediaError}
            onContextMenu={event => event.preventDefault()}
          />
          {frozenFrameUrl && (
            <img
              src={frozenFrameUrl}
              crossOrigin='anonymous'
              alt=''
              draggable={false}
              className={`pointer-events-none absolute left-0 top-0 z-0 max-w-none select-none object-fill transition-opacity duration-100 ${showFrozenFrame ? 'opacity-100' : 'opacity-0'}`}
              style={mediaStyle}
            />
          )}
        </>
      );
    }

    return (
      <img
        ref={imageRef}
        src={cropMediaUrl}
        crossOrigin='anonymous'
        alt=''
        draggable={false}
        className='pointer-events-none absolute left-0 top-0 z-0 max-w-none select-none object-fill'
        style={mediaStyle}
        onLoad={handleImageLoad}
        onError={handleMediaError}
      />
    );
  };

  return (
    <Dialog open={open} onOpenChange={nextOpen => (nextOpen ? onOpenChange(true) : requestClose())}>
      <DialogContent
        data-community-publish-nested-dialog='true'
        className='flex w-[min(980px,calc(100vw-32px))] max-w-none flex-col gap-0 overflow-hidden border-white/10 bg-[#242424] p-0 text-white shadow-2xl sm:rounded-lg'
        overlayClassName='bg-black/70 backdrop-blur-[8px]'
        showCloseButton={false}
        onEscapeKeyDown={event => event.preventDefault()}
        onPointerDownOutside={event => event.preventDefault()}
        onInteractOutside={event => event.preventDefault()}
      >
        <header className='flex h-14 shrink-0 items-center justify-between px-5'>
          <DialogTitle className='text-sm font-semibold text-white'>封面上传</DialogTitle>
          <button
            type='button'
            className='rounded-md p-1 text-white/70 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40'
            disabled={submitting}
            onClick={requestClose}
          >
            <X className='h-5 w-5' />
            <span className='sr-only'>关闭</span>
          </button>
        </header>

        <div className='px-5 pb-5'>
          <div
            ref={stageRef}
            className='relative flex min-h-[500px] cursor-grab touch-none items-center justify-center overflow-hidden bg-black/45 px-5 active:cursor-grabbing'
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onWheel={handleWheelZoom}
          >
            <div ref={setCropFrameNode} className='relative aspect-video w-full max-w-[680px] touch-none overflow-visible bg-transparent'>
              {renderMedia()}

              {!ready && mediaError && (
                <div className='absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-[#111] text-sm text-white/60'>
                  <ImageIcon className='h-7 w-7 text-white/45' />
                  <span>{mediaError}</span>
                </div>
              )}

              {snapshotError && <div className='pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-black/35 text-sm text-white/80'>{snapshotError}</div>}

              {ready && !showInitialSkeleton && (
                <>
                  <div className='pointer-events-none absolute inset-0 z-10 shadow-[0_0_0_9999px_rgba(0,0,0,0.42)]' />
                  <div className='pointer-events-none absolute inset-0 z-20 border-2 border-white' />
                </>
              )}

              {submitting && (
                <div className='absolute inset-0 z-40 flex items-center justify-center bg-black/25 text-sm text-white/80 backdrop-blur-[1px]'>
                  <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                  封面上传中
                </div>
              )}

              {!submitting && freezePending && (
                <div className='pointer-events-none absolute right-3 top-3 z-40 flex items-center rounded-md bg-black/55 px-2 py-1 text-xs text-white/80 backdrop-blur-sm'>
                  <Loader2 className='mr-1.5 h-3.5 w-3.5 animate-spin' />
                  画面更新中
                </div>
              )}
            </div>

            {showInitialSkeleton && <CoverCropPreviewSkeleton />}
          </div>

          {isVideo && (
            <CoverCropTimeline
              frames={timelineFrames}
              ready={timelineFramesReady}
              dragging={timelineDragging}
              percent={timelinePercent}
              sliderTime={sliderTime}
              previewUrl={timelinePreviewUrl}
              previewLoading={timelinePreviewLoading}
              videoDuration={videoDuration}
              submitting={submitting}
              canUseTimeline={canUseTimeline}
              onFrameLoad={handleTimelineFrameLoad}
              onFrameError={handleTimelineFrameError}
              onTimelineStart={handleTimelineStart}
              onTimelineChange={handleTimelineChange}
              onTimelineCommit={commitVideoTime}
            />
          )}
        </div>

        <footer className='flex h-14 shrink-0 items-center justify-between gap-5 border-t border-white/5 px-5'>
          <CoverCropZoomControls
            value={zoomValue}
            max={ZOOM_MAX}
            step={ZOOM_BUTTON_STEP}
            disabled={!ready || showInitialSkeleton || timelineDragging || videoSeekBlocksInteraction || submitting || freezePending}
            onChange={applyZoom}
          />

          <div className='flex items-center gap-3'>
            <Button
              type='button'
              variant='ghost'
              className='h-8 min-w-[64px] bg-white/10 text-white/80 hover:bg-white/15 hover:text-white'
              disabled={submitting}
              onClick={requestClose}
            >
              取消
            </Button>
            <Button
              type='button'
              className='h-8 min-w-[88px] bg-[#364cff] text-white hover:bg-[#455aff]'
              disabled={
                !ready || showInitialSkeleton || timelineDragging || videoSeekBlocksInteraction || submitting || freezePending || !committedSnapshotReady || Boolean(snapshotError)
              }
              onClick={handleConfirm}
            >
              {submitting && <Loader2 className='h-4 w-4 animate-spin' />}
              确认设置
            </Button>
          </div>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
