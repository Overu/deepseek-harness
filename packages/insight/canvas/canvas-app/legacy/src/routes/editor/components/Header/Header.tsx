import React from 'react';
import { Button } from '@/components/ui/button';
import { Download, Save, X, Loader2 } from 'lucide-react';
import { ButtonGroup } from '@/components/ui/button-group';
import InsTooltip from '@/components/ui/ins-tooltip';
import { toast } from 'sonner';
import { DownloadDialog } from './DownloadDialog';
import { useEditorEngine } from '../../hooks/useEditorEngine';
import { analyzeCanvasData } from '../../core/utils/canvasSerializer';
import { uploadEditorInfo } from '@/api/editor';
import { ExitConfirmDialog } from './ExitConfirmDialog';
import { uploadFile } from '@/services/upload/uploadFile';

import { useEditorStore } from '../../store/editorStore';

const dataURLtoFile = (dataurl: string, filename: string) => {
  const arr = dataurl.split(',');
  const mime = arr[0].match(/:(.*?);/)?.[1];
  if (!arr[1]) return null;
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new File([u8arr], filename, { type: mime });
};

export const Header: React.FC = () => {
  const [downloadOpen, setDownloadOpen] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);
  const [exitConfirmOpen, setExitConfirmOpen] = React.useState(false);
  const engine = useEditorEngine();

  // Get params from store
  const { onClose, onSuccess, canvasId, nodeId } = useEditorStore(state => state.params);
  const isDirty = useEditorStore(state => state.isDirty);
  const markDocumentSaved = useEditorStore(state => state.markDocumentSaved);
  const resetDocumentState = useEditorStore(state => state.resetDocumentState);

  const handleExit = () => {
    if (isSaving) return;

    if (isDirty) {
      setExitConfirmOpen(true);
      return;
    }
    if (onClose) {
      onClose();
      return;
    }
  };

  const handleDownload = () => {
    setDownloadOpen(true);
  };

  const saveEditor = async (): Promise<boolean> => {
    const documentState = useEditorStore.getState();
    if (!documentState.isDirty || isSaving) return false;

    setIsSaving(true);

    const canvas = engine.getCanvas();
    const savedVersion = documentState.documentVersion;
    const analysis = analyzeCanvasData(canvas);
    const serializedData = JSON.stringify(analysis.optimizedData);

    try {
      const dataUrl = engine.exportImage({
        format: 'png',
        quality: 1,
        multiplier: 1,
      });

      if (!dataUrl) {
        toast.error('生成图片失败');
        return false;
      }

      const file = dataURLtoFile(dataUrl, `cover-${Date.now()}.png`);
      if (!file) {
        toast.error('图片转换失败');
        return false;
      }

      const coverUrl = (await uploadFile(file)).url;
      await uploadEditorInfo({
        canvasId: canvasId || '',
        nodeId: nodeId || '',
        coverUrl,
        data: serializedData,
      });

      markDocumentSaved(savedVersion);
      const hasNewChanges = useEditorStore.getState().isDirty;

      toast.success(hasNewChanges ? '保存成功，仍有未保存的更改' : '保存成功');
      onSuccess?.(coverUrl);

      return !hasNewChanges;
    } catch (error) {
      console.error('Save failed:', error);
      toast.error('保存失败，请重试');
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveClick = () => {
    void saveEditor();
  };

  return (
    <>
      <div className='h-14 w-full fixed bg-none  flex items-center justify-between px-4 z-50  shrink-0'>
        <div className='flex items-center  bg-background px-2 py-1 rounded-sm'>
          <span className='text-sm font-semibold text-foreground select-none'>图片编辑器</span>
        </div>

        <div className='flex items-center gap-2'>
          <ButtonGroup className='bg-background rounded-lg px-2'>
            <InsTooltip label='下载'>
              <Button variant='outline' size='sm' className='border-none rounded-none' onClick={handleDownload}>
                <Download />
              </Button>
            </InsTooltip>

            <InsTooltip label='保存'>
              <Button variant='outline' size='sm' className='border-none rounded-none' onClick={handleSaveClick} disabled={!isDirty || isSaving}>
                {isSaving ? <Loader2 className='h-4 w-4 animate-spin' /> : <Save />}
              </Button>
            </InsTooltip>

            <InsTooltip label='退出'>
              <Button variant='outline' size='sm' className='border-none rounded-none' onClick={handleExit} disabled={isSaving}>
                <X />
              </Button>
            </InsTooltip>
          </ButtonGroup>
        </div>
      </div>
      <DownloadDialog open={downloadOpen} onOpenChange={setDownloadOpen} />
      <ExitConfirmDialog
        open={exitConfirmOpen}
        onOpenChange={setExitConfirmOpen}
        onDirectExit={() => {
          setExitConfirmOpen(false);
          resetDocumentState();
          if (onClose) onClose();
        }}
        onConfirmSave={async () => {
          const canExit = await saveEditor();
          if (canExit) {
            setExitConfirmOpen(false);
            if (onClose) onClose();
          }
          return canExit;
        }}
      />
    </>
  );
};
