import { useState, useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { useLocation } from '@tanstack/react-router';
import { getAnnouncement, type AnnouncementMessage } from '@/api/report';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';

export const GlobalAnnouncement = () => {
  const [announcement, setAnnouncement] = useState<AnnouncementMessage | null>(null);
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const location = useLocation();
  const isRestricted = location.pathname === '/' || location.pathname.startsWith('/login');

  const handleClose = () => {
    setVisible(false);
    setTimeout(() => {
      setAnnouncement(null);
    }, 300);
  };

  const fetchAnnouncement = async () => {
    if (isRestricted) return;

    try {
      // 从统一缓存中读取
      let cache: any = { channel: null, shownIds: [] };
      try {
        const stored = localStorage.getItem('insight_announcement_cache');
        if (stored) cache = JSON.parse(stored);
      } catch {
        /* empty */
      }

      const res: any = await getAnnouncement();

      if (res?.data && Array.isArray(res.data) && res.data.length > 0) {
        const item = (res.data as AnnouncementMessage[]).find(message => {
          const messageKey = message.userMessageId ?? message.messageId;
          return message.readStatus !== 1 && !cache.shownIds?.includes(messageKey);
        });

        if (item) {
          const messageKey = item.userMessageId ?? item.messageId;
          setAnnouncement(item);
          setVisible(true);

          if (!cache.shownIds) cache.shownIds = [];
          cache.shownIds.push(messageKey);
          localStorage.setItem('insight_announcement_cache', JSON.stringify(cache));
        }
      }
    } catch (e) {
      console.error('Failed to get announcement', e);
    }
  };

  useEffect(() => {
    if (isRestricted) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }

    // 首次挂载获取
    fetchAnnouncement();

    // 开启轮询，每两分钟获取一次
    timerRef.current = setInterval(
      () => {
        fetchAnnouncement();
      },
      2 * 60 * 1000
    );

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isRestricted]);

  useEffect(() => {
    if (isRestricted && visible) {
      handleClose();
    }
  }, [isRestricted, visible]);

  if (!announcement && !visible) return null;

  return (
    <Dialog open={visible && !!announcement} onOpenChange={open => !open && handleClose()}>
      {announcement && (
        <DialogContent
          overlayClassName='bg-black/90 backdrop-blur-[10px]'
          className='w-full max-w-[560px] p-8 pb-10 overflow-hidden rounded-[16px] shadow-2xl text-white border-none gap-0'
          style={{
            background: 'url(https://web-gpt-assets-cdn.idealead.com/static-assets-tool/jpg/44db4aed2fe8cdb9.jpg?x-oss-process=image/format,webp) center/cover no-repeat',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5), inset 0 1px 1px rgba(255, 255, 255, 0.2)',
          }}
          showCloseButton={false}
        >
          <div className='relative'>
            <button
              onClick={handleClose}
              className='z-[1] absolute -top-2 -right-2 p-1.5 text-white/70 hover:text-white hover:bg-white/20 active:bg-white/30 rounded-full transition-colors cursor-pointer'
              aria-label='Close'
            >
              <X size={20} />
            </button>

            <DialogDescription className='sr-only'>官方公告</DialogDescription>
            <div className='text-[13px] font-medium text-white/90 mb-3 opacity-90 drop-shadow-sm'>官方公告</div>

            <DialogTitle className='text-2xl font-bold mb-5 tracking-tight drop-shadow-md leading-tight break-words'>{announcement.title}</DialogTitle>

            <div
              className='text-[16px] max-h-[40vh] overflow-y-auto text-white/60 leading-relaxed whitespace-pre-wrap drop-shadow-sm break-words'
              dangerouslySetInnerHTML={{ __html: announcement.content }}
            />
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
};
