import { useEffect, type RefObject } from 'react';

export function usePreventWheelZoom<T extends HTMLElement>(targetRef: RefObject<T | null>, enabled = true) {
  useEffect(() => {
    if (!enabled) return;

    const target = targetRef.current;
    if (!target) return;

    const listenerOptions: AddEventListenerOptions = { passive: false };
    const preventDefault = (event: Event) => {
      if (event.cancelable) {
        event.preventDefault();
      }
    };

    const preventCtrlWheelZoom = (event: WheelEvent) => {
      if (event.ctrlKey) {
        preventDefault(event);
      }
    };

    target.addEventListener('wheel', preventCtrlWheelZoom, listenerOptions);
    target.addEventListener('gesturestart', preventDefault, listenerOptions);
    target.addEventListener('gesturechange', preventDefault, listenerOptions);

    return () => {
      target.removeEventListener('wheel', preventCtrlWheelZoom, listenerOptions);
      target.removeEventListener('gesturestart', preventDefault, listenerOptions);
      target.removeEventListener('gesturechange', preventDefault, listenerOptions);
    };
  }, [enabled, targetRef]);
}
