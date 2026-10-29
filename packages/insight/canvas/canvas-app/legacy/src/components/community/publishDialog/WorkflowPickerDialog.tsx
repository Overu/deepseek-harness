import { memo, type UIEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { ImageIcon, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';

import { getFlowData, getFlowsList, shareCanvas } from '@/api/workflow';
import defaultFlowCover from '@/assets/images/default_flow.png';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import NoMore from '@/components/common/scrollGrid/NoMore';
import { compressImage } from '@/utils';

const PAGE_SIZE = 12;
const SHARE_CLICK_DEBOUNCE_MS = 600;
const WORKFLOW_GRID_CLASS = 'grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4';

interface WorkflowPickerDialogProps {
  open: boolean;
  value: {
    title: string;
    url: string;
  };
  onOpenChange: (open: boolean) => void;
  onConfirm: (value: { title: string; url: string; coverUrl?: string; time?: string }) => void;
}

interface WorkflowCanvasItem {
  id: string;
  name: string;
  data?: string;
  thumbnailUrl?: string;
  updateTime?: string;
  createTime?: string;
}

type WorkflowListResponse = {
  code?: string | number;
  msg?: string;
  data?: {
    records?: WorkflowCanvasItem[];
    total?: number;
  };
  success?: boolean;
};

interface WorkflowPage {
  page: number;
  total: number;
  records: WorkflowCanvasItem[];
}

const isSuccessResponse = (response: { code?: string | number; success?: boolean }) => {
  return response.success === true || response.code === 'SUCCESS' || response.code === 200 || String(response.code) === '0';
};

const getWorkflowTimeText = (item: WorkflowCanvasItem) => {
  const rawTime = item.updateTime || item.createTime;
  if (!rawTime) return '';

  const date = new Date(rawTime);
  if (Number.isNaN(date.getTime())) return rawTime;

  return date.toLocaleString();
};

const normalizeCanvasDataForShare = (canvasData: string) => {
  try {
    const parsed = JSON.parse(canvasData);
    if (!Array.isArray(parsed?.nodes)) return canvasData;

    const nodes = parsed.nodes.map((node: any) => {
      if (!node?.data?.taskInfo && !node?.data?.storyboardInfo) return node;
      return {
        ...node,
        data: {
          ...node.data,
          ...(node.data.taskInfo
            ? {
                taskInfo: {
                  ...node.data.taskInfo,
                  status: 'success',
                },
              }
            : {}),
          ...(node.data.storyboardInfo
            ? {
                storyboardInfo: {
                  ...node.data.storyboardInfo,
                  status: 'success',
                },
              }
            : {}),
        },
      };
    });

    return JSON.stringify({
      ...parsed,
      nodes,
    });
  } catch {
    return canvasData;
  }
};

const normalizeWorkflowItem = (item: any): WorkflowCanvasItem => ({
  id: String(item?.id || ''),
  name: item?.name || '',
  data: item?.data,
  thumbnailUrl: item?.thumbnailUrl,
  updateTime: item?.updateTime,
  createTime: item?.createTime,
});

const getShareUrl = (response: any) => {
  const data = response?.data;
  if (typeof data === 'string')
    return data.startsWith('http') ? data : `${import.meta.env.MODE === 'production' ? window.location.origin : 'https://test-base-platform.insight-aigc.com'}/share/${data}`;
  if (typeof data?.url === 'string') return data.url;
  if (typeof data?.shareUrl === 'string') return data.shareUrl;
  if (typeof data?.code === 'string') return `${import.meta.env.MODE === 'production' ? window.location.origin : 'https://test-base-platform.insight-aigc.com'}/share/${data.code}`;
  return '';
};

const fetchWorkflowPage = async (page: number): Promise<WorkflowPage> => {
  const response = (await getFlowsList({
    page,
    size: PAGE_SIZE,
    temp: false,
    name: '',
    version: 'comfyui',
    canvasType: [0],
  })) as WorkflowListResponse;

  if (!isSuccessResponse(response)) {
    throw new Error(response.msg || '画布列表加载失败');
  }

  return {
    page,
    total: response.data?.total || 0,
    records: (response.data?.records || []).map(normalizeWorkflowItem).filter(item => item.id),
  };
};

const WorkflowCard = memo(function WorkflowCard({
  item,
  selected,
  sharing,
  disabled,
  onSelect,
}: {
  item: WorkflowCanvasItem;
  selected: boolean;
  sharing: boolean;
  disabled: boolean;
  onSelect: (item: WorkflowCanvasItem) => void;
}) {
  const timeText = useMemo(() => getWorkflowTimeText(item), [item]);
  const cover = item.thumbnailUrl ? compressImage(item.thumbnailUrl, 480) : defaultFlowCover;

  return (
    <article
      className={`group relative overflow-hidden rounded-md border border-white/10 bg-muted-foreground/10 p-1.5 transition-[border-color,background-color,box-shadow] duration-200 ${
        selected ? 'border-[#6f7cff]' : 'border-transparent hover:border-white/25 hover:bg-[#424242]'
      }`}
    >
      <div className='relative aspect-[16/9] w-full overflow-hidden rounded bg-[#252525]'>
        {cover ? (
          <img
            src={cover}
            alt={item.name || '画布封面'}
            loading='lazy'
            decoding='async'
            className='h-full w-full object-cover aspect-video transition-transform duration-500 ease-out group-hover:scale-110'
          />
        ) : (
          <div className='flex h-full w-full items-center justify-center text-white/35'>
            <ImageIcon className='h-7 w-7' />
          </div>
        )}

        <Button
          type='button'
          variant='ghost'
          className={`absolute inset-0 h-full w-full rounded-none bg-black/45 text-xs font-medium text-white transition-opacity duration-200 hover:bg-black/45 hover:text-white ${
            sharing ? 'opacity-100' : disabled ? 'invisible' : 'opacity-0 group-hover:opacity-100'
          }`}
          disabled={disabled}
          onClick={() => onSelect(item)}
        >
          {sharing ? <Loader2 className='h-3.5 w-3.5 animate-spin' /> : null}
          {sharing ? '分享中' : '点击添加'}
        </Button>
      </div>

      <div className='flex min-w-0 flex-col justify-center px-0.5'>
        <div className='mt-2 truncate text-sm font-medium text-white'>{item.name || '未命名画布'}</div>
        <div className='mt-1 truncate text-xs text-white/65'>{timeText}</div>
      </div>
    </article>
  );
});

function WorkflowSkeletonGrid() {
  return (
    <div className={WORKFLOW_GRID_CLASS}>
      {Array.from({ length: PAGE_SIZE }).map((_, index) => (
        <div key={index} className='rounded-md bg-[#3b3b3b] p-1.5'>
          <div className='aspect-[16/9] w-full animate-pulse rounded bg-white/10' />
          <div className='mt-2 h-3 w-2/3 animate-pulse rounded bg-white/10' />
          <div className='mt-1 h-2.5 w-1/2 animate-pulse rounded bg-white/10' />
        </div>
      ))}
    </div>
  );
}

export function WorkflowPickerDialog({ open, value, onOpenChange, onConfirm }: WorkflowPickerDialogProps) {
  const [shareLoadingId, setShareLoadingId] = useState('');
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const lastShareClickAtRef = useRef(0);
  const openRef = useRef(open);

  const listQuery = useInfiniteQuery<WorkflowPage, Error>({
    queryKey: ['community-workflow-picker'],
    enabled: open,
    initialPageParam: 1,
    staleTime: 30_000,
    queryFn: ({ pageParam }) => fetchWorkflowPage(Number(pageParam)),
    getNextPageParam: (lastPage, allPages) => {
      const loadedCount = allPages.reduce((sum, page) => sum + page.records.length, 0);
      if (lastPage.total > 0) {
        return loadedCount < lastPage.total ? lastPage.page + 1 : undefined;
      }
      return lastPage.records.length === PAGE_SIZE ? lastPage.page + 1 : undefined;
    },
  });

  const items = useMemo(() => listQuery.data?.pages.flatMap(page => page.records) || [], [listQuery.data?.pages]);
  const sharing = Boolean(shareLoadingId);
  const initialLoading = listQuery.isLoading || (listQuery.isFetching && items.length === 0);

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  useEffect(() => {
    if (!open) {
      setShareLoadingId('');
    }
  }, [open]);

  useEffect(() => {
    if (listQuery.error) {
      toast.error(listQuery.error.message || '画布列表加载失败');
    }
  }, [listQuery.error]);

  const handleListScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      if (!listQuery.hasNextPage || listQuery.isFetchingNextPage) return;

      const target = event.currentTarget;
      const distanceToBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
      if (distanceToBottom <= 120) {
        void listQuery.fetchNextPage();
      }
    },
    [listQuery]
  );

  const getShareCanvasData = async (item: WorkflowCanvasItem) => {
    if (item.data) return item;

    const response: any = await getFlowData({ id: item.id });
    if (!isSuccessResponse(response) || !response.data) {
      throw new Error(response?.msg || '画布详情加载失败');
    }

    return {
      ...item,
      ...response.data,
      id: String(response.data.id || item.id),
      name: response.data.name || item.name,
      thumbnailUrl: response.data.thumbnailUrl || item.thumbnailUrl,
    } as WorkflowCanvasItem;
  };

  const handleSelect = async (item: WorkflowCanvasItem) => {
    const now = Date.now();
    if (sharing || now - lastShareClickAtRef.current < SHARE_CLICK_DEBOUNCE_MS) return;

    lastShareClickAtRef.current = now;
    setShareLoadingId(item.id);

    try {
      const detail = await getShareCanvasData(item);
      const canvasData = detail.data;
      if (!canvasData) {
        toast.error('画布数据为空，无法生成分享链接');
        return;
      }

      const response: any = await shareCanvas({
        canvasId: detail.id,
        canvasData: normalizeCanvasDataForShare(canvasData),
        canvasName: detail.name || '未命名画布',
        thumbnailUrl: detail.thumbnailUrl || '',
      });

      if (!isSuccessResponse(response)) {
        toast.error(response?.msg || '生成分享链接失败');
        return;
      }

      const shareUrl = getShareUrl(response);
      if (!shareUrl) {
        toast.error('生成分享链接失败');
        return;
      }

      if (!openRef.current) return;

      onConfirm({
        title: detail.name || '已选择工作流',
        url: shareUrl,
        coverUrl: detail.thumbnailUrl || '',
        time: detail.updateTime || detail.createTime || '',
      });
      onOpenChange(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : '生成分享链接失败';
      toast.error(message);
    } finally {
      setShareLoadingId('');
    }
  };

  const closeDialog = () => {
    if (sharing) return;
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={nextOpen => (nextOpen ? onOpenChange(true) : closeDialog())}>
      <DialogContent
        data-community-publish-nested-dialog='true'
        className='flex max-w-none flex-col gap-0 overflow-hidden border-white/10 bg-[#242424] p-0 text-white shadow-2xl'
        style={{
          width: 'calc(100vw - 24px)',
          maxWidth: '1200px',
          height: 'calc(100vh - 40px)',
          maxHeight: '720px',
        }}
        overlayClassName='bg-black/60'
        showCloseButton={false}
      >
        <header className='flex h-12 shrink-0 items-center justify-between px-4'>
          <DialogTitle className='text-sm font-semibold text-white'>选择画布</DialogTitle>
          <Button type='button' variant='ghost' size='icon' className='h-8 w-8 text-white/65 hover:bg-white/10 hover:text-white' disabled={sharing} onClick={closeDialog}>
            <X className='h-4 w-4' />
            <span className='sr-only'>关闭</span>
          </Button>
        </header>

        <div ref={scrollContainerRef} className='min-h-0 flex-1 overflow-y-auto px-4 pb-4' onScroll={handleListScroll}>
          {initialLoading ? (
            <WorkflowSkeletonGrid />
          ) : items.length > 0 ? (
            <>
              <div className={WORKFLOW_GRID_CLASS}>
                {items.map(item => (
                  <WorkflowCard
                    key={item.id}
                    item={item}
                    selected={Boolean(value.url) && value.title === item.name}
                    sharing={shareLoadingId === item.id}
                    disabled={sharing}
                    onSelect={handleSelect}
                  />
                ))}
              </div>

              {listQuery.hasNextPage ? (
                <div className='flex h-12 items-center justify-center text-xs text-white/45'>
                  {listQuery.isFetchingNextPage ? (
                    <>
                      <Loader2 className='mr-2 h-3.5 w-3.5 animate-spin' />
                      加载中
                    </>
                  ) : (
                    '向下滚动加载更多'
                  )}
                </div>
              ) : (
                <NoMore show={items.length > 0} text='没有更多画布了' />
              )}
            </>
          ) : (
            <div className='flex h-full min-h-[360px] flex-col items-center justify-center text-white/45'>
              <ImageIcon className='mb-3 h-9 w-9' />
              <div className='text-sm'>暂无画布</div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
