import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import type { CommunityWorkMedia, CommunityWorkType } from '@/api/community';
import HistoryUpload, { type AssetItem } from '@/components/canvasFlow/components/uploadControl/HistoryUpload';
import LocalUpload from '@/components/canvasFlow/components/uploadControl/LocalUpload';
import CustomTabs from '@/components/canvasFlow/components/common/CustomTabs';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { COVER_MAX_SIZE_MB, IMAGE_WORK_MAX_COUNT, IMAGE_WORK_MAX_SIZE_MB, VIDEO_WORK_ALLOWED_EXTENSIONS, VIDEO_WORK_MAX_COUNT, VIDEO_WORK_MAX_SIZE_MB } from './constants';

export type CommunityUploadTarget = 'work' | 'cover';

interface CommunityMediaUploadDialogProps {
  open: boolean;
  target: CommunityUploadTarget;
  workType: CommunityWorkType;
  selectedMediaList: CommunityWorkMedia[];
  selectedCoverUrl?: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: (items: CommunityWorkMedia[]) => void;
}

const getUploadMediaKind = (target: CommunityUploadTarget, workType: CommunityWorkType) => {
  if (target === 'cover') return 'image';
  return workType === 'VIDEO' ? 'video' : 'image';
};

const getMediaType = (mediaKind: string) => (mediaKind === 'video' ? 'VIDEO' : 'IMAGE');

const createMediaItem = (url: string, mediaKind: string, sortOrder: number, assetId?: number, duration?: number): CommunityWorkMedia => ({
  id: assetId !== undefined ? String(assetId) : `${mediaKind}-${url}`,
  media_type: getMediaType(mediaKind),
  media_url: url,
  ...(mediaKind === 'video' && typeof duration === 'number' && Number.isFinite(duration) && duration > 0 ? { duration } : {}),
  sort_order: sortOrder,
});

const normalizeSortOrder = (items: CommunityWorkMedia[]) => items.map((item, index) => ({ ...item, sort_order: index }));

