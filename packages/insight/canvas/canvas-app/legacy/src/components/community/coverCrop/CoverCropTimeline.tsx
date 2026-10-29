import { useRef, type PointerEvent as ReactPointerEvent, type SyntheticEvent } from 'react';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';

import { formatTime } from './coverCropUtils';
import { CoverCropTimelineSkeleton } from './CoverCropSkeleton';

interface CoverCropTimelineFrame {
  time: number;
  url: string;
}

interface CoverCropTimelineProps {
  frames: CoverCropTimelineFrame[];
  ready: boolean;
  dragging: boolean;
  percent: number;
  sliderTime: number;
  previewUrl: string;
  previewLoading: boolean;
  videoDuration: number;
  submitting: boolean;
  canUseTimeline: boolean;
  onFrameLoad: () => void;
  onFrameError: (event: SyntheticEvent<HTMLImageElement>) => void;
  onTimelineStart: () => void;
  onTimelineChange: (time: number) => void;
  onTimelineCommit: (time: number) => void;
}

export function CoverCropTimeline({
  frames,
  ready,
  dragging,
  percent,
  sliderTime,
  previewUrl,
  previewLoading,
  videoDuration,
  submitting,
  canUseTimeline,
  onFrameLoad,
  onFrameError,
  onTimelineStart,
  onTimelineChange,
  onTimelineCommit,
}: CoverCropTimelineProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const handleDragRef = useRef<{ pointerId: number; offsetX: number } | null>(null);
  const disabled = submitting || !canUseTimeline;

  const getPointerTime = (clientX: number, offsetX: number) => {
    const track = trackRef.current;
    if (!track || videoDuration <= 0) return sliderTime;

    const rect = track.getBoundingClientRect();
    const handleWidth = 66;
    const availableWidth = Math.max(rect.width - handleWidth, 1);
    const centerX = Math.min(Math.max(clientX - rect.left - offsetX, handleWidth / 2), rect.width - handleWidth / 2);
    const nextPercent = (centerX - handleWidth / 2) / availableWidth;

    return Math.round(nextPercent * videoDuration * 100) / 100;
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled) return;

    const track = trackRef.current;
    if (!track) return;

    const rect = track.getBoundingClientRect();
    const availableWidth = Math.max(rect.width - 66, 1);
    const centerX = rect.left + 33 + (percent / 100) * availableWidth;

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    handleDragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - centerX,
    };
    onTimelineStart();
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = handleDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    onTimelineChange(getPointerTime(event.clientX, drag.offsetX));
  };

  const finishHandleDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = handleDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const nextTime = getPointerTime(event.clientX, drag.offsetX);
    handleDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    onTimelineChange(nextTime);
    onTimelineCommit(nextTime);
  };

  const cancelHandleDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = handleDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    handleDragRef.current = null;
    onTimelineCommit(sliderTime);
  };

  return (
    <div className='mt-4 flex items-center rounded-md  py-4 text-xs text-white/70'>
      <div ref={trackRef} className='relative h-[70px] flex-1 overflow-visible'>
        <div className='absolute inset-0 grid grid-cols-10 grid-rows-1 overflow-hidden rounded-md bg-[#101010] ring-1 ring-white/10'>
          {frames.length > 0 ? (
            frames.map(frame => (
              <div key={`${frame.time}-${frame.url}`} className='relative min-h-0 min-w-0 overflow-hidden'>
                <img
                  src={frame.url}
                  crossOrigin='anonymous'
                  alt=''
                  draggable={false}
                  className='absolute inset-0 h-full w-full object-cover object-center'
                  onLoad={onFrameLoad}
                  onError={onFrameError}
                />
              </div>
            ))
          ) : (
            <div className='col-span-10 h-full w-full bg-[#111]' />
          )}
        </div>

        {!ready && <CoverCropTimelineSkeleton />}

        {ready && (
          <>
            <div className='pointer-events-none absolute inset-y-0 left-[33px] right-[33px] z-40'>
              <div
                className={`pointer-events-auto absolute top-1/2 h-[82px] w-[66px] touch-none -translate-x-1/2 -translate-y-1/2 cursor-ew-resize overflow-visible rounded-md border-2 border-white bg-[#101010] shadow-[0_10px_30px_rgba(0,0,0,0.45)] transition-transform duration-150 ${
                  dragging ? 'scale-105' : 'scale-100'
                } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
                style={{ left: `${percent}%` }}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={finishHandleDrag}
                onPointerCancel={cancelHandleDrag}
              >
                {previewUrl && (
                  <img src={previewUrl} crossOrigin='anonymous' alt='' draggable={false} className='absolute inset-0 h-full w-full rounded-[4px] object-cover object-center' />
                )}
                <div className='absolute inset-1 rounded-sm ring-1 ring-black/40' />
                {previewLoading && (
                  <div className='absolute inset-0 flex items-center justify-center rounded-[4px] bg-black/35'>
                    <Loader2 className='h-4 w-4 animate-spin text-white' />
                  </div>
                )}
                <div className='absolute -bottom-4 left-1/2 flex -translate-x-1/2 items-center rounded-sm bg-white px-1 py-0.5 text-[#3a3a3a] shadow-md'>
                  <ChevronLeft className='h-2.5 w-2.5' />
                  <ChevronRight className='h-2.5 w-2.5' />
                </div>
              </div>
            </div>

            {dragging && (
              <div className='pointer-events-none absolute inset-y-0 left-[33px] right-[33px] z-20'>
                <div
                  className='absolute bottom-[78px] min-w-14 -translate-x-1/2 rounded-md border border-white/20 bg-[#1e1e1e] px-2 text-center text-[11px] leading-7 text-white/85 shadow-xl'
                  style={{ left: `${percent}%` }}
                >
                  {formatTime(sliderTime)}
                </div>
              </div>
            )}

            <input
              type='range'
              value={sliderTime}
              min={0}
              max={videoDuration || 0}
              step={0.01}
              disabled={disabled}
              className='absolute inset-0 z-30 h-full w-full cursor-ew-resize opacity-0 disabled:cursor-not-allowed'
              onPointerDown={onTimelineStart}
              onChange={event => onTimelineChange(Number(event.currentTarget.value))}
              onPointerUp={event => onTimelineCommit(Number(event.currentTarget.value))}
              onPointerCancel={event => onTimelineCommit(Number(event.currentTarget.value))}
              onKeyUp={event => onTimelineCommit(Number(event.currentTarget.value))}
              onBlur={event => {
                if (dragging) {
                  onTimelineCommit(Number(event.currentTarget.value));
                }
              }}
            />
          </>
        )}
      </div>
    </div>
  );
}
