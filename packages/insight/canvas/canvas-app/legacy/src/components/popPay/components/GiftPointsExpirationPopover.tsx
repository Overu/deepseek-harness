import { useCallback, useEffect, useMemo, useRef, useState, type UIEvent } from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { useInfiniteQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { CircleQuestionMark, LoaderCircle } from 'lucide-react';

import { queryGiftPointsExpiration, type GiftPointsExpirationResult } from '@/api/order';
import { Popover, PopoverTrigger } from '@/components/ui/popover';
import { PAYMENT_FLOATING_Z_INDEX } from '../payLayer';

const PAGE_SIZE = 20;
const CACHE_STALE_TIME = 5 * 60_000;
const CACHE_GC_TIME = 10 * 60_000;

const findDialogContainer = (element: HTMLElement | null) => element?.closest<HTMLElement>('[role="dialog"]') ?? null;

interface GiftPointsExpirationPopoverProps {
  fallbackGiftBalance: number | string | null | undefined;
}

type GiftPointsExpirationResponse = {
  data?: GiftPointsExpirationResult;
  body?: GiftPointsExpirationResult;
  msg?: string;
};

type GiftPointsExpirationPage = GiftPointsExpirationResult & {
  page: number;
};

const formatExpirationDate = (value?: string) => {
  if (!value) return '-';
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format('YYYY.MM.DD') : value;
};

const formatPoint = (value?: number | string | null) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue.toLocaleString('en-US') : '0';
};

const fetchGiftExpirationPage = async (page: number): Promise<GiftPointsExpirationPage> => {
  const response = (await queryGiftPointsExpiration({
    page_no: page,
    page_size: PAGE_SIZE,
  })) as GiftPointsExpirationResponse;
  const data = response.data || response.body;

  return {
    gift_balance: Number(data?.gift_balance) || 0,
    total: Number(data?.total) || 0,
    items: data?.items ?? [],
    page,
  };
};

export function GiftPointsExpirationPopover({ fallbackGiftBalance }: GiftPointsExpirationPopoverProps) {
  const [open, setOpen] = useState(false);
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const triggerContainerRef = useRef<HTMLSpanElement | null>(null);

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const listQuery = useInfiniteQuery<GiftPointsExpirationPage, Error>({
    queryKey: ['account', 'giftPointsExpiration', PAGE_SIZE],
    enabled: open,
    initialPageParam: 1,
    staleTime: CACHE_STALE_TIME,
    gcTime: CACHE_GC_TIME,
    queryFn: ({ pageParam }) => fetchGiftExpirationPage(Number(pageParam) || 1),
    getNextPageParam: (lastPage, allPages) => {
      const loadedCount = allPages.reduce((sum, page) => sum + page.items.length, 0);
      if (lastPage.total > 0) {
        return loadedCount < lastPage.total ? lastPage.page + 1 : undefined;
      }

      return lastPage.items.length === PAGE_SIZE ? lastPage.page + 1 : undefined;
    },
  });

  const items = useMemo(() => listQuery.data?.pages.flatMap(page => page.items) || [], [listQuery.data?.pages]);
  const giftBalance = listQuery.data?.pages[0]?.gift_balance ?? fallbackGiftBalance;
  const initialLoading = listQuery.isLoading && items.length === 0;
  const { fetchNextPage, hasNextPage, isFetchingNextPage, refetch } = listQuery;

  const openPopover = useCallback(() => {
    clearCloseTimer();
    setPortalContainer(findDialogContainer(triggerContainerRef.current));
    setOpen(true);
  }, [clearCloseTimer]);

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (nextOpen) {
      setPortalContainer(findDialogContainer(triggerContainerRef.current));
    }
    setOpen(nextOpen);
  }, []);

  const scheduleClosePopover = useCallback(() => {
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      setOpen(false);
    }, 120);
  }, [clearCloseTimer]);

  const handleListScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      if (!hasNextPage || isFetchingNextPage) return;

      const target = event.currentTarget;
      const distanceToBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
      if (distanceToBottom <= 48) {
        void fetchNextPage();
      }
    },
    [fetchNextPage, hasNextPage, isFetchingNextPage]
  );

  const handleRetry = useCallback(() => {
    void refetch();
  }, [refetch]);

  useEffect(() => {
    return () => {
      clearCloseTimer();
    };
  }, [clearCloseTimer]);

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <span ref={triggerContainerRef} onMouseEnter={openPopover} onMouseLeave={scheduleClosePopover}>
        <PopoverTrigger asChild>
          <button
            type='button'
            className='ml-2 inline-flex h-5 w-5 items-center justify-center rounded-full text-white/75 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60'
            aria-label='查看赠送赛点过期明细'
          >
            <CircleQuestionMark size={16} />
          </button>
        </PopoverTrigger>
        <PopoverPrimitive.Portal container={portalContainer}>
          <PopoverPrimitive.Content
            align='start'
            side='bottom'
            sideOffset={8}
            style={{ zIndex: PAYMENT_FLOATING_Z_INDEX }}
            className='w-[390px] rounded-xl border border-white/10 bg-[#262626] p-0 text-white shadow-[0_12px_28px_rgba(0,0,0,0.38)] outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-(--radix-popover-content-transform-origin)'
            onMouseEnter={clearCloseTimer}
            onMouseLeave={scheduleClosePopover}
          >
            <div className='px-4 py-3'>
              <div className='flex items-center justify-between border-b border-white/10 pb-3 text-sm font-medium'>
                <span className='text-white/90'>剩余赛点</span>
                <span className='text-white/80'>{formatPoint(giftBalance)}</span>
              </div>

              <div className='max-h-[160px] overflow-y-auto pr-1' onScroll={handleListScroll}>
                {initialLoading ? (
                  <div className='flex h-20 items-center justify-center text-white/55'>
                    <LoaderCircle className='h-4 w-4 animate-spin' />
                  </div>
                ) : listQuery.isError ? (
                  <button type='button' className='flex h-20 w-full items-center justify-center text-sm text-white/55 hover:text-white' onClick={handleRetry}>
                    加载失败，点击重试
                  </button>
                ) : items.length ? (
                  <div className='space-y-3 py-3'>
                    {items.map((item, index) => (
                      <div key={`${item.expiration_date}-${index}`} className='flex items-center justify-between gap-4 text-sm leading-5'>
                        <span className='text-white/80'>{formatExpirationDate(item.expiration_date)}到期</span>
                        <span className='font-medium text-white/55'>{formatPoint(item.points)}</span>
                      </div>
                    ))}
                    {listQuery.isFetchingNextPage && (
                      <div className='flex h-8 items-center justify-center text-white/65'>
                        <LoaderCircle className='h-3.5 w-3.5 animate-spin' />
                      </div>
                    )}
                    {!listQuery.hasNextPage && items.length > 0 && <div className='pb-1 text-center text-xs text-white/30'>没有更多了</div>}
                  </div>
                ) : (
                  <div className='flex h-20 items-center justify-center text-sm text-white/45'>暂无到期明细</div>
                )}
              </div>
            </div>
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      </span>
    </Popover>
  );
}
