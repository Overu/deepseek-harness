import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Download, Maximize, Pause, Play, Volume2, VolumeX, X } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { downloadFile } from '@/utils';

const formatTime = (seconds: number): string => {
  if (isNaN(seconds)) return '0:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const formattedMins = hrs > 0 ? mins.toString().padStart(2, '0') : mins;
  const formattedSecs = secs.toString().padStart(2, '0');
  return hrs > 0 ? `${hrs}:${formattedMins}:${formattedSecs}` : `${formattedMins}:${formattedSecs}`;
};

const formatFileSize = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '--';

  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  const fixed = unitIndex === 0 ? String(Math.round(size)) : size.toFixed(1).replace(/\.0$/, '');
  return `${fixed} ${units[unitIndex]}`;
};

const getVideoQualityLabel = (width: number, height: number): string => {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return '--';
  return `${Math.min(width, height)}P`;
};

const getAspectRatioLabel = (width: number, height: number): string => {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return '--';

  let left = Math.round(width);
  let right = Math.round(height);

  while (right !== 0) {
    const remainder = left % right;
    left = right;
    right = remainder;
  }

  return `${Math.round(width) / left}:${Math.round(height) / left}`;
};

const getAudibleVolume = (value: number): number => {
  if (!Number.isFinite(value) || value <= 0) return 1;
  return Math.min(value, 1);
};

const COMMON_RANGE_CLASS = `
  appearance-none bg-transparent cursor-pointer accent-white nodrag
  [&::-webkit-slider-runnable-track]:bg-transparent [&::-webkit-slider-runnable-track]:h-0.5
  [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-1.5 [&::-webkit-slider-thumb]:w-1.5
  [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white
  [&::-webkit-slider-thumb]:mt-[-2px] hover:[&::-webkit-slider-thumb]:scale-125 transition-all
  [&::-moz-range-track]:bg-transparent [&::-moz-range-track]:h-0.5
  [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:h-1.5 [&::-moz-range-thumb]:w-1.5
  [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-white
  [&::-moz-range-thumb]:cursor-pointer
`;

interface VideoPreviewDialogProps {
  open: boolean;
  url: string;
  poster: string;
  initialMuted: boolean;
  initialVolume: number;
  onOpenChange: (open: boolean) => void;
}

