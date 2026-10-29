import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Camera, ChevronDown, Check, LoaderCircle, Maximize, RotateCcw, X } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuPortal, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { uploadFile } from '@/services/upload/uploadFile';
import AspectRatioHint from '../../../components/common/AspectRatioHint';
import { usePanoramaViewer } from './usePanoramaViewer';
import { PANORAMA_ASPECT_RATIOS, computeFrameRect, getPanoramaAspectRatioLabel, isFullFrameRect, type PanoramaAspectRatio, type PanoramaViewState } from './panoramaUtil';
import { toast } from 'sonner';

const dataURLtoFile = (dataurl: string, filename: string) => {
  const arr = dataurl.split(',');
  const mime = arr[0].match(/:(.*?);/)?.[1] || 'image/png';
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) u8arr[n] = bstr.charCodeAt(n);
  return new File([u8arr], filename, { type: mime });
};

const stopBubble = (e: React.SyntheticEvent) => {
  e.stopPropagation();
};

export interface PanoramaViewerHandle {
  getViewState: () => PanoramaViewState | null;
}

interface PanoramaViewerProps {
  imageUrl: string;
  visible: boolean;
  mode: 'embedded' | 'fullscreen';
  aspectRatio: PanoramaAspectRatio;
  onAspectRatioChange: (ratio: PanoramaAspectRatio) => void;
  closeLabel?: string;
  onClose: () => void;
  onCapture?: (url: string) => void | Promise<void>;
  /** 打开时应用的视角（嵌入/全屏切换） */
  initialView?: PanoramaViewState | null;
  /** 嵌入模式底栏全屏入口 */
  onFullscreen?: () => void;
}