export function CommunityMediaUploadDialog({ open, target, workType, selectedMediaList, selectedCoverUrl, onOpenChange, onConfirm }: CommunityMediaUploadDialogProps) {
  const wasOpenRef = useRef(false);
  const mediaKind = getUploadMediaKind(target, workType);
  const maxCount = target === 'cover' ? 1 : workType === 'IMAGE' ? IMAGE_WORK_MAX_COUNT : VIDEO_WORK_MAX_COUNT;
  const maxSize = mediaKind === 'video' ? VIDEO_WORK_MAX_SIZE_MB : target === 'cover' ? COVER_MAX_SIZE_MB : IMAGE_WORK_MAX_SIZE_MB;
  const maxDuration = mediaKind === 'video' ? null : undefined;
  const [activeTab, setActiveTab] = useState('asset');
  const [assetVisited, setAssetVisited] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [selectedItems, setSelectedItems] = useState<CommunityWorkMedia[]>([]);
  const selectAssetById = target === 'work';

  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      return;
    }

    if (wasOpenRef.current) return;
    wasOpenRef.current = true;

    const initialItems = target === 'cover' && selectedCoverUrl ? [createMediaItem(selectedCoverUrl, 'image', 0)] : selectedMediaList.filter(item => Boolean(item.media_url));

    setSelectedItems(normalizeSortOrder(initialItems));
    setActiveTab('asset');
    setAssetVisited(true);
    setUploading(false);
  }, [open, selectedCoverUrl, selectedMediaList, target]);

  const selectedAssetKeys = useMemo(() => selectedItems.map(item => (selectAssetById ? item.id : item.media_url)), [selectAssetById, selectedItems]);
  const title = target === 'cover' ? '封面上传' : '作品上传';

  const handleTabChange = (key: string) => {
    if (uploading) {
      toast.warning('文件上传中，请稍后再切换');
      return;
    }

    if (key === 'asset') {
      setAssetVisited(true);
    }
    setActiveTab(key);
  };

  const addItem = (url: string, asset?: AssetItem, duration = asset?.duration) => {
    setSelectedItems(prev => {
      if (prev.some(item => item.media_url === url)) {
        return prev;
      }

      if (prev.length >= maxCount) {
        toast.warning(`最多选择${maxCount}个资源`);
        return prev;
      }

      return normalizeSortOrder([...prev, createMediaItem(url, mediaKind, prev.length, asset?.id, duration)]);
    });
  };

  const handleAssetSelect = (url: string, asset?: AssetItem) => {
    setSelectedItems(prev => {
      const assetId = asset?.id;
      const useAssetId = selectAssetById && assetId !== undefined;
      const selected = prev.some(item => (useAssetId ? item.id === String(assetId) : item.media_url === url));
      if (selected) {
        return normalizeSortOrder(prev.filter(item => (useAssetId ? item.id !== String(assetId) : item.media_url !== url)));
      }

      if (maxCount === 1) {
        return [createMediaItem(url, mediaKind, 0, asset?.id, asset?.duration)];
      }

      if (prev.length >= maxCount) {
        toast.warning(`最多选择${maxCount}个资源`);
        return prev;
      }

      return normalizeSortOrder([...prev, createMediaItem(url, mediaKind, prev.length, asset?.id, asset?.duration)]);
    });
  };

  const handleLocalUpload = (url: string, meta?: { duration?: number }) => {
    if (maxCount === 1) {
      setSelectedItems([createMediaItem(url, mediaKind, 0, undefined, meta?.duration)]);
      return;
    }

    addItem(url, undefined, meta?.duration);
  };

  const handleConfirm = () => {
    if (selectedItems.length === 0) {
      toast.warning(target === 'cover' ? '请选择封面' : '请选择作品资源');
      return;
    }

    onConfirm(normalizeSortOrder(selectedItems));
    onOpenChange(false);
  };

  const tabs = [
    { key: 'upload', label: '本地上传' },
    { key: 'asset', label: '资产库' },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-community-publish-nested-dialog='true'
        className='flex h-[75vh] w-[min(980px,calc(100vw-32px))] max-w-none flex-col gap-0 overflow-hidden border-white/10 bg-[#242424] p-0 text-white'
        overlayClassName='bg-black/70'
      >
        <header className='flex h-14 shrink-0 items-center px-5'>
          <DialogTitle className='text-sm font-semibold text-white'>{title}</DialogTitle>
        </header>

        <div className='shrink-0'>
          <CustomTabs tabs={tabs} activeKey={activeTab} onChange={handleTabChange} width={292} />
        </div>

        <div className='min-h-0 flex-1 px-5 pb-4'>
          <div className={`h-full ${activeTab === 'upload' ? '' : 'hidden'}`}>
            <LocalUpload
              uploading={uploading}
              accept={mediaKind}
              acceptedExtensions={mediaKind === 'video' ? VIDEO_WORK_ALLOWED_EXTENSIONS : undefined}
              maxSize={maxSize}
              maxDuration={maxDuration}
              onOk={handleLocalUpload}
              updateUploading={setUploading}
            />
          </div>
          {assetVisited && (
            <div className={`h-full ${activeTab === 'asset' ? '' : 'hidden'}`}>
              <HistoryUpload type={mediaKind} selectedKeys={selectedAssetKeys} selectKey={selectAssetById ? 'id' : 'fileUrl'} maxCount={maxCount} onSelect={handleAssetSelect} />
            </div>
          )}
        </div>

        <footer className='flex h-14 shrink-0 items-center justify-end gap-3 border-t border-white/5 px-5'>
          <span className='text-xs text-white/80'>
            已选择 {selectedItems.length}/{maxCount}
          </span>
          <div className='flex items-center gap-3'>
            <Button type='button' variant='ghost' className='h-8 min-w-[64px] bg-white/10 text-white/80 hover:bg-white/15 hover:text-white' onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button
              type='button'
              className='h-8 min-w-[64px] bg-[#364cff] text-white hover:bg-[#455aff]'
              disabled={selectedItems.length === 0 || uploading}
              onClick={handleConfirm}
            >
              确定
            </Button>
          </div>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
