import { cn } from '@/lib/utils';
import React from 'react';

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: React.ReactNode;
  label: React.ReactNode;
  className?: string;
  textClassName?: string;
}

export const IconButton: React.FC<IconButtonProps> = ({ icon, label, className = '', textClassName = '', ...props }) => {
  return (
    <button className={cn('flex items-center gap-2', className)} {...props}>
      {icon}
      <span className={cn('mobile:hidden', textClassName)}>{label}</span>
    </button>
  );
};
