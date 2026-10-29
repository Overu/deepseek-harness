import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, Eye, Inbox, Loader2 } from 'lucide-react';
import type { AssetDetailResponse, AssetItem, AssetSetDetailItem, AddToCanvasItem } from './types';
import { ASSET_TYPE_CODE } from './types';
import { fetchAssetDetail } from '@/api/asset';
import { typeNumberLabelMap, nodeTypeByAssetTypeForAdd as nodeTypeByAssetType } from './util';
import MediaPreview from '@/components/common/MediaPreview';
import DefaultImage from '@/assets/images/default_flow.png';
import AudioImage from '@/assets/images/audio.png';
import { compressImage } from '@/utils';

interface AssetCollectionDetailProps {
  collection: AssetItem;
  onBack: () => void;
  onAdd?: (items: AddToCanvasItem[]) => void;
  /** 每行展示的列数，默认 3，在展开弹窗中可传 6 */
  columns?: number;
}

export const AssetCollectionDetail: React.FC<AssetCollectionDetailProps> = ({ collection, onBack, onAdd, columns = 3 }) => {
  const [detailData, setDetailData] = useState<AssetDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [mediaPreviewVisible, setMediaPreviewVisible] = useState(false);
  const [mediaPreviewInitialIndex, setMediaPreviewInitialIndex] = useState(0);
  const fetchIdRef = useRef(0);

  useEffect(() => {
    const id = Number(collection.id);
    if (!id) {
      setDetailData(null);
      setLoading(false);
      return;
    }
    const fetchId = ++fetchIdRef.current;
    setLoading(true);
    fetchAssetDetail({ id, type: 99 })
      .then((res: any) => {
        if (fetchId !== fetchIdRef.current) return;
        setDetailData((res?.data as AssetDetailResponse | undefined) ?? null);
      })
      .catch(() => {
        if (fetchId === fetchIdRef.current) setDetailData(null);
      })
      .finally(() => {
        if (fetchId === fetchIdRef.current) setLoading(false);
      });
  }, [collection.id]);

  const list = useMemo(() => detailData?.assetSetDetail ?? [], [detailData?.assetSetDetail]);

  const mediaPreviewItems = useMemo(() => {
    const items = list.filter(
      (i): i is AssetSetDetailItem & { fileUrl: string } =>
        (i.type === ASSET_TYPE_CODE.IMAGE || i.type === ASSET_TYPE_CODE.VIDEO || i.type === ASSET_TYPE_CODE.AUDIO) && Boolean(i.fileUrl)
    );
    return {
      urls: items.map(i => i.fileUrl),
      types: items.map(i => (i.type === ASSET_TYPE_CODE.IMAGE ? 'image' : i.type === ASSET_TYPE_CODE.VIDEO ? 'video' : 'audio')) as Array<'image' | 'video' | 'audio'>,
      items,
    };
  }, [list]);

  const openMediaPreview = (item: AssetSetDetailItem) => {
    const index = mediaPreviewItems.items.findIndex(x => x.id === item.id);
    if (index >= 0) {
      setMediaPreviewInitialIndex(index);
      setMediaPreviewVisible(true);
    }
  };

  return (
    <div className='flex flex-col h-full overflow-hidden'>
      <div className='flex items-center gap-2 px-4 pb-4'>
        <button onClick={onBack} className='p-1 hover:bg-white/10 rounded-md transition-colors shrink-0' title='返回'>
          <ChevronLeft className='w-5 h-5 text-white/60' />
        </button>
        <div className='min-w-0'>
          <div className='text-sm font-medium text-white/90 truncate'>{collection.name ?? '资产集'}</div>
          <div className='text-xs text-white/40'>{list.length} 项</div>
        </div>
      </div>

      <div className='flex-1 overflow-y-auto no-scrollbar px-4 pb-4'>
        {loading ? (
          <div className='w-full flex justify-center py-20'>
            <Loader2 className='h-6 w-6 animate-spin text-white/20' />
          </div>
        ) : list.length > 0 ? (
          <div className={`grid gap-4 ${columns === 6 ? 'grid-cols-6' : 'grid-cols-3'}`}>
            {list.map((item: AssetSetDetailItem) => {
              const isText = item.type === ASSET_TYPE_CODE.TEXT || item.type === ASSET_TYPE_CODE.TEXT_SUB;
              const label = isText ? '文本' : (typeNumberLabelMap[item.type] ?? `类型${item.type}`);
              const active = activeId === item.id;
              const canAdd = item.type !== ASSET_TYPE_CODE.COLLECTION && (isText ? Boolean(item.text?.trim()) : Boolean(item.fileUrl));
              const canPreview = (item.type === ASSET_TYPE_CODE.IMAGE || item.type === ASSET_TYPE_CODE.VIDEO || item.type === ASSET_TYPE_CODE.AUDIO) && Boolean(item.fileUrl);

              return (
                <div
                  key={item.id}
                  onClick={() => {
                    setActiveId(item.id);
                  }}
                  role='button'
                  tabIndex={0}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setActiveId(item.id);
                    }
                  }}
                  className={`relative rounded-lg overflow-hidden border bg-white/5 text-left ${
                    active ? 'border-white/30 ring-1 ring-white/20' : 'border-white/10 hover:border-white/20'
                  }`}
                >
                  <div className='absolute top-1 left-1 px-1.5 py-0.5 rounded text-xs bg-black/50 text-white/90 z-10'>{label}</div>

                  {item.type === ASSET_TYPE_CODE.IMAGE && item.fileUrl && (
                    <img src={compressImage(item.fileUrl) || DefaultImage} alt='' className='w-full aspect-square object-cover' />
                  )}
                  {item.type === ASSET_TYPE_CODE.VIDEO && item.fileUrl && <video src={item.fileUrl} className='w-full aspect-square object-cover' muted />}
                  {item.type === ASSET_TYPE_CODE.AUDIO && <img src={AudioImage} alt='' className='w-full aspect-square object-cover' />}
                  {isText && <div className='w-full aspect-square p-3 text-sm text-white/80 whitespace-pre-wrap overflow-hidden'>{item.text ?? ''}</div>}

                  <div
                    className='absolute inset-0 bg-black/40 opacity-0 hover:opacity-100 transition-opacity duration-200 flex items-center justify-center'
                    role={canAdd ? 'button' : undefined}
                    tabIndex={canAdd ? 0 : -1}
                    onClick={e => {
                      if (!canAdd) return;
                      e.stopPropagation();
                      const t = nodeTypeByAssetType[item.type] ?? (isText ? 'text' : 'image');
                      const value = isText ? (item.text?.trim() ?? '') : (item.fileUrl ?? '');
                      onAdd?.([{ type: t, value }]);
                    }}
                    onKeyDown={e => {
                      if (!canAdd) return;
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        e.stopPropagation();
                        const t = nodeTypeByAssetType[item.type] ?? (isText ? 'text' : 'image');
                        const value = isText ? (item.text?.trim() ?? '') : (item.fileUrl ?? '');
                        onAdd?.([{ type: t, value }]);
                      }
                    }}
                  >
                    {canAdd && <span className='text-white text-sm font-medium'>点击加入画布</span>}

                    <div className='absolute bottom-3 right-3 flex gap-2'>
                      {canPreview && (
                        <button
                          type='button'
                          onClick={e => {
                            e.stopPropagation();
                            openMediaPreview(item);
                          }}
                          className='p-2 bg-black/60 hover:bg-black/80 text-white rounded-lg transition-colors'
                          title='预览'
                        >
                          <Eye className='w-4 h-4' />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className='h-full flex flex-col items-center justify-center text-white/20'>
            <Inbox className='w-8 h-8 mb-2 opacity-10' />
            <p className='text-sm'>暂无资产</p>
          </div>
        )}
      </div>

      {mediaPreviewItems.urls.length > 0 && (
        <MediaPreview
          url={mediaPreviewItems.urls}
          visible={mediaPreviewVisible}
          onClose={() => setMediaPreviewVisible(false)}
          type={mediaPreviewItems.types}
          initialIndex={mediaPreviewInitialIndex}
        />
      )}
    </div>
  );
};
