import { ChevronLeft, Loader2, X } from 'lucide-react';
import { useState, useEffect } from 'react';
import UserMenu from '@/components/auth/UserMenu';
import { toast } from 'sonner';
import { useNavigate } from '@tanstack/react-router';
import { PublishWorkDialog, type PublishWorkDialogProps } from '@/components/community/publishDialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { Input } from '@/components/ui/input';
import { deleteFlow, reportTemplateFlowUsage, shareCanvas } from '@/api/workflow';
import { useFlowStore } from '@/store/flowStore';
import { copyToClipboard } from '@/utils';
import { CANVAS_ONBOARDING_TARGETS } from '../../onboarding';

interface HeaderProps {
  name: string;
  temp: boolean;
  id: string;
  thumbnailUrl: string;
  templateId?: number | string;
}

interface ConfirmDialogState {
  open: boolean;
  title: string;
  content: string;
  tip: string;
  onConfirm: () => void;
}

interface NameInputDialogState {
  open: boolean;
  onConfirm: (currentInputName: string) => void;
}

type ShareAction = 'publish' | 'copy';

const Header = ({ name, temp, id, thumbnailUrl, templateId }: HeaderProps) => {
  const navigator = useNavigate();
  const [editName, setEditName] = useState(name);
  const [inputName, setInputName] = useState('');
  const nodes = useFlowStore(state => state.nodes);
  const edges = useFlowStore(state => state.edges);
  const canvasId = useFlowStore(state => state.canvasId);
  const readOnly = useFlowStore(state => state.readOnly);
  const saveFlow = useFlowStore(state => state.actions.saveFlow);
  const [shareMenuOpen, setShareMenuOpen] = useState(false);
  const [shareAction, setShareAction] = useState<ShareAction | null>(null);
  const [publishDialogOpen, setPublishDialogOpen] = useState(false);
  const [publishInitialValue, setPublishInitialValue] = useState<PublishWorkDialogProps['initialValue']>();
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState>({
    open: false,
    title: '',
    content: '',
    tip: '',
    onConfirm: () => {},
  });
  const [nameInputDialog, setNameInputDialog] = useState<NameInputDialogState>({
    open: false,
    onConfirm: () => {},
  });

  useEffect(() => {
    setEditName(name);
  }, [name]);

  const handleEdit = async () => {
    if (editName === name) return;
    if (!editName) {
      toast.error('命名不能为空');
      setEditName(name);
      return;
    }

    const params = {
      id,
      name: editName,
      version: 'comfyui',
    };
    await saveFlow(params);
  };

  const handleBack = () => {
    if (temp) {
      openConfirmDialog('是否保存该项目？', '项目尚未保存，如果离开会丢失之前改动的内容（建议立即保存）', '保存后，项目将保存在"我的项目"中', () => {
        setInputName(editName);
        setConfirmDialog(prev => ({ ...prev, open: false }));
        // 打开工作流名称输入弹窗
        openNameInputDialog(async currentInputName => {
          if (!currentInputName.trim()) {
            toast.error('工作流名称不能为空');
            return;
          }

          const saveParams = {
            id,
            temp: false,
            name: currentInputName,
            version: 'comfyui',
          };
          const result: any = await saveFlow(saveParams);
          if (result.code == 'SUCCESS') {
            if (templateId) {
              reportTemplateFlowUsage({ id: templateId });
            }
            closeNameInputDialog();
          }
        });
      });
    } else {
      navigate();
    }
  };

  const navigate = () => {
    navigator({
      to: '/workflow',
    });
  };

  const createCanvasShareUrl = async () => {
    const canvasData = {
      nodes: nodes.map(item => {
        const nextData = { ...item.data };
        if (item.data.taskInfo) {
          nextData.taskInfo = {
            ...item.data.taskInfo,
            status: 'success',
          };
        }
        if (item.data.storyboardInfo) {
          nextData.storyboardInfo = {
            ...item.data.storyboardInfo,
            status: 'success',
          };
        }
        if (item.data.taskInfo || item.data.storyboardInfo) {
          return {
            ...item,
            data: nextData,
          };
        }
        return item;
      }),
      edges,
    };
    const res: any = await shareCanvas({
      canvasId,
      canvasData: JSON.stringify(canvasData),
      canvasName: name,
      thumbnailUrl,
    });

    if (res.code != 'SUCCESS' || !res.data?.code) {
      throw new Error('生成分享链接失败');
    }

    return `${window.location.origin}/share/${res.data.code}`;
  };

  const handleCopyCanvasLink = async () => {
    if (shareAction) return;

    setShareAction('copy');
    try {
      toast.success('开始备份，请稍后');
      const shareUrl = await createCanvasShareUrl();
      await copyToClipboard(shareUrl);
      toast.success('分享成功，链接已复制到剪贴板');
    } catch {
      toast.error('分享失败，请重试');
    } finally {
      setShareAction(null);
      setShareMenuOpen(false);
    }
  };

  const handlePublishToCommunity = async () => {
    if (shareAction) return;

    setShareAction('publish');
    try {
      toast.success('开始备份，请稍后');
      const shareUrl = await createCanvasShareUrl();
      const canvasInitialValue = {
        canvasShareUrl: shareUrl,
        canvasShareTitle: name || '当前画布',
        canvasShareCoverUrl: thumbnailUrl,
      };

      setPublishInitialValue({
        VIDEO: canvasInitialValue,
        IMAGE: canvasInitialValue,
      });
      setShareMenuOpen(false);
      setPublishDialogOpen(true);
    } catch {
      toast.error('生成分享链接失败，请重试');
    } finally {
      setShareAction(null);
    }
  };

  // 打开确认弹窗
  const openConfirmDialog = (title: string, content: string, tip: string, onConfirm: () => void) => {
    setConfirmDialog({
      open: true,
      title,
      content,
      tip,
      onConfirm,
    });
  };

  const closeConfirmDialog = async () => {
    try {
      await deleteFlow({ id });
    } catch {
      // request.ts 已统一处理错误提示
    }
    navigate();
    setConfirmDialog(prev => ({ ...prev, open: false }));
  };

  const dismissConfirmDialog = () => {
    setConfirmDialog(prev => ({ ...prev, open: false }));
  };

  // 打开工作流名称输入弹窗
  const openNameInputDialog = (onConfirm: (currentInputName: string) => void) => {
    setNameInputDialog({
      open: true,
      onConfirm,
    });
  };

  const closeNameInputDialog = () => {
    navigate();
    setNameInputDialog(prev => ({ ...prev, open: false }));
  };

  const dismissNameInputDialog = () => {
    setNameInputDialog(prev => ({ ...prev, open: false }));
  };

  const renderDialog = () => {
    return confirmDialog.open ? (
      <AlertDialog open={confirmDialog.open}>
        <AlertDialogContent>
          <button
            type='button'
            aria-label='关闭'
            onClick={dismissConfirmDialog}
            className='absolute right-4 top-4 rounded-sm text-white/70 transition-colors hover:text-white focus:outline-none focus:ring-2 focus:ring-white/70'
          >
            <X className='h-4 w-4' />
          </button>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmDialog.title}</AlertDialogTitle>
            <AlertDialogDescription className='text-sm text-white'>{confirmDialog.content}</AlertDialogDescription>
            <AlertDialogDescription className='text-xs text-[#ffffffa6] mt-2'>{confirmDialog.tip}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={closeConfirmDialog}>不保存，离开</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDialog.onConfirm}>保存</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    ) : nameInputDialog.open ? (
      <AlertDialog open={nameInputDialog.open}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle></AlertDialogTitle>
            <AlertDialogDescription className='text-sm text-white'>工作流名称</AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            value={inputName}
            onChange={e => setInputName(e.target.value)}
            placeholder='请输入工作流名称'
            onKeyDown={e => {
              e.stopPropagation();
              if (e.key === 'Enter') {
                nameInputDialog.onConfirm(inputName);
              }
            }}
          />
          <AlertDialogFooter>
            <AlertDialogCancel onClick={dismissNameInputDialog}>取消保存</AlertDialogCancel>
            <AlertDialogAction onClick={() => nameInputDialog.onConfirm(inputName)}>确定</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    ) : null;
  };

  return (
    <>
      <div className='absolute top-0 left-0 p-4'>
        <div className='flex items-center gap-5'>
          <div className='w-10 h-10 rounded-lg flex items-center justify-center bg-white/25 cursor-pointer backdrop-blur-md' onClick={handleBack}>
            <ChevronLeft size={18} color='#fff' />
          </div>
          <input
            type='text'
            value={editName}
            onChange={e => setEditName(e.target.value)}
            onBlur={handleEdit}
            onKeyDown={e => {
              e.stopPropagation();
              if (e.key === 'Enter') {
                handleEdit();
              }
            }}
            className='flex-1 mr-2 bg-transparent border-none outline-none truncate cursor-text text-white text-sm'
          />
        </div>
      </div>
      {!readOnly && (
        <div className='absolute top-0 right-0 p-4 flex items-center gap-2'>
          <HoverCard open={shareMenuOpen} onOpenChange={open => !shareAction && setShareMenuOpen(open)} openDelay={120} closeDelay={160}>
            <HoverCardTrigger asChild>
              <button
                type='button'
                data-onboarding-target={CANVAS_ONBOARDING_TARGETS.share}
                className='h-8 rounded-lg px-4 text-sm text-white bg-white/25 backdrop-blur-md cursor-pointer hover:bg-white/45'
              >
                分享
              </button>
            </HoverCardTrigger>
            <HoverCardContent align='end' side='bottom' sideOffset={6} className='w-[132px] rounded-lg border-white/10 bg-[#2f2f2f] p-1 text-white shadow-xl'>
              <button
                type='button'
                className='flex h-8 w-full items-center text-left gap-1.5 rounded-md px-3 text-xs text-white/85 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-50'
                disabled={Boolean(shareAction)}
                onClick={handlePublishToCommunity}
              >
                {shareAction === 'publish' && <Loader2 className='h-3.5 w-3.5 animate-spin' />}
                发布到社区
              </button>
              <button
                type='button'
                className='flex h-8 w-full items-center gap-1.5 rounded-md px-3 text-xs text-white/85 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-50'
                disabled={Boolean(shareAction)}
                onClick={handleCopyCanvasLink}
              >
                {shareAction === 'copy' && <Loader2 className='h-3.5 w-3.5 animate-spin' />}
                复制画布链接
              </button>
            </HoverCardContent>
          </HoverCard>
          <UserMenu></UserMenu>
        </div>
      )}
      {renderDialog()}
      <PublishWorkDialog canvasId={canvasId} open={publishDialogOpen} onOpenChange={setPublishDialogOpen} initialValue={publishInitialValue} />
    </>
  );
};

export default Header;
