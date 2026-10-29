import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogTitle, DialogPortal } from '@/components/ui/dialog';
import { Search, Eye, Loader2, Upload } from 'lucide-react';
import { addToAssetCollection, createAssetCollection, fetchAssetList, type AssetCollectionParams, type AssetItem as ApiAssetSetItem, type FetchAssetListParams } from '@/api/asset';
import useFileUpload from '@/hooks/useFileUpload';
import fileUtil from '@/utils/file';
import UploadPreview from '@/components/common/fileControl/UploadPreview';
import { useScroll } from '@/hooks/useScroll';
import LoadMore from '@/components/common/scrollGrid/LoadMore';
import NoMore from '@/components/common/scrollGrid/NoMore';
import type { AssetItem, AssetTypeCode } from './types';
import { ASSET_TYPE_CODE } from './types';
import { typeNumberMap } from './util';
import { AssetDetail } from './AssetDetail';
import DefaultImage from '@/assets/images/default_flow.png';
import setting from '@/components/canvasFlow/settings/setting';
import { toast } from 'sonner';
import { compressImage } from '@/utils';

const { convertToHtmlAccept } = fileUtil;
const COLLECTION_PAGE_SIZE = 20;

type SelectionAsset = {
  type: string | number;
  url?: string;
  text?: string;
};

interface AssetCollectionModalProps {
  onClose: () => void;
  assets: SelectionAsset[];
  canvasId: string;
}

