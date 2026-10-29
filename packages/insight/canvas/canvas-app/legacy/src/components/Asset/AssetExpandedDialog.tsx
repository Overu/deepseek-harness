import React, { useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { X, Star, StarOff, Download, PlusSquare, Inbox, Loader2 } from 'lucide-react';
import { AssetFilterBar } from './components/AssetFilterBar';
import { AssetLibraryContext } from './contexts/AssetLibraryContext';
import { useScroll } from '@/hooks/useScroll';
import Skeleton from '@/components/workFlow/common/Skeleton';
import LoadMore from '@/components/common/scrollGrid/LoadMore';
import NoMore from '@/components/common/scrollGrid/NoMore';
import type { AssetItem, AssetSetDetailItem, AddToCanvasItem, AssetTypeCode } from './types';
import { ASSET_TYPE_CODE } from './types';
import { DialogAssetCard } from './components/DialogAssetCard';
import { nodeTypeByAssetTypeForAdd as nodeTypeByAssetType, assetSetDetailToItems } from './util';
import { AssetDetail } from './AssetDetail';
import { AssetCollectionDetail } from './AssetCollectionDetail';
import { useAssetLibrary } from './hooks/useAssetLibrary';
import { fetchAssetDetail, fetchAssetDetails, reportAssetIds } from '@/api/asset';
import { useFlowStore } from '@/store/flowStore';

const PAGE_SIZE = 24;

interface AssetExpandedDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd?: (items: AddToCanvasItem[]) => void;
}

