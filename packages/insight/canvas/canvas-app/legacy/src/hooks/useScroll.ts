import { useEffect, useRef } from 'react';

interface UseScrollParams {
  callback: () => void;
  hasMore: boolean;
  isLoading: boolean;
  enabled?: boolean;
}

export const useScroll = ({ callback, hasMore, isLoading, enabled = true }: UseScrollParams) => {
  const observerRef = useRef<IntersectionObserver>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!sentinelRef.current || !enabled) return;

    const options = {
      root: null,
      rootMargin: '10px',
      threshold: 0.1,
    };

    observerRef.current = new IntersectionObserver(entries => {
      const [entry] = entries;

      if (entry.isIntersecting && !isLoading && hasMore) {
        callback();
      }
    }, options);

    observerRef.current.observe(sentinelRef.current);

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, [isLoading, hasMore, callback, enabled]);

  // 当数据更新时，重新观察哨兵元素
  useEffect(() => {
    if (observerRef.current && sentinelRef.current && enabled) {
      observerRef.current.disconnect();
      observerRef.current.observe(sentinelRef.current);
    }
  }, [enabled]);

  return { sentinelRef };
};
