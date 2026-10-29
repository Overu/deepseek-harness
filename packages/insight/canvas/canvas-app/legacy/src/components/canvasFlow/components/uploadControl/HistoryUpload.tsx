import { useState, useEffect, useMemo, useRef } from 'react';
import { Eye, Check, Loader2 } from 'lucide-react';
import MediaPreview from '@/components/common/MediaPreview';
import SafeImage from '@/components/common/SafeImage';
import { fetchAssetList, type FetchAssetListParams } from '@/api/asset';
import { compressImage } from '@/utils';
import { useScroll } from '@/hooks/useScroll';
import NoMore from '@/components/common/scrollGrid/NoMore';
import LoadMore from '@/components/common/scrollGrid/LoadMore';
import Empty from '@/components/common/scrollGrid/Empty';
import AudioImage from '@/assets/images/audio.png';
import { AssetCardTags } from '@/components/Asset/components/AssetCardTags';
import { AssetVideoPreview } from '@/components/Asset/components/AssetVideoPreview';
import { toast } from 'sonner';
import { BackToTopButton } from '@/components/common/BackToTopButton';
import { getHistorySelectKey, type AssetItem, type HistorySelectKey } from './historyUploadSelection';

export type { AssetItem } from './historyUploadSelection';

const typeMap: any = {
  image: 1,
  video: 2,
  audio: 3,
};

const assetTypeMap: any = {
  1: 'image',
  2: 'video',
  3: 'audio',
};

interface HistoryProps {
  type: string;
  selectedUrl?: string | null; // 接收选中的URL
  selectedUrls?: string[];
  selectedKeys?: Array<string | number>;
  selectKey?: HistorySelectKey;
  maxCount?: number;
  onSelect: (url: string, asset?: AssetItem) => void; // 处理选择事件
}

const HistoryUpload = ({ type, selectedUrl, selectedUrls = [], selectedKeys, selectKey = 'fileUrl', maxCount, onSelect }: HistoryProps) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [assets, setAssets] = useState<AssetItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewUrl, setPreviewUrl] = useState('');
  const size = 20;
  const hasMore = useMemo(() => {
    return total > size * page;
  }, [total, page]);
  const activeSelectedKeys = selectedKeys ?? selectedUrls;
  const selectedKeySet = useMemo(() => new Set(activeSelectedKeys.map(String)), [activeSelectedKeys]);

  const { sentinelRef } = useScroll({
    callback: () => {
      getAssets(page + 1);
    },
    hasMore,
    isLoading: loadingMore,
  });

  const getAssets = async (page: number, reset = false) => {
    if (reset) {
      setLoading(true);
    } else {
      setLoadingMore(true);
    }
    try {
      const params: FetchAssetListParams = {
        pageIndex: page,
        pageSize: size,
        type: typeMap[type],
        isPublic: 0,
        isDesc: 1,
      };
      const response = (await fetchAssetList(params)) as { data?: { dataList?: AssetItem[]; total?: number } };
      const data = response?.data;
      const newAssets = data?.dataList ?? [];

      if (reset) {
        setAssets(newAssets);
        setPage(1);
      } else {
        setAssets(prev => [...prev, ...newAssets]);
        setPage(page);
      }

      setTotal(data?.total ?? 0);
    } catch (error) {
      console.error('Failed to fetch assets:', error);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    getAssets(1, true);
  }, [type]);

  const handlePreview = (url: string) => {
    setPreviewVisible(true);
    setPreviewUrl(url);
  };

  const handleSelect = (asset: AssetItem) => {
    const selected = (selectKey === 'fileUrl' && selectedUrl === asset.fileUrl) || selectedKeySet.has(getHistorySelectKey(asset, selectKey));
    if (!selected && maxCount && maxCount > 1 && activeSelectedKeys.length >= maxCount) {
      toast.warning(`最多选择${maxCount}个资源`);
      return;
    }

    onSelect(asset.fileUrl, asset);
  };

  const renderAssets = () => {
    return assets.map((asset: AssetItem) => {
      const selected = (selectKey === 'fileUrl' && selectedUrl === asset.fileUrl) || selectedKeySet.has(getHistorySelectKey(asset, selectKey));

      return (
        <div
          key={`${asset.type}-${asset.id}-${asset.fileUrl}`}
          className={`relative group aspect-square rounded-xl hover:shadow-lg transition-all duration-300 cursor-pointer ${selected ? 'border-[3px] border-blue-400' : ''}`}
          onClick={() => handleSelect(asset)}
        >
          {/* 内容展示区 */}
          <div className='w-full h-full flex items-center justify-center overflow-hidden rounded-lg bg-[#1b1b1b]'>
            {assetTypeMap[asset.type] === 'image' && (
              <SafeImage
                src={compressImage(asset.fileUrl, 300)}
                alt='资产图片'
                draggable={false}
                className='w-full h-full object-cover transition-transform duration-300 group-hover:scale-110'
              />
            )}

            {assetTypeMap[asset.type] === 'video' && <AssetVideoPreview fileUrl={asset.fileUrl} posterWidth={300} alt='视频首帧' className='h-full w-full object-cover' />}

            {assetTypeMap[asset.type] === 'audio' && (
              <img src={AudioImage} alt='asset' className='w-full h-full object-cover transition-transform duration-300 group-hover:scale-110' />
            )}
          </div>

          {/* 视频/音频左上角时长（与资产库一致；选中时避开左上角勾选） */}
          <AssetCardTags asset={asset} positionClassName={selected ? 'top-2 left-8' : 'top-2 left-2'} />

          {/* 底部遮罩层 */}
          <div className='pointer-events-none absolute inset-0 rounded-lg bg-black/45 backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center text-sm text-white'>
            {selected ? '取消选择' : '点击添加'}
          </div>

          {/* 悬浮操作按钮 */}
          <div className='absolute bottom-2 right-2 flex space-x-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300'>
            <button className='bg-black/45 text-white p-2 rounded-md backdrop-blur-sm hover:bg-black/85 transition'>
              <Eye
                size={12}
                onClick={e => {
                  e.stopPropagation();
                  handlePreview(asset.fileUrl);
                }}
              />
            </button>
          </div>

          {/* 选中标识 */}
          {selected && (
            <div className='absolute top-1 left-1 bg-blue-500 rounded-full p-1 z-30'>
              <Check size={12} className='text-white' />
            </div>
          )}
        </div>
      );
    });
  };

  return (
    <div className='relative flex h-full w-full flex-col gap-1 space-y-1'>
      {loading ? (
        // 添加加载状态，防止切换时出现空白闪烁
        <div className='w-full flex justify-center py-4'>
          <Loader2 className='h-6 w-6 animate-spin text-muted-foreground' />
        </div>
      ) : (
        <>
          <Empty data={assets}></Empty>
          <div
            ref={scrollContainerRef}
            className='grid min-h-0 w-full flex-1 content-start grid-cols-2 gap-2 overflow-y-auto pr-1 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6'
          >
            {renderAssets()}
            <LoadMore show={hasMore} loadingMore={loadingMore} sentinelRef={sentinelRef} />
            <NoMore show={total > 0 && !hasMore} text='没有更多资产了' />
          </div>
          <BackToTopButton scrollTargetRef={scrollContainerRef} />
        </>
      )}
      <MediaPreview visible={previewVisible} url={previewUrl} onClose={() => setPreviewVisible(false)} />
    </div>
  );
};

export default HistoryUpload;
