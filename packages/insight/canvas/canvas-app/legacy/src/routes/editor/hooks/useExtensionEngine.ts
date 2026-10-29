import { useEffect, useRef, useState, useCallback } from 'react';
import { ExtensionEngine, type ExtensionResult } from '../core/ExtensionEngine';

export const useExtensionEngine = (imageUrl?: string) => {
  const engineRef = useRef<ExtensionEngine | null>(null);
  const [canvasEl, setCanvasEl] = useState<HTMLCanvasElement | null>(null);
  const canvasRef = useCallback((node: HTMLCanvasElement | null) => {
    if (node) setCanvasEl(node);
  }, []);

  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);
  const containerRef = useCallback((node: HTMLDivElement | null) => {
    if (node) setContainerEl(node);
  }, []);

  const [isReady, setIsReady] = useState(false);
  const [maskSize, setMaskSize] = useState({ width: 0, height: 0 });
  const [tooltip, setTooltip] = useState({ visible: false, x: 0, y: 0, text: '' });

  useEffect(() => {
    if (!canvasEl || !imageUrl) return;

    const engine = new ExtensionEngine();
    engineRef.current = engine;

    engine.setOnMaskChange((width, height) => {
      setMaskSize({ width, height });
    });

    engine.setOnTooltipChange(info => {
      setTooltip(info);
    });

    const initEngine = async () => {
      engine.init(canvasEl);
      // 对于全屏自适应，我们可以监听窗口改变同步更新画布大小
      const updateCanvasSize = () => {
        if (containerEl && engine.canvas) {
          const w = containerEl.clientWidth;
          const h = containerEl.clientHeight;
          if (w > 0 && h > 0) {
            engine.canvas.setWidth(w);
            engine.canvas.setHeight(h);
            engine.canvas.requestRenderAll();
            // 只要宽高稳定跳变，强制居中
            engine.zoomToFit();
          }
        }
      };

      const observer = new ResizeObserver(() => {
        updateCanvasSize();
      });

      if (containerEl) {
        observer.observe(containerEl);
      }

      try {
        await engine.loadImage(imageUrl);
        updateCanvasSize();
        setIsReady(true);
      } catch (err) {
        console.error(err);
      }

      return () => {
        observer.disconnect();
      };
    };

    const cleanupResize = initEngine();

    return () => {
      cleanupResize.then(cleanup => cleanup?.());
      engine.dispose();
      engineRef.current = null;
    };
  }, [imageUrl, canvasEl, containerEl]);

  const resizeMask = useCallback((w: number, h: number) => {
    if (engineRef.current) {
      engineRef.current.resizeMask(w, h);
    }
  }, []);

  const applyRatio = useCallback((ratio: string) => {
    if (engineRef.current) {
      engineRef.current.applyRatio(ratio);
    }
  }, []);

  const recenter = useCallback(() => {
    if (engineRef.current) {
      engineRef.current.zoomToFit();
    }
  }, []);

  const getResult = useCallback((): ExtensionResult | null => {
    return engineRef.current ? engineRef.current.getResult() : null;
  }, []);

  return {
    engine: engineRef.current,
    canvasRef,
    containerRef,
    isReady,
    maskSize,
    tooltip,
    resizeMask,
    applyRatio,
    recenter,
    getResult,
  };
};
