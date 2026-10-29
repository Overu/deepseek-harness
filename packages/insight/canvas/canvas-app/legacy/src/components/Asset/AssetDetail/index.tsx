import React, { useRef } from 'react';
import { ChevronLeft } from 'lucide-react';
import { Dialog, DialogContent, DialogPortal, DialogTitle } from '@/components/ui/dialog';
import { Operation } from './Operation';
import { typeNumberLabelMap, formatCreateTime, isGeneratedAsset } from '../util';
import { useAssetDetailState } from './useAssetDetailState';
import { PreviewContent } from './PreviewContent';
import { NavButtons } from './NavButtons';
import { RightPanel } from './RightPanel';
import { DeleteConfirmDialog } from './DeleteConfirmDialog';
import type { AssetItem, AssetTypeCode } from '../types';
import { ResponsiveView } from '@/components/common/ResponsiveView';
import { useBreakpoint } from '@/hooks/useBreakpoint';

export interface AssetDetailProps {
  assetId: number | string;
  assetType: AssetTypeCode;
  allAssets: AssetItem[];
  isPublic: boolean;
  onClose: () => void;
  readOnly?: boolean;
  onDeleted?: () => void;
}

export const AssetDetail: React.FC<AssetDetailProps> = props => {
  const previewViewportRef = useRef<HTMLDivElement>(null);
  const state = useAssetDetailState(props);
  const {
    zoom,
    setZoom,
    currentType,
    activePreviewItem,
    detailData,
    detailLoading,
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
    setActivePreviewItem,
  } = state;

  const isMobile = useBreakpoint(768);

  if (!detailLoading && !detailData && !mainAsset) return null;

  const operation = (
    <Operation
      onZoomOut={() => setZoom(value => Math.max(value - 0.2, 0.4))}
      onZoomIn={() => setZoom(value => Math.min(value + 0.2, 5))}
      onReset={() => setZoom(1)}
      isPublic={isPublic}
      readOnly={readOnly}
      assetType={Number(currentType)}
      onDownload={handleDetailDownload}
      onDelete={() => setDeleteConfirmOpen(true)}
    />
  );

  return (
    <Dialog open={true} onOpenChange={open => !open && props.onClose()}>
      <DialogPortal>
        <DialogContent className='w-screen h-screen max-w-[1920px] p-0' showCloseButton={!isMobile}>
          <DialogTitle className='hidden' />
          <div className='w-full h-full flex overflow-hidden bg-black mobile:flex-col'>
            <div className='flex-1 min-h-0 min-w-0 relative flex flex-col bg-[#050505] overflow-hidden mobile:basis-1/2' ref={containerRef}>
              <div className='hidden mobile:flex h-12 shrink-0 items-center justify-center border-b border-white/5 bg-black px-4 text-white'>
                <button
                  type='button'
                  onClick={props.onClose}
                  className='absolute left-4 flex h-8 w-8 items-center justify-center rounded-md text-white/90 transition-colors hover:bg-white/10 hover:text-white focus:outline-none focus:ring-1 focus:ring-white/40 disabled:opacity-50'
                  aria-label='返回'
                >
                  <ChevronLeft size={20} />
                </button>
                <div className='text-sm font-medium text-white'>作品详情</div>
              </div>
              <ResponsiveView
                mobileWrapper={() => null}
                pcWrapper={children => <div className='h-20 flex items-center justify-center gap-8 border-b border-white/5 z-10 px-8'>{children}</div>}
              >
                {operation}
              </ResponsiveView>
              <div ref={previewViewportRef} className='flex-1 min-h-0 min-w-0 relative overflow-hidden'>
                <div
                  className='absolute inset-8 mobile:inset-0 min-h-0 min-w-0 transition-transform duration-200 ease-out flex items-center justify-center will-change-transform origin-center'
                  style={{ transform: `scale(${zoom})` }}
                >
                  {activePreviewItem && <PreviewContent item={activePreviewItem} zoom={zoom} panViewportRef={previewViewportRef} />}
                </div>
              </div>
              <ResponsiveView
                mobileWrapper={children => (
                  <div className='hidden mobile:flex h-10 shrink-0 items-center border-t border-white/10 bg-black text-white'>
                    <NavButtons onNavigate={navigate} assetIndex={assetIndex} totalCount={effectiveAssets.length} variant='horizontal'>
                      {children}
                    </NavButtons>
                  </div>
                )}
                pcWrapper={() => <NavButtons onNavigate={navigate} assetIndex={assetIndex} totalCount={effectiveAssets.length} />}
              >
                {operation}
              </ResponsiveView>
            </div>

            <div className='w-1/3 min-w-72 border-l border-white/10 bg-[#0A0A0A] flex flex-col overflow-hidden p-8 mobile:w-full mobile:flex-1 mobile:basis-1/2 mobile:border-l-0 mobile:border-t mobile:p-4'>
              <div className='mb-8 mobile:mb-4'>
                {(Number(currentType) === 99 || isMobile) && <h1 className='text-xl font-bold mb-2'>{displayAsset?.name ?? '未命名'}</h1>}
                <div className='flex flex-wrap items-center gap-2 text-sm text-white/65'>
                  <span>{isPublic ? '公共资产' : '我的资产'}</span>
                  <span>|</span>
                  <span>{typeNumberLabelMap[Number(displayAsset?.type)] ?? displayAsset?.type}</span>
                  {!isPublic ? (
                    <>
                      <span>|</span>
                      <span>{isGeneratedAsset(displayAsset) ? '生成资产' : '上传资产'}</span>
                    </>
                  ) : null}
                  {displayAsset?.createTime && (
                    <>
                      <span>|</span>
                      <span>{formatCreateTime(displayAsset.createTime)}</span>
                    </>
                  )}
                </div>
              </div>

              <div className='flex-1 overflow-y-auto p-2 mobile:p-0 scrollbar-hide'>
                <RightPanel
                  detailLoading={detailLoading}
                  hasAssetSetDetail={hasAssetSetDetail}
                  sourceParam={sourceParam}
                  detailData={detailData}
                  canvasName={mainAsset && 'canvasName' in mainAsset ? (mainAsset as { canvasName?: string }).canvasName : undefined}
                  fieldChoicesMap={fieldChoicesMap}
                  fieldLabelsMap={fieldLabelsMap}
                  expandedPromptIndices={expandedPromptIndices}
                  setExpandedPromptIndices={setExpandedPromptIndices}
                  activePreviewItem={activePreviewItem}
                  setActivePreviewItem={setActivePreviewItem}
                  readOnly={readOnly}
                  isPublic={isPublic}
                  deletingSetItemId={deletingSetItemId}
                  onDeleteAssetSetItem={handleDeleteAssetSetItem}
                />
              </div>
            </div>
          </div>

          <DeleteConfirmDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen} submitting={deleteSubmitting} onConfirm={handleDetailDelete} />
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
};
