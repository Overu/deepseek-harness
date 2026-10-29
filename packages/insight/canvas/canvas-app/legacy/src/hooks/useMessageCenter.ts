import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { InfiniteData } from '@tanstack/react-query';
import { toast } from 'sonner';
import { getMessageList, getMessageTypes, markMessageRead, MessageSSEAuthError, subscribeMessageSSE } from '@/api/message';
import type { MarkReadParams, MessageCategory, MessageListData, UserMessage } from '@/api/message';
import { REQUIRED_MESSAGE_CATEGORIES, normalizeMessageCategories } from '@/components/message/messageConstants';
import { getMessageCategoryCode, getMessageIdentityKey, isSameUserMessage, normalizeMessage, normalizeMessages } from '@/components/message/messageUtils';
import { useAuth } from '@/contexts/AuthContext';
import { useUserStore } from '@/store/userStore';

const DEFAULT_CATEGORY: MessageCategory = REQUIRED_MESSAGE_CATEGORIES[0];

const PAGE_LIMIT = 20;

const messageKeys = {
  root: ['message-center'] as const,
  scope: (authScope: string) => ['message-center', authScope] as const,
  categories: (authScope: string) => ['message-center', authScope, 'categories'] as const,
  list: (authScope: string, categoryCode: string) => ['message-center', authScope, 'list', categoryCode] as const,
};

type MessageQueryMode = 'preview' | 'list';

function uniqueByUserMessageId(items: UserMessage[]) {
  const seen = new Set<number>();
  const result: UserMessage[] = [];

  for (const item of items) {
    if (seen.has(item.userMessageId)) {
      continue;
    }

    seen.add(item.userMessageId);
    result.push(item);
  }

  return result;
}

function readResponseData<T>(response: any): T | null {
  return response?.data ?? response?.body ?? null;
}

async function fetchMessageList(params: { categoryCode: string; cursor?: number | null; limit: number }, signal?: AbortSignal) {
  const response = await getMessageList(
    {
      categoryCode: params.categoryCode,
      cursor: params.cursor,
      limit: params.limit,
    },
    signal
  );
  const data = readResponseData<MessageListData>(response);

  if (!data) {
    throw new Error('消息列表响应为空');
  }

  return {
    ...data,
    items: Array.isArray(data.items) ? normalizeMessages(data.items) : [],
  };
}

function markItemsRead(items: UserMessage[], idList?: number[]) {
  const idSet = idList?.length ? new Set(idList) : null;
  const now = new Date().toISOString();

  return items.map(item => {
    if (idSet && !idSet.has(item.userMessageId)) {
      return item;
    }

    return {
      ...item,
      readStatus: 1 as const,
      readAt: item.readAt || now,
    };
  });
}

function countUnreadByIds(items: UserMessage[], idList?: number[]) {
  if (!idList?.length) return 0;

  const idSet = new Set(idList);
  const unreadIds = new Set<number>();

  for (const item of items) {
    if (item.readStatus === 0 && idSet.has(item.userMessageId)) {
      unreadIds.add(item.userMessageId);
    }
  }

  return unreadIds.size;
}

function removeDeletedMessageItems(items: UserMessage[], deletedMessage: Partial<UserMessage>, globalUnreadKeys: Set<string>) {
  let localUnreadDelta = 0;
  let globalUnreadDelta = 0;
  const nextItems: UserMessage[] = [];

  for (const item of items) {
    if (!isSameUserMessage(item, deletedMessage)) {
      nextItems.push(item);
      continue;
    }

    if (item.readStatus === 0) {
      localUnreadDelta += 1;

      const identityKey = getMessageIdentityKey(item) || `user:${item.userMessageId}`;
      if (!globalUnreadKeys.has(identityKey)) {
        globalUnreadKeys.add(identityKey);
        globalUnreadDelta += 1;
      }
    }
  }

  return {
    items: nextItems,
    localUnreadDelta,
    globalUnreadDelta,
  };
}

