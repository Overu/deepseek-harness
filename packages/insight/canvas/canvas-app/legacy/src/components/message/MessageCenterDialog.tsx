import { type UIEvent, useCallback, useEffect, useRef, useState } from 'react';
import { CircleCheckBig, Loader2 } from 'lucide-react';

import type { UserMessage } from '@/api/message';
import type { OpenDialogInjectedProps } from '@/components/globalDialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useMessageCenter } from '@/hooks/useMessageCenter';
import { useOfficialMessageAction } from '@/components/message/useOfficialMessageAction';
import { cn } from '@/lib/utils';
import { INTERACTION_CATEGORY_CODE, SYSTEM_CATEGORY_CODE } from './messageConstants';
import { MessageCategoryTabs } from './MessageCategoryTabs';
import { EmptyState, InteractionMessageItem, MessageUnreadDot, OfficialMessageListItem } from './MessageItems';
import { isInteractionMessage } from './messageUtils';

export type MessageCenterDialogProps = {
  initialCategoryCode?: string;
  initialMessageId?: number | null;
};

export function MessageCenterDialog({ initialCategoryCode = SYSTEM_CATEGORY_CODE, initialMessageId = null, resolve }: MessageCenterDialogProps & OpenDialogInjectedProps<void>) {
  const [open, setOpen] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [selectedMessageId, setSelectedMessageId] = useState<number | null>(initialMessageId);
  const pendingAutoOpenMessageIdRef = useRef<number | null>(initialMessageId);
  const listViewportRef = useRef<HTMLDivElement | null>(null);
  const settledRef = useRef(false);
  const initializedRef = useRef(false);
  const {
    categories,
    activeCategory,
    messages,
    categoryUnreadCount,
    hasMore,
    loadingList,
    loadingMore,
    listError,
    markingAllRead,
    switchCategory,
    loadList,
    loadMore,
    markOneRead,
    markAllRead,
  } = useMessageCenter('list');
  const canMarkAllRead = categoryUnreadCount > 0 && !markingAllRead;
  const listIsInteraction = activeCategory === INTERACTION_CATEGORY_CODE;
  const handleOfficialMessageAction = useOfficialMessageAction(markOneRead);

  const requestClose = useCallback(() => {
    if (settledRef.current) return;
    settledRef.current = true;
    setOpen(false);
    resolve();
  }, [resolve]);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    setSelectedMessageId(initialMessageId);
    pendingAutoOpenMessageIdRef.current = initialMessageId;
    setExpandedIds(initialMessageId ? new Set([initialMessageId]) : new Set());

    if (activeCategory !== initialCategoryCode) {
      switchCategory(initialCategoryCode);
    }
  }, [activeCategory, initialCategoryCode, initialMessageId, switchCategory]);

  useEffect(() => {
    if (!open || selectedMessageId === null) return;
    if (pendingAutoOpenMessageIdRef.current !== selectedMessageId) return;

    const selectedMessage = messages.find(message => message.userMessageId === selectedMessageId);
    if (!selectedMessage) return;

    pendingAutoOpenMessageIdRef.current = null;
    setExpandedIds(prev => {
      if (prev.has(selectedMessageId)) return prev;

      const next = new Set(prev);
      next.add(selectedMessageId);
      return next;
    });
    void markOneRead(selectedMessage);

    requestAnimationFrame(() => {
      listViewportRef.current?.querySelector(`[data-message-id="${selectedMessageId}"]`)?.scrollIntoView({
        block: 'nearest',
      });
    });
  }, [markOneRead, messages, open, selectedMessageId]);

  const handleTabChange = useCallback(
    (categoryCode: string) => {
      setSelectedMessageId(null);
      pendingAutoOpenMessageIdRef.current = null;
      setExpandedIds(new Set());
      switchCategory(categoryCode);
    },
    [switchCategory]
  );

  const handleSelectMessage = useCallback(
    (message: UserMessage) => {
      pendingAutoOpenMessageIdRef.current = null;
      setSelectedMessageId(prev => (prev === message.userMessageId ? null : message.userMessageId));

      if (isInteractionMessage(message)) {
        void markOneRead(message);
      }
    },
    [markOneRead]
  );

  const handleInteractionRead = useCallback(
    (message: UserMessage) => {
      void markOneRead(message);
    },
    [markOneRead]
  );

  const handleToggleMessage = useCallback(
    (message: UserMessage) => {
      setExpandedIds(prev => {
        const next = new Set(prev);
        if (next.has(message.userMessageId)) {
          next.delete(message.userMessageId);
        } else {
          next.add(message.userMessageId);
          void markOneRead(message);
        }
        return next;
      });
    },
    [markOneRead]
  );

  const handleListScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      const target = event.currentTarget;
      const distanceToBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
      if (distanceToBottom < 48) {
        void loadMore();
      }
    },
    [loadMore]
  );

  return (
    <Dialog open={open} onOpenChange={nextOpen => !nextOpen && requestClose()}>
      <DialogContent className='grid h-[min(82dvh,640px)] max-h-[calc(100dvh-56px)] w-[min(92vw,380px)] max-w-none grid-rows-[auto_1fr] overflow-hidden rounded-lg border bg-[#262626] p-0 shadow-lg sm:h-[72vh] sm:max-h-[720px] sm:min-h-[520px] sm:w-[min(920px,calc(100vw-32px))]'>
        <DialogHeader className='border-b border-border/70 px-4 py-4 sm:px-6'>
          <div className='flex items-center justify-between gap-3 pr-8'>
            <DialogTitle className='min-w-0 truncate text-base sm:text-lg'>消息管理中心</DialogTitle>
          </div>
        </DialogHeader>
        <div className='grid min-h-0 grid-rows-[auto_1fr] px-4 pb-4 sm:px-6 sm:pb-5'>
          <div className='relative mt-2 flex justify-between gap-4'>
            <MessageCategoryTabs categories={categories} value={activeCategory} onValueChange={handleTabChange} />

            <button
              type='button'
              disabled={!canMarkAllRead}
              className={cn(
                'relative flex shrink-0 items-center gap-1 text-sm text-muted-foreground transition-colors focus:outline-none focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0',
                canMarkAllRead ? 'cursor-pointer hover:text-foreground' : 'cursor-not-allowed opacity-50'
              )}
              onClick={() => void markAllRead()}
            >
              <CircleCheckBig size={14} />
              <span>{markingAllRead ? '处理中...' : '一键已读'}</span>
              {categoryUnreadCount > 0 && <MessageUnreadDot className='absolute -right-2 -top-[2px]' />}
            </button>
          </div>
          <div ref={listViewportRef} className='mt-4 min-h-0 overflow-y-auto pr-1' onScroll={handleListScroll}>
            {loadingList ? (
              <div className='flex h-full min-h-[320px] items-center justify-center text-muted-foreground'>
                <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                加载中
              </div>
            ) : listError ? (
              <button
                type='button'
                className='flex h-full min-h-[320px] w-full flex-col items-center justify-center text-sm text-muted-foreground hover:text-foreground focus:outline-none focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0'
                onClick={() => void loadList(activeCategory)}
              >
                加载失败
                <span className='mt-1 text-xs'>点击重试</span>
              </button>
            ) : messages.length ? (
              <div className='space-y-3'>
                {messages.map(message =>
                  isInteractionMessage(message) ? (
                    <InteractionMessageItem
                      key={message.userMessageId}
                      message={message}
                      selected={selectedMessageId === message.userMessageId}
                      onSelect={handleSelectMessage}
                      onRead={handleInteractionRead}
                    />
                  ) : (
                    <OfficialMessageListItem
                      key={message.userMessageId}
                      message={message}
                      expanded={expandedIds.has(message.userMessageId)}
                      selected={selectedMessageId === message.userMessageId}
                      onSelect={handleSelectMessage}
                      onToggle={handleToggleMessage}
                      onAction={handleOfficialMessageAction}
                    />
                  )
                )}
                <div className='flex h-10 items-center justify-center text-xs text-muted-foreground'>
                  {loadingMore && (
                    <>
                      <Loader2 className='mr-2 h-3.5 w-3.5 animate-spin' />
                      加载更多
                    </>
                  )}
                  {!loadingMore && !hasMore && '已加载全部'}
                </div>
              </div>
            ) : (
              <EmptyState interaction={listIsInteraction} />
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
