import { useCallback, useMemo } from 'react';
import { NavButtons } from '@/components/Asset/AssetDetail/NavButtons';
import AudioPlayer from '@/components/common/fileControl/AudioPlayer';
import { FilePreviewStage, useFilePreviewController, type FilePreviewItem } from '@/components/common/filePreview';
import { MediaThumbnailRail } from '@/components/community/workDetail/MediaThumbnailRail';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

interface InputParamsPreviewProps {
  visible: boolean;
  items: FilePreviewItem[];
  initialIndex?: number;
  videoAutoPlay?: boolean;
  onClose: () => void;
}

export function InputParamsPreview({ visible, items, initialIndex = 0, videoAutoPlay = false, onClose }: InputParamsPreviewProps) {
  const itemsKey = useMemo(() => items.map(item => `${item.id}:${item.url}`).join('|'), [items]);
  const preview = useFilePreviewController({
    items,
    initialIndex,
    resetKey: `${visible}-${itemsKey}`,
    loop: false,
    enabled: visible,
    keyboardDirections: 'horizontal',
  });

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

  return (
    <Dialog open={visible} onOpenChange={open => !open && onClose()}>
      <DialogContent className='h-screen w-screen max-w-[1920px] gap-0 overflow-hidden border-0 bg-[#050505] p-0 text-white'>
        <DialogTitle className='hidden'>媒体预览</DialogTitle>
        <div className='flex h-full w-full min-h-0 flex-col overflow-hidden'>
          <div className='relative flex min-h-0 flex-1 items-center justify-center overflow-hidden'>
            <FilePreviewStage
              item={preview.activeItem}
              videoAutoPlay={videoAutoPlay}
              videoInitialMuted={false}
              onItemReady={preview.markActiveItemReady}
              onItemError={preview.markActiveItemFailed}
              renderAudio={item => (
                <div className='w-[600px] max-w-[calc(100vw-80px)]'>
                  <AudioPlayer url={item.url} height={314} />
                </div>
              )}
            />
            {preview.multiple && <NavButtons onNavigate={navigate} assetIndex={preview.activeIndex} totalCount={items.length} />}
          </div>
          {preview.multiple && (
            <MediaThumbnailRail items={items} activeIndex={preview.activeIndex} onSelect={preview.setActiveIndex} onPrev={preview.goPrevious} onNext={preview.goNext} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
