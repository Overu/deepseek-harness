import { useEffect } from 'react';
import { useUploadStore } from '../../store/uploadStore';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils'; // Assuming cn utility exists, otherwise will use template literals

export function UploadStatusToast() {
  const { status, message, reset } = useUploadStore();

  useEffect(() => {
    if (status === 'success' || status === 'error') {
      const timer = setTimeout(() => {
        reset();
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [status, reset]);

  if (status === 'idle') return null;

  return (
    <div className='fixed bottom-24 left-1/2 -translate-x-1/2 z-[100] pointer-events-none'>
      <div
        className={cn(
          'flex items-center gap-2.5 px-4 py-2.5 rounded-full shadow-xl transition-all duration-300 animate-in fade-in slide-in-from-bottom-4',
          'bg-zinc-800 border border-zinc-700/50 backdrop-blur-md',
          status === 'error' ? 'bg-red-950/80 border-red-900/50' : ''
        )}
      >
        {status === 'uploading' && <Loader2 className='w-4 h-4 text-blue-400 animate-spin' />}
        {status === 'success' && <CheckCircle2 className='w-4 h-4 text-green-400' />}
        {status === 'error' && <XCircle className='w-4 h-4 text-red-400' />}

        <span className={cn('text-sm font-medium text-white/90', status === 'error' && 'text-red-100')}>{message}</span>
      </div>
    </div>
  );
}
