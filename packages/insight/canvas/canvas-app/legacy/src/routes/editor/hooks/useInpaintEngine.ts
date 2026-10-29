import { useCallback, useEffect, useRef, useState } from 'react';
import { InpaintEngine, type InpaintImageInfo } from '../core/InpaintEngine';

export const useInpaintEngine = (imageUrl?: string) => {
  const engineRef = useRef<InpaintEngine | null>(null);
  const [canvasEl, setCanvasEl] = useState<HTMLCanvasElement | null>(null);
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [imageInfo, setImageInfo] = useState<InpaintImageInfo | null>(null);
  const resizeFrameRef = useRef<number | null>(null);

  const canvasRef = useCallback((node: HTMLCanvasElement | null) => {
    if (node) setCanvasEl(node);
  }, []);

  const containerRef = useCallback((node: HTMLDivElement | null) => {
    if (node) setContainerEl(node);
  }, []);

  const refreshImageInfo = useCallback(() => {
    const info = engineRef.current?.getImageInfo() || null;
    setImageInfo(info);
    return info;
  }, []);

  useEffect(() => {
    if (!canvasEl || !containerEl || !imageUrl) return;

    const engine = new InpaintEngine();
    engineRef.current = engine;
    setIsReady(false);

    engine.init(canvasEl);

    const resizeNow = () => {
      engine.resize(containerEl.clientWidth, containerEl.clientHeight);
      refreshImageInfo();
    };

    const resize = () => {
      if (resizeFrameRef.current !== null) return;
      resizeFrameRef.current = requestAnimationFrame(() => {
        resizeFrameRef.current = null;
        resizeNow();
      });
    };

    const observer = new ResizeObserver(resize);
    observer.observe(containerEl);

    const syncAfterRender = () => refreshImageInfo();
    engine.canvas?.on('after:render', syncAfterRender);

    engine
      .loadImage(imageUrl)
      .then(() => {
        resizeNow();
        setIsReady(true);
        refreshImageInfo();
      })
      .catch(error => {
        console.error('[InpaintEngine] load image failed:', error);
      });

    return () => {
      if (resizeFrameRef.current !== null) {
        cancelAnimationFrame(resizeFrameRef.current);
        resizeFrameRef.current = null;
      }
      observer.disconnect();
      engine.canvas?.off('after:render', syncAfterRender);
      engine.dispose();
      engineRef.current = null;
      setIsReady(false);
      setImageInfo(null);
    };
  }, [canvasEl, containerEl, imageUrl, refreshImageInfo]);

  const recenter = useCallback(() => {
    engineRef.current?.zoomToFit();
    requestAnimationFrame(refreshImageInfo);
  }, [refreshImageInfo]);

  const zoomAt = useCallback(
    (clientX: number, clientY: number, factor: number) => {
      engineRef.current?.zoomAt(clientX, clientY, factor);
      requestAnimationFrame(refreshImageInfo);
    },
    [refreshImageInfo]
  );

  const zoomBy = useCallback(
    (factor: number) => {
      engineRef.current?.zoomBy(factor);
      requestAnimationFrame(refreshImageInfo);
    },
    [refreshImageInfo]
  );

  const panBy = useCallback(
    (deltaX: number, deltaY: number) => {
      engineRef.current?.panBy(deltaX, deltaY);
      requestAnimationFrame(refreshImageInfo);
    },
    [refreshImageInfo]
  );

  return {
    engine: engineRef.current,
    canvasRef,
    containerRef,
    isReady,
    imageInfo,
    recenter,
    zoomAt,
    zoomBy,
    panBy,
  };
};
