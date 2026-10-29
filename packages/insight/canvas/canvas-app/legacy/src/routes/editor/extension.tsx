import React, { useEffect, useRef, useState } from 'react';
import { ExtensionCanvas } from './components/Extension/ExtensionCanvas';
import { ExtensionToolbar } from './components/Extension/ExtensionToolbar';
import { useExtensionEngine } from './hooks/useExtensionEngine';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

export interface OutpaintingSubmitPayload {
  imageUrlList: string[];
  imageParam: {
    resolution: string;
    aspectRatio: string;
    canvasSize: unknown;
    imageLayout: unknown;
  };
}

export interface OutpaintingExtensionProps {
  canvasId?: string;
  nodeId?: string;
  value?: string;
  imageList?: string[];
  onClose?: () => void;
  /** @deprecated 任务创建已上移到 SizeAdaptTool */
  onSuccess?: (value: string) => void;
  onSubmitTask?: (payload: OutpaintingSubmitPayload) => Promise<boolean>;
}

export default function OutpaintingExtension(props: OutpaintingExtensionProps) {
  const initialPropsRef = useRef(props);
  const { canvasId, nodeId, value, imageList, onClose, onSubmitTask } = initialPropsRef.current;
  const targetImageUrl = imageList && imageList.length > 0 ? imageList[0] : value;
  const { canvasRef, containerRef, isReady, maskSize, tooltip, resizeMask, applyRatio, recenter, getResult } = useExtensionEngine(targetImageUrl);
  const [isSending, setIsSending] = useState(false);

  // 阻止浏览器的默认滚动，防止因触摸产生页面位移
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  const handleSend = async (resolution: string, aspectMode: string) => {
    if (!isReady) {
      toast.error('编辑器尚未初始化完成，请稍后');
      return;
    }

    if (isSending) return;

    if (!targetImageUrl) {
      toast.error('未获取到有效的原图订阅地址');
      return;
    }

    if (!canvasId || !nodeId) {
      toast.error('画板上下文信息缺失，请刷新后再试');
      return;
    }

    const result = getResult();
    if (!result) {
      toast.error('获取扩图参数失败，请尝试重新调整选区');
      return;
    }

    setIsSending(true);
    try {
      const payload: OutpaintingSubmitPayload = {
        imageUrlList: [targetImageUrl],
        imageParam: {
          resolution: resolution, //输出分辨率
          aspectRatio: aspectMode, //输出宽高比
          canvasSize: result.canvasSize,
          imageLayout: result.imageLayout,
        },
      };

      if (onSubmitTask) {
        const ok = await onSubmitTask(payload);
        if (ok) {
          toast.success('扩图任务提交成功');
          setTimeout(() => {
            onClose?.();
          }, 800);
        }
        return;
      }

      toast.error('扩图提交入口未就绪，请刷新后重试');
    } catch (error: any) {
      toast.error(error?.message || '网络请求失败，请检查网络连接');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Dialog open modal={false} onOpenChange={open => !open && onClose?.()}>
      <DialogTitle className='sr-only'>图片扩图编辑器</DialogTitle>
      <DialogContent
        showCloseButton={false}
        overlayClassName='z-[39]'
        className='z-[40] h-screen w-screen max-w-none rounded-none border-none bg-[#1C1C1E] p-0 overflow-hidden'
        onInteractOutside={e => e.preventDefault()}
        onEscapeKeyDown={e => e.preventDefault()}
      >
        <div className='relative w-full h-full flex flex-col items-center justify-center overflow-hidden'>
          {/* 顶部退出按键 */}
          <div className='pointer-events-auto fixed right-4 top-4 z-[60]'>
            <button
              type='button'
              onClick={onClose}
              className='p-2 bg-background/50 backdrop-blur-md rounded-full hover:bg-background/80 disabled:opacity-50 disabled:cursor-not-allowed transition-all text-white border border-border/50'
              aria-label='关闭扩图编辑器'
            >
              <X className='w-5 h-5' />
            </button>
          </div>

          <div className='w-full h-full relative'>
            <ExtensionCanvas canvasRef={canvasRef} containerRef={containerRef} isReady={isReady} />
          </div>

          <ExtensionToolbar maskSize={maskSize} onResizeMask={resizeMask} onApplyRatio={applyRatio} onRecenter={recenter} onSend={handleSend} isLoading={isSending} />

          {/* 实时动态尺寸气泡悬浮窗 */}
          {tooltip.visible && (
            <div
              className='pointer-events-none fixed z-[42] flex items-center justify-center rounded-md border border-white/10 bg-black/75 px-2.5 py-1.5 font-mono text-[13px] tracking-wider text-white shadow-lg backdrop-blur-md'
              style={{
                left: tooltip.x,
                top: tooltip.y,
                transform: 'translate(-115%, -115%)', // 保持在鼠标左上方，并留出缝隙以免遮挡指针
              }}
            >
              {tooltip.text}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
