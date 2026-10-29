import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import type { AssetItem } from '../types';
import { ASSET_TYPE_CODE, type AssetDetailResponse, type AssetSetDetailItem } from '../types';
import { fetchAssetDetail, deleteAsset, deleteAssetSetItem } from '@/api/asset';
import { getModelParams } from '@/api/workflow';
import canvasFlowUtil from '@/components/canvasFlow/utils/util';
import { toast } from 'sonner';
import { downloadFile } from '@/utils';
import { buildDownloadFilename } from '../util';
import { parseSourceParam } from './utils';

const { transformModelMap, buildFieldChoicesFromMap, buildFieldLabelsFromMap } = canvasFlowUtil;

export interface UseAssetDetailStateProps {
  assetId: number | string;
  assetType: number;
  allAssets: AssetItem[];
  isPublic: boolean;
  onClose: () => void;
  readOnly?: boolean;
  onDeleted?: () => void;
}

export function useAssetDetailState({ assetId, assetType, allAssets, isPublic, onClose, readOnly, onDeleted }: UseAssetDetailStateProps) {
  const [zoom, setZoom] = useState(1);
  const [currentId, setCurrentId] = useState<number | string>(assetId);
  const [activePreviewItem, setActivePreviewItem] = useState<AssetItem | AssetSetDetailItem | null>(null);
  const [detailData, setDetailData] = useState<AssetDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(true);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [deletingSetItemId, setDeletingSetItemId] = useState<number | null>(null);
  const [deletedIdsInSession, setDeletedIdsInSession] = useState<Set<number>>(() => new Set());
  const [expandedPromptIndices, setExpandedPromptIndices] = useState<Set<number>>(() => new Set());
  const [fieldChoicesMap, setFieldChoicesMap] = useState<Record<string, { value: any; label: string }[]>>({});
  const [fieldLabelsMap, setFieldLabelsMap] = useState<Record<string, string>>({});
  const containerRef = useRef<HTMLDivElement>(null);
  const fetchIdRef = useRef(0);

  useEffect(() => {
    getModelParams()
      .then((res: any) => {
        if (res?.code === 'SUCCESS' && res?.data?.[0]?.config) {
          const data = JSON.parse(res.data[0].config);
          const modelsMap = transformModelMap(data);
          setFieldChoicesMap(buildFieldChoicesFromMap(modelsMap));
          setFieldLabelsMap(buildFieldLabelsFromMap(modelsMap));
        }
      })
      .catch(() => {});
  }, []);

  const effectiveAssets = useMemo(() => allAssets.filter(a => !deletedIdsInSession.has(Number(a.id))), [allAssets, deletedIdsInSession]);

  const assetIndex = useMemo(() => effectiveAssets.findIndex(a => String(a.id) === String(currentId)), [currentId, effectiveAssets]);
  const mainAsset = effectiveAssets[assetIndex];
  const currentType = mainAsset?.type ?? assetType;

  const navigate = useCallback(
    (dir: 'up' | 'down') => {
      const idx = dir === 'up' ? assetIndex - 1 : assetIndex + 1;
      if (idx >= 0 && idx < effectiveAssets.length) {
        setCurrentId(effectiveAssets[idx].id);
        setZoom(1);
      }
    },
    [assetIndex, effectiveAssets]
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowUp':
        case 'ArrowLeft':
          navigate('up');
          break;
        case 'ArrowDown':
        case 'ArrowRight':
          navigate('down');
          break;
        case 'Escape':
          if (deleteConfirmOpen) setDeleteConfirmOpen(false);
          else onClose();
          break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [navigate, onClose, deleteConfirmOpen]);

  useEffect(() => {
    const id = Number(currentId);
    if (!id || !currentType) {
      setDetailData(null);
      setDetailLoading(false);
      return;
    }
    const fetchId = ++fetchIdRef.current;
    setDetailLoading(true);
    fetchAssetDetail({ id, type: currentType })
      .then((res: any) => {
        if (fetchId !== fetchIdRef.current) return;
        const data = res?.data as AssetDetailResponse | undefined;
        setDetailData(data ?? null);
      })
      .catch(() => {
        if (fetchId === fetchIdRef.current) setDetailData(null);
      })
      .finally(() => {
        if (fetchId === fetchIdRef.current) setDetailLoading(false);
      });
  }, [currentId, currentType]);

  const hasAssetDetail = Boolean(detailData?.assetDetail);
  const hasAssetSetDetail = Boolean(detailData?.assetSetDetail?.length);
  const sourceParam = useMemo(() => {
    const raw = detailData?.assetDetail?.sourceParam;
    return raw ? parseSourceParam(raw) : null;
  }, [detailData?.assetDetail?.sourceParam]);

  useEffect(() => {
    setExpandedPromptIndices(() => new Set());
  }, [currentId]);

  useEffect(() => {
    if (detailLoading) return;
    if (hasAssetSetDetail && detailData?.assetSetDetail) {
      const first = detailData.assetSetDetail[0];
      setActivePreviewItem(first);
    } else if (hasAssetDetail && detailData?.assetDetail) {
      const d = detailData.assetDetail;
      setActivePreviewItem({
        id: d.id,
        type: d.type,
        fileUrl: d.fileUrl,
        createTime: d.createTime ?? '',
      } as AssetItem);
    } else if (mainAsset) {
      setActivePreviewItem(mainAsset);
    }
  }, [detailLoading, hasAssetDetail, hasAssetSetDetail, detailData, mainAsset]);

  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const sensitivity = 0.0015;
      const delta = e.deltaY * -sensitivity;
      setZoom(prev => Math.min(Math.max(prev + delta, 0.4), 5));
    };
    let attachedEl: HTMLDivElement | null = null;
    const tryAttach = () => {
      if (attachedEl) return;
      const el = containerRef.current;
      if (el) {
        el.addEventListener('wheel', handleWheel, { passive: false });
        attachedEl = el;
      }
    };
    tryAttach();
    const t = setTimeout(tryAttach, 50);
    return () => {
      clearTimeout(t);
      if (attachedEl) attachedEl.removeEventListener('wheel', handleWheel);
    };
  }, []);

  const handleDeleteAssetSetItem = useCallback(
    async (item: AssetSetDetailItem) => {
      const assetSetId = Number(currentId);
      if (!assetSetId || Number(currentType) !== ASSET_TYPE_CODE.COLLECTION) return;

      setDeletingSetItemId(item.id);
      try {
        const res: any = await deleteAssetSetItem({
          assetSetId,
          assetIdList: [item.id],
        });
        if (res?.code !== 'SUCCESS') {
          toast.error(res?.message ?? '删除失败');
          return;
        }

        let nextListSnapshot: AssetSetDetailItem[] = [];
        setDetailData(prev => {
          if (!prev?.assetSetDetail) return prev;
          const nextList = prev.assetSetDetail.filter(x => x.id !== item.id);
          nextListSnapshot = nextList;
          return { ...prev, assetSetDetail: nextList };
        });

        setActivePreviewItem(prev => {
          if (!prev) return prev;
          if ((prev as AssetSetDetailItem).id !== item.id) return prev;
          return nextListSnapshot[0] ?? null;
        });

        if (nextListSnapshot.length === 0) {
          const resSet: any = await deleteAsset({ type: 99, idList: [assetSetId] });
          if (resSet?.code === 'SUCCESS') {
            toast.success('已删除最后一个子资产，资产集已删除');
            setDeletedIdsInSession(prev => new Set(prev).add(assetSetId));
            onDeleted?.();
            const hasNext = assetIndex + 1 < effectiveAssets.length;
            const hasPrev = assetIndex - 1 >= 0;
            if (hasNext) {
              setCurrentId(effectiveAssets[assetIndex + 1].id);
              setZoom(1);
            } else if (hasPrev) {
              setCurrentId(effectiveAssets[assetIndex - 1].id);
              setZoom(1);
            } else {
              onClose();
            }
          } else {
            toast.error(resSet?.message ?? '删除资产集失败');
          }
        } else {
          toast.success('删除成功');
        }
      } catch {
        toast.error('删除失败，请重试');
      } finally {
        setDeletingSetItemId(null);
      }
    },
    [currentId, currentType, assetIndex, effectiveAssets, onClose, onDeleted]
  );

  const displayAsset =
    mainAsset ??
    (hasAssetDetail && detailData?.assetDetail
      ? {
          id: detailData.assetDetail.id,
          type: detailData.assetDetail.type,
          name: '',
          createTime: detailData.assetDetail.createTime ?? '',
          label: detailData.assetDetail.label,
        }
      : null);

  const handleDetailDelete = useCallback(async () => {
    const id = Number(currentId);
    if (!id || !currentType) return;
    setDeleteSubmitting(true);
    try {
      const res: any = await deleteAsset({ type: currentType, idList: [id] });
      if (res?.code === 'SUCCESS') {
        toast.success('删除成功');
        setDeleteConfirmOpen(false);
        setDeletedIdsInSession(prev => new Set(prev).add(id));
        onDeleted?.();
        const hasNext = assetIndex + 1 < effectiveAssets.length;
        const hasPrev = assetIndex - 1 >= 0;
        if (hasNext) {
          setCurrentId(effectiveAssets[assetIndex + 1].id);
          setZoom(1);
        } else if (hasPrev) {
          setCurrentId(effectiveAssets[assetIndex - 1].id);
          setZoom(1);
        } else {
          onClose();
        }
      } else {
        toast.error(res?.message ?? '删除失败');
      }
    } catch {
      toast.error('删除失败，请重试');
    } finally {
      setDeleteSubmitting(false);
    }
  }, [currentId, currentType, assetIndex, effectiveAssets, onClose, onDeleted]);

  const handleDetailDownload = useCallback(async () => {
    if (isPublic || readOnly) return;
    if (Number(currentType) === 99) return;

    const url = detailData?.assetDetail?.fileUrl ?? mainAsset?.fileUrl;
    if (!url) {
      toast.warning('缺少下载地址');
      return;
    }

    const id = Number(currentId);
    const filename = buildDownloadFilename(mainAsset?.name ?? `asset-${id}`, url);
    await downloadFile(url, filename);
  }, [isPublic, readOnly, currentType, detailData?.assetDetail?.fileUrl, mainAsset?.fileUrl, mainAsset?.name, currentId]);

  return {
    zoom,
    setZoom,
    currentId,
    currentType,
    activePreviewItem,
    setActivePreviewItem,
    detailData,
    detailLoading,
    hasAssetDetail,
    hasAssetSetDetail,
    sourceParam,
    deleteConfirmOpen,
    setDeleteConfirmOpen,
    deleteSubmitting,
    deletingSetItemId,
    expandedPromptIndices,
    setExpandedPromptIndices,
    fieldChoicesMap,
    fieldLabelsMap,
    containerRef,
    effectiveAssets,
    assetIndex,
    mainAsset,
    displayAsset,
    navigate,
    handleDeleteAssetSetItem,
    handleDetailDelete,
    handleDetailDownload,
    isPublic,
    readOnly,
  };
}
