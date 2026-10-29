import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuPortal } from '@/components/ui/dropdown-menu';
import { Checkbox } from '@/components/ui/checkbox';
import { Search, ChevronDown, Inbox, Check } from 'lucide-react';
import Skeleton from '@/components/workFlow/common/Skeleton';
import LoadMore from '@/components/common/scrollGrid/LoadMore';
import NoMore from '@/components/common/scrollGrid/NoMore';
import MediaPreview from '@/components/common/MediaPreview';
import { useScroll } from '@/hooks/useScroll';
import { CameraMovementCard } from './components/CameraMovementCard';
import { useCameraMovementLibrary } from './hooks/useCameraMovementLibrary';

interface CameraMovementLibraryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentText?: string;
  onSelect: (payload: { name: string; text: string }) => void;
}

export const CameraMovementLibraryDialog: React.FC<CameraMovementLibraryDialogProps> = ({ open, onOpenChange, currentText, onSelect }) => {
  const library = useCameraMovementLibrary();
  const {
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
  } = library;

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const { sentinelRef } = useScroll({
    callback: () => fetchData(page + 1),
    hasMore,
    isLoading: loadingMore,
  });

  const selectedLabelName = selectedLabelId == null ? '全部' : (labels.find(l => l.id === selectedLabelId)?.value ?? '全部');

  const handleAdd = (item: { name: string; text: string }) => {
    onSelect(item);
    onOpenChange(false);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className='max-w-[90vw] w-[1400px] bg-[#262626] h-[85vh] p-6 overflow-hidden border-white/5 flex flex-col [&>button]:z-50 [&>button]:-m-2 [&>button]:p-2'
          onInteractOutside={e => {
            const target = e.target as Element;
            if (target.closest('[role="menu"]') || target.closest('[data-radix-popper-content-wrapper]')) {
              e.preventDefault();
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>专业运镜</DialogTitle>
          </DialogHeader>

          <div className='flex-1 overflow-hidden flex flex-col mt-4' onKeyDown={e => e.stopPropagation()}>
            <div className='flex items-center justify-between mb-4 shrink-0'>
              <div className='flex items-center gap-4'>
                <div className='flex items-center gap-2'>
                  <span className='text-sm text-white/60'>类型：</span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <div className='flex items-center justify-between gap-2 px-3 h-9 rounded-md cursor-pointer min-w-[100px] outline-none hover:bg-white/10 data-[state=open]:bg-white/10 transition-colors'>
                        <span className='text-sm'>{selectedLabelName}</span>
                        <ChevronDown className='w-4 h-4 opacity-40' />
                      </div>
                    </DropdownMenuTrigger>
                    <DropdownMenuPortal>
                      <DropdownMenuContent className='w-48 bg-[#1A1A1A] border border-white/10 rounded-lg shadow-2xl z-[50] p-1 animate-in fade-in zoom-in-95' align='start'>
                        <DropdownMenuItem
                          onSelect={() => setSelectedLabelId(null)}
                          className='px-3 py-2 hover:bg-white/5 outline-none rounded-md text-sm cursor-pointer flex items-center justify-between data-[highlighted]:bg-white/5'
                        >
                          <span className={selectedLabelId == null ? 'text-[#4155F0]' : ''}>全部</span>
                          {selectedLabelId == null && <Check className='w-3.5 h-3.5 text-[#4155F0]' />}
                        </DropdownMenuItem>
                        {labels.map(label => (
                          <DropdownMenuItem
                            key={label.id}
                            onSelect={() => setSelectedLabelId(label.id)}
                            className='px-3 py-2 hover:bg-white/5 outline-none rounded-md text-sm cursor-pointer flex items-center justify-between data-[highlighted]:bg-white/5'
                          >
                            <span className={selectedLabelId === label.id ? 'text-[#4155F0]' : ''}>{label.value}</span>
                            {selectedLabelId === label.id && <Check className='w-3.5 h-3.5 text-[#4155F0]' />}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenuPortal>
                  </DropdownMenu>
                </div>

                <div className='w-[1px] h-5 bg-white/25' />

                <label className='flex items-center gap-2 cursor-pointer text-sm text-white/65 hover:text-white/95 transition-colors'>
                  <Checkbox
                    checked={isFavoriteFilter}
                    onCheckedChange={checked => setIsFavoriteFilter(checked === true)}
                    className='w-4 h-4 rounded-full border border-white/20 data-[state=checked]:bg-[#4155F0] data-[state=checked]:border-[#4155F0]'
                  />
                  我的收藏
                </label>
              </div>

              <div className='relative w-72 shrink-0'>
                <Search className='absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40 pointer-events-none z-10' />
                <input
                  type='text'
                  placeholder='搜索运镜'
                  className='w-full bg-[#1A1A1A] border border-white/10 rounded-lg py-2 pl-10 pr-4 text-sm outline-none text-white/95 transition-colors hover:border-white/25 focus:border-white/25 focus:ring-0'
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                />
              </div>
            </div>

            <div className='flex-1 overflow-y-auto no-scrollbar pb-6'>
              {loading ? (
                <Skeleton />
              ) : assets.length > 0 ? (
                <div className='grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4'>
                  {assets.map(asset => (
                    <CameraMovementCard
                      key={asset.id}
                      item={asset}
                      isSelected={Boolean(currentText && asset.text === currentText)}
                      onPreview={() => setPreviewUrl(asset.fileUrl)}
                      onAdd={() => handleAdd({ name: asset.name, text: asset.text })}
                      onFavorite={() => (asset.isInCollection === 1 ? handleSingleUnfavorite(asset) : handleSingleFavorite(asset))}
                    />
                  ))}
                  <LoadMore show={hasMore} loadingMore={loadingMore} sentinelRef={sentinelRef} />
                  <NoMore show={total > 0 && !hasMore} text='没有更多了' />
                </div>
              ) : (
                <div className='py-32 flex flex-col items-center justify-center text-white/20'>
                  <Inbox className='w-12 h-12 mb-4 opacity-10' />
                  <p className='text-lg'>暂无运镜内容</p>
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {previewUrl && <MediaPreview visible={Boolean(previewUrl)} url={[previewUrl]} type={['video']} onClose={() => setPreviewUrl(null)} autoPlay />}
    </>
  );
};
