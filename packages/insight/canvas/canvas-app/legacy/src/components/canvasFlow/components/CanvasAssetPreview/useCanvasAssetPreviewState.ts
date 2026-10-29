import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { getAssetByFileUrl, type AssetByFileUrlDetail } from '@/api/asset';
import { useFlowStore } from '@/store/flowStore';
import { useFieldMapsFromModelsMap } from '@/components/Asset/hooks/useFieldMapsFromModelsMap';
import { parseSourceParam } from '@/components/Asset/AssetDetail/utils';
import type { SourceParamParsed } from '@/components/Asset/types';

export interface UseCanvasAssetPreviewStateProps {
  visible: boolean;
  nodeId: string;
  currentUrl: string;
}

interface DetailRequestState {
  url: string;
  data: AssetByFileUrlDetail | null;
  loading: boolean;
}

export function useCanvasAssetPreviewState({ visible, nodeId, currentUrl }: UseCanvasAssetPreviewStateProps) {
  const canvasId = useFlowStore(s => s.canvasId);
  const modelsMap = useFlowStore(s => s.modelsMap);
  const { fieldChoicesMap, fieldLabelsMap } = useFieldMapsFromModelsMap(modelsMap);

  const [detailRequest, setDetailRequest] = useState<DetailRequestState>({ url: '', data: null, loading: false });
  const [expandedPromptIndices, setExpandedPromptIndices] = useState<Set<number>>(() => new Set());
  const fetchIdRef = useRef(0);
  const detailData = detailRequest.url === currentUrl ? detailRequest.data : null;
  const detailLoading = visible && Boolean(currentUrl) && (detailRequest.url !== currentUrl || detailRequest.loading);

  useEffect(() => {
    if (!visible) return;
    setExpandedPromptIndices(() => new Set());
  }, [currentUrl, visible]);

  useEffect(() => {
    const fetchId = ++fetchIdRef.current;
    if (!visible || !currentUrl || !canvasId || !nodeId) {
      setDetailRequest({ url: currentUrl, data: null, loading: false });
      return;
    }

    setDetailRequest({ url: currentUrl, data: null, loading: true });

    getAssetByFileUrl({ fileUrl: currentUrl })
      .then((res: any) => {
        if (fetchId !== fetchIdRef.current) return;
        if (res?.code === 'SUCCESS' && res?.data) {
          setDetailRequest({ url: currentUrl, data: res.data as AssetByFileUrlDetail, loading: false });
        } else {
          setDetailRequest({ url: currentUrl, data: null, loading: false });
        }
      })
      .catch(() => {
        if (fetchId === fetchIdRef.current) {
          setDetailRequest({ url: currentUrl, data: null, loading: false });
        }
      });
  }, [visible, currentUrl, canvasId, nodeId]);

  const sourceParam: SourceParamParsed | null = useMemo(() => {
    const raw = detailData?.sourceParam;
    return raw ? parseSourceParam(raw) : null;
  }, [detailData?.sourceParam]);

  const onTogglePromptExpand = useCallback((index: number) => {
    setExpandedPromptIndices(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  return {
    detailData,
    detailLoading,
    sourceParam,
    fieldChoicesMap,
    fieldLabelsMap,
    expandedPromptIndices,
    onTogglePromptExpand,
  };
}
