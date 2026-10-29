import React from 'react';
import { createRoot } from 'react-dom/client';
import { AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatFileSize } from '@/utils';
import { openGlobalDialog } from '@/components/popPay/payPop';
import { getAvailableCapacity } from '@/api/asset';
import { router } from '@/routes';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';

interface StorageCapacity {
  usedCapacity: number;
  limitCapacity: number;
  highestCapacity: number;
}

interface StorageLimitDialogProps {
  open: boolean;
  onClose: () => void;
}

let dialogRoot: ReturnType<typeof createRoot> | null = null;
let dialogContainer: HTMLDivElement | null = null;

const StorageLimitDialog: React.FC<StorageLimitDialogProps> = ({ open, onClose }) => {
  const [capacity, setCapacity] = React.useState<StorageCapacity | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
      const fetchCapacity = async () => {
        try {
          const res: any = await getAvailableCapacity();
          if (res.code === 'SUCCESS' && res.data) {
            setCapacity(res.data);
          }
        } catch (error) {
          console.error('获取资产库容量失败：', error);
        } finally {
          setLoading(false);
        }
      };
      fetchCapacity();
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  const usedStr = capacity ? formatFileSize(capacity.usedCapacity, 1) : '';
  const limitStr = capacity ? formatFileSize(capacity.limitCapacity, 1) : '';
  const isOverLimit = capacity ? capacity.usedCapacity >= capacity.limitCapacity : false;
  const showUpgrade = capacity ? capacity.usedCapacity < capacity.highestCapacity : false;

  const handleGoToDelete = () => {
    router.navigate({ to: '/asset', search: { tab: 'my' } });
    onClose();
  };

  const handleUpgrade = () => {
    openGlobalDialog({ type: 'subscription' });
    onClose();
  };

  return (
    <AnimatePresence>
      {open && (
        <div className='fixed inset-0 z-[9999] flex items-center justify-center p-4'>
          {/* Backdrop */}
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className='absolute inset-0 bg-black/60 backdrop-blur-md' />

          {/* Modal Content */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className='relative w-full max-w-lg overflow-hidden rounded-2xl border border-white/10 bg-[#121212] shadow-2xl'
          >
            <div className='flex flex-col p-8'>
              <div className='flex items-start gap-4'>
                <div className='rounded-full p-2.5 bg-red-500/10 shrink-0'>
                  <AlertCircle className='h-8 w-8 text-red-500' />
                </div>

                <div className='text-left flex-1 min-h-[100px]'>
                  <h3 className='mb-3 text-lg font-bold tracking-tight text-white'>
                    资产库存储空间已达上限
                    {loading ? (
                      <Loader2 className='ml-2 h-4 w-4 animate-spin inline-block opacity-50' />
                    ) : (
                      <>
                        <span className={cn('ml-4', isOverLimit ? 'text-[#F87171]' : 'text-blue-400')}>{usedStr}</span>
                        <span className='text-white/40 font-normal'>/{limitStr}</span>
                      </>
                    )}
                  </h3>

                  <p className='mb-6 text-sm text-white/70 leading-relaxed'>
                    {showUpgrade
                      ? '当前无法进行生成，请到资产库删除部分文件或升级会员套餐以获得更多存储空间。'
                      : '当前无法进行生成，存储空间已耗尽，请前往资产库清理不再需要的文件。'}
                  </p>
                </div>
              </div>

              <div className='flex justify-end gap-3'>
                <Button
                  variant={showUpgrade ? 'ghost' : 'outline'}
                  className={cn('h-10 text-white/80', !showUpgrade && 'btn ins-btn-primary hover:text-white')}
                  onClick={handleGoToDelete}
                >
                  去删除文件
                </Button>
                {showUpgrade && (
                  <Button className='btn ins-btn-primary h-10 px-6 font-semibold' onClick={handleUpgrade} disabled={loading}>
                    升级会员
                  </Button>
                )}
              </div>
            </div>

            {/* Subtle glow effect */}
            <div className='absolute -top-24 -left-24 w-48 h-48 bg-blue-500/10 rounded-full blur-[80px] pointer-events-none' />
            <div className='absolute -bottom-24 -right-24 w-48 h-48 bg-red-500/10 rounded-full blur-[80px] pointer-events-none' />
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

function createDialogContainer() {
  if (dialogContainer) return dialogContainer;
  dialogContainer = document.createElement('div');
  document.body.appendChild(dialogContainer);
  return dialogContainer;
}

export function openStorageLimitDialog() {
  const container = createDialogContainer();
  if (!dialogRoot) dialogRoot = createRoot(container);

  const close = () => {
    dialogRoot?.render(<StorageLimitDialog open={false} onClose={close} />);
    // 动画结束后延迟清理 body 属性 (如果需要)
  };

  dialogRoot.render(<StorageLimitDialog open={true} onClose={close} />);
}
