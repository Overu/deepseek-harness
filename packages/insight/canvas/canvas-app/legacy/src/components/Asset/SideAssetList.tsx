import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Maximize, Loader2, Inbox } from 'lucide-react';
import { SideAssetCard } from './components/SideAssetCard';
import { SideScrollableTabs } from './components/SideScrollableTabs';
import { fetchAssetList, fetchAssetDetail, getLabelTree, reportAssetIds, type FetchAssetListParams } from '@/api/asset';
import { useScroll } from '@/hooks/useScroll';
import LoadMore from '@/components/common/scrollGrid/LoadMore';
import NoMore from '@/components/common/scrollGrid/NoMore';
import type { AssetType, AssetItem, FilterTreeNode, AssetSetDetailItem, AddToCanvasItem, AssetTypeCode } from './types';
import { ASSET_TYPE_CODE } from './types';
import { typeMap, typeNumberMap, assetSetDetailToItems, nodeTypeByAssetTypeForAdd as NODE_TYPE_BY_ASSET_TYPE } from './util';
import { AssetDetail } from './AssetDetail';
import { AssetExpandedDialog } from './AssetExpandedDialog';
import { AssetCollectionDetail } from './AssetCollectionDetail';
import { useFlowStore } from '@/store/flowStore';

const PAGE_SIZE = 15;
const SIDE_ASSET_QUERY_KEYS = {
  labelTree: ['asset', 'label-tree'] as const,
  list: (params: FetchAssetListParams) => ['asset', 'side-list', params] as const,
};
const LEVEL1_OPTIONS: { label: string; value: AssetType }[] = [
  { label: '图片', value: 'image' },
  { label: '视频', value: 'video' },
  { label: '音频', value: 'audio' },
  { label: '资产集', value: 'collection' },
];

interface SideAssetListProps {
  onAdd?: (items: AddToCanvasItem[]) => void;
  refreshTrigger?: number;
}

