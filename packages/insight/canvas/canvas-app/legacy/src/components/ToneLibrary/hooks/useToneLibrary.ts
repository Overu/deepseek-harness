import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchFavoritePublicToneList,
  fetchFavoriteUserToneList,
  fetchPublicToneList,
  fetchToneCategoryTree,
  fetchUserTonePage,
  toggleToneFavorite,
  type ToneCategoryTreeItem,
} from '@/api/tone';
import { useGlobalToast } from '@/contexts/ToastContext';
import { buildFilterConfigsFromTree, getPagePayload, normalizePublicItem, normalizeUserItem, type ToneFilterKey, type ToneLibraryFilters, type ToneListItem, type TonePrimaryTab } from '../types';

const PAGE_SIZE = 18;

export const useToneLibrary = () => {
  const { toast } = useGlobalToast();
  const [tab, setTab] = useState<TonePrimaryTab>('public');
  const [filters, setFilters] = useState<ToneLibraryFilters>({});
  const [keyword, setKeyword] = useState('');
  const [debouncedKeyword, setDebouncedKeyword] = useState('');
  const [filterTree, setFilterTree] = useState<ToneCategoryTreeItem[]>([]);
  const [isFavoriteFilter, setIsFavoriteFilter] = useState(false);

  const [list, setList] = useState<ToneListItem[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const hasMore = useMemo(() => total > page * PAGE_SIZE, [total, page]);
  const fetchIdRef = useRef(0);

  const filterConfigs = useMemo(() => buildFilterConfigsFromTree(filterTree), [filterTree]);

  const fetchTree = useCallback(async () => {
    const res: any = await fetchToneCategoryTree();
    if (res?.code === 'SUCCESS') {
      setFilterTree(res.data || []);
    }
  }, []);

  useEffect(() => {
    fetchTree();
  }, [fetchTree]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedKeyword(keyword.trim());
    }, 400);
    return () => clearTimeout(timer);
  }, [keyword]);

  const fetchData = useCallback(
    async (pageIndex: number, reset = false) => {
      const fetchId = ++fetchIdRef.current;
      if (reset) setLoading(true);
      else setLoadingMore(true);

      try {
        let response: any;
        if (tab === 'public') {
          const payload = {
            page: pageIndex,
            size: PAGE_SIZE,
            onSale: 1,
            language: filters.language,
            gender: filters.gender,
            age: filters.age,
            category: filters.category,
            name: debouncedKeyword || undefined,
          };
          response = isFavoriteFilter ? await fetchFavoritePublicToneList(payload) : await fetchPublicToneList(payload);
        } else {
          const payload = {
            page: pageIndex,
            size: PAGE_SIZE,
            name: debouncedKeyword || undefined,
          };
          response = isFavoriteFilter ? await fetchFavoriteUserToneList(payload) : await fetchUserTonePage(payload);
        }

        if (fetchId !== fetchIdRef.current) return;

        if (response?.code !== 'SUCCESS') {
          toast.error(response?.message || '音色列表加载失败');
          return;
        }

        const pagePayload = getPagePayload(response?.data);
        const mappedList = pagePayload.list.map((item: any) => (tab === 'public' ? normalizePublicItem(item) : normalizeUserItem(item)));

        if (reset) {
          setList(mappedList);
          setPage(1);
        } else {
          setList(prev => [...prev, ...mappedList]);
          setPage(pageIndex);
        }
        setTotal(pagePayload.total);
      } catch (error) {
        if (fetchId !== fetchIdRef.current) return;
        console.error(error);
        toast.error('音色列表加载失败，请稍后重试');
      } finally {
        if (fetchId === fetchIdRef.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [tab, filters.language, filters.gender, filters.age, filters.category, debouncedKeyword, isFavoriteFilter]
  );

  useEffect(() => {
    fetchData(1, true);
  }, [fetchData]);

  const refreshMyList = useCallback(() => {
    if (tab === 'my') {
      fetchData(1, true);
    }
  }, [tab, fetchData]);

  const changeTab = useCallback(
    (nextTab: TonePrimaryTab) => {
      if (nextTab === tab) return;
      setTab(nextTab);
      setPage(1);
      setTotal(0);
      setList([]);
      if (nextTab === 'my') {
        setFilters({});
      }
    },
    [tab]
  );

  const updateFilter = useCallback((key: ToneFilterKey, value: string) => {
    setFilters(prev => ({
      ...prev,
      [key]: value === 'all' ? undefined : value,
    }));
  }, []);

  const toggleFavoriteStatus = useCallback(
    async (item: ToneListItem) => {
      const res: any = await toggleToneFavorite({
        pkId: item.id,
        type: item.voiceType,
        isFavorite: !item.isFavorite,
      });
      if (res?.code !== 'SUCCESS') {
        toast.error(res?.message || '收藏状态更新失败');
        return false;
      }
      const nextFavorite = !item.isFavorite;
      if (isFavoriteFilter && !nextFavorite) {
        setList(prev => prev.filter(voice => voice.voiceId !== item.voiceId));
        setTotal(prev => Math.max(0, prev - 1));
        return true;
      }

      setList(prev => prev.map(voice => (voice.voiceId === item.voiceId ? { ...voice, isFavorite: nextFavorite } : voice)));
      return true;
    },
    [toast, isFavoriteFilter]
  );

  return {
    tab,
    list,
    loading,
    loadingMore,
    page,
    total,
    hasMore,
    keyword,
    filters,
    isFavoriteFilter,
    filterConfigs,
    changeTab,
    setKeyword,
    setIsFavoriteFilter,
    updateFilter,
    fetchData,
    refreshMyList,
    toggleFavoriteStatus,
  };
};
