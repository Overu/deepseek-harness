import React from 'react';
import { cn } from '@/lib/utils';

export function PropertySeparator({ className }: { className?: string }) {
  return <div className={cn('h-4 w-[1px] bg-border/50 mx-1', className)} />;
}
