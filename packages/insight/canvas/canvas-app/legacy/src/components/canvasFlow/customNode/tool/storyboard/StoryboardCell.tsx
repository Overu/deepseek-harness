import { memo, useEffect, useRef, useState } from 'react';
import { Image as ImageIcon, Video as VideoIcon, Music4, Type, Eye, Download, MoreHorizontal, Files, Trash2, Play } from 'lucide-react';
import { compressImage, downloadFile, copyToClipboard } from '@/utils';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import MediaPreview from '@/components/common/MediaPreview';
import AudioPlayer from '@/components/common/fileControl/AudioPlayer';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from 'sonner';
import type { CellData, CellType } from './types';

interface StoryboardCellProps {
  cell: CellData;
  /** 是否处于编辑态（仅编辑态可交互） */
  editing: boolean;
  /** 是否为高亮拖入目标 */
  highlighted?: boolean;
  /** 拖入目标不可落盘（生成中/失败节点），显示红框 */
  dropBlocked?: boolean;
  /** 是否高亮(进入文本编辑时不再显示) */
  showActions?: boolean;
  width: number;
  height: number;
  onSelectType: (type: Exclude<CellType, 'empty'>) => void;
  onChangeText: (text: string) => void;
  onReupload: () => void;
  onDelete: () => void;
  /** 拖拽相关 */
  onDragStartCell?: (e: React.DragEvent) => void;
  onDragOverCell?: (e: React.DragEvent) => void;
  onDragLeaveCell?: (e: React.DragEvent) => void;
  onDropCell?: (e: React.DragEvent) => void;
  onDragEndCell?: (e: React.DragEvent) => void;
  /** 文本编辑标记 */
  textAutoFocusKey?: number;
  /** 表格内所有非空单元格预览列表 */
  previewUrls?: string[];
  previewTypes?: Array<'image' | 'video' | 'audio' | 'text'>;
  previewInitialIndex?: number;
}

const ICON_ACTIONS: Array<{ key: Exclude<CellType, 'empty'>; label: string; icon: React.ReactNode }> = [
  { key: 'text', label: '文本', icon: <Type size={20} /> },
  { key: 'image', label: '图片', icon: <ImageIcon size={20} /> },
  { key: 'video', label: '视频', icon: <VideoIcon size={20} /> },
  { key: 'audio', label: '音频', icon: <Music4 size={20} /> },
];

const tw = {
  bodyCell: 'group relative bg-[#1a1a1a] flex items-center justify-center overflow-hidden box-border border-r border-b border-white/25',
  dropTarget: 'outline outline-2 outline-[#4155F0] outline-offset-[-2px] z-[5]',
  dropTargetBlocked: 'outline outline-2 outline-red-500 outline-offset-[-2px] z-[5]',
  placeholder: 'text-white/45 text-2xl select-none group-hover:hidden',
  emptyCellOptions: 'hidden absolute inset-0 grid grid-cols-2 grid-rows-2 p-2 gap-2 group-hover:grid',
  cellActions: 'absolute top-1 right-1 flex gap-0.5 z-[5] opacity-0 transition-opacity duration-150 ease-in-out group-hover:opacity-100',
  actionBtn:
    'inline-flex items-center justify-center w-6 h-6 rounded-md bg-black/60 backdrop-blur-[10px] text-white cursor-pointer transition-colors duration-150 hover:bg-black/85',
  textContent: 'w-full h-full text-white text-[13px] leading-[1.5] p-2 box-border overflow-auto nowheel whitespace-pre-wrap break-words',
  editingTextarea: 'bg-[#121212] border-none outline-none resize-none nodrag',
  dropdownMenuItem:
    'cursor-pointer hover:bg-white/10 focus:bg-white/10' +
    ' data-[disabled]:pointer-events-auto data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[disabled]:hover:bg-transparent',
  dropdownMenuItemDanger: 'text-red-400 focus:text-red-400 hover:text-red-400',
};

