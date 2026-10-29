import { useCallback, useEffect, useRef, useState, type ReactNode, type SyntheticEvent } from 'react';
import { useFlowStore } from '@/store/flowStore';

function isCopyableTarget(target: HTMLElement) {
  if (target.closest('[data-prompt-copyable]')) return true;
  if (target.closest('.ProseMirror')) return true;
  if (target.closest('textarea')) return true;
  return false;
}

function isCopyShortcut(event: KeyboardEvent) {
  if (!(event.ctrlKey || event.metaKey)) return false;
  const key = event.key.toLowerCase();
  return key === 'c' || key === 'a';
}

interface ReadOnlyPromptGuardProps {
  children: ReactNode;
}

const ReadOnlyPromptGuard = ({ children }: ReadOnlyPromptGuardProps) => {
  const isPromptViewOnly = useFlowStore(state => state.readOnly);
  const containerRef = useRef<HTMLDivElement>(null);
  const [masks, setMasks] = useState<{ top: number; bottom: number } | null>(null);

  const blockIfNeeded = useCallback((event: SyntheticEvent) => {
    const target = event.target as HTMLElement;
    if (isCopyableTarget(target)) {
      if (event.type === 'keydown') {
        const keyboardEvent = event.nativeEvent as KeyboardEvent;
        if (!isCopyShortcut(keyboardEvent)) {
          event.preventDefault();
          event.stopPropagation();
        }
      }
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  }, []);

  useEffect(() => {
    if (!isPromptViewOnly || !containerRef.current) return;
    const textareas = containerRef.current.querySelectorAll('textarea');
    textareas.forEach(textarea => {
      textarea.readOnly = true;
    });
  });

  useEffect(() => {
    if (!isPromptViewOnly || !containerRef.current) return;
    const container = containerRef.current;

    const updateMasks = () => {
      const editorEl = container.querySelector('.ProseMirror, textarea') as HTMLElement | null;
      if (!editorEl) {
        setMasks(null);
        return;
      }
      const containerRect = container.getBoundingClientRect();
      const editorRect = editorEl.getBoundingClientRect();
      setMasks({
        top: Math.max(0, editorRect.top - containerRect.top),
        bottom: Math.max(0, containerRect.bottom - editorRect.bottom),
      });
    };

    updateMasks();
    const observer = new ResizeObserver(updateMasks);
    observer.observe(container);
    const editorEl = container.querySelector('.ProseMirror, textarea');
    if (editorEl) observer.observe(editorEl);
    return () => observer.disconnect();
  }, [isPromptViewOnly]);

  if (!isPromptViewOnly) {
    return <>{children}</>;
  }

  return (
    <div ref={containerRef} className='relative nodrag nopan' onPointerDownCapture={blockIfNeeded} onClickCapture={blockIfNeeded} onKeyDownCapture={blockIfNeeded}>
      {children}
      {masks && masks.top > 0 ? <div className='absolute inset-x-0 top-0 z-10' style={{ height: masks.top }} aria-hidden /> : null}
      {masks && masks.bottom > 0 ? <div className='absolute inset-x-0 bottom-0 z-10' style={{ height: masks.bottom }} aria-hidden /> : null}
    </div>
  );
};

export default ReadOnlyPromptGuard;
