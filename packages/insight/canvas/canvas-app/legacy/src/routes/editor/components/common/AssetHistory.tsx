import { useState, useMemo } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { fetchAssets } from '@/api/asset';
import { useFlowStore } from '@/store/flowStore';
import { useScroll } from '@/hooks/useScroll';
import { Loader2, Eye } from 'lucide-react';
import MediaPreview from '@/components/common/MediaPreview';
import { compressImage } from '@/utils';
import LoadMore from '@/components/common/scrollGrid/LoadMore';
import NoMore from '@/components/common/scrollGrid/NoMore';
import Empty from '@/components/common/scrollGrid/Empty';

interface AssetItem {
  id: number;
  assetType: number;
  fileUrl: string;
}

interface AssetHistoryProps {
  onAdd: (type: string, url: string) => void;
}

export function AssetHistory({ onAdd }: AssetHistoryProps) {
  const size = 15;
  const { canvasId } = useFlowStore();
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewUrl, setPreviewUrl] = useState('');

  // 配置 react-query 实现无限滚动与缓存
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, status } = useInfiniteQuery({
    queryKey: ['editor-assets', canvasId],
    queryFn: async ({ pageParam = 1 }) => {
      const response: any = await fetchAssets({
        page: pageParam,
        size,
        canvasId,
        type: 1, // 仅请求图片
      });
      return {
        dataList: response.data?.dataList || [],
        total: response.data?.total || 0,
        nextPage: pageParam + 1,
      };
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage, pages) => {
      // 检查当前已加载的数量是否小于总数
      const currentCount = pages.reduce((acc, page) => acc + page.dataList.length, 0);
      if (currentCount < lastPage.total) {
        return lastPage.nextPage;
      }
      return undefined;
    },
    staleTime: 5 * 60 * 1000, // 5分钟缓存
  });

  const assets = useMemo(() => {
    return data?.pages.flatMap(page => page.dataList) || [];
  }, [data]);

  const { sentinelRef } = useScroll({
    callback: () => {
      if (hasNextPage && !isFetchingNextPage) {
        fetchNextPage();
      }
    },
    hasMore: hasNextPage,
    isLoading: isFetchingNextPage,
  });

  const handlePreview = (e: React.MouseEvent, url: string) => {
    e.stopPropagation();
    setPreviewUrl(url);
    setPreviewVisible(true);
  };

  return (
    <div className='flex flex-col rounded-lg w-[400px] bg-zinc-900 border border-zinc-700 shadow-2xl overflow-hidden'>
      <div className='px-4 py-3 border-b border-zinc-800 bg-zinc-900/90 text-zinc-100 text-sm font-medium'>图片生成历史</div>
      <div className='flex flex-col gap-2 h-[500px] p-4 bg-zinc-900/50'>
        {status === 'pending' ? (
          <div className='flex-1 min-h-0 flex items-center justify-center'>
            <Loader2 className='h-6 w-6 animate-spin text-zinc-500' />
          </div>
        ) : status === 'error' ? (
          <div className='flex-1 min-h-0 flex items-center justify-center text-red-400 text-sm'>加载失败</div>
        ) : assets.length === 0 ? (
          <div className='flex-1 min-h-0'>
            <Empty data={assets} />
          </div>
        ) : (
          <div className='flex-1 min-h-0 overflow-y-auto [&::-webkit-scrollbar]:hidden pr-1 pb-4'>
            <div className='grid gap-2 grid-cols-3 w-full'>
              {assets.map((asset: AssetItem, index: number) => (
                <div
                  key={`${asset.id}-${index}`}
                  className='relative group aspect-square rounded-md overflow-hidden bg-zinc-800 border border-zinc-700 hover:border-zinc-500 transition-all cursor-pointer'
                  onClick={() => onAdd('image', asset.fileUrl)}
                >
                  <img src={compressImage(asset.fileUrl)} alt='asset' className='w-full h-full object-cover transition-transform duration-300 group-hover:scale-110' />

                  {/* Hover 遮罩 */}
                  <div className='absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center'>
                    <span className='text-xs text-zinc-200 font-medium'>点击加入编辑器</span>
                  </div>

                  {/* 预览按钮 */}
                  <button
                    className='absolute bottom-1 right-1 p-1.5 bg-black/70 hover:bg-black text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-200'
                    onClick={e => handlePreview(e, asset.fileUrl)}
                    title='预览'
                  >
                    <Eye size={12} />
                  </button>
                </div>
              ))}
              <LoadMore show={hasNextPage} loadingMore={isFetchingNextPage} sentinelRef={sentinelRef} />
              <NoMore show={assets.length > 0 && !hasNextPage} text='没有更多资产了' />
            </div>
          </div>
        )}
      </div>

      <MediaPreview visible={previewVisible} url={previewUrl} onClose={() => setPreviewVisible(false)} />
    </div>
  );
}
