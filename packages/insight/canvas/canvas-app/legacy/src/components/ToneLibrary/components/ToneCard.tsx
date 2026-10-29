import { useLayoutEffect, useRef, useState, type FC } from 'react';
import { Play, Pause, Star, Trash2 } from 'lucide-react';
import type { ToneListItem } from '../types';
import AudioImage from '@/assets/images/audio.png';

interface ToneCardProps {
  item: ToneListItem;
  isCurrent: boolean;
  isActive: boolean;
  isPublic: boolean;
  isPlaying: boolean;
  onApply: () => void;
  onToggleFavorite: () => void;
  onDelete?: () => void;
  onPlayToggle: () => void;
}

export const ToneCard: FC<ToneCardProps> = ({ item, isCurrent, isActive, isPublic, isPlaying, onApply, onToggleFavorite, onDelete, onPlayToggle }) => {
  const actionsRef = useRef<HTMLDivElement>(null);
  const favoriteSlotRef = useRef<HTMLDivElement>(null);
  const [isHovered, setIsHovered] = useState(false);
  const [favoriteRight, setFavoriteRight] = useState<number>(0);

  const measureFavoriteRight = () => {
    const actionsEl = actionsRef.current;
    const slotEl = favoriteSlotRef.current;
    if (!actionsEl || !slotEl) return;

    const actionsRect = actionsEl.getBoundingClientRect();
    const slotRect = slotEl.getBoundingClientRect();
    setFavoriteRight(Math.max(0, actionsRect.right - slotRect.right));
  };

  useLayoutEffect(() => {
    measureFavoriteRight();
    window.addEventListener('resize', measureFavoriteRight);
    return () => window.removeEventListener('resize', measureFavoriteRight);
  }, []);

  useLayoutEffect(() => {
    // 依赖按钮数量/宽度变化时重新测量（删除/当前使用/更换按钮会影响布局）
    measureFavoriteRight();
  }, [isPublic, isCurrent]);

  return (
    <div
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`group rounded-xl bg-[#2b2b2b] border transition-all p-3 flex items-center gap-3 ${isActive ? 'border-[#4155f0]' : 'border-transparent hover:border-white/25'}`}
    >
      <div className='relative h-11 w-11 rounded-xl shrink-0 overflow-hidden bg-cover bg-center bg-no-repeat' style={{ backgroundImage: `url(${AudioImage})` }}>
        <div className={`absolute inset-0 bg-black/45 flex items-center justify-center transition-opacity ${isPlaying ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
          <button
            className='h-8 w-8 bg-transparent flex items-center justify-center text-white cursor-pointer'
            onClick={e => {
              e.stopPropagation();
              onPlayToggle();
            }}
            aria-label={isPlaying ? '暂停' : '播放'}
          >
            {isPlaying ? <Pause size={16} /> : <Play size={16} />}
          </button>
        </div>
      </div>

      <div className='min-w-0 flex-1'>
        <div className='text-sm font-medium truncate'>{item.name || '未命名音色'}</div>
        {isPublic ? (
          <div className='mt-1 flex gap-2 flex-wrap text-[10px] text-white/75'>
            {item.language && <span className='px-2 py-0.5 rounded-lg bg-white/10'>{item.language}</span>}
            {item.gender && <span className='px-2 py-0.5 rounded-lg bg-white/10'>{item.gender}</span>}
            {item.age && <span className='px-2 py-0.5 rounded-lg bg-white/10'>{item.age}</span>}
            {item.category && <span className='px-2 py-0.5 rounded-lg bg-white/10'>{item.category}</span>}
          </div>
        ) : null}
      </div>

      <div ref={actionsRef} className='relative flex items-center gap-2 shrink-0' onClick={e => e.stopPropagation()}>
        {/* 预留“悬浮时”的收藏按钮槽位，用于计算/占位 */}
        <div ref={favoriteSlotRef} className='h-8 w-8 shrink-0' />
        <button
          className={`absolute top-0 h-8 w-8 rounded-xl flex items-center justify-center ${
            isCurrent ? 'transition-[background-color,opacity,color,box-shadow]' : 'transition-[right,background-color,opacity,color,box-shadow]'
          } duration-200 ease-out bg-white/10 text-white hover:bg-white/30 hover:text-[#4155f0] ${
            item.isFavorite ? 'opacity-100 ring-1 ring-[#4155f0]' : 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto'
          }`}
          style={{ right: !isHovered && item.isFavorite && !isCurrent ? 0 : favoriteRight }}
          onClick={onToggleFavorite}
          title={item.isFavorite ? '取消收藏' : '收藏'}
        >
          <Star className={`w-4 h-4 ${item.isFavorite ? 'fill-[#4155f0] text-[#4155f0]' : ''}`} />
        </button>
        {!isPublic && onDelete ? (
          <button
            className='h-8 w-8 rounded-md bg-white/10 hover:bg-white/15 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center'
            onClick={onDelete}
            title='删除'
          >
            <Trash2 className='w-4 h-4' />
          </button>
        ) : null}

        {isCurrent ? (
          <button className='h-8 px-3 rounded-md bg-[#4155f0] text-xs text-white cursor-not-allowed' disabled>
            当前使用
          </button>
        ) : (
          <button className='h-8 px-3 rounded-md bg-[#4155f0] text-xs text-white opacity-0 group-hover:opacity-100 transition-opacity' onClick={onApply}>
            确定更换
          </button>
        )}
      </div>
    </div>
  );
};
