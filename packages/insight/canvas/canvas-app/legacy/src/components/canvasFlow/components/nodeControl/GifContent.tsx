import { useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { getToolGiftMediaType, TOOL_META_BY_TYPE } from '../../settings/toolListConfig';

interface GifContentProps {
  type: string;
}

const GifContent = ({ type }: GifContentProps) => {
  const tipCont = TOOL_META_BY_TYPE[type];
  const previewSrc = tipCont?.gift;
  const previewType = getToolGiftMediaType(previewSrc);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const previewLoaded = Boolean(previewSrc && loadedSrc === previewSrc);
  const previewFailed = !previewSrc || failedSrc === previewSrc;

  return (
    <div
      className='relative flex shrink-0 items-center justify-center overflow-hidden rounded-2xl border-2 border-white/15 bg-[#262626] shadow-[0_4px_16px_rgba(0,0,0,0.3)]'
      style={{ width: 320, minWidth: 320, height: 240 }}
    >
      {previewSrc && previewType === 'video' && (
        <video
          key={previewSrc}
          src={previewSrc}
          className={`max-h-full max-w-full object-contain transition-opacity duration-150 ${previewLoaded ? 'opacity-100' : 'opacity-0'}`}
          autoPlay
          muted
          loop
          playsInline
          preload='metadata'
          onLoadedData={() => setLoadedSrc(previewSrc)}
          onError={() => setFailedSrc(previewSrc)}
        />
      )}
      {previewSrc && previewType === 'image' && (
        <div className='flex h-full w-full items-center justify-center'>
          <img
            key={previewSrc}
            src={previewSrc}
            alt='feature'
            className={`max-h-full max-w-full object-contain transition-opacity duration-150 ${previewLoaded ? 'opacity-100' : 'opacity-0'}`}
            loading='eager'
            decoding='async'
            draggable={false}
            onLoad={() => setLoadedSrc(previewSrc)}
            onError={() => setFailedSrc(previewSrc)}
          />
        </div>
      )}
      {!previewLoaded && (
        <div className='absolute inset-0 flex items-center justify-center bg-[#262626] text-white/55'>
          {!previewFailed ? <LoaderCircle size={24} className='animate-spin' /> : <span className='text-xs text-white/45'>预览加载失败</span>}
        </div>
      )}
    </div>
  );
};

export default GifContent;
