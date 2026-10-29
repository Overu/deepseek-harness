import React, { memo, useMemo } from 'react';
import { markdownToHtml } from './markdown';
import styles from './index.module.less';
import { cn } from '@/lib/utils';

interface RichTextViewerProps {
  value: string;
  onDoubleClick?: () => void;
  className?: string;
  placeholder?: string;
}

const RichTextViewer: React.FC<RichTextViewerProps> = ({ value, onDoubleClick, className, placeholder = '暂无内容' }) => {
  const htmlContent = useMemo(() => {
    return markdownToHtml(value || '');
  }, [value]);

  if (!value?.trim()) {
    return (
      <div className={cn('flex h-full w-full items-center justify-center bg-transparent p-4 text-sm text-white/45', className)} onDoubleClick={onDoubleClick}>
        {placeholder}
      </div>
    );
  }

  return (
    <div
      className={cn('h-full w-full overflow-y-auto p-4', styles.textNodeTextarea, styles.richTextContent, className)}
      onDoubleClick={onDoubleClick}
      dangerouslySetInnerHTML={{ __html: htmlContent }}
    />
  );
};

export default memo(RichTextViewer);
