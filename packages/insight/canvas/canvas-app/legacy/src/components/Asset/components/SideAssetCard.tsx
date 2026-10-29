import React, { useState } from 'react';
import { Eye, LogIn, Loader2 } from 'lucide-react';
import { ASSET_TYPE_CODE, type AssetItem } from '../types';
import DefaultImage from '@/assets/images/default_flow.png';
import { compressImage } from '@/utils';
import AudioImage from '@/assets/images/audio.png';
import { AssetVideoPreview } from './AssetVideoPreview';
import { AssetCardTags } from './AssetCardTags';
import SafeImage from '../../common/SafeImage';

interface SideAssetCardProps {
  asset: AssetItem;
  isPublic: boolean;
  onPreview: () => void;
  onEnter?: () => void;
  onAdd: () => void;
  isAdding?: boolean;
}

export const SideAssetCard: React.FC<SideAssetCardProps> = ({ asset, isPublic, onPreview, onEnter, onAdd, isAdding }) => {
  const [isHovered, setIsHovered] = useState(false);

  const renderContent = () => {
    const commonClasses = 'w-full h-full object-cover transition-transform duration-700 ease-out group-hover:scale-110';

    switch (asset.type) {
      case ASSET_TYPE_CODE.IMAGE:
      case ASSET_TYPE_CODE.COLLECTION:
        return <SafeImage src={compressImage(asset.coverUrl || DefaultImage, 300)} className={commonClasses} alt={asset.name} />;
      case ASSET_TYPE_CODE.VIDEO:
        return <AssetVideoPreview fileUrl={asset.fileUrl} coverUrl={asset.coverUrl} className={commonClasses} alt={asset.name} posterWidth={320} hovered={isHovered} />;
      case ASSET_TYPE_CODE.AUDIO:
        return <img src={AudioImage} className={commonClasses} alt={asset.name} />;
      default:
        return <div className='w-full h-full bg-[#1A1A1A]' />;
    }
  };

  const showName = isPublic || asset.type === ASSET_TYPE_CODE.COLLECTION;

  return (
    <div className='relative flex flex-col gap-2'>
      <div
        className='group relative aspect-square rounded-xl overflow-hidden bg-[#1A1A1A] cursor-pointer'
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {renderContent()}
        <AssetCardTags asset={asset} positionClassName='top-2 left-2' />

        {/* Hover Mask：悬浮或添加中时显示 */}
        <div
          className={`absolute inset-0 bg-black/40 transition-opacity duration-300 flex flex-col items-center justify-center gap-3 ${
            isAdding ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          }`}
          role='button'
          tabIndex={0}
          onClick={e => {
            e.stopPropagation();
            if (!isAdding) onAdd();
          }}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              e.stopPropagation();
              if (!isAdding) onAdd();
            }
          }}
        >
          {isAdding ? <Loader2 className='w-5 h-5 animate-spin text-white' /> : <span className='text-white text-sm font-medium'>点击加入画布</span>}

          <div className='absolute bottom-3 right-3 flex gap-2'>
            <button
              onClick={e => {
                e.stopPropagation();
                onPreview();
              }}
              className='p-2 bg-black/60 hover:bg-black/80 text-white rounded-lg transition-colors'
              title='预览'
            >
              <Eye className='w-4 h-4' />
            </button>
            {asset.type === ASSET_TYPE_CODE.COLLECTION && onEnter && (
              <button
                onClick={e => {
                  e.stopPropagation();
                  onEnter();
                }}
                className='p-2 bg-black/60 hover:bg-black/80 text-white rounded-lg transition-colors'
                title='进入'
              >
                <LogIn className='w-4 h-4' />
              </button>
            )}
          </div>
        </div>
      </div>

      {showName && asset.name && (
        <div className='px-1'>
          <p className='text-xs text-white/70 truncate'>{asset.name}</p>
        </div>
      )}
    </div>
  );
};
