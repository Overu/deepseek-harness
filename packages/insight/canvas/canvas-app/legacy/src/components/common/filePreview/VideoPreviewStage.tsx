import { useEffect, useRef, useState } from 'react';
const MP4_STREAMING_THRESHOLD_BYTES = 20 * 1024 * 1024;

interface VideoPreviewStageProps {
  src: string;
  poster?: string;
  autoPlay?: boolean;
  initialMuted?: boolean;
  onReady?: () => void;
  onError?: () => void;
}

interface XgPlayerInstance {
  destroy: () => void;
  on: (event: string, callback: () => void) => void;
}

type XgPlayerConstructor = new (options: Record<string, unknown>) => XgPlayerInstance;

function isAliyunOssUrl(src: string) {
  try {
    return new URL(src, window.location.href).hostname.endsWith('.aliyuncs.com');
  } catch {
    return false;
  }
}

function shouldUseMp4Streaming(headers: Headers) {
  const contentLength = Number(headers.get('content-length'));
  const acceptRanges = headers.get('accept-ranges') || '';
  return Number.isFinite(contentLength) && contentLength >= MP4_STREAMING_THRESHOLD_BYTES && /\bbytes\b/i.test(acceptRanges);
}

async function shouldUseMp4Plugin(src: string, signal: AbortSignal) {
  if (!isAliyunOssUrl(src)) return false;

  try {
    const response = await fetch(src, { method: 'HEAD', signal });
    return response.ok && shouldUseMp4Streaming(response.headers);
  } catch {
    return false;
  }
}

export function VideoPreviewStage({ src, poster, autoPlay = false, initialMuted = false, onReady, onError }: VideoPreviewStageProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<XgPlayerInstance | null>(null);
  const callbacksRef = useRef({ onReady, onError });
  const [initializing, setInitializing] = useState(true);
  const [failed, setFailed] = useState(false);

  callbacksRef.current = { onReady, onError };

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let readyNotified = false;
    let errorNotified = false;

    const destroyPlayer = () => {
      playerRef.current?.destroy();
      playerRef.current = null;
      containerRef.current?.replaceChildren();
    };

    const notifyReady = () => {
      if (!active || readyNotified) return;
      readyNotified = true;
      setInitializing(false);
      callbacksRef.current.onReady?.();
    };

    const notifyError = () => {
      if (!active || errorNotified) return;
      errorNotified = true;
      setInitializing(false);
      setFailed(true);
      callbacksRef.current.onError?.();
    };

    const initialize = async () => {
      setInitializing(true);
      setFailed(false);
      destroyPlayer();

      const useMp4Plugin = await shouldUseMp4Plugin(src, controller.signal);
      if (!active) return;

      let usingMp4Plugin = useMp4Plugin;
      const createPlayer = async (withMp4Plugin: boolean) => {
        const [{ default: Player }] = await Promise.all([import('xgplayer'), import('xgplayer/dist/index.min.css')]);
        if (!active) return;

        const options: Record<string, unknown> = {
          el: containerRef.current,
          url: src,
          poster: {
            poster,
            fillMode: 'contain',
          },
          width: '100%',
          height: '100%',
          autoplay: autoPlay,
          autoplayMuted: initialMuted,
          volume: initialMuted ? 0 : 1,
          controls: true,
          download: true,
          pip: false,
          cssFullscreen: false,
          keyShortcut: true,
          lang: 'zh-cn',
          ignores: ['cssfullscreen', 'pip', 'playbackrate', 'definition', 'screenshot', 'miniscreen'],
          videoFillMode: 'contain',
          commonStyle: {
            // progressColor: '#ffffff',
            playedColor: '#ffffff',
            // cachedColor: 'rgba(255, 255, 255, 0.35)',
            volumeColor: '#ffffff',
          },
          videoAttributes: {
            preload: 'metadata',
            playsinline: 'true',
            disablePictureInPicture: true,
            controlsList: 'noremoteplayback',
          },
        };

        if (withMp4Plugin) {
          const { default: Mp4Plugin } = await import('xgplayer-mp4');
          if (!active) return;
          options.plugins = [Mp4Plugin];
          options.mp4plugin = {
            maxBufferLength: 30,
            minBufferLength: 10,
            reqOptions: { mode: 'cors' },
          };
        }

        const player = new (Player as unknown as XgPlayerConstructor)(options);
        if (!active) {
          player.destroy();
          return;
        }

        playerRef.current = player;
        player.on('canplay', notifyReady);
        player.on('playing', notifyReady);
        player.on('error', () => {
          if (usingMp4Plugin) {
            usingMp4Plugin = false;
            destroyPlayer();
            void createPlayer(false).catch(notifyError);
            return;
          }
          notifyError();
        });
      };

      try {
        await createPlayer(useMp4Plugin);
      } catch {
        if (useMp4Plugin) {
          usingMp4Plugin = false;
          destroyPlayer();
          try {
            await createPlayer(false);
          } catch {
            notifyError();
          }
          return;
        }
        notifyError();
      }
    };

    void initialize();

    return () => {
      active = false;
      controller.abort();
      destroyPlayer();
    };
  }, [autoPlay, initialMuted, poster, src]);

  return (
    <div className='relative h-full w-full overflow-hidden bg-black'>
      <div ref={containerRef} className='h-full w-full' />
      {initializing && !failed && <div className='pointer-events-none absolute inset-0 flex items-center justify-center bg-black/20 text-sm text-white/70'>视频加载中</div>}
      {failed && <div className='absolute inset-0 flex items-center justify-center bg-black text-sm text-white/45'>视频加载失败</div>}
    </div>
  );
}
