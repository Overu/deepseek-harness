/* eslint-disable react-refresh/only-export-components */
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import WaveSurfer from 'wavesurfer.js';
import { Check, LoaderCircle, Pause, Play, X } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { formatDuration } from '@/utils/index';
import { uploadFile } from '@/services/upload/uploadFile';
import { useFlowStore } from '@/store/flowStore';
import { toast } from 'sonner';

export const getAudioDuration = (url: string): Promise<number> =>
  new Promise((resolve, reject) => {
    const audio = new Audio();
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => {
      const duration = audio.duration;
      if (!Number.isFinite(duration) || duration <= 0) {
        reject(new Error('invalid duration'));
        return;
      }
      resolve(duration);
    };
    audio.onerror = () => reject(new Error('load failed'));
    audio.src = url;
  });

const encodeWavBlob = (buffer: AudioBuffer): Blob => {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const bitDepth = 16;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const length = buffer.length;
  const dataSize = length * blockAlign;
  const arrayBuffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(arrayBuffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, buffer.getChannelData(ch)[i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
};

const clipAudioFromUrl = async (sourceUrl: string, startSecond: number, endSecond: number): Promise<Blob> => {
  const response = await fetch(sourceUrl);
  if (!response.ok) throw new Error('fetch audio failed');
  const arrayBuffer = await response.arrayBuffer();
  const audioContext = new AudioContext();
  try {
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    const sampleRate = audioBuffer.sampleRate;
    const startSample = Math.floor(startSecond * sampleRate);
    const endSample = Math.min(Math.floor(endSecond * sampleRate), audioBuffer.length);
    const frameCount = Math.max(0, endSample - startSample);
    if (frameCount <= 0) throw new Error('invalid clip range');

    const clipped = audioContext.createBuffer(audioBuffer.numberOfChannels, frameCount, sampleRate);
    for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
      clipped.getChannelData(ch).set(audioBuffer.getChannelData(ch).subarray(startSample, endSample));
    }
    return encodeWavBlob(clipped);
  } finally {
    await audioContext.close();
  }
};

const clipAndUpload = async (sourceUrl: string, startSecond: number, endSecond: number): Promise<string> => {
  const blob = await clipAudioFromUrl(sourceUrl, startSecond, endSecond);
  const file = new File([blob], `clip-${Date.now()}.wav`, { type: 'audio/wav' });
  const url = (await uploadFile(file)).url;
  if (!url) throw new Error('upload failed');
  return url;
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
      const url = await clipAndUpload(sourceUrl, startSecond, endSecond);
      const latest = useFlowStore.getState().nodes.find(n => n.id === nodeId);
      if (!latest) return;
      const latestData = latest.data as Record<string, unknown>;
      const latestParams = (latestData.params as Record<string, unknown>) || {};
      const { sourceUrl: removedSourceUrl, ...restParams } = latestParams;
      void removedSourceUrl;
      updateNodeData(
        nodeId,
        {
          ...latestData,
          time: Date.now(),
          value: url,
          product: [{ value: url }],
          params: {
            ...restParams,
            audioStartSecond: startSecond,
            audioEndSecond: endSecond,
          },
        },
        true,
        true
      );
      updateNodeStatus(nodeId, 'success');
      if (onComplete) {
        await onComplete(url);
      }
    } catch {
      if (useFlowStore.getState().nodes.some(n => n.id === nodeId)) {
        updateNodeStatus(nodeId, 'success');
        toast.error('音频裁切失败，请重试');
      }
    } finally {
      runningNodeIds.delete(nodeId);
    }
  })();
}

type DragMode = 'none' | 'move' | 'left' | 'right';

const WAVEFORM_HEIGHT = 48;
const HANDLE_WIDTH = 4;
const HANDLE_WIDTH_ACTIVE = 12;
const DEFAULT_MIN_DURATION = 2;
const TOOLTIP_CLASS = 'px-2 py-0.5 rounded-md bg-black/80 text-xs text-white whitespace-nowrap pointer-events-none';
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export interface AudioClipProps {
  audioUrl: string;
  /** 选区最短时长（秒），未传时默认 2 秒 */
  minDuration?: number;
  maxDuration: number;
  startSecond: number;
  endSecond: number;
  onSave: (startSecond: number, endSecond: number) => void | Promise<void>;
  onCancel?: () => void;
  confirmLoading?: boolean;
  /** 工具权限不可用：仅置灰确定按钮，裁切交互仍可预览 */
  permissionDisabled?: boolean;
}

