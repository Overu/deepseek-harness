import React, { useCallback, useMemo } from 'react';
import { Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogPortal, DialogTitle } from '@/components/ui/dialog';
import { NavButtons } from '@/components/Asset/AssetDetail/NavButtons';
import { RightPanelSourceParams } from '@/components/Asset/AssetDetail/RightPanelSourceParams';
import { formatCreateTime, isGeneratedAsset, typeNumberLabelMap } from '@/components/Asset/util';
import { isToolSourceParam, resolveToolNodeName } from '@/components/Asset/AssetDetail/toolSourceParamDisplay';
import AudioPlayer from '@/components/common/fileControl/AudioPlayer';
import { useFlowStore } from '@/store/flowStore';
import { isDesktopCanvas } from '@/utils';
import { createFilePreviewItemsFromUrls, FilePreviewStage, resolveFilePreviewType, useFilePreviewController, type FilePreviewItem } from '@/components/common/filePreview';
import { useCanvasAssetPreviewState } from './useCanvasAssetPreviewState';

export interface CanvasAssetPreviewProps {
  visible: boolean;
  onClose: () => void;
  nodeId: string;
  urls: string | string[];
  initialIndex?: number;
}

export const CanvasAssetPreview: React.FC<CanvasAssetPreviewProps> = props => {
  const { visible, onClose, nodeId, urls, initialIndex = 0 } = props;
  const audioNode = useFlowStore(state => state.nodes.some(node => node.id === nodeId && node.type === 'audio'));
  const items = useMemo(() => createFilePreviewItemsFromUrls(urls, audioNode ? (Array.isArray(urls) ? urls : [urls]).map(() => 'audio') : undefined), [urls, audioNode]);
  const itemsKey = useMemo(() => items.map(item => item.id).join('|'), [items]);
  const preview = useFilePreviewController({
    items,
    initialIndex,
    resetKey: `${visible}-${nodeId}-${itemsKey}`,
    loop: false,
    enabled: visible,
    keyboardDirections: 'all',
  });
  const { detailData, detailLoading, sourceParam, fieldChoicesMap, fieldLabelsMap, expandedPromptIndices, onTogglePromptExpand } = useCanvasAssetPreviewState({
    visible,
    nodeId,
    currentUrl: preview.activeItem?.url || '',
  });

  const stageItem = useMemo<FilePreviewItem | undefined>(() => {
    if (!preview.activeItem) return undefined;
    if (!detailData) {
      // 详情返回前延续原有的图片兜底展示，但不把未知地址加入图片预请求队列，
      // 避免将无扩展名的视频等大文件误当图片下载。
      return preview.activeItem.type === 'unknown' ? { ...preview.activeItem, type: 'image' } : preview.activeItem;
    }

    // Desktop playback must retain the saved node URL authorized by the Host.
    const audio = preview.activeItem.type === 'audio' || detailData.assetType === 3;
    const fileUrl = isDesktopCanvas() && audio ? preview.activeItem.url : detailData.fileUrl || preview.activeItem.url;
    return {
      ...preview.activeItem,
      type: audio ? 'audio' : resolveFilePreviewType(fileUrl, detailData.assetType),
      url: fileUrl,
      thumbnailUrl: detailData.thumbnailUrl || preview.activeItem.thumbnailUrl,
      name: detailData.assetName || preview.activeItem.name,
      text: detailData.text || preview.activeItem.text,
    };
  }, [detailData, preview.activeItem]);

  const navigate = useCallback(
    (direction: 'up' | 'down') => {
      if (direction === 'up') {
        preview.goPrevious();
      } else {
        preview.goNext();
      }
    },
    [preview.goNext, preview.goPrevious]
  );

  if (!visible) return null;

  const hasSourceParam = sourceParam != null;
  const isToolSource = isToolSourceParam(sourceParam);

  return (
    <Dialog open={visible} onOpenChange={open => !open && onClose()}>
      <DialogPortal>
        <DialogContent className='w-screen h-screen max-w-[1920px] p-0'>
          <DialogTitle className='hidden' />
          <div className='w-full h-full flex overflow-hidden bg-black mobile:flex-col'>
            <div className='flex-1 relative flex flex-col bg-[#050505] overflow-hidden'>
              <div className='flex-1 flex items-center justify-center relative overflow-hidden'>
                <FilePreviewStage
                  item={stageItem}
                  videoAutoPlay={false}
                  videoInitialMuted={false}
                  onItemReady={preview.markActiveItemReady}
                  onItemError={preview.markActiveItemFailed}
                  renderAudio={item => (
                    <div className='w-[600px]'>
                      <AudioPlayer url={item.url} height={314} />
                    </div>
                  )}
                />
              </div>
              {items.length > 1 && <NavButtons onNavigate={navigate} assetIndex={preview.activeIndex} totalCount={items.length} />}
            </div>

            <div className='w-[640px] border-l border-white/10 bg-[#0A0A0A] max-w-[33%] flex flex-col overflow-hidden p-8 mobile:max-w-full mobile:w-full mobile:h-2/5 mobile:p-4'>
              <div className='flex flex-wrap items-center gap-2 text-sm text-white/65 mb-8'>
                <span>{typeNumberLabelMap[Number(detailData?.type)] ?? detailData?.type}</span>
                {detailData && (
                  <>
                    <span>|</span>
                    <span>{isGeneratedAsset(detailData) ? '生成资产' : '上传资产'}</span>
                  </>
                )}
                {detailData?.createTime && (
                  <>
                    <span>|</span>
                    <span>{formatCreateTime(detailData.createTime)}</span>
                  </>
                )}
              </div>

              <div className='flex-1 overflow-y-auto p-2 mobile:p-0 scrollbar-hide'>
                {detailLoading ? (
                  <div className='flex-1 flex items-center justify-center text-white/50 min-h-[200px]'>
                    <Loader2 className='w-8 h-8 animate-spin' />
                  </div>
                ) : hasSourceParam || isToolSource ? (
                  <RightPanelSourceParams
                    sourceParam={sourceParam}
                    showCanvasSource={false}
                    canvasName={detailData?.canvasName}
                    toolNodeKey={isToolSource ? sourceParam?.toolNodeKey : undefined}
                    toolNodeName={isToolSource ? resolveToolNodeName(sourceParam) : undefined}
                    fieldChoicesMap={fieldChoicesMap}
                    fieldLabelsMap={fieldLabelsMap}
                    expandedPromptIndices={expandedPromptIndices}
                    onTogglePromptExpand={onTogglePromptExpand}
                  />
                ) : (
                  <div className='flex items-center justify-center text-white/50 text-sm min-h-[200px]'>暂无详情</div>
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
};

export default CanvasAssetPreview;
