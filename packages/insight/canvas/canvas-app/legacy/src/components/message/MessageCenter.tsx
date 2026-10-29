import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, Loader2, SquareArrowOutUpRight } from 'lucide-react';

import type { UserMessage } from '@/api/message';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useMessageCenter } from '@/hooks/useMessageCenter';
import { INTERACTION_CATEGORY_CODE, SYSTEM_CATEGORY_CODE } from './messageConstants';
import { MessageCategoryTabs } from './MessageCategoryTabs';
import { EmptyState, InteractionMessageItem, MessageUnreadDot, OfficialPreviewItem } from './MessageItems';
import { isInteractionMessage } from './messageUtils';
import { openMessageCenterDialog } from './openMessageCenterDialog';
import { useOfficialMessageAction } from './useOfficialMessageAction';

type MessageCenterProps = {
  className?: string;
};

export default function MessageCenter({ className }: MessageCenterProps) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const {
    categories,
    activePreviewCategory,
    previewMessages,
    unreadCount,
    hasPreviewOverflow,
    hasOverflowUnread,
    loadingPreview,
    previewError,
    isLoggedIn,
    switchPreviewCategory,
    loadPreview,
    markOneRead,
  } = useMessageCenter('preview');
  const handleOfficialMessageAction = useOfficialMessageAction(markOneRead);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewIsInteraction = activePreviewCategory === INTERACTION_CATEGORY_CODE;
  const showPreviewFooter = hasPreviewOverflow || previewMessages.length > 0;

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const openPopover = () => {
    clearCloseTimer();
    setPopoverOpen(true);
    switchPreviewCategory(SYSTEM_CATEGORY_CODE);
    void loadPreview(SYSTEM_CATEGORY_CODE);
  };

  const scheduleClosePopover = () => {
    clearCloseTimer();
    closeTimerRef.current = setTimeout(() => {
      setPopoverOpen(false);
    }, 120);
  };

  const handlePreviewTabChange = (categoryCode: string) => {
    switchPreviewCategory(categoryCode);
    void loadPreview(categoryCode);
  };

  const handlePreviewClick = (message: UserMessage) => {
    const categoryCode = message.categoryCode || SYSTEM_CATEGORY_CODE;

    setPopoverOpen(false);
    void openMessageCenterDialog({
      initialCategoryCode: categoryCode,
      initialMessageId: message.userMessageId,
    });
  };

  const handleInteractionRead = useCallback(
    (message: UserMessage) => {
      void markOneRead(message);
    },
    [markOneRead]
  );

  useEffect(() => clearCloseTimer, [clearCloseTimer]);

  if (!isLoggedIn) {
    return null;
  }

  return (
    <>
      <Popover
        open={popoverOpen}
        onOpenChange={open => {
          clearCloseTimer();
          setPopoverOpen(open);
          if (open) {
            switchPreviewCategory(SYSTEM_CATEGORY_CODE);
            void loadPreview(SYSTEM_CATEGORY_CODE);
          }
        }}
      >
        <div className={className} onMouseEnter={openPopover} onMouseLeave={scheduleClosePopover}>
          <PopoverTrigger asChild>
            <button
              type='button'
              className='relative inline-flex h-9 w-9 items-center justify-center rounded-full border border-border/70 bg-background/60 text-muted-foreground transition-all hover:border-primary/60 hover:bg-accent hover:text-foreground focus:outline-none focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0'
              aria-label='消息通知'
            >
              <Bell className='h-[18px] w-[18px]' />
              {unreadCount > 0 && <span className='absolute right-2 top-2 h-2 w-2 rounded-full bg-[#ff4d4f] shadow-[0_0_8px_rgba(255,77,79,0.8)]' />}
            </button>
          </PopoverTrigger>
          <PopoverContent
            align='end'
            sideOffset={8}
            className='w-[calc(100vw-24px)] max-w-[392px] overflow-hidden rounded-lg border border-white/10 bg-popover p-0 shadow-md outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0'
            onMouseEnter={clearCloseTimer}
            onMouseLeave={scheduleClosePopover}
          >
            <div className='border-b border-border/70 px-4'>
              <MessageCategoryTabs categories={categories} value={activePreviewCategory} onValueChange={handlePreviewTabChange} compact />
            </div>
            <div className='max-h-[410px] min-h-[176px] overflow-y-auto'>
              {loadingPreview ? (
                <div className='flex h-[176px] items-center justify-center text-muted-foreground'>
                  <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                  加载中
                </div>
              ) : previewError ? (
                <button
                  type='button'
                  className='flex h-[176px] w-full flex-col items-center justify-center text-sm text-muted-foreground hover:text-foreground focus:outline-none focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0'
                  onClick={() => void loadPreview(activePreviewCategory)}
                >
                  加载失败
                  <span className='mt-1 text-xs'>点击重试</span>
                </button>
              ) : previewMessages.length ? (
                previewMessages.map(message =>
                  isInteractionMessage(message) ? (
                    <InteractionMessageItem key={message.userMessageId} message={message} compact onSelect={handlePreviewClick} onRead={handleInteractionRead} />
                  ) : (
                    <OfficialPreviewItem key={message.userMessageId} message={message} onClick={handlePreviewClick} onAction={handleOfficialMessageAction} />
                  )
                )
              ) : (
                <EmptyState compact interaction={previewIsInteraction} />
              )}
            </div>
            {showPreviewFooter && (
              <button
                type='button'
                className='flex h-11 w-full items-center justify-center gap-1 border-t border-border/70 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus:outline-none focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0'
                onClick={() => {
                  setPopoverOpen(false);
                  void openMessageCenterDialog({ initialCategoryCode: activePreviewCategory });
                }}
              >
                <SquareArrowOutUpRight size={14} />
                <span>查看全部消息</span>
                {hasOverflowUnread && <MessageUnreadDot />}
              </button>
            )}
          </PopoverContent>
        </div>
      </Popover>
    </>
  );
}
