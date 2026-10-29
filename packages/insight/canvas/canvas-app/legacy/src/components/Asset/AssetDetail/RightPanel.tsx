import React from 'react';
import { Loader2 } from 'lucide-react';
import type { AssetItem, AssetDetailResponse, AssetSetDetailItem, SourceParamParsed } from '../types';
import { RightPanelSourceParams } from './RightPanelSourceParams';
import { RightPanelAssetSetGrid } from './RightPanelAssetSetGrid';
import { isToolSourceParam, resolveToolNodeName } from './toolSourceParamDisplay';

interface RightPanelProps {
  detailLoading: boolean;
  hasAssetSetDetail: boolean;
  sourceParam: SourceParamParsed | null;
  detailData: AssetDetailResponse | null;
  /** 无 assetDetail 时若由列表或其它来源提供画布名，仍展示所属来源 */
  canvasName?: string;
  fieldChoicesMap: Record<string, { value: any; label: string }[]>;
  fieldLabelsMap: Record<string, string>;
  expandedPromptIndices: Set<number>;
  setExpandedPromptIndices: React.Dispatch<React.SetStateAction<Set<number>>>;
  activePreviewItem: AssetItem | AssetSetDetailItem | null;
  setActivePreviewItem: React.Dispatch<React.SetStateAction<AssetItem | AssetSetDetailItem | null>>;
  readOnly?: boolean;
  isPublic: boolean;
  deletingSetItemId: number | null;
  onDeleteAssetSetItem: (item: AssetSetDetailItem) => Promise<void>;
}

export const RightPanel: React.FC<RightPanelProps> = ({
  detailLoading,
  hasAssetSetDetail,
  sourceParam,
  detailData,
  canvasName: canvasNameProp,
  fieldChoicesMap,
  fieldLabelsMap,
  expandedPromptIndices,
  setExpandedPromptIndices,
  activePreviewItem,
  setActivePreviewItem,
  readOnly,
  isPublic,
  deletingSetItemId,
  onDeleteAssetSetItem,
}) => {
  const onTogglePromptExpand = (index: number) => {
    setExpandedPromptIndices(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  if (detailLoading) {
    return (
      <div className='flex-1 flex items-center justify-center text-white/50'>
        <Loader2 className='w-8 h-8 animate-spin' />
      </div>
    );
  }

  const displayCanvasName = detailData?.assetDetail?.canvasName ?? canvasNameProp;
  const isToolSource = isToolSourceParam(sourceParam);
  const shouldShowSourceParams = sourceParam != null || (displayCanvasName != null && displayCanvasName !== '') || isToolSource;
  if (shouldShowSourceParams) {
    return (
      <RightPanelSourceParams
        sourceParam={sourceParam}
        canvasName={displayCanvasName}
        toolNodeKey={isToolSource ? sourceParam?.toolNodeKey : undefined}
        toolNodeName={isToolSource ? resolveToolNodeName(sourceParam) : undefined}
        fieldChoicesMap={fieldChoicesMap}
        fieldLabelsMap={fieldLabelsMap}
        expandedPromptIndices={expandedPromptIndices}
        onTogglePromptExpand={onTogglePromptExpand}
      />
    );
  }

  if (hasAssetSetDetail && detailData?.assetSetDetail) {
    return (
      <RightPanelAssetSetGrid
        list={detailData.assetSetDetail}
        activeItem={activePreviewItem as AssetSetDetailItem | null}
        onSelectItem={setActivePreviewItem}
        readOnly={readOnly}
        isPublic={isPublic}
        deletingSetItemId={deletingSetItemId}
        onDeleteItem={onDeleteAssetSetItem}
      />
    );
  }

  return <div className='flex-1 flex items-center justify-center text-white/50 text-sm'>暂无详情</div>;
};
