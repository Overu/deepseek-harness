import React, { useState } from 'react'
import { Eye, Star, Download, Loader2, LogIn } from 'lucide-react'
import { ASSET_TYPE_CODE, type AssetItem } from '../types'
import { formatCreateTime } from '../util'
import DefaultImage from '@/assets/images/default_flow.png'
import AudioImage from '@/assets/images/audio.png'
import { compressImage } from '@/utils'
import { AssetVideoPreview } from './AssetVideoPreview'
import { AssetCardTags } from './AssetCardTags'

interface DialogAssetCardProps {
  asset: AssetItem
  isPublic: boolean
  isBatchMode: boolean
  isSelected: boolean
  onToggleSelect: () => void
  onPreview: () => void
  onAdd: () => void
  onEnter?: () => void
  onFavorite: () => void
  onDownload?: () => void
  isAdding?: boolean
}

export const DialogAssetCard: React.FC<DialogAssetCardProps> = ({
  asset,
  isBatchMode,
  isSelected,
  isPublic,
  onToggleSelect,
  onPreview,
  onAdd,
  onEnter,
  onFavorite,
  onDownload,
  isAdding,
}) => {
  const [isHovered, setIsHovered] = useState(false)
  const handleClick = (e: React.SyntheticEvent<HTMLDivElement>) => {
    if (isBatchMode) {
      onToggleSelect()
      e.currentTarget.blur()
    }
  }

  const renderContent = () => {
    const commonClasses = 'w-full h-full object-cover transition-transform duration-700 ease-out group-hover:scale-110'

    switch (asset.type) {
      case ASSET_TYPE_CODE.IMAGE:
      case ASSET_TYPE_CODE.COLLECTION:
        return <img src={compressImage(asset.coverUrl) || DefaultImage} className={commonClasses} alt={asset.name} />
      case ASSET_TYPE_CODE.VIDEO:
        return <AssetVideoPreview fileUrl={asset.fileUrl}
          coverUrl={asset.coverUrl} className={commonClasses} alt={asset.name} hovered={isHovered} />
      case ASSET_TYPE_CODE.AUDIO:
        return <img src={AudioImage} className={commonClasses} alt={asset.name} />
      default:
        return <div className='w-full h-full bg-[#1A1A1A]' />
    }
  }

  return (
    <div className='relative flex flex-col gap-2'>
      <div
        className={`group relative aspect-[4/3] rounded-2xl overflow-hidden bg-[#1A1A1A] cursor-pointer transition-all duration-300 ${isSelected ? 'ring-2 ring-blue-500 ring-offset-2 ring-offset-black scale-95 shadow-xl' : 'hover:shadow-2xl hover:shadow-blue-500/10'}`}
        onClick={handleClick}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        role='button'
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            handleClick(e)
          }
        }}
      >
        {renderContent()}
        <AssetCardTags asset={asset} />

        {/* Mask for Hover - 点击添加；悬浮或添加中时显示 */}
        {!isBatchMode && (
          <div
            className={`absolute inset-0 bg-black/50 transition-opacity duration-300 flex flex-col items-center justify-center gap-2 ${
              isAdding ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
            }`}
            role='button'
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation()
              if (!isAdding) onAdd()
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                e.stopPropagation()
                if (!isAdding) onAdd()
              }
            }}
          >
            {isAdding ? <Loader2 className='w-6 h-6 animate-spin text-white' /> : <span className='text-white text-sm font-medium hover:text-blue-400'>点击添加</span>}
          </div>
        )}

        {/* 操作按钮：固定于图片/视频右下角，悬浮显示；收藏态时收藏按钮常驻 */}
        {!isBatchMode && (
          <div className='absolute bottom-3 right-3 z-20 flex items-center gap-2' onClick={e => e.stopPropagation()}>
            <button
              className='p-2 rounded-xl bg-black/60 text-white hover:bg-black/80 transition-all duration-200 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto'
              onClick={(e) => {
                e.stopPropagation()
                onPreview()
              }}
              title='预览'
            >
              <Eye className='w-4 h-4' />
            </button>
            {asset.type === ASSET_TYPE_CODE.COLLECTION && onEnter && (
              <button
                className='p-2 rounded-xl bg-black/60 text-white hover:bg-black/80 transition-all duration-200 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto'
                onClick={(e) => {
                  e.stopPropagation()
                  onEnter()
                }}
                title='进入'
              >
                <LogIn className='w-4 h-4' />
              </button>
            )}
            {onDownload && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onDownload()
                }}
                className='p-2 rounded-xl bg-black/60 text-white hover:bg-black/80 transition-all duration-200 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto'
                title='下载'
              >
                <Download className='w-4 h-4' />
              </button>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation()
                onFavorite()
                e.currentTarget.blur()
              }}
              className={`p-2 rounded-xl bg-black/60 text-white hover:bg-black/80 hover:text-orange-400 transition-all duration-200 ${asset.isInCollection === 1 ? 'opacity-100' : 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto'} ${asset.isInCollection === 1 ? 'ring-2 ring-orange-400' : ''}`}
              title={asset.isInCollection === 1 ? '取消收藏' : '收藏'}
            >
              <Star className={`w-4 h-4 ${asset.isInCollection === 1 ? 'fill-orange-400/90 text-orange-400' : ''}`} />
            </button>
          </div>
        )}

        {/* Batch Selection Checkbox */}
        {isBatchMode && (
          <div className='absolute top-3 right-3 z-30'>
            <div
              className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all ${isSelected ? 'bg-blue-600 border-blue-600' : 'border-white/20 bg-black/50'}`}
            >
              {isSelected && <div className='w-3 h-2 border-b-2 border-l-2 border-white -rotate-45 -translate-y-0.5' />}
            </div>
          </div>
        )}
      </div>

      <div className='px-1 relative flex flex-col justify-start'>
        {asset.name && <h3 className='text-sm font-semibold truncate text-white/90 mb-1'>{asset.name}</h3>}
        <div className='relative overflow-hidden'>
          <div className='flex justify-between flex-col w-full'>
            {asset.promptPreview && <p className='text-xs text-white/90 font-medium truncate'>{asset.promptPreview}</p>}
            <p className='text-xs text-white/65 transition-opacity duration-300'>{asset.description ?? (isPublic ? asset.label : formatCreateTime(asset.createTime))}</p>
          </div>
        </div>
      </div>
    </div>
  )
}
