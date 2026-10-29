import vipImage from '@/assets/images/vip.png';
import { LockKeyhole } from 'lucide-react';
import { cn } from '@/lib/utils';

type VipUpgradeOverlayVariant = 'toolList' | 'select';

interface VipUpgradeOverlayProps {
  variant: VipUpgradeOverlayVariant;
}

const VipUpgradeOverlay = ({ variant }: VipUpgradeOverlayProps) => {
  const isToolList = variant === 'toolList';

  return (
    <>
      <span className={cn('pointer-events-none absolute top-1/2 z-[1] -translate-y-1/2 text-white/50', isToolList ? 'right-4' : 'right-3')}>
        <LockKeyhole size={16} />
      </span>
      <div
        className={cn(
          'pointer-events-none absolute inset-0 z-10 flex items-center opacity-0 transition-opacity duration-150 group-hover:opacity-100',
          isToolList ? 'bg-[#303642]' : 'bg-[#3c3c3c]',
          isToolList ? 'px-4' : 'pl-8 pr-3'
        )}
      >
        <div className='flex w-full items-center justify-between gap-3'>
          <div className='flex min-w-0 items-center gap-2 text-sm text-white/90'>
            <img src={vipImage} alt='VIP' className='h-4 w-auto shrink-0' />
            <span className='whitespace-nowrap'>升级会员解锁此功能</span>
          </div>
          <span className='shrink-0 text-white/50'>
            <LockKeyhole size={16} />
          </span>
        </div>
      </div>
    </>
  );
};

export default VipUpgradeOverlay;
