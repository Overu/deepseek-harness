import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { format } from 'date-fns';
import type { DateRange } from 'react-day-picker';
import { downloadFile } from '@/utils';
import { addToCollection, deleteAsset, fetchAssetList, getLabelTree, removeFromCollection, type FetchAssetListParams } from '@/api/asset';
import type { AssetItem, AssetType, AudioContentCategory, FilterTreeNode, SortOrder, SourceFilter, ViewMode, TimelineFlatItem } from '../types';
import { ASSET_SOURCE } from '../types';
import { buildDownloadFilename, flattenAssetsByDate, typeMap, typeNumberMap } from '../util';
import { useGlobalToast } from '@/contexts/ToastContext';

const DEFAULT_PAGE_SIZE = 20;

export interface UseAssetLibraryOptions {
  pageSize?: number;
  initialPrimaryTab?: 'public' | 'my';
  initialSecondaryTab?: AssetType;
  /** 外部触发刷新（如详情删除后） */
  refreshTrigger?: number;
  canvasId?: string | number;
  hideCanvasFilter?: boolean;
  initialViewMode?: ViewMode;
}

export function useAssetLibrary(options: UseAssetLibraryOptions = {}) {
  const {
    pageSize = DEFAULT_PAGE_SIZE,
    initialPrimaryTab = 'my',
    initialSecondaryTab = 'image',
    refreshTrigger,
    canvasId,
    hideCanvasFilter = false,
    initialViewMode = 'timeline',
  } = options;
  const { toast } = useGlobalToast();

  const [primaryTab, setPrimaryTab] = useState<'public' | 'my'>(initialPrimaryTab);
  const [secondaryTab, setSecondaryTab] = useState<AssetType>(initialSecondaryTab);

  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [contentCategoryFilter, setContentCategoryFilter] = useState<AudioContentCategory>('all');
  const [isCurrentCanvasFilter, setIsCurrentCanvasFilter] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>(initialViewMode);

  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  const [isBatchMode, setIsBatchMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [isFavoriteFilter, setIsFavoriteFilter] = useState(false);
  const [cascadeSelections, setCascadeSelections] = useState<(number | null)[]>([]);
  const [date, setDate] = useState<DateRange | undefined>(undefined);
  const [filterTree, setFilterTree] = useState<FilterTreeNode[]>([]);

  const [assets, setAssets] = useState<AssetItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const fetchIdRef = useRef(0);

  const hasMore = useMemo(() => total > pageSize * page, [total, pageSize, page]);

  const selectedLabelId = useMemo(() => {
    if (cascadeSelections.length === 0) return undefined;
    return cascadeSelections[cascadeSelections.length - 1] ?? undefined;
  }, [cascadeSelections]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      if (searchQuery.trim()) {
        setDate(undefined);
        setCascadeSelections([]);
        setIsFavoriteFilter(false);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    const fetchLabelTree = async () => {
      const res: any = await getLabelTree();
      if (res?.code === 'SUCCESS') setFilterTree(res.data ?? []);
    };
    fetchLabelTree();
  }, []);

  const tabNode = useMemo(() => {
    const tabLabel = typeMap[secondaryTab];
    return filterTree.find(n => n.label === tabLabel);
  }, [secondaryTab, filterTree]);

  const cascadeFilters = useMemo(() => {
    if (!tabNode) return [];
    const result: { type: string; options: FilterTreeNode[]; level: number }[] = [];
    let currentNode: FilterTreeNode | undefined = tabNode;
    let level = 0;
    while (currentNode?.type && currentNode?.children?.length) {
      result.push({ type: currentNode.type, options: currentNode.children, level });
      const selectedId = cascadeSelections[level];
      if (selectedId == null) break;
      currentNode = currentNode.children.find(c => c.id === selectedId);
      level++;
    }
    return result;
  }, [tabNode, cascadeSelections]);

  const handleCascadeSelect = useCallback((level: number, nodeId: number | null) => {
    setCascadeSelections(prev => {
      const next = prev.slice(0, level);
      if (nodeId != null) next.push(nodeId);
      return next;
    });
  }, []);

  const exitBatchMode = useCallback(() => {
    setIsBatchMode(false);
    setSelectedIds(new Set());
  }, []);

  const handlePrimaryTabChange = useCallback((tab: 'public' | 'my') => {
    setPrimaryTab(tab);
    setCascadeSelections([]);
    setSelectedIds(new Set());
    setIsBatchMode(false);
    setSourceFilter('all');
    setContentCategoryFilter('all');
    setIsCurrentCanvasFilter(false);
  }, []);

  const handleSecondaryTabChange = useCallback((tab: AssetType) => {
    setSecondaryTab(tab);
    setCascadeSelections([]);
    setSelectedIds(new Set());
    setIsBatchMode(false);
  }, []);

  const handleSourceFilterChange = useCallback((source: SourceFilter) => {
    setSourceFilter(source);
    if (source !== ASSET_SOURCE.AIGC) {
      setContentCategoryFilter('all');
    }
  }, []);

  const typeNum = useMemo(() => typeNumberMap[secondaryTab], [secondaryTab]);

  const buildListParams = useCallback(
    (pageIndex: number): FetchAssetListParams => {
      const isMy = primaryTab === 'my';
      const isCollection = secondaryTab === 'collection';
      const isAudio = secondaryTab === 'audio';

      const sourceParam = isMy && !isCollection && sourceFilter !== 'all' ? sourceFilter : undefined;
      const contentCategoryParam = isMy && isAudio && sourceFilter === ASSET_SOURCE.AIGC && contentCategoryFilter !== 'all' ? contentCategoryFilter : undefined;
      const resolvedCanvasId = isMy && !isCollection && isCurrentCanvasFilter && canvasId ? canvasId : undefined;

      return {
        type: typeNumberMap[secondaryTab],
        pageSize,
        pageIndex,
        isDesc: sortOrder === 'desc' ? 1 : 0,
        isPublic: primaryTab === 'public' ? 1 : 0,
        ...(selectedLabelId != null && { labelId: selectedLabelId }),
        ...(debouncedSearch && { keyword: debouncedSearch }),
        ...(isFavoriteFilter && { isInCollection: 1 as const }),
        ...(date?.from && { fromTime: `${format(date.from, 'yyyy-MM-dd')} 00:00:00` }),
        ...(date?.to && { toTime: `${format(date.to, 'yyyy-MM-dd')} 23:59:59` }),
        ...(sourceParam && { source: sourceParam }),
        ...(contentCategoryParam && { contentCategory: contentCategoryParam }),
        ...(resolvedCanvasId && { canvasId: resolvedCanvasId }),
      };
    },
    [primaryTab, secondaryTab, debouncedSearch, sortOrder, isFavoriteFilter, selectedLabelId, date, pageSize, sourceFilter, contentCategoryFilter, isCurrentCanvasFilter, canvasId]
  );

  /** 静默拉取某一页，不触发 loading/骨架屏，用于收藏视图取消收藏后补最后一页 */
  const fetchPageSilent = useCallback(
    async (pageIndex: number): Promise<AssetItem[]> => {
      const params = buildListParams(pageIndex);
      const response: any = await fetchAssetList(params);
      const data = response?.data;
      return data?.dataList || [];
    },
    [buildListParams]
  );

  const fetchData = useCallback(
    async (pageIndex: number, reset = false) => {
      const fetchId = ++fetchIdRef.current;

      if (reset) setLoading(true);
      else setLoadingMore(true);

      try {
        const params = buildListParams(pageIndex);
        const response: any = await fetchAssetList(params);
        if (fetchId !== fetchIdRef.current) return;

        const data = response?.data;
        const newList: AssetItem[] = data?.dataList || [];

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
    [buildListParams]
  );

  useEffect(() => {
    fetchData(1, true);
  }, [fetchData]);

  useEffect(() => {
    if (typeof refreshTrigger === 'number' && refreshTrigger > 0) {
      fetchData(1, true);
    }
  }, [refreshTrigger, fetchData]);

  const resetFilters = useCallback(() => {
    setSearchQuery('');
    setCascadeSelections([]);
    setIsFavoriteFilter(false);
    setDate(undefined);
    setSourceFilter('all');
    setContentCategoryFilter('all');
    setIsCurrentCanvasFilter(false);
  }, []);

  const isTimelineView = viewMode === 'timeline' && secondaryTab !== 'collection';
  const displayItems = useMemo<TimelineFlatItem[]>(() => {
    if (isTimelineView) {
      return flattenAssetsByDate(assets);
    }
    return assets;
  }, [isTimelineView, assets]);

  const downloadAsset = useCallback(async (asset: Pick<AssetItem, 'fileUrl' | 'name'>) => {
    if (!asset.fileUrl) {
      toast.warning('缺少下载地址');
      return;
    }
    const filename = buildDownloadFilename(asset.name, asset.fileUrl);
    await downloadFile(asset.fileUrl, filename);
  }, []);

  const batchAddFavorite = useCallback(async () => {
    if (selectedIds.size === 0) {
      toast.warning('请先选择要收藏的资产');
      return;
    }
    try {
      const res: any = await addToCollection({ type: typeNum, idList: Array.from(selectedIds) });
      if (res?.code === 'SUCCESS') {
        toast.success('收藏成功');
        exitBatchMode();
        if (!isFavoriteFilter) {
          setAssets(prev => prev.map(a => (selectedIds.has(a.id) ? { ...a, isInCollection: 1 } : a)));
        } else {
          fetchData(1, true);
        }
      } else {
        toast.error(res?.message ?? '收藏失败');
      }
    } catch {
      toast.error('收藏失败，请重试');
    }
  }, [selectedIds, typeNum, exitBatchMode, fetchData, isFavoriteFilter]);

  const batchRemoveFavorite = useCallback(async () => {
    if (selectedIds.size === 0) {
      toast.warning('请先选择要取消收藏的资产');
      return;
    }
    try {
      const res: any = await removeFromCollection({ type: typeNum, idList: Array.from(selectedIds) });
      if (res?.code === 'SUCCESS') {
        toast.success('已取消收藏');
        exitBatchMode();
        fetchData(1, true);
      } else {
        toast.error(res?.message ?? '取消收藏失败');
      }
    } catch {
      toast.error('取消收藏失败，请重试');
    }
  }, [selectedIds, typeNum, exitBatchMode, fetchData]);

  const batchDelete = useCallback(async () => {
    if (selectedIds.size === 0) {
      toast.warning('请先选择要删除的资产');
      return;
    }
    try {
      const res: any = await deleteAsset({ type: typeNum, idList: Array.from(selectedIds) });
      if (res?.code === 'SUCCESS') {
        toast.success('删除成功');
        exitBatchMode();
        fetchData(1, true);
      } else {
        toast.error(res?.message ?? '删除失败');
      }
    } catch {
      toast.error('删除失败，请重试');
    }
  }, [selectedIds, typeNum, exitBatchMode, fetchData]);

  const batchDownload = useCallback(async () => {
    if (secondaryTab === 'collection') {
      toast.warning('资产集暂不支持批量下载');
      return;
    }
    if (selectedIds.size === 0) {
      toast.warning('请先选择要下载的资产');
      return;
    }
    const toDownload = assets.filter(a => selectedIds.has(a.id));
    toast.info(`正在下载 ${toDownload.length} 个文件`);
    for (const asset of toDownload) {
      await downloadAsset(asset);
    }
    toast.success('下载已触发');
  }, [secondaryTab, selectedIds, assets, downloadAsset]);

  const handleSingleFavorite = useCallback(
    async (asset: AssetItem) => {
      try {
        const res: any = await addToCollection({ type: asset.type, idList: [asset.id] });
        if (res?.code === 'SUCCESS') {
          toast.success('收藏成功');
          if (!isFavoriteFilter) {
            setAssets(prev => prev.map(a => (a.id === asset.id ? { ...a, isInCollection: 1 } : a)));
          } else {
            fetchData(1, true);
          }
        } else {
          toast.error(res?.message ?? '收藏失败');
        }
      } catch {
        toast.error('收藏失败，请重试');
      }
    },
    [fetchData, isFavoriteFilter]
  );

  const handleSingleUnfavorite = useCallback(
    async (asset: AssetItem) => {
      try {
        const res: any = await removeFromCollection({ type: asset.type, idList: [asset.id] });
        if (res?.code !== 'SUCCESS') {
          toast.error(res?.message ?? '取消收藏失败');
          return;
        }
        toast.success('已取消收藏');

        if (!isFavoriteFilter) {
          setAssets(prev => prev.map(a => (a.id === asset.id ? { ...a, isInCollection: 0 } : a)));
          return;
        }

        // 收藏视图：前端移除该项，并重新拉取当前已加载的最后一页以替换本地该页数据，避免继续加载下一页时遗漏资产；不整页刷新、不出现骨架屏
        const currentPage = page;
        const currentTotal = total;
        const newTotal = currentTotal - 1;

        setAssets(prev => prev.filter(a => a.id !== asset.id));
        setTotal(newTotal);

        if (newTotal <= 0) {
          setPage(1);
          return;
        }

        // 拉取当前已加载的最后一页（第1页或第2页等），用接口返回替换本地该页，保证与后端一致、后续加载下一页时不会漏数据
        fetchPageSilent(currentPage).then(list => {
          setAssets(prev => {
            const baseLen = (currentPage - 1) * pageSize;
            const base = prev.slice(0, baseLen);
            return base.concat(list);
          });
        });
      } catch {
        toast.error('取消收藏失败，请重试');
      }
    },
    [isFavoriteFilter, page, total, pageSize, fetchPageSilent]
  );

  const handleSingleDelete = useCallback(
    async (asset: AssetItem) => {
      try {
        const res: any = await deleteAsset({ type: asset.type, idList: [asset.id] });
        if (res?.code === 'SUCCESS') {
          toast.success('删除成功');
          fetchData(1, true);
        } else {
          toast.error(res?.message ?? '删除失败');
        }
      } catch {
        toast.error('删除失败，请重试');
      }
    },
    [fetchData]
  );

  const handleSingleDownload = useCallback(
    async (asset: AssetItem) => {
      await downloadAsset(asset);
    },
    [downloadAsset]
  );

  return {
    // filters / tabs
    primaryTab,
    secondaryTab,
    searchQuery,
    sortOrder,
    isFavoriteFilter,
    cascadeSelections,
    date,
    filterTree,
    cascadeFilters,
    sourceFilter,
    contentCategoryFilter,
    isCurrentCanvasFilter,
    viewMode,
    canvasId,
    hideCanvasFilter,

    // data
    assets,
    displayItems,
    isTimelineView,
    loading,
    loadingMore,
    page,
    total,
    hasMore,

    // selection / batch
    isBatchMode,
    selectedIds,

    // setters
    setSearchQuery,
    setSortOrder,
    setIsFavoriteFilter,
    setCascadeSelections,
    setDate,
    setIsBatchMode,
    setSelectedIds,
    setSourceFilter,
    handleSourceFilterChange,
    setContentCategoryFilter,
    setIsCurrentCanvasFilter,
    setViewMode,

    // actions
    handlePrimaryTabChange,
    handleSecondaryTabChange,
    handleCascadeSelect,
    fetchData,
    resetFilters,
    exitBatchMode,

    batchAddFavorite,
    batchRemoveFavorite,
    batchDelete,
    batchDownload,

    handleSingleFavorite,
    handleSingleUnfavorite,
    handleSingleDelete,
    handleSingleDownload,
  };
}