const PanoramaViewer = forwardRef<PanoramaViewerHandle, PanoramaViewerProps>(
  ({ imageUrl, visible, mode, aspectRatio, onAspectRatioChange, closeLabel = '关闭', onClose, onCapture, initialView, onFullscreen }, ref) => {
    const [capturing, setCapturing] = useState(false);
    const viewportRef = useRef<HTMLDivElement>(null);
    const frameOverlayRef = useRef<HTMLDivElement>(null);
    const [frameRect, setFrameRect] = useState<{ width: number; height: number } | null>(null);
    const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });
    const [viewportSize, setViewportSize] = useState({ w: 0, h: 0 });
    const [imageSize, setImageSize] = useState<{ w: number; h: number } | null>(null);

    const { containerRef, ready, resetView, captureFrame, getViewState } = usePanoramaViewer({
      imageUrl,
      enabled: visible,
      initialView,
    });

    useImperativeHandle(ref, () => ({ getViewState }), [getViewState]);

    useEffect(() => {
      if (!visible || !imageUrl) {
        setImageSize(null);
        return;
      }

      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        if (img.naturalWidth > 0 && img.naturalHeight > 0) {
          setImageSize({ w: img.naturalWidth, h: img.naturalHeight });
        }
      };
      img.src = imageUrl;
    }, [visible, imageUrl]);

    useEffect(() => {
      if (!visible || mode !== 'fullscreen' || !viewportRef.current) return;

      const el = viewportRef.current;
      const update = () => setViewportSize({ w: el.clientWidth, h: el.clientHeight });
      update();
      const resizeObserver = new ResizeObserver(update);
      resizeObserver.observe(el);
      return () => resizeObserver.disconnect();
    }, [visible, mode]);

    const fullscreenContentSize = useMemo(() => {
      if (mode !== 'fullscreen' || !imageSize || viewportSize.w <= 0 || viewportSize.h <= 0) return null;
      return computeFrameRect(viewportSize.w, viewportSize.h, `${imageSize.w}:${imageSize.h}`);
    }, [imageSize, mode, viewportSize.h, viewportSize.w]);

    useEffect(() => {
      if (!visible || !frameOverlayRef.current) return;

      const el = frameOverlayRef.current;
      const update = () => {
        const w = el.clientWidth;
        const h = el.clientHeight;
        setContainerSize({ w, h });
        setFrameRect(computeFrameRect(w, h, aspectRatio));
      };

      update();
      const resizeObserver = new ResizeObserver(update);
      resizeObserver.observe(el);
      return () => resizeObserver.disconnect();
    }, [visible, aspectRatio]);

    const isFullFrame = frameRect != null && containerSize.w > 0 && isFullFrameRect(frameRect, containerSize.w, containerSize.h);

    const handleCapture = useCallback(async () => {
      if (capturing || !onCapture) return;
      setCapturing(true);
      toast.success('截图生成中，请稍后');
      try {
        const dataUrl = await captureFrame(aspectRatio);
        if (!dataUrl) return;
        const file = dataURLtoFile(dataUrl, `panorama-capture-${Date.now()}.png`);
        const url = (await uploadFile(file)).url;
        if (url) await onCapture(url);
      } finally {
        setCapturing(false);
      }
    }, [aspectRatio, captureFrame, capturing, onCapture]);

    if (!visible) return null;

    const viewerBody = (
      <div className={`relative flex flex-col ${mode === 'embedded' ? 'pointer-events-none w-full h-full' : 'w-full h-full bg-black'}`}>
        <div className='absolute top-4 left-4 z-20 w-[72px] h-[32px] flex items-center justify-center rounded-lg bg-black/60 text-xs text-white/95 pointer-events-none'>
          全景模式
        </div>
        <button
          type='button'
          className='absolute top-4 right-4 z-20 w-8 h-8 rounded-lg bg-black/60 flex items-center justify-center text-white hover:bg-black/80 transition-colors pointer-events-auto'
          onMouseDown={stopBubble}
          onClick={e => {
            e.stopPropagation();
            onClose();
          }}
        >
          <X size={14} />
          <span className='sr-only'>{closeLabel}</span>
        </button>

        <div ref={viewportRef} className={`relative flex-1 min-h-0 overflow-hidden ${mode === 'fullscreen' ? 'flex items-center justify-center bg-black' : ''}`}>
          <div
            className={`relative ${mode === 'embedded' ? 'w-full h-full' : ''}`}
            style={
              mode === 'fullscreen' && fullscreenContentSize
                ? { width: fullscreenContentSize.width, height: fullscreenContentSize.height }
                : mode === 'fullscreen'
                  ? { width: '100%', height: '100%' }
                  : undefined
            }
          >
            <div ref={containerRef} className='absolute inset-0 w-full h-full nowheel nodrag pointer-events-auto' onWheel={e => e.stopPropagation()} />

            <div ref={frameOverlayRef} className='absolute inset-0 z-10 pointer-events-none flex items-center justify-center'>
              {frameRect ? (
                <div
                  className={`relative border-2 border-white/90 ${mode === 'embedded' && isFullFrame ? 'rounded-2xl' : ''}`}
                  style={{
                    width: frameRect.width,
                    height: frameRect.height,
                    boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.55)',
                  }}
                />
              ) : null}
            </div>
          </div>
        </div>

        <div
          className='absolute bottom-3 left-1/2 -translate-x-1/2 z-20 h-[40px] flex items-center gap-1 px-2 rounded-2xl bg-[#1A1A1A]/90 border border-white/10 shadow-2xl nodrag pointer-events-auto'
          onMouseDown={stopBubble}
          onClick={stopBubble}
        >
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type='button'
                  disabled={!ready || capturing || !onCapture}
                  className='w-7 h-7 shrink-0 rounded-lg bg-[#4155F0] flex items-center justify-center text-white hover:bg-[#4155F0]/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors'
                  onClick={e => {
                    e.stopPropagation();
                    handleCapture();
                  }}
                >
                  {capturing ? <LoaderCircle size={14} className='animate-spin' /> : <Camera size={14} />}
                </button>
              </TooltipTrigger>
              <TooltipContent side='top' className='bg-black border-white/10 text-white'>
                截取
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <div className='flex flex-1 min-w-0 items-center justify-center gap-1 h-7 px-1 rounded-lg cursor-pointer hover:bg-white/10 data-[state=open]:bg-white/10 transition-colors nodrag'>
                <AspectRatioHint ratio={aspectRatio} />
                <span className='text-xs text-white/95'>{aspectRatio}</span>
                <ChevronDown className='w-3 h-3 opacity-40 shrink-0' />
              </div>
            </DropdownMenuTrigger>
            <DropdownMenuPortal>
              <DropdownMenuContent className='min-w-36 w-auto bg-[#1A1A1A] border border-white/10 rounded-lg shadow-2xl z-[9999] p-1' align='center'>
                {PANORAMA_ASPECT_RATIOS.map(ratio => (
                  <DropdownMenuItem
                    key={ratio}
                    onSelect={() => onAspectRatioChange(ratio)}
                    className='px-3 py-2 hover:bg-white/5 outline-none rounded-md text-sm cursor-pointer flex items-center justify-between gap-2 data-[highlighted]:bg-white/5'
                  >
                    <span className='flex items-center gap-2 whitespace-nowrap'>
                      <AspectRatioHint ratio={ratio} />
                      <span className={aspectRatio === ratio ? 'text-[#4155F0]' : ''}>{getPanoramaAspectRatioLabel(ratio)}</span>
                    </span>
                    {aspectRatio === ratio ? <Check className='w-3.5 h-3.5 text-[#4155F0] shrink-0' /> : null}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenuPortal>
          </DropdownMenu>

          <div className='w-px h-4 bg-white/15 shrink-0' />

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type='button'
                  className='w-7 h-7 shrink-0 rounded-lg flex items-center justify-center text-white hover:bg-white/10 transition-colors'
                  onClick={e => {
                    e.stopPropagation();
                    resetView();
                  }}
                >
                  <RotateCcw size={14} />
                </button>
              </TooltipTrigger>
              <TooltipContent side='top' className='bg-black border-white/10 text-white'>
                重置
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {mode === 'embedded' && onFullscreen ? (
            <>
              <div className='w-px h-4 bg-white/15 shrink-0' />
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type='button'
                      className='w-7 h-7 shrink-0 rounded-lg flex items-center justify-center text-white hover:bg-white/10 transition-colors'
                      onClick={e => {
                        e.stopPropagation();
                        onFullscreen();
                      }}
                    >
                      <Maximize size={14} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side='top' className='bg-black border-white/10 text-white'>
                    全屏
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </>
          ) : null}
        </div>
      </div>
    );

    if (mode === 'fullscreen') {
      return createPortal(
        <div className='fixed inset-0 z-[9998] bg-black flex flex-col nodrag nowheel' data-canvas-ignore-drop='true' onClick={e => e.stopPropagation()}>
          {viewerBody}
        </div>,
        document.body
      );
    }

    return (
      <div className='absolute inset-0 z-30 rounded-2xl overflow-hidden nodrag nowheel pointer-events-none' data-canvas-ignore-drop='true'>
        {viewerBody}
      </div>
    );
  }
);

PanoramaViewer.displayName = 'PanoramaViewer';

export default PanoramaViewer;
