import { Button } from '@/components/ui/button';
import { useNavigate } from '@tanstack/react-router';
import { AlertCircle } from 'lucide-react';
import { useEffect } from 'react';

import type { ErrorComponentProps } from '@tanstack/react-router';

interface ErrorLog {
  name: string;
  message: string;
  stack?: string;
  timestamp: number;
  href: string;
}

const STORAGE_KEY = '__ins_crash_logs__';

const ErrorBoundary: React.FC<ErrorComponentProps> = ({ error, reset }) => {
  const navigate = useNavigate();

  useEffect(() => {
    try {
      if (!error) return;

      const newLog: ErrorLog = {
        name: error.name,
        message: error.message,
        stack: error.stack,
        timestamp: Date.now(),
        href: window.location.href,
      };

      const existingLogsStr = localStorage.getItem(STORAGE_KEY);
      let logs: ErrorLog[] = [];
      try {
        logs = existingLogsStr ? JSON.parse(existingLogsStr) : [];
      } catch {
        // Ignore parse error
        logs = [];
      }

      // Limit log size to avoid hitting storage quota (keep last 50)
      const updatedLogs = [...logs, newLog].slice(-50);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedLogs));
    } catch (e) {
      console.error('Failed to save error log', e);
    }
  }, [error]);

  const handleBackToHome = () => {
    navigate({ to: '/squeeze' });
    setTimeout(() => {
      reset();
    }, 100);
  };

  const handleRefresh = () => {
    // Hard reload is often safer for recovering from unknown state
    window.location.reload();
  };

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4'>
      <div className='w-full max-w-md overflow-hidden rounded-xl border border-white/10 bg-background shadow-2xl animate-in fade-in zoom-in-95 duration-200'>
        <div className='flex flex-col p-6 '>
          <div className='flex items-start gap-2'>
            <div className='mb-4 rounded-full  p-3'>
              <AlertCircle className='h-8 w-8 text-blue-600 dark:text-blue-400' />
            </div>

            <div className='text-left'>
              <h2 className='mb-2 text-xl font-semibold tracking-tight text-foreground'>请求异常，请刷新页面重试</h2>

              <p className='mb-6 text-sm text-white/80 leading-relaxed'>抱歉，当前页面发生意外错误。我们已自动记录该问题，您可以尝试刷新页面或返回首页。</p>
            </div>
          </div>

          <div className=' flex self-end gap-3'>
            <Button variant='outline' className='flex-1' size='sm' onClick={handleBackToHome}>
              返回首页
            </Button>
            <Button className='flex-1 btn ins-btn-primary' size='sm' onClick={handleRefresh}>
              刷新重试
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ErrorBoundary;