export const SideAssetList: React.FC<SideAssetListProps> = ({ onAdd, refreshTrigger }) => {
  const canvasId = useFlowStore(state => state.canvasId);
  const queryClient = useQueryClient();
  const [primaryTab, setPrimaryTab] = useState<'public' | 'my'>('my');
  const [level1Tab, setLevel1Tab] = useState<AssetType>('image');
  const [level2Tab, setLevel2Tab] = useState<number | 'favorites' | 'currentCanvas' | null>(null); // null means "All"
  const [activeCollection, setActiveCollection] = useState<AssetItem | null>(null);

  const [assets, setAssets] = useState<AssetItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  // Dialog state
  const [expandedDialogOpen, setExpandedDialogOpen] = useState(false);

  // Detail/Preview state
  const [previewData, setPreviewData] = useState<{ id: number; assetType: AssetTypeCode; allAssets: AssetItem[] } | null>(null);
  const [addingId, setAddingId] = useState<number | null>(null);

  const fetchIdRef = useRef(0);
  const hasInitRefreshTriggerRef = useRef(false);

  const handleSingleAdd = useCallback(
    async (asset: AssetItem) => {
      if (!onAdd) return;
      if (primaryTab === 'public') {
        reportAssetIds({ ids: [asset.id] }).catch(() => void 0);
      }
      if (asset.type !== ASSET_TYPE_CODE.COLLECTION) {
        const type = NODE_TYPE_BY_ASSET_TYPE[asset.type] ?? 'image';
        const value = asset.fileUrl ?? '';
        onAdd([{ type, value }]);
        return;
      }
      setAddingId(asset.id);
      try {
        const res: any = await fetchAssetDetail({ id: asset.id, type: ASSET_TYPE_CODE.COLLECTION });
        const data = res?.data;
        const list: AssetSetDetailItem[] = data?.assetSetDetail ?? [];
        const items = assetSetDetailToItems(list);
        if (items.length) {
          onAdd(items);
        }
      } finally {
        setAddingId(null);
      }
    },
    [onAdd, primaryTab]
  );

  const { data: filterTree = [] } = useQuery<FilterTreeNode[]>({
    queryKey: SIDE_ASSET_QUERY_KEYS.labelTree,
    queryFn: async () => {
      const res: any = await getLabelTree();
      return res.code === 'SUCCESS' ? res.data : [];
    },
    retry: false,
  });

  const resetTabsForPrimary = useCallback((tab: 'public' | 'my') => {
    setPrimaryTab(tab);
    setLevel1Tab('image');
    setLevel2Tab(null);
    setActiveCollection(null);
  }, []);

  const level2Options = useMemo(() => {
    // 我的资产时二级 tab 展示「收藏」和「当前画布」（资产集不展示当前画布）
    if (primaryTab === 'my') {
      const showCurrentCanvas = canvasId && level1Tab !== 'collection';
      return [{ label: '收藏', value: 'favorites' as const }, ...(showCurrentCanvas ? [{ label: '当前画布', value: 'currentCanvas' as const }] : [])];
    }
    const node = filterTree.find(n => n.label === typeMap[level1Tab]);
    const children = node?.children || [];
    return [...children.map(c => ({ label: c.label, value: c.id })), { label: '收藏', value: 'favorites' as const }];
  }, [primaryTab, level1Tab, filterTree, canvasId]);

  const fetchData = useCallback(
    async (pageIndex: number, reset = false) => {
      const fetchId = ++fetchIdRef.current;
      if (reset) setLoading(true);
      else setLoadingMore(true);

      try {
        const params: FetchAssetListParams = {
          pageSize: PAGE_SIZE,
          pageIndex,
          isPublic: primaryTab === 'public' ? 1 : 0,
          isDesc: 1,
          type: typeNumberMap[level1Tab],
        };

        if (level2Tab === 'favorites') {
          params.isInCollection = 1;
        } else if (level2Tab === 'currentCanvas' && level1Tab !== 'collection') {
          if (canvasId) params.canvasId = canvasId;
        } else if (typeof level2Tab === 'number') {
          params.labelId = level2Tab;
        }

        const response: any = await queryClient.fetchQuery({
          queryKey: SIDE_ASSET_QUERY_KEYS.list(params),
          queryFn: () => fetchAssetList(params),
          retry: false,
        });
        if (fetchId !== fetchIdRef.current) return;

        const data = response.data;
        const newList = data?.dataList || [];

        if (reset) {
          setAssets(newList);
          setPage(1);
        } else {
          setAssets(prev => [...prev, ...newList]);
          setPage(pageIndex);
        }
        setTotal(data?.total || 0);
      } catch (error) {
        if (fetchId !== fetchIdRef.current) return;
        console.error('Failed to fetch assets:', error);
      } finally {
        if (fetchId === fetchIdRef.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [primaryTab, level1Tab, level2Tab, queryClient]
  );

  useEffect(() => {
    fetchData(1, true);
  }, [fetchData]);

  useEffect(() => {
    if (refreshTrigger === undefined) return;
    if (!hasInitRefreshTriggerRef.current) {
      hasInitRefreshTriggerRef.current = true;
      return;
    }
    setPage(1);
    fetchData(1, true);
  }, [refreshTrigger, fetchData]);

  const hasMore = useMemo(() => total > PAGE_SIZE * page, [total, page]);
  const { sentinelRef } = useScroll({
    callback: () => fetchData(page + 1),
    hasMore,
    isLoading: loadingMore,
  });

  return (
    <div className='flex flex-col h-full rounded-lg overflow-hidden border border-[#595959] bg-[linear-gradient(0deg,rgba(38,38,38,0.5),rgba(38,38,38,0.5)),linear-gradient(114deg,rgba(19,10,77,0.4)_-3%,rgba(0,36,197,0.4)_46%,rgba(116,126,255,0.4)_64%,rgba(0,175,255,0.4)_76%)] backdrop-blur-[20px]'>
      {/* Header Tabs */}
      <div className='flex items-center justify-between px-4 pt-4 border-b border-white/5 bg-[#262626]'>
        <div className='flex gap-6'>
          <button
            onClick={() => resetTabsForPrimary('my')}
            className={`pb-2 text-sm font-medium transition-all relative ${primaryTab === 'my' ? 'text-white' : 'text-white/40 hover:text-white/60'}`}
          >
            我的资产
            {primaryTab === 'my' && <div className='absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500' />}
          </button>
          <button
            onClick={() => resetTabsForPrimary('public')}
            className={`pb-2 text-sm font-medium transition-all relative ${primaryTab === 'public' ? 'text-white' : 'text-white/40 hover:text-white/60'}`}
          >
            公共资产
            {primaryTab === 'public' && <div className='absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500' />}
          </button>
        </div>
        <button onClick={() => setExpandedDialogOpen(true)} className='flex items-center gap-1 text-white hover:text-white/65 transition-colors mb-3'>
          <Maximize size={16} />
          <span className='text-xs'>展开</span>
        </button>
      </div>

      {activeCollection ? (
        <div className='flex-1 overflow-hidden pt-4'>
          <AssetCollectionDetail
            collection={activeCollection}
            onBack={() => setActiveCollection(null)}
            onAdd={
              primaryTab === 'public'
                ? items => {
                    reportAssetIds({ ids: [activeCollection.id] }).catch(() => void 0);
                    onAdd?.(items);
                  }
                : onAdd
            }
          />
        </div>
      ) : (
        <>
          {/* Level 1 & 2 Tabs */}
          <div className='p-4 flex flex-col gap-3'>
            <SideScrollableTabs
              options={LEVEL1_OPTIONS}
              value={level1Tab}
              onChange={val => {
                setLevel1Tab(val);
                if (typeof level2Tab === 'number' || (val === 'collection' && level2Tab === 'currentCanvas')) {
                  setLevel2Tab(null);
                }
              }}
              showAll={false}
              variant='level1'
            />
            <SideScrollableTabs options={level2Options} value={level2Tab} onChange={setLevel2Tab} showAll variant='level2' />
          </div>

          {/* Asset Grid */}
          <div className='flex-1 overflow-y-auto no-scrollbar p-4 pt-0'>
            {loading ? (
              <div className='w-full flex justify-center py-20'>
                <Loader2 className='h-6 w-6 animate-spin text-white/20' />
              </div>
            ) : assets.length > 0 ? (
              <div className='grid grid-cols-3 gap-3'>
                {assets.map(asset => (
                  <SideAssetCard
                    key={asset.id}
                    asset={asset}
                    isPublic={primaryTab === 'public'}
                    onPreview={() => setPreviewData({ id: asset.id, assetType: asset.type, allAssets: assets })}
                    onEnter={asset.type === ASSET_TYPE_CODE.COLLECTION ? () => setActiveCollection(asset) : undefined}
                    onAdd={() => handleSingleAdd(asset)}
                    isAdding={addingId === asset.id}
                  />
                ))}
                <LoadMore show={hasMore} loadingMore={loadingMore} sentinelRef={sentinelRef} />
                <NoMore show={total > 0 && !hasMore} text='没有更多了' />
              </div>
            ) : (
              <div className='h-full flex flex-col items-center justify-center text-white/20'>
                <Inbox className='w-8 h-8 mb-2 opacity-10' />
                <p className='text-sm'>暂无资产</p>
              </div>
            )}
          </div>
        </>
      )}

      {/* Detail Preview */}
      {previewData && (
        <AssetDetail
          assetId={previewData.id}
          assetType={previewData.assetType}
          allAssets={previewData.allAssets}
          isPublic={primaryTab === 'public'}
          onClose={() => setPreviewData(null)}
        />
      )}

      {/* Expanded Dialog */}
      {expandedDialogOpen && (
        <AssetExpandedDialog
          open={expandedDialogOpen}
          onOpenChange={setExpandedDialogOpen}
          onAdd={items => {
            onAdd?.(items);
            setExpandedDialogOpen(false);
          }}
        />
      )}
    </div>
  );
};