const AudioClip = ({
  audioUrl,
  minDuration = DEFAULT_MIN_DURATION,
  maxDuration,
  startSecond,
  endSecond,
  onSave,
  onCancel,
  confirmLoading = false,
  permissionDisabled = false,
}: AudioClipProps) => {
  const showCancel = Boolean(onCancel);
  const containerRef = useRef<HTMLDivElement>(null);
  const waveRef = useRef<HTMLDivElement>(null);
  const waveSurferRef = useRef<WaveSurfer | null>(null);
  const [duration, setDuration] = useState(0);
  const [draftStart, setDraftStart] = useState(startSecond);
  const [draftEnd, setDraftEnd] = useState(endSecond);
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeDrag, setActiveDrag] = useState<DragMode>('none');
  const dragRef = useRef<{ mode: DragMode; startX: number; origStart: number; origEnd: number }>({
    mode: 'none',
    startX: 0,
    origStart: 0,
    origEnd: 0,
  });

  const disabled = confirmLoading;
  const confirmDisabled = confirmLoading || permissionDisabled;

  useEffect(() => {
    setDraftStart(startSecond);
    if (endSecond > 0) {
      setDraftEnd(endSecond);
    }
  }, [startSecond, endSecond, audioUrl]);

  useEffect(() => {
    if (!waveRef.current) return;
    const ws = WaveSurfer.create({
      container: waveRef.current,
      waveColor: '#4155F0',
      progressColor: '#818CF8',
      height: WAVEFORM_HEIGHT,
      normalize: true,
      interact: false,
    });
    waveSurferRef.current = ws;
    ws.load(audioUrl);

    ws.on('ready', () => {
      const d = ws.getDuration();
      setDuration(d);
      if (endSecond <= 0 || endSecond > d) {
        setDraftStart(0);
        setDraftEnd(Math.min(d, maxDuration));
      }
    });

    ws.on('play', () => setIsPlaying(true));
    ws.on('pause', () => setIsPlaying(false));
    ws.on('finish', () => setIsPlaying(false));

    return () => {
      ws.destroy();
      waveSurferRef.current = null;
    };
  }, [audioUrl, endSecond, maxDuration]);

  useEffect(() => {
    const ws = waveSurferRef.current;
    if (!ws) return;
    const onProcess = (time: number) => {
      if (time >= draftEnd - 0.02) {
        ws.pause();
        ws.setTime(draftStart);
        setIsPlaying(false);
      }
    };
    ws.on('audioprocess', onProcess);
    return () => ws.un('audioprocess', onProcess);
  }, [draftStart, draftEnd]);

  const applyRange = useCallback(
    (nextStart: number, nextEnd: number) => {
      if (!duration || disabled) return;
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
      setDraftStart(start);
      setDraftEnd(end);
    },
    [duration, minDuration, maxDuration, disabled]
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent, mode: DragMode) => {
      if (disabled || mode === 'none') return;
      e.preventDefault();
      e.stopPropagation();
      dragRef.current = { mode, startX: e.clientX, origStart: draftStart, origEnd: draftEnd };
      setActiveDrag(mode);

      const onPointerMove = (ev: PointerEvent) => {
        const { mode: dragMode, startX, origStart, origEnd } = dragRef.current;
        if (dragMode === 'none' || !containerRef.current || !duration) return;
        const deltaTime = ((ev.clientX - startX) / containerRef.current.clientWidth) * duration;
        if (dragMode === 'left') applyRange(origStart + deltaTime, origEnd);
        else if (dragMode === 'right') applyRange(origStart, origEnd + deltaTime);
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
          applyRange(start, end);
        }
      };

      const onPointerUp = () => {
        dragRef.current.mode = 'none';
        setActiveDrag('none');
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
      };

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
    },
    [draftStart, draftEnd, duration, applyRange, disabled]
  );

  const togglePlay = () => {
    if (disabled) return;
    const ws = waveSurferRef.current;
    if (!ws || !duration) return;
    if (isPlaying) {
      ws.pause();
      return;
    }
    ws.setTime(draftStart);
    ws.play();
  };

  const clipDuration = draftEnd - draftStart;
  const leftPct = duration ? (draftStart / duration) * 100 : 0;
  const widthPct = duration ? ((draftEnd - draftStart) / duration) * 100 : 100;

  const centerTooltipText = `${clipDuration.toFixed(2)} S`;

  const leftHandleWidth = activeDrag === 'left' ? HANDLE_WIDTH_ACTIVE : HANDLE_WIDTH;
  const rightHandleWidth = activeDrag === 'right' ? HANDLE_WIDTH_ACTIVE : HANDLE_WIDTH;

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

      <div className='flex items-center gap-1 flex-1 min-w-[280px] rounded-xl bg-[#262626]/65 backdrop-blur-[20px] py-1 pr-1 pl-1 border border-white/10'>
        <button
          type='button'
          disabled={disabled}
          className='shrink-0 w-8 h-8 flex items-center justify-center text-white disabled:opacity-50'
          onPointerDown={e => e.stopPropagation()}
          onClick={e => {
            e.stopPropagation();
            togglePlay();
          }}
        >
          {isPlaying ? <Pause size={18} fill='currentColor' /> : <Play size={18} fill='currentColor' />}
        </button>
        <div className='relative flex-1 min-w-[200px] h-[48px]'>
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
          <div ref={containerRef} className='absolute inset-0 bg-[#161616] rounded-lg overflow-hidden select-none'>
            <div ref={waveRef} className='absolute inset-0 w-full pointer-events-none z-0' />
            {duration > 0 ? (
              <>
                <div className='absolute inset-y-0 left-0 bg-[#000000]/75 z-[5] pointer-events-none' style={{ width: `${leftPct}%` }} />
                <div className='absolute inset-y-0 bg-[#000000]/75 z-[5] pointer-events-none' style={{ left: `${leftPct + widthPct}%`, right: 0 }} />
                <div
                  className={`absolute top-0 bottom-0 z-10 border-2 border-[#4155F0] bg-[#4155F0]/15 rounded-lg overflow-hidden ${disabled ? 'pointer-events-none opacity-60' : 'cursor-grab active:cursor-grabbing'}`}
                  style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                  onPointerDown={e => handlePointerDown(e, 'move')}
                >
                  <div
                    className={`absolute left-0 top-0 bottom-0 cursor-ew-resize z-20 transition-[width,background-color,box-shadow] duration-150 ${activeDrag === 'left' ? 'bg-[#3abcff] shadow-[0_0_8px_rgba(34,211,238,0.6)]' : 'bg-[#4155F0]/80'}`}
                    style={{ width: leftHandleWidth, marginLeft: -leftHandleWidth / 2 }}
                    onPointerDown={e => handlePointerDown(e, 'left')}
                  />
                  <div
                    className={`absolute right-0 top-0 bottom-0 cursor-ew-resize z-20 transition-[width,background-color,box-shadow] duration-150 ${activeDrag === 'right' ? 'bg-[#3abcff] shadow-[0_0_8px_rgba(34,211,238,0.6)]' : 'bg-[#4155F0]/80'}`}
                    style={{ width: rightHandleWidth, marginRight: -rightHandleWidth / 2 }}
                    onPointerDown={e => handlePointerDown(e, 'right')}
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

export const AudioClipBar = memo(AudioClip);

interface AudioClipPopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchor: React.ReactNode;
  audioUrl: string;
  minDuration?: number;
  maxDuration: number;
  startSecond: number;
  endSecond: number;
  onSave: (startSecond: number, endSecond: number) => void;
}

const AudioClipPopover = ({ open, onOpenChange, anchor, audioUrl, minDuration = DEFAULT_MIN_DURATION, maxDuration, startSecond, endSecond, onSave }: AudioClipPopoverProps) => {
  const [sessionKey, setSessionKey] = useState(0);

  return (
    <Popover
      open={open}
      onOpenChange={next => {
        if (next) setSessionKey(k => k + 1);
        onOpenChange(next);
      }}
    >
      <PopoverTrigger asChild>{anchor}</PopoverTrigger>
      <PopoverContent
        side='top'
        align='center'
        sideOffset={8}
        className='w-auto max-w-[min(560px,calc(100vw-32px))] p-0 bg-transparent border-0 shadow-none nodrag'
        onInteractOutside={() => onOpenChange(false)}
        onEscapeKeyDown={() => onOpenChange(false)}
      >
        {open && audioUrl ? (
          <AudioClip
            key={sessionKey}
            audioUrl={audioUrl}
            minDuration={minDuration}
            maxDuration={maxDuration}
            startSecond={startSecond}
            endSecond={endSecond}
            onSave={(start, end) => {
              onSave(start, end);
              onOpenChange(false);
            }}
            onCancel={() => onOpenChange(false)}
          />
        ) : null}
      </PopoverContent>
    </Popover>
  );
};

export default memo(AudioClipPopover);
