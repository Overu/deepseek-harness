import React from 'react';
import { cn } from '@/lib/utils';

interface PropertyItemProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export function PropertyItem({ children, className, ...props }: PropertyItemProps) {
  return (
    <div className={cn('flex items-center gap-1', className)} {...props}>
      {children}
    </div>
  );
}
