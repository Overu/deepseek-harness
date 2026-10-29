import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search, Bell, Pause, Play, ChevronDown, Check } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuPortal, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Checkbox } from '@/components/ui/checkbox';
import LoadMore from '@/components/common/scrollGrid/LoadMore';
import NoMore from '@/components/common/scrollGrid/NoMore';
import { useScroll } from '@/hooks/useScroll';
import ToneUpload from '@/components/canvasFlow/components/uploadControl/ToneUpload';
import { fetchToneDetailByVoiceId, removeTone } from '@/api/tone';
import { useGlobalToast } from '@/contexts/ToastContext';
import { ToneCard } from './components/ToneCard';
import { ToneCardSkeletonGrid } from './components/ToneCardSkeleton';
import { useToneLibrary } from './hooks/useToneLibrary';
import { mapToneDetailToItem, type ToneLibraryModalProps, type ToneListItem } from './types';
import AudioImage from '@/assets/images/audio.png';

const ToneLibraryModal: React.FC<ToneLibraryModalProps> = ({ open, onOpenChange, voiceId, onSelect, allowCustomTone = true }) => {
  const { toast } = useGlobalToast();
  const {
    tab,
    list,
    loading,
    loadingMore,
    page,
    total,
    hasMore,
    keyword,
    filters,
    filterConfigs,
    isFavoriteFilter,
    changeTab,
    setKeyword,
    setIsFavoriteFilter,
    updateFilter,
    fetchData,
    refreshMyList,
    toggleFavoriteStatus,
  } = useToneLibrary();

  const [detailTone, setDetailTone] = useState<ToneListItem | null>(null);
  const [currentVoiceId, setCurrentVoiceId] = useState<string>(voiceId || '');
  const [activeVoiceId, setActiveVoiceId] = useState<string>(voiceId || '');
  const [playingVoiceId, setPlayingVoiceId] = useState<string>('');
  const [uploadVisible, setUploadVisible] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const { sentinelRef } = useScroll({
    callback: () => fetchData(page + 1),
    hasMore,
    isLoading: loadingMore,
    enabled: open,
  });

  const initialDetailLoadedRef = useRef(false);
  useEffect(() => {
    if (!open) {
      initialDetailLoadedRef.current = false;
      return;
    }
    if (!voiceId || initialDetailLoadedRef.current) return;

    const fetchDetail = async () => {
      const res: any = await fetchToneDetailByVoiceId({ voiceId });
      if (res?.code !== 'SUCCESS') return;
      const mapped = mapToneDetailToItem(res.data);
      if (mapped) {
        changeTab(mapped.voiceType === 'PUBLIC_VOICE' ? 'public' : 'my');
        setDetailTone(mapped);
        setCurrentVoiceId(mapped.voiceId);
        setActiveVoiceId(mapped.voiceId);
      }
    };
    fetchDetail();
    initialDetailLoadedRef.current = true;
  }, [open, voiceId]);

  useEffect(() => {
    if (!open) return;
    setCurrentVoiceId(voiceId || '');
    setActiveVoiceId(voiceId || '');
  }, [voiceId, open]);

  useEffect(() => {
    if (!open) {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      setPlayingVoiceId('');
    }
  }, [open]);

  const activeDetail = useMemo(() => {
    if (detailTone) return detailTone;
    const byCurrent = list.find(item => item.voiceId === currentVoiceId);
    if (byCurrent) return byCurrent;
    return null;
  }, [detailTone, list, currentVoiceId]);

  const handleApply = (item: ToneListItem) => {
    setCurrentVoiceId(item.voiceId);
    setDetailTone(item);
    setActiveVoiceId(item.voiceId);
    onSelect?.(item);
    onOpenChange(false);
  };

  const handlePlayToggle = async (item: ToneListItem) => {
    const audioUrl = item.demoUrl;
    if (!audioUrl) {
      toast.warning('该音色暂无试听音频');
      return;
    }

    if (playingVoiceId === item.voiceId) {
      audioRef.current?.pause();
      setPlayingVoiceId('');
      return;
    }

    if (!audioRef.current) {
      audioRef.current = new Audio();
    }
    try {
      audioRef.current.pause();
      audioRef.current.src = audioUrl;
      await audioRef.current.play();
      setPlayingVoiceId(item.voiceId);
      audioRef.current.onended = () => {
        setPlayingVoiceId('');
      };
    } catch (error) {
      console.error(error);
      toast.error('播放失败，请稍后重试');
    }
  };

  const handleDeleteTone = async (item: ToneListItem) => {
    const deleteId = item.id;
    console.log(voiceId, deleteId);
    if (!deleteId) {
      toast.error('删除失败');
      return;
    }

    try {
      const res: any = await removeTone({ ids: [deleteId] });
      if (res?.code !== 'SUCCESS') {
        toast.error(res?.message || '删除失败，请稍后重试');
        return;
      }

      toast.success('删除成功');

      if (playingVoiceId === item.voiceId) {
        audioRef.current?.pause();
        setPlayingVoiceId('');
      }
      if (currentVoiceId === item.voiceId) {
        setCurrentVoiceId('');
        setDetailTone(null);
        setActiveVoiceId('');
      }

      refreshMyList();
    } catch (error) {
      console.error(error);
      toast.error('删除失败，请稍后重试');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-[1200px] h-[78vh] bg-[#1f1f1f] border-white/10 text-white p-0 overflow-hidden flex flex-col' onKeyDown={(e: any) => e.stopPropagation()}>
        <DialogHeader className='px-6 pt-6 pb-3 border-b border-white/10'>
          <DialogTitle>音色库</DialogTitle>
        </DialogHeader>

        <div className='shrink-0'>
          <div className='px-6 pt-4 pb-0'>
            <div className='flex gap-6 mb-4 shrink-0 items-center'>
              <button
                type='button'
                onClick={() => changeTab('public')}
                className={`text-base font-medium transition-colors ${tab === 'public' ? 'text-white/95' : 'text-white/65 hover:text-white/95'}`}
              >
                公共音色
              </button>
              <button
                type='button'
                onClick={() => changeTab('my')}
                className={`text-base font-medium transition-colors ${tab === 'my' ? 'text-white/95' : 'text-white/65 hover:text-white/95'}`}
              >
                我的音色
              </button>
            </div>
          </div>

          <div className='px-6 pb-3 flex items-center justify-between gap-3 text-sm'>
            <div className='flex items-center gap-3 min-h-9 overflow-x-auto no-scrollbar pr-2'>
              {tab === 'public'
                ? filterConfigs.map(filter => (
                    <div key={filter.key} className='flex items-center gap-2 shrink-0'>
                      <span className='text-sm text-white/60'>{filter.label}:</span>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <div className='flex items-center justify-between gap-2 px-3 h-9 rounded-md cursor-pointer min-w-[120px] outline-none hover:bg-white/10 data-[state=open]:bg-white/10 transition-colors'>
                            <span className='text-sm'>{filters[filter.key] ? (filter.options.find(o => o.value === filters[filter.key])?.label ?? '全部') : '全部'}</span>
                            <ChevronDown className='w-4 h-4 opacity-40' />
                          </div>
                        </DropdownMenuTrigger>
                        <DropdownMenuPortal>
                          <DropdownMenuContent className='w-48 bg-[#1A1A1A] border border-white/10 rounded-lg shadow-2xl z-[50] p-1 animate-in fade-in zoom-in-95' align='start'>
                            <DropdownMenuItem
                              onSelect={() => updateFilter(filter.key, 'all')}
                              className='px-3 py-2 hover:bg-white/5 outline-none rounded-md text-sm cursor-pointer flex items-center justify-between data-[highlighted]:bg-white/5'
                            >
                              <span className={filters[filter.key] ? '' : 'text-blue-400'}>全部</span>
                              {!filters[filter.key] && <Check className='w-3.5 h-3.5 text-blue-400' />}
                            </DropdownMenuItem>
                            {filter.options.map(option => {
                              const selected = filters[filter.key] === option.value;
                              return (
                                <DropdownMenuItem
                                  key={option.value}
                                  onSelect={() => updateFilter(filter.key, option.value)}
                                  className='px-3 py-2 hover:bg-white/5 outline-none rounded-md text-sm cursor-pointer flex items-center justify-between data-[highlighted]:bg-white/5'
                                >
                                  <span className={selected ? 'text-blue-400' : ''}>{option.label}</span>
                                  {selected && <Check className='w-3.5 h-3.5 text-blue-400' />}
                                </DropdownMenuItem>
                              );
                            })}
                          </DropdownMenuContent>
                        </DropdownMenuPortal>
                      </DropdownMenu>
                    </div>
                  ))
                : null}
              <label className='flex items-center gap-2 cursor-pointer ml-1 group'>
                <Checkbox
                  checked={isFavoriteFilter}
                  onCheckedChange={checked => setIsFavoriteFilter(checked === true)}
                  className='w-5 h-5 rounded-full border border-white/20 data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-600 transition-all flex items-center justify-center group-hover:border-white/40 outline-none'
                />
                <span className='text-sm group-hover:text-white transition-colors text-white/60'>我的收藏</span>
              </label>
            </div>
            <div className='flex items-center gap-2 shrink-0'>
              <div className='relative w-[280px]'>
                <Search className='w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-white/45' />
                <Input value={keyword} onChange={e => setKeyword(e.target.value)} placeholder='搜索项目' className='pl-9 bg-[#2b2b2b] border-white/10 h-9' />
              </div>
              {tab === 'my' && allowCustomTone ? (
                <button className='h-9 px-3 rounded-md bg-[#2f4ed8] text-white text-sm flex items-center gap-1.5' onClick={() => setUploadVisible(true)}>
                  <Bell className='w-4 h-4' />
                  定制音色
                </button>
              ) : null}
            </div>
          </div>
        </div>

        <div className='px-6 flex-1 overflow-y-auto no-scrollbar pb-32 min-h-0'>
          {loading ? (
            <ToneCardSkeletonGrid />
          ) : list.length === 0 ? (
            <div className='py-32 flex flex-col items-center justify-center text-white/20'>
              <p className='text-lg'>暂无音色内容</p>
            </div>
          ) : (
            <div className='grid grid-cols-2 gap-3'>
              {list.map(item => (
                <ToneCard
                  key={`${item.voiceType}-${item.id}-${item.voiceId}`}
                  item={item}
                  isCurrent={item.voiceId === currentVoiceId}
                  isActive={item.voiceId === activeVoiceId}
                  isPublic={tab === 'public'}
                  isPlaying={playingVoiceId === item.voiceId}
                  onApply={() => handleApply(item)}
                  onToggleFavorite={() => toggleFavoriteStatus(item)}
                  onDelete={() => handleDeleteTone(item)}
                  onPlayToggle={() => handlePlayToggle(item)}
                />
              ))}
              <LoadMore show={hasMore} loadingMore={loadingMore} sentinelRef={sentinelRef} />
              <NoMore show={total > 0 && !hasMore} text='没有更多音色了' />
            </div>
          )}
        </div>

        <div className='absolute bottom-4 left-1/2 -translate-x-1/2 w-[436px] rounded-2xl border border-white/25 bg-black/45 backdrop-blur-lg p-2 pr-4'>
          {activeDetail ? (
            <div className='flex items-center justify-between'>
              <div className='group flex items-center gap-2 min-w-0'>
                <div className='relative h-12 w-12 rounded-xl shrink-0 overflow-hidden bg-cover bg-center bg-no-repeat' style={{ backgroundImage: `url(${AudioImage})` }}>
                  <div
                    className={`absolute inset-0 bg-black/45 flex items-center justify-center transition-opacity ${
                      playingVoiceId === activeDetail.voiceId ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                    }`}
                  >
                    <button
                      className='h-9 w-9 bg-transparent flex items-center justify-center text-white'
                      onClick={() => handlePlayToggle(activeDetail)}
                      aria-label={playingVoiceId === activeDetail.voiceId ? '暂停' : '播放'}
                    >
                      {playingVoiceId === activeDetail.voiceId ? <Pause size={16} /> : <Play size={16} />}
                    </button>
                  </div>
                </div>

                <div className='min-w-0'>
                  <div className='text-sm font-bold truncate text-white/95'>{activeDetail.name || '未命名音色'}</div>
                  {activeDetail.voiceType === 'PUBLIC_VOICE' ? (
                    <div className='mt-2 flex gap-2 flex-wrap text-xs text-white/80'>
                      {activeDetail.language ? <span className='px-2 py-0.5 rounded-lg bg-white/10'>{activeDetail.language}</span> : null}
                      {activeDetail.gender ? <span className='px-2 py-0.5 rounded-lg bg-white/10'>{activeDetail.gender}</span> : null}
                      {activeDetail.age ? <span className='px-2 py-0.5 rounded-lg bg-white/10'>{activeDetail.age}</span> : null}
                      {activeDetail.category ? <span className='px-2 py-0.5 rounded-lg bg-white/10'>{activeDetail.category}</span> : null}
                    </div>
                  ) : null}
                </div>
              </div>

              <div className='flex items-center gap-6 shrink-0 pl-6'>
                <div className='w-[2px] h-12 bg-white/25' />
                <div className='text-white/70 text-sm font-semibold'>{activeDetail.voiceId === currentVoiceId ? '当前使用' : '未使用'}</div>
              </div>
            </div>
          ) : (
            <div className='flex items-center justify-between'>
              <div className='text-sm text-white/50'>未选择音色</div>
              <div className='flex items-center gap-6 shrink-0 pl-6'>
                <div className='w-px h-10 bg-white/12' />
                <div className='text-white/40 text-sm font-semibold'>当前使用</div>
              </div>
            </div>
          )}
        </div>
      </DialogContent>

      {uploadVisible
        ? createPortal(
            <ToneUpload
              accept='audio'
              maxSize={20}
              visible={uploadVisible}
              onCancel={() => setUploadVisible(false)}
              onOk={() => {
                setUploadVisible(false);
                refreshMyList();
              }}
            />,
            document.body
          )
        : null}
    </Dialog>
  );
};

export default ToneLibraryModal;
