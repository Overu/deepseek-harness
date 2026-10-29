/* eslint-disable react-refresh/only-export-components */
import { Check, LoaderCircle, X } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatDuration } from '@/utils/index';
import { uploadFile } from '@/services/upload/uploadFile';
import { useFlowStore } from '@/store/flowStore';
import { toast } from 'sonner';
import { getCachedClipBlob, getClipFileExtension, getClipMimeType, clipVideo } from '@/utils/videoClip';

const isAliyunOssUrl = (src: string) => /aliyuncs\.com/i.test(src);

const appendOssProcess = (src: string, process: string) => {
  if (!src || !isAliyunOssUrl(src) || src.includes('x-oss-process=')) return src;
  const separator = src.includes('?') ? '&' : '?';
  return `${src}${separator}x-oss-process=${process}`;
};

const getVideoKeyframeUrl = (src: string, second: number, width = 80) => {
  const ms = Math.max(0, Math.floor(second * 1000));
  return appendOssProcess(src, `video/snapshot,t_${ms},f_jpg,w_${width},m_fast`);
};

const captureVideoFrame = (videoUrl: string, second: number): Promise<string> =>
  new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;

    const cleanup = () => {
      video.onloadedmetadata = null;
      video.onseeked = null;
      video.onerror = null;
      video.removeAttribute('src');
      video.load();
    };

    video.onerror = () => {
      cleanup();
      reject(new Error('frame capture failed'));
    };

    video.onloadedmetadata = () => {
      const target = Math.min(Math.max(0, second), Math.max(0, video.duration - 0.05));
      video.currentTime = target;
    };

    video.onseeked = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 80;
        canvas.height = 48;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('canvas unavailable');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.75);
        cleanup();
        resolve(dataUrl);
      } catch (error) {
        cleanup();
        reject(error);
      }
    };

    video.src = videoUrl;
  });

const buildKeyframeTimes = (duration: number, count: number): number[] => {
  if (!duration || count <= 0) return [];
  if (count === 1) return [0];
  return Array.from({ length: count }, (_, index) => (duration * index) / (count - 1));
};

const runningNodeIds = new Set<string>();

export interface RunClipAndUploadParams {
  nodeId: string;
  sourceUrl: string;
  startSecond: number;
  endSecond: number;
  onComplete?: (url: string) => void | Promise<void>;
}

/** 脱离组件生命周期执行裁切上传 */
export function runClipAndUpload({ nodeId, sourceUrl, startSecond, endSecond, onComplete }: RunClipAndUploadParams): void {
  if (runningNodeIds.has(nodeId)) return;
  const node = useFlowStore.getState().nodes.find(n => n.id === nodeId);
  if (!node) return;

  runningNodeIds.add(nodeId);
  const { updateNodeData, updateNodeStatus } = useFlowStore.getState().actions;
  updateNodeStatus(nodeId, 'running');

  void (async () => {
    try {
      // 主路径 WebCodecs（关键帧吸附可走流拷贝）；失败回退 ffmpeg 精确重编码
      let blob = getCachedClipBlob(sourceUrl, startSecond, endSecond);
      if (!blob) {
        blob = await clipVideo(sourceUrl, startSecond, endSecond);
      }
      const file = new File([blob], `clip-${Date.now()}.${getClipFileExtension()}`, { type: getClipMimeType() });
      const url = (await uploadFile(file)).url;
      if (!url) throw new Error('upload failed');

      const latest = useFlowStore.getState().nodes.find(n => n.id === nodeId);
      if (!latest) return;
      const latestData = latest.data as Record<string, unknown>;
      const latestParams = (latestData.params as Record<string, unknown>) || {};
      updateNodeData(
        nodeId,
        {
          ...latestData,
          time: Date.now(),
          params: {
            ...latestParams,
            videoStartSecond: startSecond,
            videoEndSecond: endSecond,
          },
        },
        true,
        true
      );
      updateNodeStatus(nodeId, 'success');
      if (onComplete) {
        await onComplete(url);
      }
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error('[VideoClip] runClipAndUpload failed', error);
      }
      if (useFlowStore.getState().nodes.some(n => n.id === nodeId)) {
        updateNodeStatus(nodeId, 'success');
        toast.error('视频裁切失败，请重试');
      }
    } finally {
      runningNodeIds.delete(nodeId);
    }
  })();
}

