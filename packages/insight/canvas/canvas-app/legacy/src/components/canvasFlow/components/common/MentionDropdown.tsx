import { useState, useEffect, useImperativeHandle, forwardRef, useRef, useMemo } from 'react';
import type { MentionItem } from '@/lib/mentionPlugin';
import { getMentionAvatarSrc } from '@/lib/utils';

interface Props {
  suggestions: MentionItem[];
  onSelect: (mention: MentionItem) => void;
  onClose: () => void;
  anchor: { top: number; left: number };
}

export interface MentionDropdownHandle {
  onKeyDown: (e: KeyboardEvent) => boolean;
}

const MentionDropdown = forwardRef<MentionDropdownHandle, Props>(({ suggestions, onSelect, onClose, anchor }, ref) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selectedIndexRef = useRef(0);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const displaySuggestions = useMemo(() => {
    const videos = suggestions.filter(u => u.mediaKind === 'video');
    const audios = suggestions.filter(u => u.mediaKind === 'audio');
    const images = suggestions.filter(u => (u.mediaKind ?? 'image') === 'image');
    return [...images, ...videos, ...audios];
  }, [suggestions]);
  const displaySuggestionKey = displaySuggestions.map(item => item.id).join('\u0000');

  useEffect(() => {
    selectedIndexRef.current = 0;
    setSelectedIndex(0);
  }, [displaySuggestionKey]);

  useEffect(() => {
    const activeItem = scrollContainerRef.current?.children[selectedIndex] as HTMLElement;
    if (activeItem) {
      activeItem.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  useImperativeHandle(
    ref,
    () => ({
      onKeyDown: (e: KeyboardEvent) => {
        if (displaySuggestions.length === 0) {
          if (e.key === 'Escape' || e.key === 'Backspace') {
            // Allow closing or naturally deleting trigger even if list is empty
            return false;
          }
          return false;
        }

        if (e.key === 'ArrowDown') {
          setSelectedIndex(prev => (prev + 1) % displaySuggestions.length);
          return true;
        }
        if (e.key === 'ArrowUp') {
          setSelectedIndex(prev => (prev - 1 + displaySuggestions.length) % displaySuggestions.length);
          return true;
        }
        if (e.key === 'Enter') {
          if (displaySuggestions[selectedIndex]) {
            onSelect(displaySuggestions[selectedIndex]);
            return true;
          }
        }
        if (e.key === 'Escape') {
          onClose();
          return true;
        }
        return false;
      },
    }),
    [displaySuggestions, selectedIndex, onSelect, onClose]
  );

  return (
    <div
      className='absolute z-50 bg-[#262626] border border-white/25 rounded-lg shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-100'
      style={{ top: anchor.top, left: anchor.left }}
      onMouseDown={e => {
        // 阻止编辑器失焦，避免 blur 触发文档重解析导致 mention range 失效
        e.preventDefault();
      }}
    >
      {displaySuggestions.length === 0 ? (
        <div className='w-20 h-8 flex items-center justify-center text-gray-400 text-sm'>无</div>
      ) : (
        <div ref={scrollContainerRef} className='max-h-32 overflow-y-auto scroll-smooth nowheel p-1'>
          {displaySuggestions.map((mention, idx) => (
            <div
              key={mention.id}
              onMouseMove={() => {
                selectedIndexRef.current = idx;
                setSelectedIndex(idx);
              }}
              onClick={() => onSelect(mention)}
              className={`flex items-center w-20 h-8 p-1 gap-1 rounded-lg cursor-pointer transition-all hover:bg-white/10 ${idx === selectedIndex && 'bg-white/10'}`}
            >
              <div className='w-6 h-6 rounded-md overflow-hidden bg-black/30 shrink-0'>
                {mention.avatar ? (
                  <img src={getMentionAvatarSrc(mention.avatar, mention.mediaKind)} alt='' loading='lazy' decoding='async' className='w-full h-full object-cover rounded-md' />
                ) : (
                  <div className='w-full h-full rounded-md bg-white/10' />
                )}
              </div>
              <div className='text-xs flex-1 overflow-hidden whitespace-nowrap text-ellipsis'>{mention.name}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

export default MentionDropdown;
