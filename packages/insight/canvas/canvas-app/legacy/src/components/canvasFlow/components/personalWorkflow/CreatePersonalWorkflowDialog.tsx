import { useMemo, useState } from 'react';
import type { Edge, Node } from '@xyflow/react';
import { Loader2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { checkCanvasNameDuplicate, saveFlow } from '@/api/workflow';
import UploadPreview from '@/components/common/fileControl/UploadPreview';
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { DialogCancelError } from '@/components/globalDialog/dialogService';
import type { OpenDialogInjectedProps } from '@/components/globalDialog/types';
import useFileUpload from '@/hooks/useFileUpload';
import fileUtil from '@/utils/file';
import defaultCover from '@/assets/images/default_flow.png';
import textCover from '@/assets/images/text_bg.png';
import audioCover from '@/assets/images/audio_bg.png';
import { getPersonalWorkflowCoverCandidate } from '../../utils/personalWorkflow';
import { buildVideoPosterUrl } from '@/components/Asset/util';
import { uploadFile } from '@/services/upload/uploadFile';

interface CreatePersonalWorkflowDialogProps {
  nodes: Node[];
  edges: Edge[];
}

type Props = CreatePersonalWorkflowDialogProps & OpenDialogInjectedProps<string, Error>;

const getResponseData = (response: any) => response?.data ?? response?.body;

export default function CreatePersonalWorkflowDialog({ nodes, edges, resolve, reject }: Props) {
  const candidate = useMemo(() => getPersonalWorkflowCoverCandidate(nodes), [nodes]);
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [manualCoverUrl, setManualCoverUrl] = useState('');

  const autoCoverUrl = useMemo(() => {
    if (candidate.kind === 'image') return candidate.url;
    if (candidate.kind === 'video') return buildVideoPosterUrl(candidate.url);
    if (candidate.kind === 'text') return textCover;
    if (candidate.kind === 'audio') return audioCover;
    return defaultCover;
  }, [candidate]);

  const handleUploadSuccess = (url: string) => setManualCoverUrl(url);
  const { mediaFile, fileInputRef, acceptConfig, handleInputChange, triggerFileInput, handleDelete, handleRetry } = useFileUpload({
    type: 'image',
    onUploadSuccess: handleUploadSuccess,
  });
  const handleCoverDelete = () => {
    handleDelete();
    setManualCoverUrl('');
  };

  const handleClose = () => {
    if (submitting) return;
    reject(new DialogCancelError());
  };

  const handleSubmit = async () => {
    if (submitting || (mediaFile && mediaFile.status !== 'done')) return;
    const workflowName = name.trim();
    if (!workflowName) {
      setNameError('请输入工作流名称');
      return;
    }

    setSubmitting(true);
    setNameError('');
    try {
      const duplicateResponse: any = await checkCanvasNameDuplicate({ name: workflowName, canvasType: 1 });
      if (getResponseData(duplicateResponse)?.duplicated) {
        setNameError('工作流名称重复，请更换名称');
        return;
      }

      const workflowNodes = nodes.map(node =>
        node.type === 'group' && !node.parentId
          ? {
              ...node,
              data: {
                ...node.data,
                title: workflowName,
              },
            }
          : node
      );

      let thumbnailUrl = manualCoverUrl || autoCoverUrl;
      if (!manualCoverUrl && candidate.kind !== 'image' && candidate.kind !== 'video') {
        // 打包资源路径会随部署和版本变化，持久化前先上传为独立封面。
        const coverResponse = await fetch(autoCoverUrl);
        if (!coverResponse.ok) throw new Error('工作流默认封面加载失败，请重试');
        const blob = await coverResponse.blob();
        thumbnailUrl = (await uploadFile(new File([blob], `${candidate.kind}-workflow-cover.png`, { type: blob.type }))).url;
      }

      const response: any = await saveFlow({
        temp: false,
        favorite: false,
        name: workflowName,
        data: JSON.stringify({ nodes: workflowNodes, edges }),
        thumbnailUrl,
        version: 'comfyui',
        canvasType: 1,
      });
      const workflowId = getResponseData(response);
      if (workflowId === undefined || workflowId === null) throw new Error(response?.msg || '创建工作流失败');

      toast.success('个人工作流创建成功');
      resolve(String(workflowId));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '创建工作流失败');
    } finally {
      setSubmitting(false);
    }
  };

  const coverUrl = manualCoverUrl || autoCoverUrl;

  return (
    <Dialog open={true} onOpenChange={nextOpen => !nextOpen && handleClose()}>
      <DialogContent onKeyDown={event => event.stopPropagation()} className='w-[528px] max-w-[calc(100vw-32px)] gap-5 border-white/10 bg-[#303030] text-white'>
        <DialogTitle className='text-lg'>创建工作流</DialogTitle>
        <div className='space-y-2'>
          <label htmlFor='personal-workflow-name' className='flex items-center gap-1 text-sm text-white/80'>
            <span className='text-red-500'>*</span>名称
          </label>
          <input
            id='personal-workflow-name'
            value={name}
            onChange={event => {
              setName(event.target.value);
              if (nameError) setNameError('');
            }}
            placeholder='请输入'
            maxLength={15}
            autoFocus
            className='h-11 w-full rounded-lg border border-transparent bg-white/10 px-3 text-sm text-white outline-none placeholder:text-white/40 focus:border-[#5865f2]'
          />
          {nameError && <p className='text-xs text-red-400'>{nameError}</p>}
        </div>
        <div className='relative aspect-[4/3] w-full overflow-hidden rounded-lg bg-black/30'>
          {mediaFile ? (
            <UploadPreview mediaFile={mediaFile} onDelete={handleCoverDelete} onRetry={handleRetry} />
          ) : (
            <img src={coverUrl} alt='工作流封面' className='h-full w-full object-cover' />
          )}
          {!mediaFile && (
            <button
              type='button'
              onClick={triggerFileInput}
              className='absolute bottom-3 right-3 flex h-9 items-center gap-1.5 rounded-md bg-black/55 px-3 text-sm text-white transition-colors hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60'
            >
              <Upload size={16} />
              替换封面
            </button>
          )}
          <input ref={fileInputRef} type='file' accept={fileUtil.convertToHtmlAccept(acceptConfig.accept)} onChange={handleInputChange} className='hidden' />
        </div>
        <DialogFooter>
          <Button type='button' className='btn ins-btn-primary' disabled={submitting || Boolean(mediaFile && mediaFile.status !== 'done')} onClick={handleSubmit}>
            {submitting && <Loader2 className='h-4 w-4 animate-spin' />}
            确定
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