const getDropHighlightClass = (highlighted?: boolean, dropBlocked?: boolean) => (highlighted ? (dropBlocked ? tw.dropTargetBlocked : tw.dropTarget) : '');

const StoryboardCell = ({
  cell,
  editing,
  highlighted,
  dropBlocked = false,
  showActions = true,
  width,
  height,
  onSelectType,
  onChangeText,
  onReupload,
  onDelete,
  onDragStartCell,
  onDragOverCell,
  onDragLeaveCell,
  onDropCell,
  onDragEndCell,
  textAutoFocusKey,
  previewUrls,
  previewTypes,
  previewInitialIndex = 0,
}: StoryboardCellProps) => {
  const [previewVisible, setPreviewVisible] = useState(false);
  const [textEditing, setTextEditing] = useState(false);
  const [textDraft, setTextDraft] = useState(cell.value);
  const [isVideoHover, setIsVideoHover] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const focusTextareaAtEnd = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.focus();
    const len = textarea.value.length;
    textarea.setSelectionRange(len, len);
  };

  useEffect(() => {
    setTextDraft(cell.value);
  }, [cell.value, cell.type]);

  // 文本类型在创建时自动进入编辑态
  useEffect(() => {
    if (editing && cell.type === 'text' && textAutoFocusKey != null) {
      setTextEditing(true);
      setTimeout(focusTextareaAtEnd, 0);
    }
  }, [textAutoFocusKey, cell.type, editing]);

  // 退出编辑态时关闭文本编辑
  useEffect(() => {
    if (!editing) setTextEditing(false);
  }, [editing]);

  // 视频 hover 自动播放
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (isVideoHover) {
      video.play().catch(() => {});
    } else {
      video.pause();
      video.currentTime = 0;
    }
  }, [isVideoHover]);

  const handlePreview = (e: React.MouseEvent) => {
    e.stopPropagation();
    setPreviewVisible(true);
  };

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (cell.value) downloadFile(cell.value);
  };

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!cell.value) return;
    try {
      await copyToClipboard(cell.value);
      toast.success('已复制文本到剪贴板');
    } catch {
      toast.error('复制失败');
    }
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete();
  };

  const handleReupload = () => {
    onReupload();
  };

  const handleTextBlur = () => {
    setTextEditing(false);
    if (textDraft !== cell.value) onChangeText(textDraft);
  };

  const startTextEdit = (e: React.MouseEvent) => {
    if (!editing) return;
    e.stopPropagation();
    setTextEditing(true);
    setTimeout(focusTextareaAtEnd, 0);
  };

  // 空类型 - 悬浮显示四个选项
  if (cell.type === 'empty') {
    return (
      <div
        className={`${tw.bodyCell} ${getDropHighlightClass(highlighted, dropBlocked)}`}
        style={{ width, height }}
        onDragOver={onDragOverCell}
        onDragLeave={onDragLeaveCell}
        onDrop={onDropCell}
      >
        <div className={tw.placeholder}>+</div>
        {editing && showActions && (
          <div className={tw.emptyCellOptions}>
            {ICON_ACTIONS.map(item => (
              <div
                key={item.key}
                className='flex flex-col items-center justify-center rounded-lg border border-white/15 bg-[#262626] hover:border-[#4155F0] cursor-pointer text-white/85 gap-1'
                onClick={e => {
                  e.stopPropagation();
                  onSelectType(item.key);
                }}
              >
                {item.icon}
                <span className='text-xs'>{item.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // 渲染单元格右上角操作按钮
  const renderActions = () => {
    if (!showActions || !editing) return null;
    if (cell.type === 'text') {
      return (
        <div className={tw.cellActions}>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className={tw.actionBtn} onClick={handlePreview}>
                  <Eye size={14} />
                </div>
              </TooltipTrigger>
              <TooltipContent>预览</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className={tw.actionBtn} onClick={handleCopy}>
                  <Files size={14} />
                </div>
              </TooltipTrigger>
              <TooltipContent>文本复制</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className={tw.actionBtn} onClick={handleDelete}>
                  <Trash2 size={14} />
                </div>
              </TooltipTrigger>
              <TooltipContent>删除</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      );
    }
    return (
      <div className={tw.cellActions}>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className={tw.actionBtn} onClick={handlePreview}>
                <Eye size={14} />
              </div>
            </TooltipTrigger>
            <TooltipContent>预览</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className={tw.actionBtn} onClick={handleDownload}>
                <Download size={14} />
              </div>
            </TooltipTrigger>
            <TooltipContent>下载</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <div className={tw.actionBtn} onClick={e => e.stopPropagation()}>
              <MoreHorizontal size={14} />
            </div>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end' className='bg-[#262626] border-white/10 text-white'>
            <DropdownMenuItem
              className={tw.dropdownMenuItem}
              onClick={e => {
                e.stopPropagation();
                handleReupload();
              }}
            >
              重新上传
            </DropdownMenuItem>
            <DropdownMenuItem
              className={`${tw.dropdownMenuItem} ${tw.dropdownMenuItemDanger}`}
              onClick={e => {
                e.stopPropagation();
                onDelete();
              }}
            >
              删除内容
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  };

  // 单元格内容渲染
  let content: React.ReactNode = null;
  if (cell.type === 'text') {
    if (textEditing) {
      content = (
        <textarea
          ref={textareaRef}
          className={`${tw.textContent} ${tw.editingTextarea}`}
          value={textDraft}
          onChange={e => setTextDraft(e.target.value)}
          onBlur={handleTextBlur}
          onKeyDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
        />
      );
    } else {
      content = (
        <div className={`${tw.textContent} ${editing ? 'cursor-grab active:cursor-grabbing' : ''}`} onDoubleClick={startTextEdit}>
          {cell.value || ''}
        </div>
      );
    }
  } else if (cell.type === 'image') {
    content = <img src={compressImage(cell.value)} alt='' className='w-full h-full object-contain pointer-events-none' draggable={false} />;
  } else if (cell.type === 'video') {
    content = (
      <div className='relative w-full h-full' onMouseEnter={() => setIsVideoHover(true)} onMouseLeave={() => setIsVideoHover(false)}>
        <video ref={videoRef} src={cell.value} className='w-full h-full object-contain pointer-events-none' muted loop playsInline preload='metadata' />
        {!isVideoHover && (
          <div className='absolute inset-0 flex items-center justify-center text-white pointer-events-none'>
            <Play size={28} fill='currentColor' />
          </div>
        )}
      </div>
    );
  } else if (cell.type === 'audio') {
    content = (
      <div className='w-full h-full relative bg-[#1a1a1a]'>
        <AudioPlayer url={cell.value} height={Math.max(40, height - 16)} />
      </div>
    );
  }

  const previewUrlList = previewUrls?.length ? previewUrls : [cell.value];
  const cellPreviewType: 'image' | 'video' | 'audio' | 'text' = cell.type === 'text' ? 'text' : cell.type === 'video' ? 'video' : cell.type === 'audio' ? 'audio' : 'image';
  const previewTypeList: Array<'image' | 'video' | 'audio' | 'text'> = previewTypes?.length === previewUrlList.length ? previewTypes : previewUrlList.map(() => cellPreviewType);

  return (
    <div
      className={`${tw.bodyCell} ${getDropHighlightClass(highlighted, dropBlocked)}`}
      style={{ width, height }}
      draggable={editing && !(cell.type === 'text' && textEditing)}
      onDragStart={editing ? onDragStartCell : undefined}
      onDragOver={onDragOverCell}
      onDragLeave={onDragLeaveCell}
      onDrop={onDropCell}
      onDragEnd={onDragEndCell}
    >
      {content}
      {renderActions()}
      {previewVisible ? (
        <MediaPreview visible={previewVisible} url={previewUrlList} type={previewTypeList} initialIndex={previewInitialIndex} onClose={() => setPreviewVisible(false)} />
      ) : null}
    </div>
  );
};

export default memo(StoryboardCell);
