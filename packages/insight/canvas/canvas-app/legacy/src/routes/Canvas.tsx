import CanvasFlow from '@/components/canvasFlow/index';
import { Button } from '@/components/ui/button';
import { useWorkflowTabGuard } from '@/hooks/useWorkflowTabGuard';
import { ReactFlowProvider } from '@xyflow/react';
import { useParams } from '@tanstack/react-router';
import { CircleAlert } from 'lucide-react';

export default function Canvas() {
  const { id } = useParams({ strict: false }) as { id: string };
  const tabStatus = useWorkflowTabGuard(id);

  if (tabStatus === 'checking') {
    return (
      <div className='flex min-h-screen items-center justify-center bg-background'>
        <div className='h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-primary' aria-label='正在加载工作流' />
      </div>
    );
  }

  if (tabStatus === 'inactive') {
    return (
      <main className='flex min-h-screen items-center justify-center bg-black px-3'>
        <section className='w-full max-w-[604px] rounded-xl bg-[#262626] px-10 py-9 text-left text-white'>
          <div className='flex items-center gap-5'>
            <CircleAlert className='h-6 w-6 shrink-0 text-[#4155F0]' aria-hidden='true' />
            <h1 className='text-xl font-semibold'>会话已过期</h1>
          </div>
          <p className='mt-3 pl-11 text-base text-white/65'>此画布已在其他标签页或浏览器中打开，请刷新页面以继续编辑</p>
          <div className='mt-8 flex justify-end gap-3'>
            <Button className='h-11 px-5 text-base btn ins-btn-primary' onClick={() => window.location.reload()}>
              刷新页面
            </Button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <div style={{ height: '100vh', width: '100%', position: 'relative' }}>
      <ReactFlowProvider>
        <CanvasFlow></CanvasFlow>
      </ReactFlowProvider>
    </div>
  );
}
