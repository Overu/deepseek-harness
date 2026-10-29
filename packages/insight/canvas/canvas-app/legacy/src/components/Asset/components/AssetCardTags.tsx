import React from 'react';
import { FileUp } from 'lucide-react';
import { formatDuration } from '@/utils/mediaDuration';
import { ASSET_TYPE_CODE, type AssetItem } from '../types';
import { isGeneratedAsset, isHighDefinitionSource, isUploadAsset } from '../util';
import { cn } from '@/lib/utils';

interface AssetCardTagsProps {
  asset: Pick<AssetItem, 'type' | 'duration' | 'sourceType' | 'source' | 'fileFormat' | 'label'>;
  positionClassName?: string;
}

const tagClassName = 'px-1.5 py-0.5 rounded-md text-[12px] bg-black/45 backdrop-blur-[10px] text-white/90 flex items-center justify-center';

export const AssetCardTags: React.FC<AssetCardTagsProps> = ({ asset, positionClassName = 'top-3 left-3' }) => {
  const showDuration = (asset.type === ASSET_TYPE_CODE.VIDEO || asset.type === ASSET_TYPE_CODE.AUDIO) && asset.duration != null;
  const showHD = isHighDefinitionSource(asset.sourceType);
  const isUpload = isUploadAsset(asset);
  const isGeneratedAudio = asset.type === ASSET_TYPE_CODE.AUDIO && isGeneratedAsset(asset);
  const audioCategoryLabel = isGeneratedAudio ? asset.label : null;

  if (!showDuration && !showHD && !isUpload && !audioCategoryLabel) return null;

  return (
    <div className={`absolute ${positionClassName} z-30 h-6 flex items-stretch gap-1 pointer-events-none`}>
      {showDuration && <span className={tagClassName}>{formatDuration(asset.duration!)}</span>}
      {isUpload && (
        <span className={cn(tagClassName, 'p-1')} title='上传资产'>
          <FileUp className='w-4 h-4' />
        </span>
      )}
      {audioCategoryLabel && <span className={tagClassName}>{audioCategoryLabel}</span>}
      {showHD && <span className={tagClassName}>高清</span>}
    </div>
  );
};
