import { useEffect, useMemo, useRef } from 'react';
import { useEditorStore, type EditorParams } from './store/editorStore';
import { useLayerStore } from './store/layerStore';
import { useHistoryStore } from './store/historyStore';
import { useUIStore } from './store/uiStore';
import { useUploadStore } from './store/uploadStore';
import { CanvasStage } from './components/Canvas/CanvasStage';
import { EditorProvider } from './context/EditorContext';
import { EditorEngine } from './core/EditorEngine';
import { DEFAULT_WORKSPACE_HEIGHT, DEFAULT_WORKSPACE_WIDTH } from './core/constants';
import { UploadStatusToast } from './components/common/UploadStatusToast';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

export type EditorModalProps = EditorParams;

export function EditorModal(props: EditorModalProps) {
  const initialPropsRef = useRef(props);
  const initialProps = initialPropsRef.current;

  console.log(
    '%c编辑器打开入参EditorModal：%o',
    'background: #0073d6; border: 1px solid #ddd; padding: 4px 8px; color: #333;', // 样式
    initialProps
  );
  const setParams = useEditorStore(state => state.setParams);

  useEffect(() => {
    setParams(initialPropsRef.current);

    // 弹窗关闭 / 卸载时重置编辑器各类核心状态
    return () => {
      useEditorStore.setState({
        isDirty: false,
        documentVersion: 0,
        layers: [],
        activeIds: [],
        zoom: 1,
        activeTool: 'select',
        brushSettings: { color: '#000000', width: 5, hardness: 100 },
      });
      useLayerStore.setState({
        layers: [],
        activeIds: [],
      });
      useHistoryStore.setState({
        canUndo: false,
        canRedo: false,
        undoCount: 0,
        redoCount: 0,
      });
      useUIStore.setState({
        zoom: 1,
        panelCollapsed: { layer: false, props: false, material: false },
        gridVisible: false,
        rulersVisible: false,
      });
      useUploadStore.setState({
        status: 'idle',
        message: '',
      });
    };
  }, [setParams]);

  const editorEngine = useMemo(() => {
    return EditorEngine.getInstance({
      workspaceWidth: DEFAULT_WORKSPACE_WIDTH,
      workspaceHeight: DEFAULT_WORKSPACE_HEIGHT,
    });
  }, []);

  return (
    <EditorProvider engine={editorEngine}>
      <Dialog open modal={false}>
        <DialogTitle>图片编辑器</DialogTitle>
        <DialogContent
          showCloseButton={false}
          className='h-screen w-screen max-w-none rounded-none border-none p-0 -mt-[1px]'
          onInteractOutside={e => e.preventDefault()}
          onEscapeKeyDown={e => e.preventDefault()}
        >
          <CanvasStage />
          <UploadStatusToast />
        </DialogContent>
      </Dialog>
    </EditorProvider>
  );
}

export default EditorModal;