type DragMode = 'none' | 'move' | 'left' | 'right';

const TIMELINE_MIN_WIDTH = 560;
const TIMELINE_INNER_MIN_WIDTH = 400;
const TIMELINE_HEIGHT = 48;
const HANDLE_WIDTH = 4;
const HANDLE_WIDTH_ACTIVE = 12;
export const MIN_CLIP_DURATION = 2;
const KEYFRAME_COUNT = 6;
const TOOLTIP_CLASS = 'px-2 py-0.5 rounded-md bg-black/80 text-xs text-white whitespace-nowrap pointer-events-none';
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export interface VideoClipProps {
  videoUrl: string;
  minDuration?: number;
  maxDuration: number;
  startSecond: number;
  endSecond: number;
  onSave: (startSecond: number, endSecond: number) => void | Promise<void>;
  onCancel?: () => void;
  /** 点击时间轴/裁切区域，跳转到对应播放时间（限制在裁切区间内） */
  onSeekPlay?: (time: number, range: { start: number; end: number }) => void;
  /** 开始拖拽裁切范围时回调（用于停播） */
  onClipDragStart?: () => void;
  /** 拖拽结束（time 为续播/定位时间） */
  onClipDragEnd?: (time: number, range: { start: number; end: number }) => void;
  /** 拖拽中草稿区间/白条变化 */
  onDraftChange?: (draft: { start: number; end: number; playhead?: number }) => void;
  /** 当前播放时间（秒），用于时间轴游标 */
  playbackTime?: number;
  confirmLoading?: boolean;
  permissionDisabled?: boolean;
}

