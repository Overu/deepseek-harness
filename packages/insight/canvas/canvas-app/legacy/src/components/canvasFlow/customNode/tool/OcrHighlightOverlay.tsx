import { useCallback, useMemo, useState } from 'react';
import { compressImage } from '@/utils';
import type { OcrResult } from '../../utils/type';

interface OcrHighlightOverlayProps {
  imageUrl: string;
  recPolys?: OcrResult['recPolys'];
  hoverIndex: number | null;
  className?: string;
}

const OcrHighlightOverlay = ({ imageUrl, recPolys, hoverIndex, className = '' }: OcrHighlightOverlayProps) => {
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });

  const handleImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setNaturalSize({ width: img.naturalWidth, height: img.naturalHeight });
  }, []);

  const highlightPoints = useMemo(() => {
    if (hoverIndex === null || !recPolys?.[hoverIndex] || !naturalSize.width || !naturalSize.height) {
      return null;
    }
    const poly = recPolys[hoverIndex];
    if (poly.length < 4) return null;
    return poly.map(([x, y]) => ({
      x: (x / naturalSize.width) * 100,
      y: (y / naturalSize.height) * 100,
    }));
  }, [hoverIndex, recPolys, naturalSize]);

  const polygonPoints = useMemo(() => {
    if (!highlightPoints) return '';
    return highlightPoints.map(p => `${p.x},${p.y}`).join(' ');
  }, [highlightPoints]);

  return (
    <div className={`relative w-full h-full ${className}`}>
      <img src={compressImage(imageUrl)} className='rounded-2xl w-full h-full bg-[#262626] object-cover' alt='' onLoad={handleImageLoad} />
      {highlightPoints && (
        <svg className='absolute inset-0 w-full h-full pointer-events-none rounded-2xl' viewBox='0 0 100 100' preserveAspectRatio='none'>
          <polygon
            points={polygonPoints}
            fill='rgba(65, 85, 240, 0.42)'
            stroke='rgba(255, 255, 255, 0.95)'
            strokeWidth='1.5'
            strokeDasharray='4 3'
            vectorEffect='non-scaling-stroke'
          />
        </svg>
      )}
    </div>
  );
};

export default OcrHighlightOverlay;
