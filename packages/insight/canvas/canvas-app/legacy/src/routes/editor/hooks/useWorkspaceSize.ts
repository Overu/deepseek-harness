import { useState, useEffect } from 'react';
import { useEditorEngine } from './useEditorEngine';

export function useWorkspaceSize() {
  const engine = useEditorEngine();
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!engine) return;

    let unsub: (() => void) | null = null;
    let canvasHandlers: {
      handleObjectAdded?: (e: any) => void;
      handleObjectModified?: (e: any) => void;
    } = {};
    let cleanupTimer: number | null = null;

    const initListener = () => {
      const canvas = engine.getCanvas();

      if (!canvas) {
        // Canvas 还未初始化，50ms 后重试
        cleanupTimer = window.setTimeout(initListener, 50);
        return;
      }

      console.log('useWorkspaceSize: canvas 已初始化，注册监听器');

      const updateSize = (data?: { width: number; height: number }) => {
        let newW = 0;
        let newH = 0;
        // console.log('this-----updateSize', data);

        // 优先使用传入的数据（事件数据），否则查找 workspace 对象
        if (data) {
          newW = Math.floor(data.width);
          newH = Math.floor(data.height);
        } else {
          const workspace = canvas.getObjects().find((obj: any) => obj.id === 'workspace');

          if (workspace) {
            newW = Math.floor(workspace.width || 0);
            newH = Math.floor(workspace.height || 0);
          }
        }

        setSize(prev => {
          if (prev.width === newW && prev.height === newH) {
            return prev;
          }
          return { width: newW, height: newH };
        });
      };

      // 监听 workspace:change 事件 (由 WorkspacePlugin 发出)
      unsub = engine.eventBus.on('workspace:change', updateSize);

      // 监听对象添加，确保初始化时若 workspace 尚未创建也能捕获
      const handleObjectAdded = (e: any) => {
        if (e.target?.id === 'workspace') {
          updateSize();
        }
      };
      canvasHandlers.handleObjectAdded = handleObjectAdded;
      canvas.on('object:added', handleObjectAdded);

      // 备用：也监听 object:modified 以防万一
      const handleObjectModified = (e: any) => {
        if (e.target?.id === 'workspace') {
          updateSize({ width: e.target.width, height: e.target.height });
        }
      };
      canvasHandlers.handleObjectModified = handleObjectModified;
      canvas.on('object:modified', handleObjectModified);

      // 初始获取
      updateSize();
    };

    // 开始尝试初始化
    initListener();

    return () => {
      // 清理定时器
      if (cleanupTimer) {
        clearTimeout(cleanupTimer);
      }

      // 清理事件监听器
      if (unsub) {
        unsub();
      }

      const canvas = engine.getCanvas();
      if (canvas && canvasHandlers.handleObjectAdded) {
        canvas.off('object:added', canvasHandlers.handleObjectAdded);
      }
      if (canvas && canvasHandlers.handleObjectModified) {
        canvas.off('object:modified', canvasHandlers.handleObjectModified);
      }
    };
  }, [engine]);

  const setWorkspaceSize = (width: number, height: number) => {
    if (!engine) return;
    engine.resizeWorkspace(width, height);
    // Optimistic update
    setSize({ width, height });
  };

  return {
    width: size.width,
    height: size.height,
    setSize: setWorkspaceSize,
  };
}
