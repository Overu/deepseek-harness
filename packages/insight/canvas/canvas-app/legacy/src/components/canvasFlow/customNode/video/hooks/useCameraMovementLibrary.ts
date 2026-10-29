import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { addToCollection, fetchAssetList, getAssetListLabel, removeFromCollection, type AssetListLabelItem } from '@/api/asset';
import { useGlobalToast } from '@/contexts/ToastContext';
import type { CameraMovementItem } from '../cameraMovementTypes';

const CAMERA_MOVEMENT_TYPE = 6;
const PAGE_SIZE = 20;
const LABEL_SCENE = 'video_camera_movement';

export function useCameraMovementLibrary() {
  const { toast } = useGlobalToast();

  const [labels, setLabels] = useState<AssetListLabelItem[]>([]);
  const [selectedLabelId, setSelectedLabelId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [isFavoriteFilter, setIsFavoriteFilter] = useState(false);

  const [assets, setAssets] = useState<CameraMovementItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const fetchIdRef = useRef(0);

  const hasMore = useMemo(() => total > PAGE_SIZE * page, [total, page]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      if (searchQuery.trim()) {
        setIsFavoriteFilter(false);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    const fetchLabels = async () => {
      const res: any = await getAssetListLabel(LABEL_SCENE);
      if (res?.code === 'SUCCESS') {
        setLabels(res.data ?? []);
      }
    };
    fetchLabels();
  }, []);

  const buildListParams = useCallback(
    (pageIndex: number) => ({
      type: CAMERA_MOVEMENT_TYPE,
      pageSize: PAGE_SIZE,
      pageIndex,
      isDesc: 1 as const,
      isPublic: 1 as const,
      ...(selectedLabelId != null && { labelId: selectedLabelId }),
      ...(debouncedSearch && { keyword: debouncedSearch }),
      ...(isFavoriteFilter && { isInCollection: 1 as const }),
    }),
    [selectedLabelId, debouncedSearch, isFavoriteFilter]
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

        if (response?.code !== 'SUCCESS') return;

        const data = response?.data;
        const newList: CameraMovementItem[] = data?.dataList || [];

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
        console.error('Failed to fetch camera movements:', error);
      } finally {
        if (fetchId === fetchIdRef.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [buildListParams, selectedLabelId, debouncedSearch, isFavoriteFilter]
  );

  useEffect(() => {
    fetchData(1, true);
  }, [selectedLabelId, debouncedSearch, isFavoriteFilter, fetchData]);

  const handleSingleFavorite = useCallback(
    async (asset: CameraMovementItem) => {
      try {
        const res: any = await addToCollection({ type: CAMERA_MOVEMENT_TYPE, idList: [asset.id] });
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
    [fetchData, isFavoriteFilter, toast]
  );

  const handleSingleUnfavorite = useCallback(
    async (asset: CameraMovementItem) => {
      try {
        const res: any = await removeFromCollection({ type: CAMERA_MOVEMENT_TYPE, idList: [asset.id] });
        if (res?.code === 'SUCCESS') {
          toast.success('已取消收藏');
          if (!isFavoriteFilter) {
            setAssets(prev => prev.map(a => (a.id === asset.id ? { ...a, isInCollection: 0 } : a)));
          } else {
            fetchData(1, true);
          }
        } else {
          toast.error(res?.message ?? '取消收藏失败');
        }
      } catch {
        toast.error('取消收藏失败，请重试');
      }
    },
    [fetchData, isFavoriteFilter, toast]
  );

  return {
    labels,
    selectedLabelId,
    setSelectedLabelId,
    searchQuery,
    setSearchQuery,
    isFavoriteFilter,
    setIsFavoriteFilter,
    assets,
    loading,
    loadingMore,
    page,
    total,
    hasMore,
    fetchData,
    handleSingleFavorite,
    handleSingleUnfavorite,
  };
}
