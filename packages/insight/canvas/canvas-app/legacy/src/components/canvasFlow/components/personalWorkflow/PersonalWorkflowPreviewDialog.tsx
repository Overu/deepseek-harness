import { useEffect, useState } from 'react';
import { FileText, Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { getFlowData } from '@/api/workflow';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { DialogCancelError } from '@/components/globalDialog/dialogService';
import type { OpenDialogInjectedProps } from '@/components/globalDialog/types';
import { useFlowStore } from '@/store/flowStore';
import WorkflowPreviewCanvas, { type WorkflowPreviewData } from '../WorkflowPreviewCanvas';

export interface PersonalWorkflowPreviewDialogProps {
  id: string;
  name: string;
}

type Props = PersonalWorkflowPreviewDialogProps & OpenDialogInjectedProps<void, Error>;

export default function PersonalWorkflowPreviewDialog({ id, name, resolve, reject }: Props) {
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [workflowData, setWorkflowData] = useState<WorkflowPreviewData | null>(null);
  const { addTemplate } = useFlowStore(state => state.actions);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    setWorkflowData(null);
    getFlowData({ id })
      .then((response: any) => {
        if (cancelled) return;
        const rawData = response?.data?.data ?? response?.body?.data;
        if (!rawData) throw new Error('工作流数据为空');
        const parsed = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
        const nodes = Array.isArray(parsed?.nodes) ? parsed.nodes : [];
        const edges = Array.isArray(parsed?.edges) ? parsed.edges : [];
        if (!nodes.length) throw new Error('工作流节点数据为空');
        setWorkflowData({ nodes, edges });
      })
      .catch(error => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : '工作流加载失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const handleClose = () => {
    if (adding) return;
    reject(new DialogCancelError());
  };

  const handleAdd = async () => {
    if (!workflowData || adding) return;
    setAdding(true);
    try {
      await addTemplate(workflowData.nodes, workflowData.edges);
      toast.success('工作流已加入画布');
      resolve();
    } catch {
      toast.error('加入画布失败，请重试');
    } finally {
      setAdding(false);
    }
  };

  return (
    <Dialog open={true} onOpenChange={nextOpen => !nextOpen && handleClose()}>
      <DialogContent className='flex h-[min(760px,calc(100vh-80px))] w-[calc(100vw-64px)] max-w-[1280px] grid-rows-none flex-col gap-0 overflow-hidden border-white/10 bg-[#161616] p-0 text-white'>
        <DialogTitle className='sr-only'>工作流预览</DialogTitle>
        <header className='flex h-14 shrink-0 items-center justify-between border-b border-white/10 px-5 pr-14'>
          <div className='flex min-w-0 items-center gap-2'>
            <FileText className='h-4 w-4 text-white/60' />
            <h2 className='truncate text-sm font-medium'>{name || '个人工作流'}</h2>
          </div>
          <Button type='button' className='btn ins-btn-primary h-9' disabled={!workflowData || loading || adding} onClick={handleAdd}>
            {adding ? <Loader2 className='h-4 w-4 animate-spin' /> : <Plus className='h-4 w-4' />}
            加入画布
          </Button>
        </header>
        <div className='relative min-h-0 flex-1 bg-black'>
          {loading && (
            <div className='absolute inset-0 z-10 flex items-center justify-center text-sm text-white/60'>
              <Loader2 className='mr-2 h-5 w-5 animate-spin' />
              工作流加载中
            </div>
          )}
          {!loading && loadError && <div className='absolute inset-0 flex items-center justify-center text-sm text-white/60'>{loadError}</div>}
          {workflowData && <WorkflowPreviewCanvas data={workflowData} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}
