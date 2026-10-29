import { type ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';

interface MobileFullscreenDialogProps {
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  title?: string | ReactNode;
  children?: ReactNode;
}

export function MobileFullscreenDialogHeader({ title, onBack }: { title: string | ReactNode; onBack?: () => void }) {
  return (
    <div className='flex h-12 flex-none items-center gap-4 border-b border-white/10 px-4 bg-[#050505]'>
      <button type='button' className='flex h-8 w-8 items-center justify-center rounded-md text-white/85  hover:bg-white/10 hover:text-white' onClick={onBack} aria-label='返回'>
        <ArrowLeft className='h-5 w-5' />
      </button>
      {typeof title !== 'string' ? title : title && <span className='text-base font-medium'>{title}</span>}
    </div>
  );
}

export function MobileFullscreenDialog({ open, onOpenChange, title, children }: MobileFullscreenDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className='!left-0 !top-0 flex h-[100dvh] w-screen max-w-none !translate-x-0 !translate-y-0 flex-col gap-0 border-0 bg-[#050505] p-0 text-white shadow-none sm:rounded-none'
        overlayClassName='bg-black/80'
      >
        <MobileFullscreenDialogHeader title={title} onBack={() => onOpenChange?.(false)} />
        {children}
      </DialogContent>
    </Dialog>
  );
}
