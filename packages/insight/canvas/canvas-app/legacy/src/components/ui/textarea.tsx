import * as React from 'react';

import { usePreventWheelZoom } from '@/hooks/usePreventWheelZoom';
import { cn } from '@/lib/utils';

export type TextareaProps = React.ComponentPropsWithoutRef<'textarea'> & {
  preventWheelZoom?: boolean;
};

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, preventWheelZoom = true, ...props }, ref) => {
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);

  const setTextareaRef = React.useCallback(
    (node: HTMLTextAreaElement | null) => {
      textareaRef.current = node;

      if (typeof ref === 'function') {
        ref(node);
        return;
      }

      if (ref) {
        ref.current = node;
      }
    },
    [ref]
  );

  usePreventWheelZoom(textareaRef, preventWheelZoom);

  return (
    <textarea
      className={cn(
        'flex min-h-[80px] w-full touch-pan-y rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
        className
      )}
      ref={setTextareaRef}
      {...props}
    />
  );
});
Textarea.displayName = 'Textarea';

export { Textarea };
