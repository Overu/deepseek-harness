import { memo } from 'react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { MessageCategory } from '@/api/message';

interface MessageCategoryTabsProps {
  categories: MessageCategory[];
  value: string;
  onValueChange: (value: string) => void;
  compact?: boolean;
}

export const MessageCategoryTabs = memo(function MessageCategoryTabs({ categories, value, onValueChange, compact = false }: MessageCategoryTabsProps) {
  return (
    <Tabs value={value} onValueChange={onValueChange} className='min-w-0'>
      <TabsList className='h-10 max-w-full justify-start gap-5 overflow-x-auto rounded-none bg-transparent p-0'>
        {categories.map(category => (
          <TabsTrigger
            key={category.categoryCode}
            value={category.categoryCode}
            className='relative h-10 rounded-none bg-transparent px-0 text-sm font-medium text-muted-foreground shadow-none transition-colors after:absolute after:bottom-0 after:left-0 after:h-0.5 after:w-full after:origin-left after:scale-x-0 after:bg-[#4257ff] after:transition-transform hover:text-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none data-[state=active]:after:scale-x-100 focus-visible:ring-0 focus-visible:ring-offset-0'
          >
            <span className={compact ? 'text-xs' : undefined}>{category.categoryName}</span>
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
});
