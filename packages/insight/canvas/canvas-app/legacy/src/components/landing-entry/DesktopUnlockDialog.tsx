import { useCallback, useRef, useState } from 'react';
import { Link, Monitor, Smartphone } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { copyToClipboard } from '@/utils';
import { cn } from '@/lib/utils';
import type { OpenDialogInjectedProps } from '@/components/globalDialog';
import { getDesktopLoginCopyHref } from './landingEntry';

export interface DesktopUnlockDialogProps {
  copyTarget?: 'dynsight' | 'inflow';
  className?: string;
}

export function DesktopUnlockDialog({ copyTarget = 'dynsight', className, resolve }: DesktopUnlockDialogProps & OpenDialogInjectedProps<boolean>) {
  const [isOpen, setIsOpen] = useState(true);
  const settledRef = useRef(false);

  const requestClose = useCallback(() => {
    if (settledRef.current) return;
    settledRef.current = true;
    setIsOpen(false);
    resolve(false);
  }, [resolve]);

  const handleCopy = async () => {
    await copyToClipboard(getDesktopLoginCopyHref(copyTarget));
    toast.success('已成功复制到剪切板');
    requestClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={open => !open && requestClose()}>
      <DialogContent
        showCloseButton={false}
        overlayClassName='z-[10001] bg-black/70'
        className={cn('z-[10002] w-[min(86vw,424px)] border-0 bg-[#282828] px-6 pb-6 pt-7 text-white shadow-[0_18px_64px_rgba(0,0,0,0.45)] rounded-[24px]', className)}
      >
        <div className='flex items-center justify-center gap-4 text-white/95'>
          <Smartphone className='h-8 w-8 ' aria-hidden='true' />
          <div className='flex items-center gap-1 text-white/65'>
            <span className='h-1 w-1 rounded-full bg-current' />
            <span className='h-1 w-1 rounded-full bg-current' />
            <span className='h-1 w-1 rounded-full bg-current' />
            <span className='h-1 w-1 rounded-full bg-current' />
            <span className='text-xl leading-none'>→</span>
          </div>
          <Monitor className='h-8 w-8 ' aria-hidden='true' />
        </div>

        <DialogTitle className='mt-1 text-center text-sm font-semibold leading-[1.35] text-white'>前往桌面端解锁创作的完整表达</DialogTitle>
        <DialogDescription className='mx-auto max-w-[312px] text-center text-xs leading-5 text-white/70'>
          <span className='block'>让您的想法绽放在更大的舞台。</span>
          {/* <span className='block'>登录链接已发送至您的手机。</span> */}
        </DialogDescription>

        <div className='mt-8 grid grid-cols-2 gap-3'>
          <button type='button' className='inline-flex items-center py-2 justify-center rounded-md bg-white/25 text-sm font-semibold text-white ' onClick={requestClose}>
            知道了
          </button>
          <button type='button' className='inline-flex py-2 items-center justify-center gap-1 rounded-md bg-[#4258ff] text-sm font-semibold text-white' onClick={handleCopy}>
            <Link size={14} aria-hidden='true' />
            复制登录链接
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
