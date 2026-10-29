import { useMemo, useState, type ReactNode } from 'react';
import { Upload, Eye, Download, Copy, Trash2 } from 'lucide-react';
import CanvasAssetPreview from '../CanvasAssetPreview';
import { downloadFile } from '@/utils';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useFlowStore } from '@/store/flowStore';
import { isToolUsable } from '../../utils/modelPermission';
import NodeOperationTools from './NodeOperationTools';
import { isUserUploadMedia, type MediaNodeContentType } from '../../utils/type';
import { getToolListItemsByNodeKind, type ToolListItem } from '../../settings/toolListConfig';

const MEDIA_PREVIEW_TYPES = new Set(['image', 'video', 'audio']);

interface NodeOperationProps {
  type: string; // 代表文件类型，image/video
  url: string; // 当前文件的URL
  status?: string; // 节点状态
  previewUrls?: string[]; // 可供预览的文件列表
  /** 媒体内容来源 data.type：upload 时允许显示上传；tool / 未设置则屏蔽 */
  contentType?: MediaNodeContentType | string;
  /** 媒体产物节点 id，用于画布详情预览 */
  nodeId?: string;
  onAddNextTool?: (toolType: string) => void;
  renderToolItem?: (tool: ToolListItem, disabled: boolean) => ReactNode;
  onUpload?: () => void;
  onCopy: () => void;
  onDelete: () => void;
  className?: any;
  /** 自定义预览回调；传入时替代默认 CanvasAssetPreview */
  onPreview?: () => void;
  /** 显式控制预览按钮 */
  showPreview?: boolean;
  /** 显式覆盖上传按钮显隐（如 panoramaTool 保留原特殊逻辑） */
  showUpload?: boolean;
}

const NodeOperation = ({
  type,
  status,
  url,
  previewUrls = [],
  contentType,
  nodeId,
  onAddNextTool,
  renderToolItem,
  onUpload = () => {},
  onCopy,
  onDelete,
  className,
  onPreview,
  showPreview,
  showUpload,
}: NodeOperationProps) => {
  const toolNodePermission = useFlowStore(s => s.toolNodePermission);
  const [previewVisible, setPreviewVisible] = useState(false);

  const isMediaNode = MEDIA_PREVIEW_TYPES.has(type);
  const resolvedPreviewUrls = previewUrls.length > 0 ? previewUrls : url ? [url] : [];

  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    onUpload();
  };

  const handlePreview = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onPreview) {
      onPreview();
      return;
    }
    setPreviewVisible(true);
  };

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    downloadFile(url);
  };

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    onCopy();
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete();
  };

  const isShowPreview = useMemo(() => {
    if (showPreview != null) return showPreview && !!url;
    return isMediaNode && !!url && !!nodeId;
  }, [isMediaNode, url, nodeId, showPreview]);

  const isShowDownload = useMemo(() => {
    return type !== 'text' && url;
  }, [type, url]);

  // 默认：非 text、非 running、有 url，且仅用户上传（contentType === 'upload'）
  // panoramaTool 等特例通过 showUpload 覆盖
  const isShowUpload = useMemo(() => {
    if (showUpload != null) return showUpload;
    return type !== 'text' && status !== 'running' && !!url && isUserUploadMedia(contentType);
  }, [showUpload, type, status, url, contentType]);

  const isShowDelete = useMemo(() => {
    return status !== 'running';
  }, [status]);

  const nextTools = useMemo(() => getToolListItemsByNodeKind(type).filter(item => item.forceVisible || isToolUsable(toolNodePermission, item.type)), [type, toolNodePermission]);
  const operationBtnClass = 'flex items-center justify-center rounded-lg transition-colors hover:bg-white/10';

  const actions = [
    {
      key: 'preview',
      label: '预览',
      icon: Eye,
      onClick: handlePreview,
      show: isShowPreview,
    },
    {
      key: 'download',
      label: '下载',
      icon: Download,
      onClick: handleDownload,
      show: isShowDownload,
    },
    {
      key: 'upload',
      label: '上传',
      icon: Upload,
      onClick: handleEdit,
      show: isShowUpload,
    },
    {
      key: 'copy',
      label: '复制',
      icon: Copy,
      onClick: handleCopy,
      show: true,
    },
    {
      key: 'delete',
      label: '删除',
      icon: Trash2,
      onClick: handleDelete,
      show: isShowDelete,
      className: 'text-red-400 hover:bg-red-500/20',
    },
  ];

  return (
    <div className={`flex items-center nodrag select-none h-10 gap-1 p-1 rounded-lg bg-[#262626] ${className}`}>
      <TooltipProvider>
        {actions.map(action => {
          if (!action.show) return null;

          const Icon = action.icon;

          return (
            <Tooltip key={action.key}>
              <TooltipTrigger asChild>
                <div onClick={action.onClick} className={cn('h-8 w-8 cursor-pointer', operationBtnClass, action.className)}>
                  <Icon size={20} />
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p>{action.label}</p>
              </TooltipContent>
            </Tooltip>
          );
        })}

        <NodeOperationTools value={url} nodeType={type} tools={nextTools} toolNodePermission={toolNodePermission} onAddNextTool={onAddNextTool} renderToolItem={renderToolItem} />
      </TooltipProvider>

      {isShowPreview && nodeId && !onPreview && <CanvasAssetPreview visible={previewVisible} nodeId={nodeId} urls={resolvedPreviewUrls} onClose={() => setPreviewVisible(false)} />}
    </div>
  );
};

export default NodeOperation;
