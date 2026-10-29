import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { resolveAssetVideoPoster } from '../util';

const HOVER_DELAY_MS = 100;
const DEACTIVATE_EVENT = 'asset-video-preview-deactivate';

interface AssetVideoPreviewProps {
  fileUrl: string;
  coverUrl?: string;
  className?: string;
  posterWidth?: number;
  alt?: string;
  /** 外部控制 hover（overlay 遮挡内部鼠标事件时使用） */
  hovered?: boolean;
}

function cleanupVideo(video: HTMLVideoElement | null) {
  if (!video) return;
  video.pause();
  video.currentTime = 0;
}

export const AssetVideoPreview = memo(({ fileUrl, coverUrl, className, posterWidth = 480, alt = '', hovered }: AssetVideoPreviewProps) => {
  const previewId = useId();
  const videoRef = useRef<HTMLVideoElement>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [internalHovered, setInternalHovered] = useState(false);
  const [isActive, setIsActive] = useState(false);

  const isControlled = hovered !== undefined;
  const isPointerInside = isControlled ? hovered : internalHovered;

  const posterUrl = useMemo(() => resolveAssetVideoPoster({ coverUrl: coverUrl ?? '', fileUrl }, posterWidth), [coverUrl, fileUrl, posterWidth]);

  const deactivate = useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    cleanupVideo(videoRef.current);
    setIsActive(false);
  }, []);

  useEffect(() => {
    const handleDeactivate = (e: Event) => {
      const customEvent = e as CustomEvent<string>;
      if (customEvent.detail !== previewId) {
        deactivate();
      }
    };
    window.addEventListener(DEACTIVATE_EVENT, handleDeactivate);
    return () => {
      window.removeEventListener(DEACTIVATE_EVENT, handleDeactivate);
      deactivate();
    };
  }, [previewId, deactivate]);

  useEffect(() => {
    if (!isPointerInside) {
      deactivate();
      return;
    }

    hoverTimerRef.current = setTimeout(() => {
      setIsActive(true);
      hoverTimerRef.current = null;
    }, HOVER_DELAY_MS);

    return () => {
      if (hoverTimerRef.current) {
        clearTimeout(hoverTimerRef.current);
        hoverTimerRef.current = null;
      }
    };
  }, [isPointerInside, deactivate]);

  useEffect(() => {
    if (!isActive) return;
    window.dispatchEvent(new CustomEvent(DEACTIVATE_EVENT, { detail: previewId }));
    const video = videoRef.current;
    video?.play().catch(() => {});
    return () => cleanupVideo(video);
  }, [isActive, previewId]);

  const handleMouseEnter = () => {
    if (isControlled) return;
    setInternalHovered(true);
  };

  const handleMouseLeave = () => {
    if (isControlled) return;
    setInternalHovered(false);
  };

  const mediaClassName = className ?? 'w-full h-full object-cover';

  return (
    <div className='w-full h-full' onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
      {isActive ? (
        <video
          ref={videoRef}
          src={fileUrl}
          poster={posterUrl}
          muted
          loop
          playsInline
          preload='none'
          disablePictureInPicture
          disableRemotePlayback
          className={`${mediaClassName} pointer-events-none [backface-visibility:hidden] [transform:translateZ(0)]`}
        />
      ) : (
        <img src={posterUrl} alt={alt} loading='lazy' decoding='async' draggable={false} className={mediaClassName} />
      )}
    </div>
  );
});

AssetVideoPreview.displayName = 'AssetVideoPreview';
