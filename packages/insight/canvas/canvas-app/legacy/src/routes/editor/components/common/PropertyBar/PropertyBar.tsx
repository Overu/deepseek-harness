import React from 'react';
import { cn } from '@/lib/utils';

interface PropertyBarProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export function PropertyBar({ children, className, ...props }: PropertyBarProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 p-1.5 bg-background/95 backdrop-blur-lg border border-border/60 rounded-xl shadow-lg animate-in fade-in slide-in-from-top-2 duration-200',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}