export function useMessageCenter(queryMode: MessageQueryMode) {
  const { authStatus } = useAuth();
  const userId = useUserStore(state => state.userInfo?.id);
  const queryClient = useQueryClient();
  const [activeCategory, setActiveCategory] = useState(DEFAULT_CATEGORY.categoryCode);
  const [activePreviewCategory, setActivePreviewCategory] = useState(DEFAULT_CATEGORY.categoryCode);
  const [unreadCount, setUnreadCount] = useState(0);
  const lastMessageIdRef = useRef<number | null>(null);
  const activeCategoryRef = useRef(activeCategory);
  const activePreviewCategoryRef = useRef(activePreviewCategory);
  const isLoggedIn = authStatus.status === 'logged_in';
  const isMessageReady = isLoggedIn && userId != null;
  const authScope = isMessageReady ? `user:${userId}` : 'logged-out';
  const queryCategory = queryMode === 'preview' ? activePreviewCategory : activeCategory;

  useEffect(() => {
    activeCategoryRef.current = activeCategory;
  }, [activeCategory]);

  useEffect(() => {
    activePreviewCategoryRef.current = activePreviewCategory;
  }, [activePreviewCategory]);

  const categoriesQuery = useQuery({
    queryKey: messageKeys.categories(authScope),
    queryFn: async () => {
      const response = await getMessageTypes();
      const data = readResponseData<MessageCategory[]>(response);
      return normalizeMessageCategories(Array.isArray(data) ? data : null);
    },
    enabled: isMessageReady,
    initialData: REQUIRED_MESSAGE_CATEGORIES,
    staleTime: 60 * 1000,
  });

  const listQuery = useInfiniteQuery({
    queryKey: messageKeys.list(authScope, queryCategory),
    queryFn: ({ pageParam, signal }) =>
      fetchMessageList(
        {
          categoryCode: queryCategory,
          cursor: pageParam,
          limit: PAGE_LIMIT,
        },
        signal
      ),
    initialPageParam: null as number | null,
    getNextPageParam: lastPage => (lastPage.hasMore ? lastPage.nextCursor || undefined : undefined),
    enabled: isMessageReady,
    staleTime: 5 * 1000,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    const maxListId = listQuery.data?.pages?.[0]?.maxUserMessageId;
    if (typeof maxListId === 'number') {
      lastMessageIdRef.current = Math.max(lastMessageIdRef.current || 0, maxListId);
    }
  }, [listQuery.data?.pages]);

  const messages = useMemo(() => {
    const pages = listQuery.data?.pages || [];
    return uniqueByUserMessageId(pages.flatMap(page => page.items || []));
  }, [listQuery.data?.pages]);

  const previewMessages = useMemo(() => messages.slice(0, 5), [messages]);
  const firstPage = listQuery.data?.pages?.[0];
  const hasPreviewOverflow = messages.length > 5 || !!firstPage?.hasMore;
  const categoryUnreadCount = firstPage?.unreadCount ?? 0;

  const patchReadStatus = useCallback(
    (categoryCode: string, params: MarkReadParams) => {
      queryClient.setQueryData<InfiniteData<MessageListData> | undefined>(messageKeys.list(authScope, categoryCode), old => {
        if (!old) return old;
        const unreadDelta =
          params.type === 'ALL'
            ? old.pages[0]?.unreadCount || 0
            : old.pages.flatMap(page => page.items || []).filter(item => params.idList?.includes(item.userMessageId) && item.readStatus === 0).length;

        return {
          ...old,
          pages: old.pages.map((page, index) => ({
            ...page,
            unreadCount: index === 0 ? Math.max(0, page.unreadCount - unreadDelta) : page.unreadCount,
            items: markItemsRead(page.items, params.type === 'BATCH' ? params.idList : undefined),
          })),
        };
      });
    },
    [authScope, queryClient]
  );

  const markReadMutation = useMutation({
    mutationFn: (params: MarkReadParams) => markMessageRead(params),
    onMutate: async params => {
      const categoryCode = params.categoryCode || activeCategoryRef.current;
      await queryClient.cancelQueries({ queryKey: messageKeys.list(authScope, categoryCode) });

      const previousUnread = unreadCount;
      const previousList = queryClient.getQueryData<InfiniteData<MessageListData>>(messageKeys.list(authScope, categoryCode));

      const unreadDelta =
        params.type === 'ALL'
          ? (previousList?.pages?.[0]?.unreadCount ?? categoryUnreadCount)
          : Math.max(countUnreadByIds(previousList?.pages?.flatMap(page => page.items || []) || [], params.idList), countUnreadByIds(messages, params.idList));

      setUnreadCount(old => Math.max(0, old - unreadDelta));
      patchReadStatus(categoryCode, params);

      return {
        categoryCode,
        previousUnread,
        previousList,
      };
    },
    onError: (_error, _params, context) => {
      if (context?.previousUnread !== undefined) {
        setUnreadCount(context.previousUnread);
      }
      if (context?.previousList && context.categoryCode) {
        queryClient.setQueryData(messageKeys.list(authScope, context.categoryCode), context.previousList);
      }
      toast.error('操作失败，请稍后重试');
    },
    onSettled: (_data, _error, _params, context) => {
      if (context?.categoryCode) {
        queryClient.invalidateQueries({ queryKey: messageKeys.list(authScope, context.categoryCode) });
      }
    },
  });

  const switchCategory = useCallback((categoryCode: string) => {
    setActiveCategory(categoryCode);
    activeCategoryRef.current = categoryCode;
  }, []);

  const switchPreviewCategory = useCallback((categoryCode: string) => {
    setActivePreviewCategory(categoryCode);
    activePreviewCategoryRef.current = categoryCode;
  }, []);

  const loadPreview = useCallback(
    async (categoryCode = activePreviewCategoryRef.current) => {
      if (categoryCode !== activePreviewCategoryRef.current) {
        setActivePreviewCategory(categoryCode);
        activePreviewCategoryRef.current = categoryCode;
        return;
      }

      await queryClient.invalidateQueries({ queryKey: messageKeys.list(authScope, categoryCode) });
    },
    [authScope, queryClient]
  );

  const loadList = useCallback(
    async (categoryCode = activeCategoryRef.current) => {
      if (categoryCode !== activeCategoryRef.current) {
        setActiveCategory(categoryCode);
        activeCategoryRef.current = categoryCode;
        return;
      }

      await listQuery.refetch();
    },
    [listQuery]
  );

  const loadMore = useCallback(async () => {
    if (listQuery.hasNextPage && !listQuery.isFetchingNextPage) {
      await listQuery.fetchNextPage();
    }
  }, [listQuery]);

  const markOneRead = useCallback(
    async (message: UserMessage) => {
      if (message.readStatus === 1 || markReadMutation.isPending) return;

      await markReadMutation.mutateAsync({
        type: 'BATCH',
        categoryCode: message.categoryCode || activeCategoryRef.current,
        idList: [message.userMessageId],
      });
    },
    [markReadMutation]
  );

  const markAllRead = useCallback(async () => {
    if (!isLoggedIn || markReadMutation.isPending || categoryUnreadCount <= 0) return;

    await markReadMutation.mutateAsync({
      type: 'ALL',
      categoryCode: activeCategoryRef.current,
    });
    toast.success('已全部标记为已读');
  }, [categoryUnreadCount, isLoggedIn, markReadMutation]);

  useEffect(() => {
    if (!isLoggedIn) {
      setActiveCategory(DEFAULT_CATEGORY.categoryCode);
      activeCategoryRef.current = DEFAULT_CATEGORY.categoryCode;
      setActivePreviewCategory(DEFAULT_CATEGORY.categoryCode);
      activePreviewCategoryRef.current = DEFAULT_CATEGORY.categoryCode;
      lastMessageIdRef.current = null;
      setUnreadCount(0);
      queryClient.removeQueries({ queryKey: messageKeys.root });
      return;
    }
  }, [isLoggedIn, queryClient]);

  useEffect(() => {
    if (!isMessageReady) return;

    let stopped = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let subscription: { abort: () => void } | null = null;

    const connect = () => {
      if (stopped) return;

      subscription = subscribeMessageSSE({
        lastMessageId: lastMessageIdRef.current,
        onEvent: event => {
          if (event.id) {
            lastMessageIdRef.current = Math.max(lastMessageIdRef.current || 0, event.id);
          }

          if (event.event === 'message.updated') {
            setUnreadCount(Number(event.data.unreadCount || 0));
            queryClient.invalidateQueries({ queryKey: messageKeys.scope(authScope), refetchType: 'none' });
            return;
          }

          if (event.event === 'connected') {
            if (typeof event.data.unreadCount === 'number') {
              setUnreadCount(event.data.unreadCount);
            }
            return;
          }

          if (event.event === 'message.deleted') {
            const deletedMessage = event.data;
            const categoryCode = getMessageCategoryCode(deletedMessage);
            const removedUnreadKeys = new Set<string>();
            let globalUnreadDelta = 0;

            queryClient.setQueryData<InfiniteData<MessageListData> | undefined>(messageKeys.list(authScope, categoryCode), old => {
              if (!old) return old;

              let listUnreadDelta = 0;
              const pages = old.pages.map(page => {
                const result = removeDeletedMessageItems(page.items || [], deletedMessage, removedUnreadKeys);
                listUnreadDelta += result.localUnreadDelta;
                globalUnreadDelta += result.globalUnreadDelta;

                return {
                  ...page,
                  items: result.items,
                };
              });

              return {
                ...old,
                pages: pages.map((page, index) =>
                  index === 0
                    ? {
                        ...page,
                        unreadCount: Math.max(0, page.unreadCount - listUnreadDelta),
                      }
                    : page
                ),
              };
            });

            if (globalUnreadDelta > 0) {
              setUnreadCount(old => Math.max(0, old - globalUnreadDelta));
            }

            return;
          }

          if (event.event !== 'message.created') {
            return;
          }

          const message = normalizeMessage(event.data);
          const categoryCode = getMessageCategoryCode(message);
          if (message.userMessageId) {
            lastMessageIdRef.current = Math.max(lastMessageIdRef.current || 0, message.userMessageId);
          }

          if (message.readStatus === 0) {
            setUnreadCount(old => old + 1);
          }

          queryClient.setQueryData<InfiniteData<MessageListData> | undefined>(messageKeys.list(authScope, categoryCode), old => {
            if (!old) return old;
            return {
              ...old,
              pages: old.pages.map((page, index) =>
                index === 0
                  ? {
                      ...page,
                      unreadCount: page.unreadCount + (message.readStatus === 0 ? 1 : 0),
                      items: uniqueByUserMessageId([message, ...page.items]),
                    }
                  : page
              ),
            };
          });
        },
        onError: error => {
          console.error('消息订阅失败：', error);
          if (error instanceof MessageSSEAuthError) {
            stopped = true;
            return;
          }
          if (!stopped) {
            retryTimer = setTimeout(connect, 5000);
          }
        },
        onClose: () => {
          if (!stopped) {
            retryTimer = setTimeout(connect, 5000);
          }
        },
      });
    };

    connect();

    return () => {
      stopped = true;
      if (retryTimer) {
        clearTimeout(retryTimer);
      }
      subscription?.abort();
    };
  }, [authScope, isMessageReady, queryClient]);

  return {
    isLoggedIn,
    categories: categoriesQuery.data || [DEFAULT_CATEGORY],
    activePreviewCategory,
    activeCategory,
    previewMessages,
    messages,
    unreadCount,
    categoryUnreadCount,
    hasPreviewOverflow,
    hasOverflowUnread: categoryUnreadCount > 5,
    hasMore: !!listQuery.hasNextPage,
    loadingPreview: listQuery.isLoading,
    loadingList: listQuery.isLoading,
    loadingMore: listQuery.isFetchingNextPage,
    previewError: listQuery.isError,
    listError: listQuery.isError,
    markingAllRead: markReadMutation.isPending,
    switchPreviewCategory,
    switchCategory,
    loadPreview,
    loadList,
    loadMore,
    markOneRead,
    markAllRead,
  };
}
