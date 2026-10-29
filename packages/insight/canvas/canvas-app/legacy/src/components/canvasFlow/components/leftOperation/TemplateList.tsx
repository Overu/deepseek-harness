import { useMemo, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { CalendarClock, LayoutGrid, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { getFlowsList, getTemplate, getTemplateCategory, getTemplateFlows, reportTemplateFlowUsage } from '@/api/workflow';
import Empty from '@/components/common/scrollGrid/Empty';
import LoadMore from '@/components/common/scrollGrid/LoadMore';
import NoMore from '@/components/common/scrollGrid/NoMore';
import { openDialog } from '@/components/globalDialog';
import { useScroll } from '@/hooks/useScroll';
import { useFlowStore } from '@/store/flowStore';
import { cn } from '@/lib/utils';
import PersonalWorkflowPreviewDialog from '../personalWorkflow/PersonalWorkflowPreviewDialog';
import styles from '../index.module.less';
import TemplateItem from './TemplateItem';

interface TemplateCategory {
  id: string;
  name: string;
}

interface Item {
  id: number | string;
  name: string;
  createTime?: string;
  updateTime?: string;
  thumbnailUrl: string;
}

interface WorkflowPageResult {
  records: Item[];
  total: number;
  page: number;
}

type WorkflowSource = 'personal' | 'public';
type PersonalViewMode = 'timeline' | 'grid';

const PAGE_SIZE = 15;

const getUpdateDateLabel = (updateTime?: string) => {
  if (!updateTime) return '未知日期';
  const date = new Date(updateTime);
  if (Number.isNaN(date.getTime())) {
    const fallbackDate = updateTime.split(/[T ]/)[0];
    return /^\d{4}-\d{2}-\d{2}$/.test(fallbackDate) ? fallbackDate : '未知日期';
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const TemplateFlow = () => {
  const [source, setSource] = useState<WorkflowSource>('personal');
  const [activeCategory, setActiveCategory] = useState('all');
  const [viewMode, setViewMode] = useState<PersonalViewMode>('timeline');
  const { addTemplate } = useFlowStore(state => state.actions);

  const categoriesQuery = useQuery({
    queryKey: ['template-categories'],
    queryFn: async () => {
      const response: any = await getTemplateCategory();
      return (response?.data || response?.body || []) as TemplateCategory[];
    },
    staleTime: 5 * 60 * 1000,
  });

  const categories = categoriesQuery.data || [];
  const categoryTabs = useMemo(() => [{ id: 'all', name: '全部' }, ...categories], [categories]);

  const personalListQuery = useInfiniteQuery<WorkflowPageResult, Error>({
    queryKey: ['personal-workflows'],
    enabled: source === 'personal',
    initialPageParam: 1,
    staleTime: 30_000,
    queryFn: async ({ pageParam = 1 }) => {
      const response: any = await getFlowsList({
        page: Number(pageParam),
        size: PAGE_SIZE,
        temp: false,
        version: 'comfyui',
        canvasType: [1],
      });
      const data = response?.data || response?.body || {};
      return {
        records: (data.records || []) as Item[],
        total: data.total || 0,
        page: Number(pageParam),
      };
    },
    getNextPageParam: (lastPage, allPages) => {
      const loadedCount = allPages.reduce((sum, p) => sum + p.records.length, 0);
      return loadedCount < lastPage.total ? lastPage.page + 1 : undefined;
    },
  });

  const publicListQuery = useInfiniteQuery<WorkflowPageResult, Error>({
    queryKey: ['public-templates', activeCategory],
    enabled: source === 'public',
    initialPageParam: 1,
    staleTime: 60_000,
    queryFn: async ({ pageParam = 1 }) => {
      const response: any = await getTemplateFlows({
        page: Number(pageParam),
        size: PAGE_SIZE,
        categoryIds: activeCategory === 'all' ? [] : [activeCategory],
      });
      const data = response?.data || response?.body || {};
      return {
        records: (data.records || []) as Item[],
        total: data.total || 0,
        page: Number(pageParam),
      };
    },
    getNextPageParam: (lastPage, allPages) => {
      const loadedCount = allPages.reduce((sum, p) => sum + p.records.length, 0);
      return loadedCount < lastPage.total ? lastPage.page + 1 : undefined;
    },
  });

  const currentQuery = source === 'personal' ? personalListQuery : publicListQuery;
  const workflowList = useMemo(() => currentQuery.data?.pages.flatMap(page => page.records) || [], [currentQuery.data?.pages]);
  const total = currentQuery.data?.pages[0]?.total ?? 0;
  const hasMore = Boolean(currentQuery.hasNextPage);
  const loading = currentQuery.isLoading;
  const loadingMore = currentQuery.isFetchingNextPage;

  const { sentinelRef } = useScroll({
    callback: () => {
      if (currentQuery.hasNextPage && !currentQuery.isFetchingNextPage) {
        void currentQuery.fetchNextPage();
      }
    },
    hasMore,
    isLoading: loadingMore,
  });

  const timelineGroups = useMemo(() => {
    const groups = new Map<string, Item[]>();
    [...workflowList]
      .sort((a, b) => {
        const timeA = a.updateTime ? new Date(a.updateTime).getTime() : 0;
        const timeB = b.updateTime ? new Date(b.updateTime).getTime() : 0;
        return timeB - timeA;
      })
      .forEach(item => {
        const label = getUpdateDateLabel(item.updateTime);
        groups.set(label, [...(groups.get(label) || []), item]);
      });
    return [...groups.entries()];
  }, [workflowList]);

  const handleAddPublicWorkflow = async (id: number | string) => {
    const templateId = Number(id);
    reportTemplateFlowUsage({ id: templateId });
    toast.info('正在克隆模板工作流，请稍后...');
    try {
      const response: any = await getTemplate({ id: templateId });
      const rawData = response?.data?.data ?? response?.body?.data;
      if (rawData) {
        const parsed = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
        const nodes = Array.isArray(parsed?.nodes) ? parsed.nodes : [];
        const edges = Array.isArray(parsed?.edges) ? parsed.edges : [];
        if (nodes.length) {
          await addTemplate(nodes, edges);
          toast.success('工作流已加入画布');
        } else {
          toast.error('模板节点数据为空');
        }
      }
    } catch {
      toast.error('加入画布失败，请重试');
    }
  };

  const handlePreviewPersonalWorkflow = (item: Item) => {
    void openDialog(PersonalWorkflowPreviewDialog, {
      id: String(item.id),
      name: item.name,
    }).catch(() => undefined);
  };

  const renderCard = (item: Item) => (
    <TemplateItem
      key={item.id}
      template={item}
      actionLabel={source === 'personal' ? '点击预览工作流' : '点击加入画布'}
      onAdd={source === 'personal' ? () => handlePreviewPersonalWorkflow(item) : handleAddPublicWorkflow}
    />
  );

  const renderListFooter = () => (
    <>
      <LoadMore show={hasMore} loadingMore={loadingMore} sentinelRef={sentinelRef} />
      <NoMore show={total > 0 && !hasMore} text={source === 'personal' ? '没有更多工作流了' : '没有更多模板了'} />
    </>
  );

  return (
    <div className={`flex w-[468px] flex-col rounded-lg border border-[#595959] ${styles.bg}`}>
      <div className='flex h-11 items-end gap-4 rounded-t-lg border-b border-black/5 bg-[#262626] px-4 text-sm text-white'>
        {[
          { id: 'personal' as const, name: '个人工作流' },
          { id: 'public' as const, name: '公共工作流' },
        ].map(tab => (
          <button
            key={tab.id}
            type='button'
            onClick={() => setSource(tab.id)}
            className={cn(
              'relative h-10 px-0.5 text-white/60 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60',
              source === tab.id && 'text-white after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-[#5865f2]'
            )}
          >
            {tab.name}
          </button>
        ))}
        {source === 'personal' && (
          <button
            type='button'
            onClick={() => setViewMode(current => (current === 'timeline' ? 'grid' : 'timeline'))}
            className='mb-1.5 ml-auto flex h-8 items-center gap-1.5 rounded-md px-2 text-sm text-white/70 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60'
          >
            {viewMode === 'timeline' ? <CalendarClock size={16} /> : <LayoutGrid size={16} />}
            {viewMode === 'timeline' ? '时序' : '平铺'}
          </button>
        )}
      </div>
      <div className='flex h-[660px] flex-col gap-3 p-4'>
        {source === 'public' && (
          <div className='flex flex-wrap gap-2'>
            {categoryTabs.map(tab => (
              <button
                key={tab.id}
                type='button'
                className={cn('flex h-8 items-center justify-center rounded-lg px-4 text-sm text-white hover:bg-white/25', activeCategory === tab.id && 'bg-white/10')}
                onClick={() => setActiveCategory(tab.id)}
              >
                {tab.name}
              </button>
            ))}
          </div>
        )}

        {loading ? (
          <div className='flex w-full justify-center py-4'>
            <Loader2 className='h-6 w-6 animate-spin text-muted-foreground' />
          </div>
        ) : (
          <>
            <Empty data={workflowList} />
            {source === 'personal' && viewMode === 'timeline' ? (
              <div className='min-h-0 flex-1 overflow-auto no-scrollbar'>
                {timelineGroups.map(([date, items]) => (
                  <section key={date} className='mb-4'>
                    <h3 className='mb-2 text-sm font-semibold text-white'>{date}</h3>
                    <div className='grid grid-cols-3 gap-2'>{items.map(renderCard)}</div>
                  </section>
                ))}
                {renderListFooter()}
              </div>
            ) : (
              <div className='grid min-h-0 flex-1 grid-cols-3 gap-2 overflow-auto no-scrollbar'>
                {workflowList.map(renderCard)}
                {renderListFooter()}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default TemplateFlow;