const VideoClip = ({
  videoUrl,
  minDuration = MIN_CLIP_DURATION,
  maxDuration,
  startSecond,
  endSecond,
  onSave,
  onCancel,
  onSeekPlay,
  onClipDragStart,
  onClipDragEnd,
  onDraftChange,
  playbackTime = 0,
  confirmLoading = false,
  permissionDisabled = false,
}: VideoClipProps) => {
  const showCancel = Boolean(onCancel);
  const containerRef = useRef<HTMLDivElement>(null);
  const [duration, setDuration] = useState(0);
  const [draftStart, setDraftStart] = useState(startSecond);
  const [draftEnd, setDraftEnd] = useState(endSecond);
  const [activeDrag, setActiveDrag] = useState<DragMode>('none');
  const [keyframeUrls, setKeyframeUrls] = useState<string[]>([]);
  const dragRef = useRef<{ mode: DragMode; startX: number; origStart: number; origEnd: number }>({
    mode: 'none',
    startX: 0,
    origStart: 0,
    origEnd: 0,
  });
  const draftRef = useRef({ start: draftStart, end: draftEnd });
  const playbackTimeRef = useRef(playbackTime);
  const callbacksRef = useRef({ onSeekPlay, onClipDragStart, onClipDragEnd, onDraftChange });
  const didDragRef = useRef(false);

  useEffect(() => {
    draftRef.current = { start: draftStart, end: draftEnd };
  }, [draftStart, draftEnd]);

  useEffect(() => {
    playbackTimeRef.current = playbackTime;
  }, [playbackTime]);

  useEffect(() => {
    callbacksRef.current = { onSeekPlay, onClipDragStart, onClipDragEnd, onDraftChange };
  });

  const disabled = confirmLoading;
  const confirmDisabled = confirmLoading || permissionDisabled;

  useEffect(() => {
    setDraftStart(startSecond);
    if (endSecond > 0) {
      setDraftEnd(endSecond);
    }
  }, [startSecond, endSecond, videoUrl]);

  useEffect(() => {
    if (!videoUrl) {
      setDuration(0);
      setKeyframeUrls([]);
      return;
    }

    let cancelled = false;
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      if (cancelled) return;
      const d = video.duration;
      if (!Number.isFinite(d) || d <= 0) {
        setDuration(0);
        setKeyframeUrls([]);
        return;
      }
      setDuration(d);
      if (endSecond <= 0 || endSecond > d) {
        setDraftStart(0);
        setDraftEnd(Math.min(d, maxDuration));
      }
    };
    video.onerror = () => {
      if (!cancelled) {
        setDuration(0);
        setKeyframeUrls([]);
      }
    };
    video.src = videoUrl;

    return () => {
      cancelled = true;
      video.onloadedmetadata = null;
      video.onerror = null;
      video.removeAttribute('src');
      video.load();
    };
  }, [videoUrl, endSecond, maxDuration]);

  useEffect(() => {
    if (!videoUrl || !duration) {
      setKeyframeUrls([]);
      return;
    }

    let cancelled = false;
    const times = buildKeyframeTimes(duration, KEYFRAME_COUNT);

    const loadKeyframes = async () => {
      if (isAliyunOssUrl(videoUrl)) {
        if (!cancelled) {
          setKeyframeUrls(times.map(time => getVideoKeyframeUrl(videoUrl, time)));
        }
        return;
      }

      const urls: string[] = [];
      for (const time of times) {
        if (cancelled) return;
        try {
          urls.push(await captureVideoFrame(videoUrl, time));
        } catch {
          urls.push('');
        }
      }
      if (!cancelled) setKeyframeUrls(urls);
    };

    void loadKeyframes();
    return () => {
      cancelled = true;
    };
  }, [videoUrl, duration]);

  const applyRange = useCallback(
    (nextStart: number, nextEnd: number) => {
      if (!duration || disabled) return null;
      let start = clamp(nextStart, 0, duration);
      let end = clamp(nextEnd, 0, duration);
      if (end - start < minDuration) {
        if (start + minDuration <= duration) end = start + minDuration;
        else {
          end = duration;
          start = Math.max(0, end - minDuration);
        }
      }
      if (end - start > maxDuration) end = start + maxDuration;
      const prev = draftRef.current;
      const changed = prev.start !== start || prev.end !== end;
      draftRef.current = { start, end };
      if (changed) {
        setDraftStart(start);
        setDraftEnd(end);
      }
      return { start, end, changed };
    },
    [duration, minDuration, maxDuration, disabled]
  );

  /** 根据指针 X 换算时间，并限制在当前裁切区间内 */
  const getSeekTimeFromClientX = useCallback(
    (clientX: number) => {
      if (!containerRef.current || !duration) return null;
      const { start, end } = draftRef.current;
      const rect = containerRef.current.getBoundingClientRect();
      if (rect.width <= 0) return null;
      const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
      return clamp(ratio * duration, start, end);
    },
    [duration]
  );

  const handleTimelineClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (disabled || didDragRef.current) return;
      const { start, end } = draftRef.current;
      const time = getSeekTimeFromClientX(e.clientX);
      if (time == null) return;
      playbackTimeRef.current = time;
      callbacksRef.current.onSeekPlay?.(time, { start, end });
    },
    [disabled, getSeekTimeFromClientX]
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent, mode: DragMode) => {
      if (disabled || mode === 'none') return;
      e.preventDefault();
      e.stopPropagation();
      didDragRef.current = false;
      callbacksRef.current.onClipDragStart?.();
      dragRef.current = { mode, startX: e.clientX, origStart: draftStart, origEnd: draftEnd };
      setActiveDrag(mode);

      const onPointerMove = (ev: PointerEvent) => {
        const { mode: dragMode, startX, origStart, origEnd } = dragRef.current;
        if (dragMode === 'none' || !containerRef.current || !duration) return;
        if (Math.abs(ev.clientX - startX) > 5) didDragRef.current = true;
        const deltaTime = ((ev.clientX - startX) / containerRef.current.clientWidth) * duration;
        let nextRange: { start: number; end: number; changed: boolean } | null = null;
        if (dragMode === 'left') nextRange = applyRange(origStart + deltaTime, origEnd);
        else if (dragMode === 'right') nextRange = applyRange(origStart, origEnd + deltaTime);
        else if (dragMode === 'move') {
          const len = origEnd - origStart;
          let start = origStart + deltaTime;
          let end = start + len;
          if (start < 0) {
            start = 0;
            end = len;
          }
          if (end > duration) {
            end = duration;
            start = duration - len;
          }
          nextRange = applyRange(start, end);
        }
        if (!nextRange) return;

        const currentPlayhead = playbackTimeRef.current;
        let nextPlayhead = currentPlayhead;
        if (nextRange.start > currentPlayhead) nextPlayhead = nextRange.start;
        else if (nextRange.end < currentPlayhead) nextPlayhead = nextRange.end;
        const playheadChanged = nextPlayhead !== currentPlayhead;
        if (playheadChanged) playbackTimeRef.current = nextPlayhead;
        if (!nextRange.changed && !playheadChanged) return;

        callbacksRef.current.onDraftChange?.({
          start: nextRange.start,
          end: nextRange.end,
          ...(playheadChanged ? { playhead: nextPlayhead } : {}),
        });
      };

      const onPointerUp = (ev: PointerEvent) => {
        dragRef.current.mode = 'none';
        setActiveDrag('none');
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        const { start, end } = draftRef.current;
        // 未拖拽：按点击位置跳转播放；拖拽结束：白条贴终点则回起点，否则保持游标
        if (!didDragRef.current) {
          const time = getSeekTimeFromClientX(ev.clientX);
          if (time != null) {
            playbackTimeRef.current = time;
            callbacksRef.current.onSeekPlay?.(time, { start, end });
          }
        } else {
          const playhead = clamp(playbackTimeRef.current, start, end);
          const resumeAt = playhead >= end - 0.05 ? start : playhead;
          playbackTimeRef.current = resumeAt;
          callbacksRef.current.onClipDragEnd?.(resumeAt, { start, end });
        }
        window.setTimeout(() => {
          didDragRef.current = false;
        }, 0);
      };

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
    },
    [draftStart, draftEnd, duration, applyRange, disabled, getSeekTimeFromClientX]
  );

  const clipDuration = draftEnd - draftStart;
  const leftPct = duration ? (draftStart / duration) * 100 : 0;
  const widthPct = duration ? ((draftEnd - draftStart) / duration) * 100 : 100;
  const centerTooltipText = `${clipDuration.toFixed(2)} S`;
  const leftHandleWidth = activeDrag === 'left' ? HANDLE_WIDTH_ACTIVE : HANDLE_WIDTH;
  const rightHandleWidth = activeDrag === 'right' ? HANDLE_WIDTH_ACTIVE : HANDLE_WIDTH;
  const clampedPlayhead = clamp(playbackTime, draftStart, draftEnd);
  const playheadPct = duration > 0 ? (clampedPlayhead / duration) * 100 : 0;

  const keyframeCells = useMemo(() => {
    if (!keyframeUrls.length) return null;
    return keyframeUrls.map((url, index) => (
      <div key={`${url}-${index}`} className='flex-1 h-full overflow-hidden'>
        {url ? <img src={url} alt='' className='w-full h-full object-cover' draggable={false} /> : <div className='w-full h-full bg-[#2a2a2a]' />}
      </div>
    ));
  }, [keyframeUrls]);

  const handleConfirmClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirmDisabled) return;
    const clipLen = draftEnd - draftStart;
    if (!duration || clipLen < minDuration) return;
    void onSave(draftStart, draftEnd);
  };

  return (
    <div className='flex items-center gap-2 nodrag nopan nowheel' onPointerDown={e => e.stopPropagation()}>
      {showCancel ? (
        <button
          type='button'
          disabled={disabled}
          className='shrink-0 w-8 h-8 rounded-lg bg-[#1a1a1a] border border-white/10 flex items-center justify-center text-white hover:bg-black/80 disabled:opacity-50 disabled:pointer-events-none'
          onPointerDown={e => e.stopPropagation()}
          onClick={e => {
            e.stopPropagation();
            onCancel?.();
          }}
        >
          <X size={16} />
        </button>
      ) : null}

      <div className='flex items-center flex-1 rounded-xl bg-[#262626]/65 backdrop-blur-[20px] py-1 pr-1 pl-1 border border-white/10' style={{ minWidth: TIMELINE_MIN_WIDTH }}>
        <div className='relative flex-1' style={{ minWidth: TIMELINE_INNER_MIN_WIDTH, height: TIMELINE_HEIGHT }}>
          {duration > 0 ? (
            <div className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 ${TOOLTIP_CLASS}`} style={{ left: `${leftPct + widthPct / 2}%` }}>
              {centerTooltipText}
            </div>
          ) : null}
          {activeDrag === 'left' ? (
            <div className={`absolute bottom-full left-0 mb-2 -translate-x-1/2 z-40 ${TOOLTIP_CLASS}`} style={{ left: `${leftPct}%` }}>
              {formatDuration(draftStart)}
            </div>
          ) : null}
          {activeDrag === 'right' ? (
            <div className={`absolute bottom-full left-0 mb-2 -translate-x-1/2 z-40 ${TOOLTIP_CLASS}`} style={{ left: `${leftPct + widthPct}%` }}>
              {formatDuration(draftEnd)}
            </div>
          ) : null}
          <div
            ref={containerRef}
            className={`absolute inset-0 bg-[#161616] rounded-lg overflow-hidden select-none ${disabled ? '' : 'cursor-pointer'}`}
            onClick={handleTimelineClick}
          >
            <div className='absolute inset-0 flex z-0 pointer-events-none'>{keyframeCells}</div>
            {duration > 0 ? (
              <>
                <div
                  className='absolute top-0 bottom-0 w-0.5 bg-white z-30 pointer-events-none shadow-[0_0_4px_rgba(255,255,255,0.8)]'
                  style={{ left: `${playheadPct}%`, transform: 'translateX(-50%)' }}
                />
                <div className='absolute inset-y-0 left-0 bg-[#000000]/75 z-[5] pointer-events-none' style={{ width: `${leftPct}%` }} />
                <div className='absolute inset-y-0 bg-[#000000]/75 z-[5] pointer-events-none' style={{ left: `${leftPct + widthPct}%`, right: 0 }} />
                <div
                  className={`absolute top-0 bottom-0 z-10 border-2 border-[#4155F0] bg-[#4155F0]/15 rounded-lg overflow-hidden ${disabled ? 'pointer-events-none opacity-60' : 'cursor-grab active:cursor-grabbing'}`}
                  style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                  onPointerDown={e => handlePointerDown(e, 'move')}
                  onClick={e => e.stopPropagation()}
                >
                  <div
                    className={`absolute left-0 top-0 bottom-0 cursor-ew-resize z-20 transition-[width,background-color,box-shadow] duration-150 ${activeDrag === 'left' ? 'bg-[#3abcff] shadow-[0_0_8px_rgba(34,211,238,0.6)]' : 'bg-[#4155F0]/80'}`}
                    style={{ width: leftHandleWidth, marginLeft: -leftHandleWidth / 2 }}
                    onPointerDown={e => {
                      e.stopPropagation();
                      handlePointerDown(e, 'left');
                    }}
                    onClick={e => e.stopPropagation()}
                  />
                  <div
                    className={`absolute right-0 top-0 bottom-0 cursor-ew-resize z-20 transition-[width,background-color,box-shadow] duration-150 ${activeDrag === 'right' ? 'bg-[#3abcff] shadow-[0_0_8px_rgba(34,211,238,0.6)]' : 'bg-[#4155F0]/80'}`}
                    style={{ width: rightHandleWidth, marginRight: -rightHandleWidth / 2 }}
                    onPointerDown={e => {
                      e.stopPropagation();
                      handlePointerDown(e, 'right');
                    }}
                    onClick={e => e.stopPropagation()}
                  />
                </div>
              </>
            ) : null}
          </div>
        </div>
      </div>

      <button
        type='button'
        disabled={confirmDisabled || !duration || draftEnd - draftStart < minDuration}
        className='shrink-0 w-8 h-8 rounded-lg bg-[#1a1a1a] border border-white/10 flex items-center justify-center text-white hover:bg-black/80 disabled:opacity-50 disabled:cursor-not-allowed'
        onPointerDown={e => e.stopPropagation()}
        onClick={handleConfirmClick}
      >
        {confirmLoading ? <LoaderCircle size={16} className='animate-spin' /> : <Check size={16} />}
      </button>
    </div>
  );
};

export const VideoClipBar = memo(VideoClip);
