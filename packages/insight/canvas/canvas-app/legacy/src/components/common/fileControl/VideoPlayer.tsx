import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Play, Pause, Volume2, VolumeX, Maximize2, Settings, ChevronRight, Monitor, Gauge, Check } from 'lucide-react';

/**
 * 工具函数：将秒数格式化为 MM:SS 或 HH:MM:SS
 */
const formatTime = (seconds: number): string => {
  if (isNaN(seconds)) return '0:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const formattedMins = hrs > 0 ? mins.toString().padStart(2, '0') : mins;
  const formattedSecs = secs.toString().padStart(2, '0');
  return hrs > 0 ? `${hrs}:${formattedMins}:${formattedSecs}` : `${formattedMins}:${formattedSecs}`;
};

const PLAYBACK_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

// 定义通用的进度条类名，确保两者完全一致
const COMMON_RANGE_CLASS = `
  appearance-none bg-transparent cursor-pointer accent-white nodrag
  [&::-webkit-slider-runnable-track]:bg-transparent [&::-webkit-slider-runnable-track]:h-0.5
  [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-1.5 [&::-webkit-slider-thumb]:w-1.5 
  [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white 
  [&::-webkit-slider-thumb]:mt-[-2px] hover:[&::-webkit-slider-thumb]:scale-125 transition-all
  /* Firefox兼容样式 */
  [&::-moz-range-track]:bg-transparent [&::-moz-range-track]:h-0.5
  [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:h-1.5 [&::-moz-range-thumb]:w-1.5 
  [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-white 
  [&::-moz-range-thumb]:cursor-pointer
`;

const pendingPosterLoadCallbacks = new Set<() => void>();
let posterLoadTimer: ReturnType<typeof setTimeout> | null = null;

const isSafariBrowser = () => typeof navigator !== 'undefined' && /safari/i.test(navigator.userAgent) && !/chrome|chromium|crios|fxios|android/i.test(navigator.userAgent);
const getPosterLoadBatchSize = () => (isSafariBrowser() ? 1 : 6);
const getPosterLoadBatchDelay = () => (isSafariBrowser() ? 260 : 100);
const getPosterLoadInitialDelay = () => (isSafariBrowser() ? 800 : 0);

const schedulePosterLoadBatch = () => {
  if (posterLoadTimer || pendingPosterLoadCallbacks.size === 0) return;

  posterLoadTimer = setTimeout(() => {
    posterLoadTimer = null;
    const callbacks = Array.from(pendingPosterLoadCallbacks).slice(0, getPosterLoadBatchSize());
    callbacks.forEach(callback => {
      if (!pendingPosterLoadCallbacks.delete(callback)) return;
      callback();
    });
    schedulePosterLoadBatch();
  }, getPosterLoadBatchDelay());
};

const requestPosterLoad = (callback: () => void) => {
  let enqueueTimer: ReturnType<typeof setTimeout> | null = null;
  const enqueue = () => {
    enqueueTimer = null;
    pendingPosterLoadCallbacks.add(callback);
    schedulePosterLoadBatch();
  };

  const initialDelay = getPosterLoadInitialDelay();
  if (initialDelay > 0) {
    enqueueTimer = setTimeout(enqueue, initialDelay);
  } else {
    enqueue();
  }

  return () => {
    if (enqueueTimer) clearTimeout(enqueueTimer);
    pendingPosterLoadCallbacks.delete(callback);
  };
};

