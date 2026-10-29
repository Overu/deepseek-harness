import { useState, useEffect, type ImgHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { ImageOff } from 'lucide-react';

interface SafeImageProps extends ImgHTMLAttributes<HTMLImageElement> {
  fallbackSrc?: string; // 方案A：自定义兜底图片的路径
  fallbackNode?: ReactNode; // 方案B：完全自定义的兜底
}

const SafeImage = ({ src, alt = '图片', className, fallbackSrc, fallbackNode = <ImageOff />, ...props }: SafeImageProps) => {
  const [isError, setIsError] = useState(false);

  useEffect(() => {
    setIsError(false);
  }, [src]);

  if (isError && fallbackNode) {
    return <div className={cn('flex items-center justify-center bg-white/10', className)}>{fallbackNode}</div>;
  }

  return (
    <img
      src={isError ? fallbackSrc : src}
      alt={alt}
      className={className}
      onError={() => setIsError(true)}
      loading='lazy'
      decoding='async' // 默认异步解码，提升性能
      {...props}
    />
  );
};
export default SafeImage;
