import { useEffect, useRef, useState } from 'react';
import { EditorEngine } from '../../core/EditorEngine';

import { CanvasToolbar } from '../Toolbar/CanvasToolbar';
import { Toolbar } from '../Toolbar/Toolbar';
import { LayerPanel } from '../LayerPanel';
import { InsertPanel } from '../InsertPanel';
import { CropOverlayV2 } from '../CropToolbar';
import { MattingOverlayV2 } from '../MattingToolbar';
import { debounce } from 'lodash-es';
import { Header } from '../Header/Header';
import { loadOptimizedData } from '../../core/utils/canvasSerializer';

// 默认工作区尺寸（首次进入编辑器，未计算图片尺寸前）
const INITIAL_WORKSPACE_SIZE = 1000;

import { queryEditorInfo } from '@/api/editor';
import { useEditorStore } from '../../store/editorStore';
import { calculateMaxDimensions, extractFileHash, filterExistingImages } from '../../core/utils/imageUtils';

export function CanvasStage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isInitialized = useRef(false);
  const [cropTargetId, setCropTargetId] = useState<string | null>(null);
  const [mattingTargetId, setMattingTargetId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Get params from store
  const { canvasId, nodeId } = useEditorStore(state => state.params);
  const isDirty = useEditorStore(state => state.isDirty);
  const resetDocumentState = useEditorStore(state => state.resetDocumentState);

  // 是否处于任何模态模式
  const isModalMode = !!cropTargetId || !!mattingTargetId;

  // 监听浏览器刷新/关闭
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = ''; // Chrome require this
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [isDirty]);

  useEffect(() => {
    const handleResize = debounce(() => {
      const newWidth = window.innerWidth;
      const newHeight = window.innerHeight;

      const engine = EditorEngine.getInstance();

      // 更新 Canvas 容器尺寸
      engine.canvasManager.resize(newWidth, newHeight);

      // 更新 Workspace 尺寸（可选，根据需求决定是否需要）
      // engine.resizeWorkspace(newWidth, newHeight);
    }, 300);

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  useEffect(() => {
    if (!canvasRef.current || isInitialized.current) {
      return;
    }

    const engine = EditorEngine.getInstance({
      workspaceWidth: INITIAL_WORKSPACE_SIZE,
      workspaceHeight: INITIAL_WORKSPACE_SIZE,
    });

    engine.init(canvasRef.current);
    isInitialized.current = true;

    const loadData = async () => {
      const { imageList = [] } = useEditorStore.getState().params;
      const historyPlugin = engine.pluginManager.get('HistoryPlugin') as any;

      try {
        if (historyPlugin?.pause) {
          historyPlugin.pause();
        }

        // Use params from store, with fallbacks if needed, or skip if missing
        if (!canvasId) {
          console.warn('[CanvasStage] No canvasId provided');
          setIsLoading(false);
          return;
        }

        const editorResult: any = await queryEditorInfo({
          canvasId: canvasId,
          nodeId: nodeId,
        });

        const savedData = editorResult?.data?.data ? JSON.parse(editorResult.data.data) : null;
        const hasNodeData = savedData?.objects?.length > 0;

        if (hasNodeData) {
          // 有节点数据 → 加载已保存数据，不重新计算尺寸
          const canvas = engine.getCanvas();
          await loadOptimizedData(canvas, savedData);

          // 检查 imageList 中是否有新图片需要添加
          if (imageList?.length) {
            // 提取已存在图片的 hash
            const existingHashes = new Set<string>();
            canvas.getObjects().forEach((obj: any) => {
              if (obj.type === 'image' && obj.getSrc) {
                const src = obj.getSrc();
                const hash = extractFileHash(src);
                if (hash) existingHashes.add(hash);
              }
            });

            // 添加不存在的图片
            const newImages = filterExistingImages(imageList, existingHashes);
            for (const url of newImages) {
              await engine.addImage(url);
            }
          }

          // 通知 WorkspacePlugin 刷新手柄位置
          setTimeout(() => {
            engine.eventBus.emit('plugin:canvas:loaded');
          }, 0);
        } else {
          // 无节点数据 → 首次编辑，用 value + imageList 计算尺寸
          if (imageList.length > 0) {
            const { width, height } = await calculateMaxDimensions(imageList);
            engine.resizeWorkspace(width, height);

            // 将所有图片添加到工作区（居中）
            for (const url of imageList) {
              await engine.addImage(url);
            }
          } else {
            engine.resizeWorkspace(1000, 1000);
          }
        }
      } catch (error) {
        console.error('[CanvasStage] 加载画布数据失败:', error);
      } finally {
        // 数据加载完成后自动重置画布，确保工作区居中显示
        engine.zoomToFit();

        // 延迟恢复历史记录并设为初始状态，避免组件内部状态异步更新导致多余记录
        setTimeout(() => {
          if (historyPlugin?.resume) {
            historyPlugin.resume();
          }
          if (historyPlugin?.clearAndSaveState) {
            historyPlugin.clearAndSaveState();
          }
          resetDocumentState();
          setIsLoading(false);
        }, 100);
      }
    };

    loadData();
  }, [canvasId, nodeId, resetDocumentState]);

  const handleStartCrop = (objectId: string) => {
    setCropTargetId(objectId);
  };

  const handleConfirmCrop = () => {
    setCropTargetId(null);
    const engine = EditorEngine.getInstance();
    const wp = engine.pluginManager.get('WorkspacePlugin') as any;
    if (wp && typeof wp.updateClipPath === 'function') {
      wp.updateClipPath();
    }
  };

  const handleCancelCrop = () => {
    setCropTargetId(null);
  };

  // 抠图模式处理
  const handleStartMatting = (objectId: string) => {
    setMattingTargetId(objectId);
  };

  const handleConfirmMatting = () => {
    setMattingTargetId(null);
    const engine = EditorEngine.getInstance();
    const wp = engine.pluginManager.get('WorkspacePlugin') as any;
    if (wp && typeof wp.updateClipPath === 'function') {
      wp.updateClipPath();
    }
  };

  const handleCancelMatting = () => {
    setMattingTargetId(null);
  };

  return (
    <div id='workspace' className='fixed inset-0 bg-black w-full h-full flex flex-col overflow-hidden'>
      {/* 全屏 Loading 覆盖层 - 避免首次加载闪烁 */}
      {isLoading && (
        <div className='fixed inset-0 z-[100] bg-black flex items-center justify-center'>
          <div className='flex flex-col items-center gap-4'>
            <div className='w-10 h-10 border-4 border-gray-600 border-t-white rounded-full animate-spin' />
            <span className='text-gray-400 text-sm'>加载中...</span>
          </div>
        </div>
      )}

      {/* 顶部面板 */}
      <Header />

      {/* 画布区域 */}
      <div className='flex-1 flex justify-center items-center relative'>
        <canvas ref={canvasRef} />
        {!isModalMode && <Toolbar onStartCrop={handleStartCrop} onStartMatting={handleStartMatting} />}
        {!isModalMode && <CanvasToolbar />}
        <CropOverlayV2 targetId={cropTargetId} onConfirm={handleConfirmCrop} onCancel={handleCancelCrop} />
        <MattingOverlayV2 targetId={mattingTargetId} canvasId={canvasId} nodeId={nodeId} onConfirm={handleConfirmMatting} onCancel={handleCancelMatting} />

        {/* 右侧图层面板 */}
        {!isModalMode && <LayerPanel />}

        {/* 左侧选入面板 */}
        {!isModalMode && <InsertPanel />}
      </div>
    </div>
  );
}
