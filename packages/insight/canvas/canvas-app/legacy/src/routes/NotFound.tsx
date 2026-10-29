import { Button } from '@/components/ui/button';
import { useLocation, useNavigate } from '@tanstack/react-router';
import { MoveLeft, Sparkles } from 'lucide-react';

export default function NotFound() {
  const navigate = useNavigate();
  const location = useLocation();

  const handleBack = () => {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }

    navigate({ to: '/squeeze' });
  };

  const handleGoHome = () => {
    navigate({ to: '/squeeze' });
  };

  return (
    <div className='relative min-h-[calc(100vh-4rem)] overflow-hidden bg-background'>
      <div className='absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(65,85,240,0.18),_transparent_36%),linear-gradient(180deg,_rgba(255,255,255,0.04),_rgba(255,255,255,0))]' />
      <div className='absolute left-[-120px] top-20 h-64 w-64 rounded-full bg-[#4155F0]/10 blur-3xl' />
      <div className='absolute right-[-80px] bottom-8 h-56 w-56 rounded-full bg-sky-400/10 blur-3xl' />

      <div className='relative mx-auto flex min-h-screen w-full max-w-4xl items-center justify-center px-6 py-12'>
        <div className='w-full max-w-3xl rounded-[36px] border border-border/70 bg-card/88 p-8 shadow-[0_32px_120px_rgba(65,85,240,0.12)] backdrop-blur md:p-12'>
          <div className='text-[72px] font-semibold leading-none tracking-[-0.04em] text-foreground md:text-[112px]'>404</div>
          <h1 className='mt-4 max-w-2xl text-3xl font-semibold leading-tight text-foreground md:text-4xl'>你访问的地址不存在，可能已经移动。</h1>
          <p className='mt-5 max-w-2xl text-base leading-7 text-muted-foreground md:text-lg'>
            你访问的路径是 <span className='rounded bg-muted px-2 py-1 font-mono text-sm text-foreground'>{location.pathname}</span>
            。可以回到首页继续浏览，也可以返回上一页重新进入。
          </p>

          <div className='mt-8 flex flex-col gap-3 sm:flex-row'>
            <Button size='lg' className='min-w-[156px]' onClick={handleGoHome}>
              前往首页
            </Button>
            <Button size='lg' variant='outline' className='min-w-[156px]' onClick={handleBack}>
              <MoveLeft className='h-4 w-4' />
              返回上一页
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
