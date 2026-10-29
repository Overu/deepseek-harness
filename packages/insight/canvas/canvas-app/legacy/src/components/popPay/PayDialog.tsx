import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import type { OpenDialogInjectedProps } from '@/components/globalDialog';
import { X } from 'lucide-react';
import OrderHistory from './OrderHistory';
import PopPointDetail from './PopPointDetail';
import PopPointV2 from './PopPointV2';
import PopSubscriptionV2 from './PopSubscriptionV2';
import type { GlobalDialogOptions } from './payPop';

export type PayDialogProps = {
  options: GlobalDialogOptions;
  registerClose: (close: () => void) => () => void;
};

let payScrollLockCount = 0;

const getScrollbarWidth = () => {
  const testDiv = document.createElement('div');
  testDiv.style.cssText = `
        width: 100px;
        height: 100px;
        overflow: scroll;
        position: absolute;
        top: -9999px;
        left: -9999px;
        visibility: hidden;
    `;
  document.body.appendChild(testDiv);

  const scrollbarWidth = testDiv.offsetWidth - testDiv.clientWidth;
  document.body.removeChild(testDiv);

  return scrollbarWidth;
};

const isScrollbarVisible = () => {
  // body 内容高度 > 视口高度（body 滚动）
  const bodyScrollable = document.body.scrollHeight > window.innerHeight;
  // html 内容高度 > 视口高度（html 滚动，部分浏览器会将滚动条挂载在 html 上）
  const htmlScrollable = document.documentElement.scrollHeight > window.innerHeight;

  return bodyScrollable || htmlScrollable;
};

const lockPayScroll = () => {
  if (payScrollLockCount === 0) {
    document.body.dataset.payScrollLocked = '1';
    const scrollbarExists = isScrollbarVisible();
    const scrollbarWidth = scrollbarExists ? getScrollbarWidth() : 0;
    document.body.style.setProperty('--scrollbar-width', `${scrollbarWidth}px`);
  }

  payScrollLockCount += 1;
};

const unlockPayScroll = () => {
  payScrollLockCount = Math.max(0, payScrollLockCount - 1);

  if (payScrollLockCount === 0) {
    delete document.body.dataset.payScrollLocked;
    document.body.style.setProperty('--scrollbar-width', '0px');
  }
};

export const PayDialog = ({ options, registerClose, resolve }: PayDialogProps & OpenDialogInjectedProps<boolean>) => {
  const [isOpen, setIsOpen] = useState(true);
  const settledRef = useRef(false);

  const requestClose = useCallback(() => {
    if (settledRef.current) return;

    settledRef.current = true;
    options.onCancel?.();
    setIsOpen(false);
    resolve(false);
  }, [options, resolve]);

  useEffect(() => {
    lockPayScroll();
    const unregisterClose = registerClose(requestClose);

    return () => {
      unregisterClose();
      unlockPayScroll();
    };
  }, [registerClose, requestClose]);

  const { type = 'history', insufficientPoints = false, fullScreen = false } = options;

  return (
    <Dialog open={isOpen} onOpenChange={open => !open && requestClose()}>
      <DialogContent
        data-payment-layer='true'
        showCloseButton={false}
        overlayClassName='bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:opacity-100 data-[state=closed]:opacity-0'
        className='fixed inset-0 left-0 top-0 z-50 grid h-screen w-screen max-w-none translate-x-0 translate-y-0 gap-0 border-0 bg-transparent p-0 shadow-none duration-200 rounded-none sm:rounded-none data-[state=closed]:slide-out-to-left-0 data-[state=closed]:slide-out-to-top-0 data-[state=open]:slide-in-from-left-0 data-[state=open]:slide-in-from-top-0'
      >
        <DialogTitle className='sr-only'>支付弹窗</DialogTitle>
        <div className={cn('h-full w-full z-20 grid overflow-y-auto relative', fullScreen ? 'p-0' : 'place-items-center p-5')} onClick={requestClose}>
          <div
            className={cn(
              'relative z-20 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-0 data-[state=open]:zoom-in-95 data-[state=open]:opacity-100 data-[state=closed]:opacity-0',
              fullScreen ? 'w-full min-h-full' : 'w-fit h-fit'
            )}
            data-state={isOpen ? 'open' : 'closed'}
            onClick={e => e.stopPropagation()}
          >
            <X size={24} className='absolute top-4 right-6 text-white/65 hover:text-white/95 duration-300 cursor-pointer z-20' onClick={requestClose}></X>
            {type == 'history' && <OrderHistory></OrderHistory>}
            {type == 'detail' && <PopPointDetail></PopPointDetail>}
            {type == 'point' && <PopPointV2 insufficientPoints={insufficientPoints} onClose={requestClose} />}
            {type == 'subscription' && <PopSubscriptionV2 onClose={requestClose}></PopSubscriptionV2>}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
