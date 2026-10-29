import React from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

interface PropertySelectProps {
  value: string;
  onValueChange: (value: string) => void;
  options: { label: string; value: string }[];
  placeholder?: string;
  className?: string;
}

export function PropertySelect({ value, onValueChange, options, placeholder, className }: PropertySelectProps) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger className={cn('h-7 bg-transparent border-border/40 text-xs focus:ring-0 focus:ring-offset-0', className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className='bg-zinc-900 border-zinc-700'>
        {options.map(option => (
          <SelectItem key={option.value} value={option.value} className='text-xs text-zinc-100 focus:bg-zinc-800'>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