export const AssetExpandedDialog: React.FC<AssetExpandedDialogProps> = ({ open, onOpenChange, onAdd }) => {
  const canvasId = useFlowStore(state => state.canvasId);
  const library = useAssetLibrary({ pageSize: PAGE_SIZE, canvasId, hideCanvasFilter: false });
  const {
    primaryTab,
    secondaryTab,
    assets,
    displayItems,
    loading,
    loadingMore,
    page,
    total,
    hasMore,
    isBatchMode,
    selectedIds,
    setSelectedIds,
    fetchData,
    exitBatchMode,
    batchAddFavorite,
    batchRemoveFavorite,
    batchDownload,
    handleSingleFavorite,
    handleSingleUnfavorite,
    handleSingleDownload,
  } = library;

  const [previewId, setPreviewId] = useState<number | null>(null);
  const [previewType, setPreviewType] = useState<AssetTypeCode | null>(null);
  const [activeCollection, setActiveCollection] = useState<AssetItem | null>(null);
  const [addingId, setAddingId] = useState<number | null>(null);
  const [batchAdding, setBatchAdding] = useState(false);

  const { sentinelRef } = useScroll({
    callback: () => {
      fetchData(page + 1);
    },
    hasMore,
    isLoading: loadingMore,
  });

  const handleSingleAdd = useCallback(
    async (asset: AssetItem) => {
      if (!onAdd) return;
      if (primaryTab === 'public') {
        reportAssetIds({ ids: [asset.id] }).catch(() => void 0);
      }
      if (asset.type !== ASSET_TYPE_CODE.COLLECTION) {
        const type = nodeTypeByAssetType[asset.type] ?? 'image';
        const value = asset.fileUrl ?? '';
        onAdd([{ type, value }]);
        onOpenChange(false);
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
          onOpenChange(false);
        }
      } finally {
        setAddingId(null);
      }
    },
    [onAdd, onOpenChange, primaryTab]
  );

  const selectedAssets = assets.filter(a => selectedIds.has(a.id));
  const allSelectedAreFavorited = selectedIds.size > 0 && selectedAssets.every(a => a.isInCollection === 1);

  const handleBatchAddToCanvas = useCallback(async () => {
    if (!onAdd || selectedIds.size === 0) return;
    const selectedAssets = assets.filter(a => selectedIds.has(a.id));
    const nonSetAssets = selectedAssets.filter(a => a.type !== ASSET_TYPE_CODE.COLLECTION);
    const setAssets = selectedAssets.filter(a => a.type === ASSET_TYPE_CODE.COLLECTION);
    const items: AddToCanvasItem[] = [];

    if (primaryTab === 'public') {
      reportAssetIds({ ids: selectedAssets.map(a => a.id) }).catch(() => void 0);
    }

    nonSetAssets.forEach((a, index) => {
      const type = nodeTypeByAssetType[a.type] ?? 'image';
      items.push({ type, value: a.fileUrl ?? '', index });
    });

    if (setAssets.length > 0) {
      setBatchAdding(true);
      try {
        const res: any = await fetchAssetDetails({
          idList: setAssets.map(a => a.id),
          type: 99,
        });
        const raw = res?.data;
        // 兼容多种返回结构：数组、{ dataList: [] }、{ [id]: detail }、或每项直接为 assetSetDetail 数组
        const list: Array<AssetSetDetailItem[]> = [];
        raw.forEach((item: any) => {
          if (item.data.assetSetDetail) {
            list.push(item.data.assetSetDetail);
          }
        });
        list.forEach((detail, index) => {
          items.push(...assetSetDetailToItems(detail).map(item => ({ ...item, index })));
        });
      } finally {
        setBatchAdding(false);
      }
    }

    if (items.length) {
      onAdd(items);
      onOpenChange(false);
    }
  }, [onAdd, onOpenChange, assets, selectedIds, primaryTab]);

  return (
    <AssetLibraryContext.Provider value={library}>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className='max-w-[90vw] w-[1400px] bg-[#262626] h-[85vh] p-6 overflow-hidden border-white/5 flex flex-col [&>button]:z-50 [&>button]:-m-2 [&>button]:p-2'
          onInteractOutside={e => {
            const target = e.target as Element;
            if (target.closest('[role="menu"]') || target.closest('[data-radix-popper-content-wrapper]')) {
              e.preventDefault();
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>资产库</DialogTitle>
          </DialogHeader>

          <div className='flex-1 overflow-hidden flex flex-col mt-4' onKeyDown={e => e.stopPropagation()}>
            <AssetFilterBar variant='dialog' />

            {activeCollection ? (
              <div className='flex-1 overflow-hidden flex flex-col min-h-0'>
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
                  columns={6}
                />
              </div>
            ) : (
              <>
                {/* Grid (scroll only) */}
                <div className='flex-1 overflow-y-auto no-scrollbar pb-24'>
                  {loading ? (
                    <Skeleton />
                  ) : assets.length > 0 ? (
                    <div className='grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4'>
                      {displayItems.map(item => {
                        if ('isHeader' in item && item.isHeader) {
                          return (
                            <div key={`header-${item.dateKey}`} className='col-span-full pt-3 first:pt-0'>
                              <h2 className='text-base font-bold text-white/90 tracking-wide'>{item.dateKey}</h2>
                            </div>
                          );
                        }
                        const asset = item as AssetItem;
                        const isPublic = primaryTab === 'public';
                        const canDownload = !isPublic && asset.type !== ASSET_TYPE_CODE.COLLECTION;
                        return (
                          <DialogAssetCard
                            key={asset.id}
                            asset={asset}
                            isPublic={isPublic}
                            isBatchMode={isBatchMode}
                            isSelected={selectedIds.has(asset.id)}
                            onToggleSelect={() => {
                              const next = new Set(selectedIds);
                              if (next.has(asset.id)) next.delete(asset.id);
                              else next.add(asset.id);
                              setSelectedIds(next);
                            }}
                            onPreview={() => {
                              setPreviewId(asset.id);
                              setPreviewType(asset.type);
                            }}
                            onAdd={() => handleSingleAdd(asset)}
                            onEnter={asset.type === ASSET_TYPE_CODE.COLLECTION ? () => setActiveCollection(asset) : undefined}
                            isAdding={addingId === asset.id}
                            onFavorite={() => (asset.isInCollection === 1 ? handleSingleUnfavorite(asset) : handleSingleFavorite(asset))}
                            onDownload={canDownload ? () => handleSingleDownload(asset) : undefined}
                          />
                        );
                      })}
                      <LoadMore show={hasMore} loadingMore={loadingMore} sentinelRef={sentinelRef} />
                      <NoMore show={total > 0 && !hasMore} text='没有更多了' />
                    </div>
                  ) : (
                    <div className='py-32 flex flex-col items-center justify-center text-white/20'>
                      <Inbox className='w-12 h-12 mb-4 opacity-10' />
                      <p className='text-lg'>暂无资产内容</p>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Batch Operations Bar */}
          {!activeCollection && isBatchMode && (
            <div className='absolute bottom-12 left-1/2 -translate-x-1/2 bg-[#1A1A1A] border border-white/10 rounded-full px-6 py-3 flex items-center gap-8 shadow-2xl z-40 animate-in fade-in slide-in-from-bottom-4'>
              <label className='flex items-center gap-2 cursor-pointer border-r border-white/10 pr-8 group'>
                <Checkbox
                  checked={selectedIds.size === assets.length && assets.length > 0}
                  onCheckedChange={checked => {
                    if (!checked) setSelectedIds(new Set());
                    else setSelectedIds(new Set(assets.map(a => a.id)));
                  }}
                  className='w-5 h-5 rounded-full border border-white/20 data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-600 transition-all flex items-center justify-center group-hover:border-white/40 outline-none'
                />
                <span className='text-sm font-medium text-white/70'>全选（已选择 {selectedIds.size}）</span>
              </label>
              <div className='flex gap-6'>
                {allSelectedAreFavorited ? (
                  <button onClick={batchRemoveFavorite} className='flex items-center gap-2 text-sm text-white/60 hover:text-white transition-colors'>
                    <StarOff className='w-4 h-4' />
                    取消收藏
                  </button>
                ) : (
                  <button onClick={batchAddFavorite} className='flex items-center gap-2 text-sm text-white/60 hover:text-white transition-colors'>
                    <Star className='w-4 h-4' />
                    收藏
                  </button>
                )}
                {primaryTab === 'my' && secondaryTab !== 'collection' && (
                  <button onClick={batchDownload} className='flex items-center gap-2 text-sm text-white/60 hover:text-white transition-colors'>
                    <Download className='w-4 h-4' />
                    下载
                  </button>
                )}
                <button
                  onClick={handleBatchAddToCanvas}
                  disabled={batchAdding || selectedIds.size === 0}
                  className='flex items-center gap-2 text-sm text-blue-400 hover:text-blue-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
                >
                  {batchAdding ? <Loader2 className='w-4 h-4 animate-spin' /> : <PlusSquare className='w-4 h-4' />}
                  加入画布
                </button>
              </div>
              <button onClick={() => exitBatchMode()} className='hover:bg-white/10 rounded-full p-1 transition-colors'>
                <X className='w-4 h-4 opacity-40' />
              </button>
            </div>
          )}

          {/* Preview Detail */}
          {previewId !== null && previewType !== null && (
            <AssetDetail
              assetId={String(previewId)}
              assetType={previewType}
              allAssets={assets}
              isPublic={primaryTab === 'public'}
              readOnly={true}
              onClose={() => {
                setPreviewId(null);
                setPreviewType(null);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </AssetLibraryContext.Provider>
  );
};
