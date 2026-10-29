import React, { useState } from 'react';
import { Eye, Star } from 'lucide-react';
import DefaultImage from '@/assets/images/default_flow.png';
import { compressImage } from '@/utils';
import { AssetVideoPreview } from '@/components/Asset/components/AssetVideoPreview';
import type { CameraMovementItem } from '../cameraMovementTypes';

interface CameraMovementCardProps {
  item: CameraMovementItem;
  isSelected: boolean;
  onPreview: () => void;
  onAdd: () => void;
  onFavorite: () => void;
}

export const CameraMovementCard: React.FC<CameraMovementCardProps> = ({ item, isSelected, onPreview, onAdd, onFavorite }) => {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div className='relative flex flex-col gap-2'>
      <div
        className={`group relative aspect-[4/3] rounded-2xl overflow-hidden bg-[#1A1A1A] cursor-pointer transition-all duration-300 ${isSelected ? 'ring-2 ring-[#4155F0] ring-offset-2 ring-offset-black scale-95 shadow-xl' : 'hover:shadow-2xl hover:shadow-[#4155F0]/10'}`}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onClick={onAdd}
        role='button'
        tabIndex={0}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onAdd();
          }
        }}
      >
        <AssetVideoPreview
          fileUrl={item.fileUrl}
          coverUrl={compressImage(item.coverUrl) || DefaultImage}
          className='w-full h-full object-cover transition-transform duration-700 ease-out group-hover:scale-110'
          alt={item.name}
          hovered={isHovered}
        />

        <div className='absolute inset-0 bg-black/50 transition-opacity duration-300 flex flex-col items-center justify-center gap-2 opacity-0 group-hover:opacity-100'>
          <span className='text-white text-sm font-medium hover:text-[#4155F0]'>点击添加</span>
        </div>

        <div className='absolute bottom-3 right-3 z-20 flex items-center gap-2' onClick={e => e.stopPropagation()}>
          <button
            className='p-2 rounded-xl bg-black/60 text-white hover:bg-black/80 transition-all duration-200 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto'
            onClick={e => {
              e.stopPropagation();
              onPreview();
            }}
            title='预览'
          >
            <Eye className='w-4 h-4' />
          </button>
          <button
            onClick={e => {
              e.stopPropagation();
              onFavorite();
              (e.currentTarget as HTMLElement).blur();
            }}
            className={`p-2 rounded-xl bg-black/60 text-white hover:bg-black/80 hover:text-orange-400 transition-all duration-200 ${item.isInCollection === 1 ? 'opacity-100' : 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto'} ${item.isInCollection === 1 ? 'ring-2 ring-orange-400' : ''}`}
            title={item.isInCollection === 1 ? '取消收藏' : '收藏'}
          >
            <Star className={`w-4 h-4 ${item.isInCollection === 1 ? 'fill-orange-400/90 text-orange-400' : ''}`} />
          </button>
        </div>
      </div>

      <div className='px-1 relative flex flex-col justify-start'>
        <p className='text-xs text-white/65 truncate'>{item.name}</p>
      </div>
    </div>
  );
};
