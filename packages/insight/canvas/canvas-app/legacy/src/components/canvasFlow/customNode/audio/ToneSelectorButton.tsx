import { fetchToneDetailByVoiceId } from '@/api/tone';
import AudioImage from '@/assets/images/audio.png';
import ToneLibraryModal from '@/components/ToneLibrary/ToneLibraryModal';
import { mapToneDetailToItem } from '@/components/ToneLibrary/types';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Pause, Play } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';

interface ToneSelectorButtonProps {
  voiceId?: string;
  onSelectVoice: (voiceId: string) => void;
  /** 为 false 时音色库「我的」中不展示「定制音色」上传入口 */
  allowCustomTone?: boolean;
}

const ToneSelectorButton = ({ voiceId, onSelectVoice, allowCustomTone = true }: ToneSelectorButtonProps) => {
  const [open, setOpen] = useState(false);
  const [voiceName, setVoiceName] = useState('');
  const [demoUrl, setDemoUrl] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const stopAudio = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) {
      setIsPlaying(false);
      return;
    }
    audio.pause();
    audio.currentTime = 0;
    audio.onended = null;
    setIsPlaying(false);
  }, []);

  const handleOpenLibrary = useCallback(() => {
    stopAudio();
    setOpen(true);
  }, [stopAudio]);

  const handlePlayToggle = useCallback(
    async (e: MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      if (!demoUrl) return;

      if (isPlaying) {
        stopAudio();
        return;
      }

      if (!audioRef.current) {
        audioRef.current = new Audio();
      }
      const audio = audioRef.current;

      try {
        audio.pause();
        audio.src = demoUrl;
        await audio.play();
        setIsPlaying(true);
        audio.onended = () => {
          setIsPlaying(false);
        };
      } catch (error) {
        console.error(error);
        setIsPlaying(false);
      }
    },
    [demoUrl, isPlaying, stopAudio]
  );

  useEffect(() => {
    if (!voiceId) {
      stopAudio();
      setVoiceName('');
      setDemoUrl('');
      return;
    }

    stopAudio();
    let cancelled = false;
    (async () => {
      const res: any = await fetchToneDetailByVoiceId({ voiceId });
      if (cancelled) return;
      if (res?.code !== 'SUCCESS') {
        setVoiceName('');
        setDemoUrl('');
        return;
      }
      const mapped = mapToneDetailToItem(res.data);
      setVoiceName(mapped?.name || '');
      setDemoUrl(mapped?.demoUrl || '');
    })();

    return () => {
      cancelled = true;
    };
  }, [stopAudio, voiceId]);

  useEffect(() => {
    return () => {
      stopAudio();
    };
  }, [stopAudio]);

  return (
    <>
      <TooltipProvider delayDuration={100}>
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              role='button'
              tabIndex={0}
              className='flex max-w-[200px] min-w-0 shrink-0 cursor-pointer items-center gap-2 rounded-lg px-3 py-1 hover:bg-white/10'
              onClick={handleOpenLibrary}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleOpenLibrary();
                }
              }}
            >
              <div className='group relative h-6 w-6 shrink-0 overflow-hidden rounded-lg bg-cover bg-center bg-no-repeat' style={{ backgroundImage: `url(${AudioImage})` }}>
                <div
                  className={`absolute inset-0 flex items-center justify-center bg-black/45 transition-opacity ${isPlaying ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                >
                  <button
                    type='button'
                    className='flex h-6 w-6 items-center justify-center bg-transparent text-white'
                    onClick={handlePlayToggle}
                    aria-label={isPlaying ? '暂停试听' : '播放试听'}
                    disabled={!demoUrl}
                  >
                    {isPlaying ? <Pause size={12} /> : <Play size={12} />}
                  </button>
                </div>
              </div>
              <span className='truncate text-sm text-white/90' title={voiceName || undefined}>
                {voiceId ? voiceName || '…' : '选择音色'}
              </span>
            </div>
          </TooltipTrigger>
          <TooltipContent side='top' className='rounded-xl border-white/10 bg-black px-3 py-2 text-white shadow-2xl'>
            音色库
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      {open
        ? createPortal(
            <ToneLibraryModal open={open} voiceId={voiceId} onOpenChange={setOpen} onSelect={item => onSelectVoice(item.voiceId)} allowCustomTone={allowCustomTone} />,
            document.body
          )
        : null}
    </>
  );
};

export default memo(ToneSelectorButton);