export const AssetCollectionModal: React.FC<AssetCollectionModalProps> = ({ assets, canvasId, onClose }) => {
  const [activeTab, setActiveTab] = useState<'create' | 'add'>('create');
  const [previewDetailVisible, setPreviewDetailVisible] = useState(false);
  const [previewAssetId, setPreviewAssetId] = useState<number | string | null>(null);
  const [previewAssetType, setPreviewAssetType] = useState<AssetTypeCode>(99);
  const [previewAllAssets, setPreviewAllAssets] = useState<AssetItem[]>([]);
  const [collectionList, setCollectionList] = useState<AssetItem[]>([]);
  const [collectionLoading, setCollectionLoading] = useState(false);
  const [collectionLoadingMore, setCollectionLoadingMore] = useState(false);
  const [collectionPage, setCollectionPage] = useState(1);
  const [collectionTotal, setCollectionTotal] = useState(0);
  const [collectionSearch, setCollectionSearch] = useState('');
  const [debouncedCollectionSearch, setDebouncedCollectionSearch] = useState('');
  const fetchIdRef = useRef(0);

  const hasMoreCollections = useMemo(() => collectionTotal > COLLECTION_PAGE_SIZE * collectionPage, [collectionTotal, collectionPage]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedCollectionSearch(collectionSearch);
    }, 500);
    return () => clearTimeout(timer);
  }, [collectionSearch]);

  const fetchCollectionData = useCallback(
    async (pageIndex: number, reset = false) => {
      const fetchId = ++fetchIdRef.current;
      if (reset) {
        setCollectionLoading(true);
      } else {
        setCollectionLoadingMore(true);
      }
      try {
        const params: FetchAssetListParams = {
          type: typeNumberMap.collection,
          pageSize: COLLECTION_PAGE_SIZE,
          pageIndex,
          isPublic: 0,
          isDesc: 1,
          ...(debouncedCollectionSearch && { keyword: debouncedCollectionSearch }),
        };
        const response = (await fetchAssetList(params)) as { data?: { dataList?: AssetItem[]; total?: number } };
        if (fetchId !== fetchIdRef.current) return;
        const data = response?.data;
        const newList = data?.dataList ?? [];
        if (reset) {
          setCollectionList(newList);
          setCollectionPage(1);
        } else {
          setCollectionList(prev => [...prev, ...newList]);
          setCollectionPage(pageIndex);
        }
        setCollectionTotal(data?.total ?? 0);
      } catch {
        if (fetchId === fetchIdRef.current) {
          setCollectionList(prev => (reset ? [] : prev));
        }
      } finally {
        if (fetchId === fetchIdRef.current) {
          setCollectionLoading(false);
          setCollectionLoadingMore(false);
        }
      }
    },
    [debouncedCollectionSearch]
  );

  const { sentinelRef } = useScroll({
    callback: () => fetchCollectionData(collectionPage + 1),
    hasMore: hasMoreCollections,
    isLoading: collectionLoadingMore,
    enabled: activeTab === 'add',
  });

  useEffect(() => {
    if (activeTab === 'add') {
      fetchCollectionData(1, true);
    }
  }, [activeTab, debouncedCollectionSearch, fetchCollectionData]);

  const [collectionName, setCollectionName] = useState('');
  const [selectedExistingId, setSelectedExistingId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const assetSetItemList = useMemo<ApiAssetSetItem[]>(() => {
    const { getImageNodeType, getVideoNodeType } = setting;

    const list: ApiAssetSetItem[] = [];
    for (const raw of assets ?? []) {
      const url = typeof raw?.url === 'string' ? raw.url.trim() : '';
      const text = typeof raw?.text === 'string' ? raw.text.trim() : '';
      const rawType = raw?.type;
      const nodeType = typeof rawType === 'string' ? rawType : '';

      if (text) {
        list.push({ type: 5, text });
        continue;
      }

      if (url) {
        const isAudio = nodeType === 'audio';
        const isVideo = nodeType ? getVideoNodeType.includes(nodeType) : false;
        const isImage = nodeType ? getImageNodeType.includes(nodeType) : true;
        list.push({ type: isAudio ? 3 : isVideo ? 2 : isImage ? 1 : 1, url });
      }
    }

    return list;
  }, [assets]);

  const autoCover = useMemo(() => {
    // audio 也要写入 assetSetItemList，但 audio 的 url 不能作为封面
    const firstWithUrl = assetSetItemList.find(
      item => (item.type === ASSET_TYPE_CODE.IMAGE || item.type === ASSET_TYPE_CODE.VIDEO) && typeof item.url === 'string' && item.url.trim()
    );
    if (firstWithUrl?.url) {
      return {
        kind: firstWithUrl.type === ASSET_TYPE_CODE.VIDEO ? ('video' as const) : ('image' as const),
        url: firstWithUrl.url,
      };
    }
    return { kind: 'default' as const, url: DefaultImage };
  }, [assetSetItemList]);

  const [coverState, setCoverState] = useState<{ source: 'auto'; kind: 'image' | 'video' | 'default'; url: string } | { source: 'upload'; kind: 'image'; url: string }>(() => ({
    source: 'auto',
    ...autoCover,
  }));

  useEffect(() => {
    setCoverState(prev => (prev.source === 'upload' ? prev : { source: 'auto', ...autoCover }));
  }, [autoCover.kind, autoCover.url]);

  const handleUploadSuccess = (url: string) => {
    setCoverState({ source: 'upload', kind: 'image', url });
  };
  const handleDelete = () => {
    handleHookDelete();
    setCoverState({ source: 'auto', ...autoCover });
  };

  const handleCreate = async () => {
    if (submitting) return;

    const name = collectionName.trim();
    if (activeTab === 'create' && !name) {
      toast.warning('请输入资产集名称');
      return;
    }
    if (activeTab === 'add' && selectedExistingId == null) {
      toast.warning('请选择一个现有资产集');
      return;
    }
    if (!canvasId) {
      toast.error('缺少画布 ID，无法创建资产集');
      return;
    }

    const coverUrl = coverState.source === 'auto' && coverState.kind === 'default' ? undefined : coverState.url;

    const baseParams: AssetCollectionParams = {
      canvasId,
      coverUrl,
      assetSetItemList,
    };

    setSubmitting(true);
    try {
      if (activeTab === 'create') {
        await createAssetCollection({ ...baseParams, setName: name });
        toast.success('创建成功');
      } else {
        await addToAssetCollection({ ...baseParams, assetSetId: selectedExistingId! });
        toast.success('添加成功');
      }
      onClose();
    } catch {
      toast.error(activeTab === 'create' ? '创建失败，请重试' : '添加失败，请重试');
    } finally {
      setSubmitting(false);
    }
  };

  const handlePreviewCollection = (id: number | string, assetType: AssetTypeCode, allAssets: AssetItem[]) => {
    setPreviewAssetId(id);
    setPreviewAssetType(assetType);
    setPreviewAllAssets(allAssets);
    setPreviewDetailVisible(true);
  };

  const handleClosePreview = () => {
    setPreviewDetailVisible(false);
    setPreviewAssetId(null);
    setPreviewAllAssets([]);
  };

  const {
    mediaFile,
    fileInputRef,
    acceptConfig,
    handleInputChange,
    triggerFileInput,
    handleDelete: handleHookDelete,
    handleRetry,
  } = useFileUpload({ type: 'image', onUploadSuccess: handleUploadSuccess });

  return (
    <>
      <Dialog open={true} onOpenChange={open => !open && onClose()}>
        <DialogPortal>
          <DialogContent onKeyDown={e => e.stopPropagation()} className='max-w-[730px] bg-[#1C1C1E] rounded-2xl border border-white/10 DialogContent focus:outline-none'>
            <div className='flex items-center justify-between pb-6'>
              <DialogTitle className='text-lg font-semibold'>创建资产集</DialogTitle>
            </div>

            <Tabs value={activeTab} onValueChange={v => setActiveTab(v as any)}>
              <TabsList className='flex py-4 gap-2'>
                <TabsTrigger
                  value='create'
                  className='flex-1 py-2.5 rounded-lg text-sm font-medium transition-all data-[state=active]:bg-white/10 data-[state=active]:text-white data-[state=active]:shadow-lg text-white/40 hover:text-white/60'
                >
                  创建资产集
                </TabsTrigger>
                <TabsTrigger
                  value='add'
                  className='flex-1 py-2.5 rounded-lg text-sm font-medium transition-all data-[state=active]:bg-white/10 data-[state=active]:text-white data-[state=active]:shadow-lg text-white/40 hover:text-white/60'
                >
                  添加到现有资产集
                </TabsTrigger>
              </TabsList>

              <div className='pt-4'>
                <TabsContent value='create'>
                  <div className='flex gap-8 animate-in fade-in slide-in-from-left-4'>
                    <div className='w-[400px] aspect-square bg-[#2A2A2E] rounded-2xl overflow-hidden relative group border-2 border-blue-500/50'>
                      {mediaFile ? (
                        <div className='h-full w-full'>
                          <UploadPreview mediaFile={mediaFile} onDelete={handleDelete} onRetry={handleRetry} />
                        </div>
                      ) : coverState.kind === 'video' ? (
                        <video
                          src={coverState.url}
                          className='w-full h-full object-cover opacity-80 rounded-2xl'
                          muted
                          playsInline
                          preload='metadata'
                          onLoadedMetadata={e => {
                            // 尽量展示首帧（不自动播放）
                            try {
                              e.currentTarget.currentTime = 0.01;
                            } catch {
                              // ignore
                            }
                          }}
                          onSeeked={e => e.currentTarget.pause()}
                        />
                      ) : (
                        <img src={coverState.url} className='w-full h-full object-cover opacity-80 rounded-2xl' alt='Cover Preview' />
                      )}
                      <div
                        className='absolute bottom-2 right-2 flex items-center justify-center bg-black/45 backdrop-blur-md py-2 px-3 rounded-lg cursor-pointer gap-1'
                        onClick={triggerFileInput}
                      >
                        <Upload size={16}></Upload>
                        <div>替换封面</div>
                      </div>
                      <input ref={fileInputRef} type='file' accept={convertToHtmlAccept(acceptConfig.accept)} onChange={handleInputChange} className='hidden' />
                    </div>

                    <div className='flex-1 space-y-4'>
                      <div className='space-y-2'>
                        <label className='text-sm text-white/60 flex items-center gap-1'>
                          <span className='text-red-500'>*</span> 名称
                        </label>
                        <input
                          type='text'
                          placeholder='请输入'
                          className='w-[246px] bg-[#2C2C2E] border-none rounded-lg py-3 px-4 text-sm focus:ring-1 focus:ring-blue-500 outline-none transition-shadow'
                          value={collectionName}
                          onChange={e => setCollectionName(e.target.value)}
                          autoFocus
                        />
                      </div>
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value='add'>
                  <div className='space-y-4 animate-in fade-in slide-in-from-right-4'>
                    <div className='relative mb-4'>
                      <Search className='absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40' />
                      <input
                        type='text'
                        placeholder='搜索现有资产集...'
                        className='w-full bg-[#2C2C2E] border-none rounded-lg py-2 pl-10 pr-4 text-sm outline-none focus:ring-1 focus:ring-blue-500 transition-shadow'
                        value={collectionSearch}
                        onChange={e => setCollectionSearch(e.target.value)}
                      />
                    </div>

                    {/* 增加 p-2 以防止选中边框被滚动区域边缘遮挡 */}
                    {collectionLoading ? (
                      <div className='flex justify-center items-center min-h-[280px]'>
                        <Loader2 className='h-8 w-8 animate-spin text-white/20' />
                      </div>
                    ) : (
                      <div className='grid grid-cols-3 gap-6 max-h-[400px] overflow-y-auto scrollbar-hide p-2'>
                        {collectionList.map(coll => (
                          <div
                            key={coll.id}
                            onClick={() => setSelectedExistingId(coll.id)}
                            className={`relative aspect-square rounded-xl cursor-pointer group transition-all duration-300 hover:opacity-80 ${selectedExistingId === coll.id ? 'ring-2 ring-white ring-offset-2 ring-offset-[#1C1C1E]' : ''}`}
                          >
                            <div className='w-full h-full rounded-xl overflow-hidden relative'>
                              <img src={compressImage(coll.coverUrl) || DefaultImage} className='w-full h-full object-cover' alt={coll.name ?? ''} />
                              <div className='absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent flex flex-col justify-end p-3'>
                                <span className='text-xs font-medium truncate'>{coll.name}</span>
                              </div>
                            </div>
                            <button
                              onClick={e => {
                                e.stopPropagation();
                                handlePreviewCollection(coll.id, 99, collectionList);
                              }}
                              className='absolute bottom-2 right-2 p-1.5 bg-black/40 backdrop-blur-md rounded-lg opacity-0 group-hover:opacity-100 transition-opacity z-10'
                            >
                              <Eye className='w-3.5 h-3.5' />
                            </button>
                          </div>
                        ))}
                        <LoadMore show={hasMoreCollections} loadingMore={collectionLoadingMore} sentinelRef={sentinelRef} />
                        <NoMore show={collectionTotal > 0 && !hasMoreCollections} text='没有更多资产集了' />
                      </div>
                    )}
                  </div>
                </TabsContent>
              </div>
            </Tabs>

            <div className='pt-6 flex justify-end gap-3'>
              <button
                disabled={submitting || (activeTab === 'create' ? !collectionName.trim() : selectedExistingId == null)}
                className='px-8 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-30 disabled:cursor-not-allowed rounded-lg text-sm font-semibold transition-all hover:shadow-lg active:scale-95'
                onClick={handleCreate}
              >
                {submitting ? (
                  <span className='inline-flex items-center gap-2'>
                    <Loader2 className='h-4 w-4 animate-spin' />
                    提交中
                  </span>
                ) : (
                  '确定'
                )}
              </button>
            </div>
          </DialogContent>
        </DialogPortal>
      </Dialog>
      {previewDetailVisible && previewAssetId != null && (
        <AssetDetail assetId={previewAssetId} assetType={previewAssetType} allAssets={previewAllAssets} isPublic={false} onClose={handleClosePreview} />
      )}
    </>
  );
};
