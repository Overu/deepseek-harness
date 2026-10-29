import { useLayoutEffect, useRef } from 'react';

interface AutoResizeHeightOptions {
  minHeight?: number;
  maxHeight?: number;
}

export function useAutoResizeHeight<T extends HTMLElement = HTMLTextAreaElement>(value: unknown, { minHeight = 100, maxHeight = 300 }: AutoResizeHeightOptions = {}) {
  const elementRef = useRef<T>(null);

  useLayoutEffect(() => {
    const element = elementRef.current;
    if (!element) return;

    element.style.height = 'auto';
    element.style.height = `${Math.min(maxHeight, Math.max(minHeight, element.scrollHeight))}px`;
  }, [maxHeight, minHeight, value]);

  return elementRef;
}
