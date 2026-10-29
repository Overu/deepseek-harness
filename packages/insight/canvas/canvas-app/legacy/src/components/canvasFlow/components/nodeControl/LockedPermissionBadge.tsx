import { Lock } from 'lucide-react';
import { memo } from 'react';

interface LockedPermissionBadgeProps {
  className?: string;
  text?: string;
  iconSize?: number;
}

const LockedPermissionBadge = ({ className = '', text = '升级会员解锁功能', iconSize = 18 }: LockedPermissionBadgeProps) => {
  return (
    <div className={`flex items-center gap-2 text-white whitespace-nowrap select-none ${className}`}>
      <Lock size={iconSize} className='shrink-0' />
      <span className='text-base'>{text}</span>
    </div>
  );
};

export default memo(LockedPermissionBadge);