export const VideoPlayer = ({
  url,
  style,
  pauseWhileRunning,
  playOnHover = false,
  onPreview,
  seekRequest,
  playRangeStart,
  playRangeEnd,
  pauseRequest,
  hideProgressBar = false,
  onPlaybackTimeChange,
  onPlayingChange,
  ...restProps
}: {
  url: string;
  style?: React.CSSProperties;
  pauseWhileRunning?: boolean;
  playOnHover?: boolean;
  /** 双击/全屏按钮触发，由父组件决定打开何种预览 */
  onPreview?: (e?: React.MouseEvent) => void;
  /** 外部 seek；play=true 时 seek 后播放 */
  seekRequest?: { time: number; seq: number; play: boolean };
  /** 裁切区间起点（到达终点后回退到此时间） */
  playRangeStart?: number;
  /** 播放到该时间点自动暂停（用于裁切区间预览） */
  playRangeEnd?: number;
  /** 外部强制暂停（seq 变化时生效） */
  pauseRequest?: { seq: number };
  /** 隐藏底部进度条 */
  hideProgressBar?: boolean;
  /** 播放进度变化回调（用于外部时间轴游标） */
  onPlaybackTimeChange?: (time: number) => void;
  /** 播放/暂停状态变化 */
  onPlayingChange?: (playing: boolean) => void;
  [key: string]: any;
}) => {
  const containerProps = { ...restProps };

  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hoverIntentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverPlayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playRequestIdRef = useRef(0);
  const isHoveringRef = useRef(false);
  const hoverPlaybackIntentRef = useRef(false);
  const didMountRef = useRef(false);

  const [isActive, setIsActive] = useState(false);
  const [posterInViewport, setPosterInViewport] = useState(false);
  const [shouldLoadPoster, setShouldLoadPoster] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(Boolean(playOnHover));
  const [showVolumeBar, setShowVolumeBar] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isHovering, setIsHovering] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [playFailed, setPlayFailed] = useState(false);
  const onPlayingChangeRef = useRef(onPlayingChange);

  useEffect(() => {
    onPlayingChangeRef.current = onPlayingChange;
  }, [onPlayingChange]);

  useEffect(() => {
    onPlayingChangeRef.current?.(isPlaying);
  }, [isPlaying]);

  const clearHoverIntent = useCallback(() => {
    if (!hoverIntentTimerRef.current) return;
    clearTimeout(hoverIntentTimerRef.current);
    hoverIntentTimerRef.current = null;
  }, []);

  const snapToPlayRangeStartIfNeeded = useCallback(
    (video: HTMLVideoElement) => {
      if (playRangeStart == null || !Number.isFinite(playRangeStart)) return;
      const end = playRangeEnd != null && Number.isFinite(playRangeEnd) ? playRangeEnd : undefined;
      const t = video.currentTime;
      const outsideRange = t < playRangeStart - 0.05 || (end != null && t >= end - 0.05);
      if (!outsideRange) return;
      video.currentTime = playRangeStart;
      setCurrentTime(playRangeStart);
      onPlaybackTimeChange?.(playRangeStart);
    },
    [onPlaybackTimeChange, playRangeEnd, playRangeStart]
  );

  const playVideo = useCallback(async () => {
    const video = videoRef.current;
    if (!video || pauseWhileRunning) return;
    if (playOnHover && !isHoveringRef.current) return;
    if (playOnHover && !hoverPlaybackIntentRef.current) return;

    const requestId = playRequestIdRef.current + 1;
    playRequestIdRef.current = requestId;

    if (playOnHover && duration && video.currentTime >= duration - 0.08) {
      video.currentTime = 0;
      setCurrentTime(0);
    } else {
      snapToPlayRangeStartIfNeeded(video);
    }

    video.muted = isMuted;
    video.volume = isMuted ? 0 : volume;
    setPlayFailed(false);
    setIsLoading(video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA);

    try {
      await video.play();
      if (requestId !== playRequestIdRef.current) return;
      if (playOnHover && !isHoveringRef.current) {
        video.pause();
        setIsPlaying(false);
        setIsLoading(false);
        return;
      }
      setIsPlaying(true);
      setVideoReady(true);
      setIsLoading(false);
    } catch {
      if (requestId !== playRequestIdRef.current) return;
      setIsPlaying(false);
      setIsLoading(false);
      setPlayFailed(true);
    }
  }, [duration, isMuted, pauseWhileRunning, playOnHover, snapToPlayRangeStartIfNeeded, volume]);

  const clearHoverPlayTimer = useCallback(() => {
    if (!hoverPlayTimerRef.current) return;
    clearTimeout(hoverPlayTimerRef.current);
    hoverPlayTimerRef.current = null;
  }, []);

  const requestHoverPlay = useCallback(
    (delay = 0) => {
      if (!playOnHover || pauseWhileRunning) return;
      clearHoverPlayTimer();
      hoverPlayTimerRef.current = setTimeout(() => {
        hoverPlayTimerRef.current = null;
        if (!isHoveringRef.current || !hoverPlaybackIntentRef.current) return;
        playVideo();
      }, delay);
    },
    [clearHoverPlayTimer, pauseWhileRunning, playOnHover, playVideo]
  );

  const togglePlay = useCallback(() => {
    if (!isActive) {
      if (playOnHover) {
        hoverPlaybackIntentRef.current = true;
      }
      setIsActive(true);
      setIsPlaying(true);
      return;
    }
    if (videoRef.current) {
      if (videoRef.current.paused) {
        if (playOnHover) {
          hoverPlaybackIntentRef.current = true;
        }
        snapToPlayRangeStartIfNeeded(videoRef.current);
        setIsPlaying(true);
        playVideo();
      } else {
        if (playOnHover) {
          hoverPlaybackIntentRef.current = false;
          clearHoverPlayTimer();
        }
        playRequestIdRef.current += 1;
        videoRef.current.pause();
        setIsPlaying(false);
        setIsLoading(false);
      }
    }
  }, [clearHoverPlayTimer, isActive, playOnHover, playVideo, snapToPlayRangeStartIfNeeded]);

  const openPreview = useCallback(
    (e?: React.MouseEvent) => {
      e?.stopPropagation();
      playRequestIdRef.current += 1;
      hoverPlaybackIntentRef.current = false;
      clearHoverPlayTimer();
      const video = videoRef.current;
      if (video && !video.paused) video.pause();
      setIsPlaying(false);
      setIsLoading(false);
      setIsHovering(false);
      setShowVolumeBar(false);
      onPreview?.(e);
    },
    [clearHoverPlayTimer, onPreview]
  );

  const handleTimeUpdate = () => {
    if (!videoRef.current) return;
    const time = videoRef.current.currentTime;
    setCurrentTime(time);
    onPlaybackTimeChange?.(time);
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration);
    }
    requestHoverPlay();
  };

  const handleVideoReady = () => {
    setVideoReady(true);
    setIsLoading(false);
    setPlayFailed(false);

    if (!playOnHover || pauseWhileRunning || !isHoveringRef.current || !hoverPlaybackIntentRef.current) return;
    setIsPlaying(true);
    requestHoverPlay();
  };

  const handleVideoPlaying = () => {
    setVideoReady(true);
    setIsLoading(false);
    setPlayFailed(false);
  };

  const handleVideoWaiting = () => {
    if (!playOnHover || !isHovering || !hoverPlaybackIntentRef.current) return;
    setIsLoading(true);
  };

  const handleVideoEnded = () => {
    const video = videoRef.current;
    setIsPlaying(false);
    setIsLoading(false);

    if (!playOnHover || !video || !Number.isFinite(video.duration) || video.duration <= 0.1) return;
    const lastVisibleTime = Math.max(0, video.duration - 0.05);
    video.currentTime = lastVisibleTime;
    setCurrentTime(lastVisibleTime);
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    if (videoRef.current) {
      videoRef.current.currentTime = time;
      setCurrentTime(time);
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVolume = parseFloat(e.target.value);
    setVolume(newVolume);
    const muted = newVolume === 0;
    setIsMuted(muted);
    if (videoRef.current) {
      videoRef.current.volume = newVolume;
      videoRef.current.muted = muted;
    }
  };

  const toggleMute = () => {
    const newMuted = !isMuted;
    const nextVolume = newMuted ? 0 : volume || 0.5;
    setIsMuted(newMuted);
    if (!newMuted && volume === 0) setVolume(nextVolume);
    if (videoRef.current) {
      videoRef.current.muted = newMuted;
      videoRef.current.volume = nextVolume;
    }
  };

  const togglePiP = async () => {
    if (videoRef.current && document.pictureInPictureEnabled) {
      try {
        if (document.pictureInPictureElement) {
          await document.exitPictureInPicture();
        } else {
          await videoRef.current.requestPictureInPicture();
        }
      } catch (error) {
        console.error('画中画启用失败', error);
      }
    }
    setShowSettings(false);
  };

  const handleSpeedChange = (speed: number) => {
    setPlaybackRate(speed);
    if (videoRef.current) videoRef.current.playbackRate = speed;
    setShowSpeedMenu(false);
    setShowSettings(false);
  };

  useEffect(() => {
    if (!isActive) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowSettings(false);
        setShowSpeedMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isActive]);

  useEffect(() => {
    if (!pauseWhileRunning) return;
    const video = videoRef.current;
    if (!video || video.paused) return;
    playRequestIdRef.current += 1;
    video.pause();
    setIsPlaying(false);
    setIsLoading(false);
  }, [pauseWhileRunning, url]);

  useEffect(() => {
    if (!seekRequest) return;
    setIsActive(true);
    setShouldLoadPoster(true);
    setPlayFailed(false);
    if (seekRequest.play) setIsPlaying(true);
  }, [seekRequest?.seq]);

  useEffect(() => {
    if (!seekRequest || !isActive) return;

    const video = videoRef.current;
    const target = Math.max(0, seekRequest.time);
    const shouldPlay = seekRequest.play;
    let cancelled = false;

    const applySeek = () => {
      if (cancelled) return;
      if (!video) {
        setCurrentTime(target);
        onPlaybackTimeChange?.(target);
        return;
      }
      video.currentTime = target;
      setCurrentTime(target);
      onPlaybackTimeChange?.(target);
      if (!shouldPlay) return;

      setPlayFailed(false);
      void video.play().then(
        () => {
          if (cancelled) return;
          setIsPlaying(true);
          setVideoReady(true);
          setIsLoading(false);
        },
        () => {
          if (!cancelled) setIsPlaying(false);
        }
      );
    };

    if (!video) {
      applySeek();
      return;
    }

    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
      applySeek();
    } else {
      const onReady = () => {
        video.removeEventListener('loadedmetadata', onReady);
        applySeek();
      };
      video.addEventListener('loadedmetadata', onReady);
      video.load();
      return () => {
        cancelled = true;
        video.removeEventListener('loadedmetadata', onReady);
      };
    }

    return () => {
      cancelled = true;
    };
  }, [seekRequest?.seq, seekRequest?.time, seekRequest?.play, isActive, url]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || playRangeEnd == null || !Number.isFinite(playRangeEnd)) return;

    const onTimeUpdate = () => {
      // 暂停态（如拖拽白条贴住终点）不回跳，仅实际播放越界时重置
      if (video.paused || video.currentTime < playRangeEnd - 0.05) return;
      playRequestIdRef.current += 1;
      video.pause();
      setIsPlaying(false);
      setIsLoading(false);
      const resetTo = playRangeStart != null && Number.isFinite(playRangeStart) ? playRangeStart : 0;
      video.currentTime = resetTo;
      setCurrentTime(resetTo);
      onPlaybackTimeChange?.(resetTo);
    };
    video.addEventListener('timeupdate', onTimeUpdate);
    return () => video.removeEventListener('timeupdate', onTimeUpdate);
  }, [onPlaybackTimeChange, playRangeEnd, playRangeStart, url]);

  useEffect(() => {
    if (!pauseRequest) return;
    const video = videoRef.current;
    playRequestIdRef.current += 1;
    if (video && !video.paused) video.pause();
    setIsPlaying(false);
    setIsLoading(false);
  }, [pauseRequest?.seq]);

  useEffect(() => {
    if (!isActive || !isPlaying) return;
    if (playOnHover && !isHovering) return;
    playVideo();
  }, [isActive, isHovering, isPlaying, playOnHover, playVideo, url]);

  useEffect(() => {
    if (!playOnHover || !isHovering || !isActive || pauseWhileRunning) return;
    if (!hoverPlaybackIntentRef.current) return;
    setIsPlaying(true);
  }, [isActive, isHovering, pauseWhileRunning, playOnHover]);

  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }

    playRequestIdRef.current += 1;
    hoverPlaybackIntentRef.current = playOnHover && isHoveringRef.current;
    clearHoverPlayTimer();
    setIsActive(false);
    setPosterInViewport(false);
    setShouldLoadPoster(false);
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setVideoReady(false);
    setIsLoading(false);
    setPlayFailed(false);
    setIsMuted(Boolean(playOnHover));
  }, [clearHoverPlayTimer, playOnHover, url]);

  useEffect(() => {
    return () => {
      clearHoverIntent();
      clearHoverPlayTimer();
    };
  }, [clearHoverIntent, clearHoverPlayTimer]);

  useEffect(() => {
    if (isActive || !url) return;

    const container = containerRef.current;
    if (!container || typeof IntersectionObserver === 'undefined') {
      setPosterInViewport(true);
      return;
    }

    const observer = new IntersectionObserver(
      entries => {
        if (!entries.some(entry => entry.isIntersecting)) return;
        setPosterInViewport(true);
        observer.disconnect();
      },
      { rootMargin: '1000px' }
    );

    observer.observe(container);

    return () => {
      observer.disconnect();
    };
  }, [isActive, url]);

  const poster = `${url}?x-oss-process=video/snapshot,t_0,f_jpg,w_480,m_fast`;

  useEffect(() => {
    if (isActive || !posterInViewport) return;
    let timeoutId: number | any;
    let idleId: number | undefined;
    let cancelPendingLoad: (() => void) | undefined;

    const schedulePoster = () => {
      cancelPendingLoad = requestPosterLoad(() => setShouldLoadPoster(true));
    };

    if ('requestIdleCallback' in window) {
      idleId = window.requestIdleCallback(schedulePoster, { timeout: 2000 });
    } else {
      timeoutId = setTimeout(schedulePoster, 1500);
    }

    return () => {
      if (idleId !== undefined) window.cancelIdleCallback(idleId);
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      cancelPendingLoad?.();
    };
  }, [isActive, posterInViewport, url]);

  const handleMouseEnter = () => {
    isHoveringRef.current = true;
    setIsHovering(true);
    if (!playOnHover || !url || pauseWhileRunning) return;

    hoverPlaybackIntentRef.current = true;
    setShouldLoadPoster(true);
    clearHoverIntent();
    hoverIntentTimerRef.current = setTimeout(() => {
      hoverIntentTimerRef.current = null;
      setIsActive(true);
      setIsPlaying(true);
      setIsLoading(!videoReady);
      requestHoverPlay();
    }, 120);
  };

  const handleMouseLeave = () => {
    isHoveringRef.current = false;
    hoverPlaybackIntentRef.current = false;
    playRequestIdRef.current += 1;
    clearHoverIntent();
    clearHoverPlayTimer();
    setIsHovering(false);
    setShowVolumeBar(false);
    if (!playOnHover) return;

    const video = videoRef.current;
    if (video && !video.paused) {
      video.pause();
    }
    setIsPlaying(false);
    setIsLoading(false);
  };

  const handleManualPlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!playOnHover) {
      togglePlay();
      return;
    }

    isHoveringRef.current = true;
    hoverPlaybackIntentRef.current = true;
    setIsHovering(true);
    setShouldLoadPoster(true);
    setIsActive(true);
    setIsPlaying(true);
    setPlayFailed(false);
  };

  const progressPercent = (currentTime / duration) * 100 || 0;
  const showVideoFrame = isActive && videoReady && !playFailed;
  const shouldShowPoster = !showVideoFrame;
  const shouldShowIdlePlay = !isActive || playFailed;
  const shouldShowLoading = playOnHover && isHovering && isActive && (isLoading || !videoReady) && !playFailed;
  // 控制栏仅在悬停时显示；暂停态也不保留（移出视频区域即隐藏）
  const shouldShowControls = isActive && isHovering;

  return (
    <>
      <div
        ref={containerRef}
        className='relative w-full h-full bg-black overflow-hidden group select-none rounded-2xl shadow-2xl cursor-pointer'
        style={style} // 将style应用到根元素
        data-play-on-hover-root={playOnHover ? '' : undefined} // 只读画布遮罩在此区域放行指针，供悬浮播放与控制条操作
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onClick={playOnHover ? undefined : togglePlay}
        onDoubleClick={openPreview}
        {...containerProps}
      >
        {shouldShowPoster && (
          <>
            {shouldLoadPoster ? (
              <img
                src={poster}
                loading='lazy'
                decoding='async'
                className='absolute inset-0 w-full h-full object-contain rounded-2xl pointer-events-none bg-[#262626]'
                alt=''
                draggable={false}
              />
            ) : (
              <div className='absolute inset-0 w-full h-full rounded-2xl bg-[#262626]' />
            )}
          </>
        )}

        {isActive && (
          <video
            ref={videoRef}
            src={url}
            poster={poster}
            preload='none' // 绝对禁止预加载！解决 Safari 内存溢出
            playsInline={true} // 防止在 iOS/Safari 强制全屏
            disablePictureInPicture={true} // 禁用画中画，省去 OS 级后台句柄
            disableRemotePlayback={true} // 禁用 AirPlay 投屏，省去网络检测开销
            crossOrigin='anonymous' // 规范跨域媒体流，防止内存泄漏
            muted={isMuted}
            className={`absolute inset-0 w-full h-full object-contain rounded-2xl pointer-events-none [backface-visibility:hidden] [transform:translateZ(0)] transition-opacity duration-150 ${showVideoFrame ? 'opacity-100' : 'opacity-0'}`}
            onTimeUpdate={handleTimeUpdate}
            onLoadedMetadata={handleLoadedMetadata}
            onLoadedData={handleVideoReady}
            onCanPlay={handleVideoReady}
            onPlaying={handleVideoPlaying}
            onWaiting={handleVideoWaiting}
            onEnded={handleVideoEnded}
          />
        )}

        {shouldShowIdlePlay && (
          <div className='absolute inset-0 flex items-center justify-center bg-black/20'>
            <button
              type='button'
              className='flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white transition-transform hover:scale-105'
              onClick={handleManualPlay}
            >
              <Play fill='white' size={16} />
            </button>
          </div>
        )}

        {shouldShowLoading && (
          <div className='absolute inset-0 flex items-center justify-center bg-black/20 pointer-events-none'>
            <div className='h-7 w-7 rounded-full border-2 border-white/30 border-t-white animate-spin' />
          </div>
        )}

        {playOnHover && isActive && (
          <button
            type='button'
            onClick={e => {
              e.stopPropagation();
              toggleMute();
            }}
            className={`absolute left-2 top-2 z-20 flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-white transition-opacity duration-200 hover:bg-black/75 ${isHovering ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
          >
            {isMuted || volume === 0 ? <VolumeX size={14} /> : <Volume2 size={14} />}
          </button>
        )}

        {/* 控制栏 */}
        {isActive && (
          <>
            {playOnHover ? (
              <div className={`absolute inset-x-0 bottom-0 z-20 transition-opacity duration-200 ${shouldShowControls ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
                <div className='bg-gradient-to-t from-black/90 via-black/45 to-transparent px-2 pb-2 pt-8'>
                  {!hideProgressBar ? (
                    <div className='mb-1 flex items-center h-2'>
                      <input
                        type='range'
                        min='0'
                        max={duration || 0}
                        step='0.001'
                        value={currentTime}
                        onChange={handleSeek}
                        className={`w-full h-0.5 ${COMMON_RANGE_CLASS}`}
                        style={{
                          background: `linear-gradient(to right, white ${progressPercent}%, rgba(255, 255, 255, 0.3) ${progressPercent}%)`,
                        }}
                      />
                    </div>
                  ) : null}
                  <div className='flex items-center justify-between gap-2' onClick={e => e.stopPropagation()}>
                    <div className='flex min-w-0 items-center gap-2'>
                      <button onClick={togglePlay} className='text-white hover:scale-110 transition-transform focus:outline-none'>
                        {isPlaying ? <Pause fill='white' size={14} /> : <Play fill='white' size={14} />}
                      </button>
                      <div className='text-xs font-medium tabular-nums text-white/90'>
                        {formatTime(currentTime)} <span className='text-white/40'>/</span> {formatTime(duration)}
                      </div>
                    </div>
                    <button onClick={openPreview} className='text-white hover:text-white/80 focus:outline-none'>
                      <Maximize2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div
                className={`absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-transparent flex flex-col justify-end p-2 transition-opacity duration-300 ${shouldShowControls ? 'opacity-100' : 'opacity-0'}`}
              >
                {!hideProgressBar ? (
                  <div className='w-full mb-1.5 px-0.5 flex items-center h-2'>
                    <input
                      type='range'
                      min='0'
                      max={duration || 0}
                      step='0.001'
                      value={currentTime}
                      onChange={handleSeek}
                      className={`w-full h-0.5 ${COMMON_RANGE_CLASS}`}
                      style={{
                        background: `linear-gradient(to right, white ${progressPercent}%, rgba(255, 255, 255, 0.3) ${progressPercent}%)`,
                      }}
                    />
                  </div>
                ) : null}

                {/* 底部按钮区域 */}
                <div className='flex items-center justify-between px-0.5' onClick={e => e.stopPropagation()}>
                  <div className='flex items-center gap-2'>
                    <button onClick={togglePlay} className='text-white hover:scale-110 transition-transform focus:outline-none'>
                      {isPlaying ? <Pause fill='white' size={14} /> : <Play fill='white' size={14} />}
                    </button>
                    <div className='text-xs font-medium tabular-nums text-white/90'>
                      {formatTime(currentTime)} <span className='text-white/40'>/</span> {formatTime(duration)}
                    </div>
                  </div>

                  <div className='flex items-center gap-2'>
                    {/* 音量控制面板 */}
                    <div className='relative flex items-center group/volume' onMouseEnter={() => setShowVolumeBar(true)} onMouseLeave={() => setShowVolumeBar(false)}>
                      <div
                        className={`absolute bottom-full left-1/2 -translate-x-1/2 flex flex-col items-center transition-all duration-200 ${showVolumeBar ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2 pointer-events-none'}`}
                      >
                        <div className='bg-zinc-900/95 backdrop-blur-md p-2 pb-3 rounded-lg border border-white/10 shadow-xl flex flex-col items-center gap-2'>
                          {/* 使用旋转 90 度的横向进度条来确保样式 100% 一致 */}
                          <div className='h-16 w-4 relative flex items-center justify-center'>
                            <input
                              type='range'
                              min='0'
                              max='1'
                              step='0.01'
                              value={isMuted ? 0 : volume}
                              onChange={handleVolumeChange}
                              className={`absolute w-14 h-0.5 rotate-[-90deg] origin-center ${COMMON_RANGE_CLASS}`}
                              style={{
                                background: `linear-gradient(to right, white ${(isMuted ? 0 : volume) * 100}%, rgba(255, 255, 255, 0.3) ${(isMuted ? 0 : volume) * 100}%)`,
                              }}
                            />
                          </div>
                          <span className='text-xs font-bold text-white/70 tabular-nums'>{Math.round((isMuted ? 0 : volume) * 100)}%</span>
                        </div>
                        <div className='h-2 w-4' />
                      </div>

                      <button onClick={toggleMute} className='text-white hover:text-white/80 py-1 focus:outline-none'>
                        {isMuted || volume === 0 ? <VolumeX size={14} /> : <Volume2 size={14} />}
                      </button>
                    </div>

                    <button onClick={openPreview} className='text-white hover:text-white/80 focus:outline-none'>
                      <Maximize2 size={14} />
                    </button>

                    {/* 设置 */}
                    <div className='relative flex items-center'>
                      <button
                        onClick={() => setShowSettings(!showSettings)}
                        className={`text-white hover:text-white/80 transition-all focus:outline-none ${showSettings ? 'rotate-45 text-blue-400' : ''}`}
                      >
                        <Settings size={14} />
                      </button>

                      {showSettings && (
                        <div className='absolute bottom-full right-0 mb-2 w-32 bg-zinc-900/95 backdrop-blur-xl border border-white/10 rounded-lg overflow-hidden shadow-2xl z-50 text-[10px]'>
                          {showSpeedMenu ? (
                            <div className='p-0.5'>
                              <button
                                onClick={() => setShowSpeedMenu(false)}
                                className='w-full flex items-center gap-1 p-1 hover:bg-white/10 rounded text-white/60 transition-colors'
                              >
                                <ChevronRight className='rotate-180' size={10} /> 返回
                              </button>
                              <div className='h-px bg-white/10 mx-1 my-0.5' />
                              {PLAYBACK_SPEEDS.map(speed => (
                                <button
                                  key={speed}
                                  onClick={() => handleSpeedChange(speed)}
                                  className='w-full flex items-center justify-between p-1 hover:bg-white/10 rounded transition-colors text-xs'
                                >
                                  <span>{speed === 1 ? '正常' : `${speed}x`}</span>
                                  {playbackRate === speed && <Check size={10} className='text-blue-400' />}
                                </button>
                              ))}
                            </div>
                          ) : (
                            <div className='p-0.5'>
                              <div className='px-1.5 py-1 font-bold uppercase tracking-wider text-white/40'>菜单</div>
                              <button onClick={togglePiP} className='w-full flex items-center gap-2 p-1.5 hover:bg-white/10 rounded group transition-colors'>
                                <Monitor size={12} className='text-white/60 group-hover:text-white' /> 画中画
                              </button>
                              <button
                                onClick={() => setShowSpeedMenu(true)}
                                className='w-full flex items-center justify-between p-1.5 hover:bg-white/10 rounded group transition-colors'
                              >
                                <div className='flex items-center gap-2'>
                                  <Gauge size={12} className='text-white/60 group-hover:text-white' /> 倍速
                                </div>
                                <div className='flex items-center text-white/40 group-hover:text-white'>
                                  <span className='mr-0.5'>{playbackRate === 1 ? '正常' : `${playbackRate}x`}</span>
                                  <ChevronRight size={12} />
                                </div>
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
};

export default VideoPlayer;
