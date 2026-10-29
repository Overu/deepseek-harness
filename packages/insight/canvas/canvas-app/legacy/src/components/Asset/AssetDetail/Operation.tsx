import React, { useMemo } from 'react';
import { ZoomIn, ZoomOut, Download, Trash2, Maximize, Star } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';

/** 资产类型：1-图片 2-视频 3-音频 99-资产集。传入 99 时内部不展示下载、删除按钮 */
const ASSET_TYPE_SET = 99;

interface OperationProps {
  onZoomOut: () => void;
  onZoomIn: () => void;
  onReset: () => void;
  /** 当前资源是否支持缩放；默认保持资产详情页现有行为 */
  showZoom?: boolean;
  isPublic?: boolean;
  readOnly?: boolean;
  /** 资产类型，用于内部控制：资产集(99) 不展示下载、删除 */
  assetType?: number;
  onDownload?: () => void | Promise<void>;
  onDelete?: () => void | Promise<void>;
  onFavorite?: () => void | Promise<void>;
  onUnfavorite?: () => void | Promise<void>;
}

export const Operation: React.FC<OperationProps> = ({
  onZoomOut,
  onZoomIn,
  onReset,
  showZoom = true,
  isPublic = false,
  readOnly,
  assetType,
  onDownload,
  onDelete,
  onFavorite,
  onUnfavorite,
}) => {
  const canShowDownloadDelete = assetType !== ASSET_TYPE_SET;

  const actions = useMemo(
    () => [
      {
        key: 'zoom-out',
        label: '缩小',
        icon: ZoomOut,
        onClick: onZoomOut,
        show: showZoom,
      },
      {
        key: 'zoom-in',
        label: '放大',
        icon: ZoomIn,
        onClick: onZoomIn,
        show: showZoom,
      },
      {
        key: 'reset',
        label: '重置',
        icon: Maximize,
        onClick: onReset,
        show: showZoom,
      },
      {
        key: 'download',
        label: '下载',
        icon: Download,
        onClick: () => onDownload?.(),
        show: canShowDownloadDelete && !isPublic && !readOnly && !!onDownload,
      },
      {
        key: 'delete',
        label: '删除',
        icon: Trash2,
        onClick: () => onDelete?.(),
        show: canShowDownloadDelete && !isPublic && !readOnly && !!onDelete,
      },
      {
        key: 'favorite',
        label: '收藏',
        icon: Star,
        onClick: () => onFavorite?.(),
        show: isPublic && !!onFavorite,
      },
      {
        key: 'unfavorite',
        label: '取消收藏',
        icon: Star,
        onClick: () => onUnfavorite?.(),
        show: isPublic && !!onUnfavorite,
      },
    ],
    [isPublic, readOnly, assetType, showZoom, onZoomOut, onZoomIn, onReset, onDownload, onDelete, onFavorite, onUnfavorite]
  );

  return (
    <div className='flex items-center gap-3 bg-black/85 backdrop-blur-md px-4 py-1.5 rounded-2xl border border-white/5 mt-4 mobile:contents'>
      <TooltipProvider>
        {actions.map(action => {
          if (!action.show) return null;

          const Icon = action.icon;

          return (
            <Tooltip key={action.key}>
              <TooltipTrigger asChild>
                <button
                  onClick={action.onClick}
                  className='p-1.5 hover:text-white text-white/70 transition-colors mobile:flex mobile:h-10 mobile:flex-1 mobile:items-center mobile:justify-center mobile:p-0 mobile:text-white/85'
                >
                  <Icon size={16} />
                </button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{action.label}</p>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </TooltipProvider>
    </div>
  );
};
