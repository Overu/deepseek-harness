import React, { useMemo, useState } from 'react';
import { Loader2, Trash2, Download } from 'lucide-react';
import type { AssetSetDetailItem } from '../types';
import { ASSET_TYPE_CODE } from '../types';
import { typeNumberLabelMap, buildDownloadFilename } from '../util';
import { downloadFile } from '@/utils';
import DefaultImage from '@/assets/images/default_flow.png';
import { DeleteConfirmDialog } from './DeleteConfirmDialog';

interface RightPanelAssetSetGridProps {
  list: AssetSetDetailItem[];
  activeItem: AssetSetDetailItem | null;
  onSelectItem: (item: AssetSetDetailItem) => void;
  readOnly?: boolean;
  isPublic: boolean;
  deletingSetItemId: number | null;
  onDeleteItem: (item: AssetSetDetailItem) => void;
}

export const RightPanelAssetSetGrid: React.FC<RightPanelAssetSetGridProps> = ({ list, activeItem, onSelectItem, readOnly, isPublic, deletingSetItemId, onDeleteItem }) => {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [pendingDeleteItem, setPendingDeleteItem] = useState<AssetSetDetailItem | null>(null);

  const submitting = useMemo(() => {
    if (!pendingDeleteItem) return false;
    return deletingSetItemId === pendingDeleteItem.id;
  }, [deletingSetItemId, pendingDeleteItem]);

  if (list.length === 0) {
    return (
      <div className='flex items-center justify-center py-12 text-white/30 text-xs'>
        <span>暂无子资产</span>
      </div>
    );
  }

  return (
    <>
      <div className='grid grid-cols-3 gap-4'>
        {list.map(item => {
          const isActive = activeItem && (activeItem as AssetSetDetailItem).id === item.id;
          return (
            <div
              key={item.id}
              className={`group relative rounded-lg overflow-hidden border bg-white/5 transition-all duration-300 ${
                isActive ? 'ring-2 ring-blue-500 ring-offset-2 ring-offset-[#0A0A0A] scale-95 shadow-xl shadow-blue-500/20' : 'border-white/10'
              }`}
            >
              <div className='absolute top-2 left-2 px-2 py-1 rounded-md text-xs bg-black/45 backdrop-blur-md z-10'>{typeNumberLabelMap[item.type] ?? `类型${item.type}`}</div>
              {item.type !== ASSET_TYPE_CODE.TEXT_SUB && (
                <img src={item.coverUrl || DefaultImage} alt='' className='w-full aspect-square object-cover cursor-pointer' onClick={() => onSelectItem(item)} />
              )}
              {item.type === ASSET_TYPE_CODE.TEXT_SUB && (
                <div className='w-full aspect-square p-3 text-sm text-white/80 whitespace-pre-wrap cursor-pointer overflow-hidden' onClick={() => onSelectItem(item)}>
                  {item.text ?? ''}
                </div>
              )}

              {!readOnly && !isPublic && (
                <div className='absolute bottom-2 right-2 flex items-center gap-2 z-20 opacity-0 group-hover:opacity-100 transition-opacity'>
                  {item.type !== ASSET_TYPE_CODE.TEXT_SUB && item.fileUrl && (
                    <button
                      className='p-2 rounded-md bg-black/50 hover:bg-black/70 text-white/80 hover:text-white transition-colors'
                      title='下载'
                      onClick={async e => {
                        e.stopPropagation();
                        const filename = buildDownloadFilename(`asset-${item.id}`, item.fileUrl!);
                        await downloadFile(item.fileUrl!, filename);
                      }}
                    >
                      <Download className='w-4 h-4' />
                    </button>
                  )}
                  <button
                    className='p-2 rounded-md bg-black/50 hover:bg-black/70 text-white/80 hover:text-white transition-colors'
                    title='删除'
                    disabled={deletingSetItemId === item.id}
                    onClick={e => {
                      e.stopPropagation();
                      setPendingDeleteItem(item);
                      setDeleteDialogOpen(true);
                    }}
                  >
                    {deletingSetItemId === item.id ? <Loader2 className='w-4 h-4 animate-spin' /> : <Trash2 className='w-4 h-4' />}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <DeleteConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={open => {
          if (submitting) return;
          setDeleteDialogOpen(open);
          if (!open) setPendingDeleteItem(null);
        }}
        submitting={submitting}
        onConfirm={async () => {
          if (!pendingDeleteItem) return;
          try {
            await onDeleteItem(pendingDeleteItem);
          } finally {
            setDeleteDialogOpen(false);
            setPendingDeleteItem(null);
          }
        }}
      />
    </>
  );
};
