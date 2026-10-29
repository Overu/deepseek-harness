import { useCallback, useEffect, useState, type RefObject } from 'react';

interface UseBackToTopOptions {
  scrollTargetRef?: RefObject<HTMLElement | null>;
  threshold?: number;
}

export function useBackToTop({ scrollTargetRef, threshold = 200 }: UseBackToTopOptions = {}) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const scrollTarget = scrollTargetRef?.current ?? window;
    let animationFrameId: number | null = null;

    const updateVisibility = () => {
      animationFrameId = null;
      const scrollTop = scrollTargetRef?.current?.scrollTop ?? window.scrollY;
      const nextVisible = scrollTop >= threshold;

      setIsVisible(currentVisible => (currentVisible === nextVisible ? currentVisible : nextVisible));
    };

    const handleScroll = () => {
      if (animationFrameId !== null) return;
      animationFrameId = window.requestAnimationFrame(updateVisibility);
    };

    handleScroll();
    scrollTarget.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      scrollTarget.removeEventListener('scroll', handleScroll);
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId);
      }
    };
  }, [scrollTargetRef, threshold]);

  const scrollToTop = useCallback(() => {
    const scrollTarget = scrollTargetRef?.current;

    if (scrollTarget) {
      scrollTarget.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [scrollTargetRef]);

  return { isVisible, scrollToTop };
}
