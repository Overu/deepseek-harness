import WaveSurfer from 'wavesurfer.js';
import { Pause, Play } from 'lucide-react';
import { useState, useRef, useEffect, useCallback } from 'react';
import { isDesktopCanvas, ResourceDownloadError } from '@/utils';
import { forgetAudioSource, readAudioSource } from './audioSource';

interface AudioPlayerProps {
  url: string | undefined;
  height: number;
  onPreview?: (e?: React.MouseEvent) => void;
}

const AudioPlayer = ({ url, height, onPreview }: AudioPlayerProps) => {
  const waveformRef = useRef<HTMLDivElement>(null);
  const waveSurferRef = useRef<WaveSurfer | null>(null);
  const playAfterRetryRef = useRef<string | undefined>(undefined);
  // 添加播放状态和时长相关状态
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);

  // 添加播放/暂停控制函数
  const togglePlayback = () => {
    if (error) { playAfterRetryRef.current = url; setLoadAttempt(attempt => attempt + 1); return; }
    const wave = waveSurferRef.current;
    if (ready && wave) void wave.playPause().catch(cause => {
      if (cause?.name === 'AbortError') return;
      if (waveSurferRef.current === wave) { setIsPlaying(false); setError('音频播放失败，点击重试'); }
    });
  };

  const openPreview = useCallback(
    (e?: React.MouseEvent) => {
      e?.stopPropagation();
      if (waveSurferRef.current?.isPlaying()) {
        waveSurferRef.current.pause();
      }
      onPreview?.(e);
    },
    [onPreview]
  );

  // 格式化时间显示
  const formatTime = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${minutes}:${secs < 10 ? '0' : ''}${secs}`;
  };

  useEffect(() => {
    setIsPlaying(false); setDuration(0); setCurrentTime(0); setReady(false); setError(null);
    if (!url || !waveformRef.current) return;
    const controller = new AbortController();
    let active = true;
    const wave = WaveSurfer.create({
      container: waveformRef.current,
      waveColor: '#4F46E5',
      progressColor: '#818CF8',
      height,
      normalize: true,
    });
    waveSurferRef.current = wave;
    const failed = (cause?: unknown) => {
      if (!active) return;
      playAfterRetryRef.current = undefined;
      const reason = cause instanceof ResourceDownloadError ? `（HTTP ${cause.status}）` : '';
      setReady(false); setIsPlaying(false); setError(`音频加载失败${reason}，点击播放按钮重试`);
    };
    // Listen before loading: cached/local audio can become ready immediately.
    const unsubscribe = [
      wave.on('ready', () => {
        if (!active) return;
        setDuration(wave.getDuration() || 0); setReady(true); setError(null);
        if (playAfterRetryRef.current === url) {
          playAfterRetryRef.current = undefined;
          void wave.play().catch(() => { if (active) setError('音频播放失败，点击重试'); });
        }
      }),
      wave.on('play', () => { if (active) setIsPlaying(true); }),
      wave.on('pause', () => { if (active) setIsPlaying(false); }),
      wave.on('finish', () => { if (active) setIsPlaying(false); }),
      wave.on('timeupdate', seconds => { if (active) setCurrentTime(seconds); }),
      wave.on('error', cause => { if (active) { if (isDesktopCanvas()) forgetAudioSource(url); failed(cause); } }),
    ];
    const load = async () => {
      if (isDesktopCanvas()) {
        const blob = await readAudioSource(url, controller.signal);
        if (active) {
          try { await wave.loadBlob(blob); }
          catch (cause) { if (active) forgetAudioSource(url); throw cause; }
        }
      } else await wave.load(url);
    };
    void load().catch(cause => { if (!controller.signal.aborted) failed(cause); });

    return () => {
      active = false; controller.abort(); unsubscribe.forEach(stop => stop()); wave.destroy();
      if (waveSurferRef.current === wave) waveSurferRef.current = null;
    };
  }, [url, height, loadAttempt]);

  return (
    <div className={`relative w-full h-full ${onPreview ? 'cursor-pointer' : ''}`} onDoubleClick={onPreview ? openPreview : undefined}>
      <div ref={waveformRef} className='w-full z-[1]' />
      <div className='absolute bottom-2 left-2 flex items-center p-2 gap-2 z-[2]'>
        <button type='button' onClick={togglePlayback} disabled={!ready && !error} aria-label={error ? '重新加载音频' : isPlaying ? '暂停音频' : '播放音频'} className='flex items-center justify-center w-8 h-8 rounded-full bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer disabled:cursor-not-allowed disabled:opacity-50'>
          {isPlaying ? <Pause size={18}></Pause> : <Play size={18}></Play>}
        </button>
        {error ? <span role='alert' className='text-sm text-red-400'>{error}</span> : !ready ? <span role='status' className='text-sm text-gray-400'>{url ? '音频加载中…' : '暂无音频'}</span> : <div className='flex items-center text-sm text-gray-600'>
          <span>{formatTime(currentTime)}</span>
          <span className='mx-1'>/</span>
          <span>{formatTime(duration)}</span>
        </div>}
      </div>
    </div>
  );
};

export default AudioPlayer;