const VideoPreviewDialog = ({ open, url, poster, initialMuted, initialVolume, onOpenChange }: VideoPreviewDialogProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const autoPlayAttemptedRef = useRef(false);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(initialVolume);
  const [isMuted, setIsMuted] = useState(initialMuted);
  const [showVolumeBar, setShowVolumeBar] = useState(false);
  const [qualityLabel, setQualityLabel] = useState('--');
  const [aspectRatioLabel, setAspectRatioLabel] = useState('--');
  const [fileSizeLabel, setFileSizeLabel] = useState('--');

  useEffect(() => {
    if (!open) {
      videoRef.current?.pause();
      setIsPlaying(false);
      setShowVolumeBar(false);
      return;
    }

    autoPlayAttemptedRef.current = false;
    setIsLoading(true);
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setVolume(getAudibleVolume(initialVolume));
    setIsMuted(false);
    setShowVolumeBar(false);
    setQualityLabel('--');
    setAspectRatioLabel('--');
    setFileSizeLabel('--');
  }, [initialVolume, open, url]);

  useEffect(() => {
    if (!open || !url) return;

    const controller = new AbortController();

    fetch(url, {
      method: 'HEAD',
      mode: 'cors',
      cache: 'no-cache',
      signal: controller.signal,
    })
      .then(response => {
        if (!response.ok) return;

        const contentLength = response.headers.get('content-length');
        if (!contentLength) return;

        const bytes = Number(contentLength);
        setFileSizeLabel(formatFileSize(bytes));
      })
      .catch(error => {
        if (error?.name !== 'AbortError') {
          setFileSizeLabel('--');
        }
      });

    return () => controller.abort();
  }, [open, url]);

  const playOnceAfterLoad = useCallback(async () => {
    const video = videoRef.current;
    if (!open || !video || autoPlayAttemptedRef.current) return;

    autoPlayAttemptedRef.current = true;
    const audibleVolume = getAudibleVolume(volume);
    video.muted = false;
    video.volume = audibleVolume;
    setIsMuted(false);
    if (volume !== audibleVolume) setVolume(audibleVolume);

    try {
      await video.play();
      setIsPlaying(true);
    } catch {
      setIsPlaying(false);
    }
  }, [open, volume]);

  const togglePreviewPlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    if (video.paused) {
      video
        .play()
        .then(() => setIsPlaying(true))
        .catch(() => setIsPlaying(false));
      return;
    }

    video.pause();
    setIsPlaying(false);
  }, []);

  const handlePreviewSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = time;
    setCurrentTime(time);
  };

  const handlePreviewVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextVolume = parseFloat(e.target.value);
    const muted = nextVolume === 0;
    const video = videoRef.current;

    setVolume(nextVolume);
    setIsMuted(muted);
    if (!video) return;
    video.volume = nextVolume;
    video.muted = muted;
  };

  const togglePreviewMute = useCallback(() => {
    const nextMuted = !isMuted;
    const nextVolume = nextMuted ? 0 : volume || 0.5;
    const video = videoRef.current;

    setIsMuted(nextMuted);
    if (!nextMuted && volume === 0) setVolume(nextVolume);
    if (!video) return;
    video.muted = nextMuted;
    video.volume = nextVolume;
  }, [isMuted, volume]);

  const handlePreviewFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(err => console.error(err));
      return;
    }

    stageRef.current?.requestFullscreen().catch(err => console.error(err));
  }, []);

  const handleDownload = useCallback(() => {
    downloadFile(url);
  }, [url]);

  const progressPercent = duration ? (currentTime / duration) * 100 : 0;
  const volumePercent = (isMuted ? 0 : volume) * 100;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        overlayClassName='z-[999] bg-black/45 backdrop-blur-[10px]'
        className='z-[1000] h-[calc(100vh-36px)] w-[calc(100vw-40px)] max-w-none overflow-hidden border border-white/10 bg-[#171717]/80 p-0 text-white shadow-[0_24px_90px_rgba(0,0,0,0.5)] backdrop-blur-[10px] focus:outline-none sm:rounded-xl'
      >
        <DialogTitle className='sr-only'>视频预览</DialogTitle>
        <div className='flex h-full min-h-0 flex-col md:flex-row'>
          <div
            ref={stageRef}
            className='group/preview relative flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden bg-black/35'
            onDoubleClick={togglePreviewPlay}
          >
            {isLoading && (
              <div className='absolute inset-0 z-10 flex items-center justify-center bg-black/20'>
                <div className='h-8 w-8 rounded-full border-2 border-white/25 border-t-white animate-spin' />
              </div>
            )}

            <video
              ref={videoRef}
              src={url}
              poster={poster}
              preload='auto'
              playsInline
              disablePictureInPicture
              disableRemotePlayback
              crossOrigin='anonymous'
              muted={isMuted}
              controls={false}
              className='h-full max-h-full w-full max-w-[1560px] object-contain'
              onLoadedMetadata={e => {
                setDuration(e.currentTarget.duration);
                setQualityLabel(getVideoQualityLabel(e.currentTarget.videoWidth, e.currentTarget.videoHeight));
                setAspectRatioLabel(getAspectRatioLabel(e.currentTarget.videoWidth, e.currentTarget.videoHeight));
              }}
              onLoadedData={() => {
                setIsLoading(false);
                playOnceAfterLoad();
              }}
              onCanPlay={() => {
                setIsLoading(false);
                playOnceAfterLoad();
              }}
              onPlaying={() => {
                setIsLoading(false);
                setIsPlaying(true);
              }}
              onWaiting={() => setIsLoading(true)}
              onTimeUpdate={e => setCurrentTime(e.currentTarget.currentTime)}
              onEnded={() => setIsPlaying(false)}
            />

            <div className='pointer-events-none absolute inset-x-0 bottom-0 z-20 translate-y-4 bg-gradient-to-t from-black/85 via-black/35 to-transparent px-5 pb-5 pt-16 opacity-0 transition-all duration-200 ease-out group-hover/preview:translate-y-0 group-hover/preview:opacity-100'>
              <div className='pointer-events-auto flex items-center gap-4' onDoubleClick={e => e.stopPropagation()}>
                <button
                  type='button'
                  onClick={togglePreviewPlay}
                  className='flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white transition-colors hover:bg-white/10'
                >
                  {isPlaying ? <Pause fill='white' size={18} /> : <Play fill='white' size={18} />}
                </button>

                <input
                  type='range'
                  min='0'
                  max={duration || 0}
                  step='0.001'
                  value={currentTime}
                  onChange={handlePreviewSeek}
                  className={`h-1 min-w-0 flex-1 ${COMMON_RANGE_CLASS}`}
                  style={{
                    background: `linear-gradient(to right, white ${progressPercent}%, rgba(255,255,255,0.34) ${progressPercent}%)`,
                  }}
                />

                <div className='w-[84px] shrink-0 text-sm font-medium tabular-nums text-white/90'>
                  {formatTime(currentTime)} <span className='text-white/50'>/</span> {formatTime(duration)}
                </div>

                <div className='relative flex shrink-0 items-center' onMouseEnter={() => setShowVolumeBar(true)} onMouseLeave={() => setShowVolumeBar(false)}>
                  <div
                    className={`absolute bottom-full left-1/2 flex -translate-x-1/2 flex-col items-center pb-2 transition-all duration-200 ${showVolumeBar ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0 pointer-events-none'}`}
                  >
                    <div className='flex flex-col items-center gap-2 rounded-lg border border-white/10 bg-zinc-900/95 p-2 pb-3 shadow-xl backdrop-blur-md'>
                      <div className='relative flex h-20 w-5 items-center justify-center'>
                        <input
                          type='range'
                          min='0'
                          max='1'
                          step='0.01'
                          value={isMuted ? 0 : volume}
                          onChange={handlePreviewVolumeChange}
                          className={`absolute h-0.5 w-16 origin-center rotate-[-90deg] ${COMMON_RANGE_CLASS}`}
                          style={{
                            background: `linear-gradient(to right, white ${volumePercent}%, rgba(255,255,255,0.34) ${volumePercent}%)`,
                          }}
                        />
                      </div>
                      <span className='text-xs font-bold tabular-nums text-white/70'>{Math.round(volumePercent)}%</span>
                    </div>
                  </div>

                  <button
                    type='button'
                    onClick={togglePreviewMute}
                    className='flex h-8 w-8 items-center justify-center rounded-full text-white transition-colors hover:bg-white/10'
                  >
                    {isMuted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
                  </button>
                </div>

                <button
                  type='button'
                  onClick={handlePreviewFullscreen}
                  className='flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white transition-colors hover:bg-white/10'
                >
                  <Maximize size={18} />
                </button>
              </div>
            </div>
          </div>

          <aside className='flex min-h-0 w-full flex-col border-t border-white/10 bg-[#202020]/90 p-4 backdrop-blur-[10px] md:w-[292px] md:border-l md:border-t-0'>
            <div className='mb-4 flex items-center justify-between'>
              <div className='text-sm font-semibold text-white/85'>视频预览</div>
              <button
                type='button'
                onClick={() => onOpenChange(false)}
                className='flex h-8 w-8 items-center justify-center rounded-md text-white/75 transition-colors hover:bg-white/10 hover:text-white'
              >
                <X size={18} />
              </button>
            </div>

            <div className='space-y-5 overflow-y-auto pr-1 text-sm'>
              {/* <section>
                <div className='mb-2 font-semibold text-white/80'>提示词</div>
                <div className='min-h-[180px] rounded-lg bg-white/10 p-3 leading-5 text-white/50'>--</div>
              </section> */}

              <section>
                <div className='mb-2 font-semibold text-white/80'>信息</div>
                <div className='space-y-2 rounded-lg bg-white/10 p-3 text-white/70'>
                  {/* <div className='flex gap-2'>
                    <span className='w-16 shrink-0 text-white/40'>模型:</span>
                    <span>--</span>
                  </div> */}
                  <div className='flex gap-2'>
                    <span className='w-16 shrink-0 text-white/40'>质量:</span>
                    <span>{qualityLabel}</span>
                  </div>
                  <div className='flex gap-2'>
                    <span className='w-16 shrink-0 text-white/40'>宽高比:</span>
                    <span>{aspectRatioLabel}</span>
                  </div>
                  <div className='flex gap-2'>
                    <span className='w-16 shrink-0 text-white/40'>时长:</span>
                    <span>{duration ? formatTime(duration) : '--'}</span>
                  </div>
                  <div className='flex gap-2'>
                    <span className='w-16 shrink-0 text-white/40'>文件大小:</span>
                    <span>{fileSizeLabel}</span>
                  </div>
                  <div className='flex gap-2'>
                    <span className='w-16 shrink-0 text-white/40'>创建日期:</span>
                    <span>--</span>
                  </div>
                  <div className='flex gap-2'>
                    <span className='w-16 shrink-0 text-white/40'>创建者:</span>
                    <span>--</span>
                  </div>
                </div>
              </section>
            </div>

            <button
              type='button'
              onClick={handleDownload}
              className='mt-auto flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-white/20 text-sm font-semibold text-white transition-colors hover:bg-white/30'
            >
              <Download size={16} />
              下载
            </button>
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default VideoPreviewDialog;
