import { LoaderCircle, Play, Copy, CloudSync, Workflow, Trash2, Download } from 'lucide-react';
import type { Node as FlowNode } from '@xyflow/react';
import hooks from '../../hooks';
import setting from '../../settings/setting';
import toolUtil from '../../utils/toolUtil';
import styles from '../index.module.less';
import pointImage from '@/assets/images/point.png';
import { toast } from 'sonner';
import { useFlowStore } from '@/store/flowStore';
import { usePointStore } from '@/store/pointStore';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { useState, useMemo, type ComponentProps } from 'react';
import { AssetCollectionModal } from '@/components/Asset/AssetCreate';
import { openDialog } from '@/components/globalDialog';
import CreatePersonalWorkflowDialog from '../personalWorkflow/CreatePersonalWorkflowDialog';
import { buildPersonalWorkflowSubgraph } from '../../utils/personalWorkflow';
import { cn } from '@/lib/utils';
import Dialog from '../common/Dialog';
import LayoutMenu from './LayoutMenu';
import { downloadFile, downloadFilesAsZip } from '@/utils';

const { useGroupPointCaculate, useDeleteSelection } = hooks;
const { getImageNodeType, getVideoNodeType } = setting;
const { collectDownloadableMediaNodes } = toolUtil;

interface SelectionOperationProps {
  selectedNodes: FlowNode[] | undefined;
  onGroup: () => void;
  onExcuteSuccess: () => void;
}

const SelectionOperation = ({ selectedNodes, onGroup, onExcuteSuccess }: SelectionOperationProps) => {
  const canvasId = useFlowStore(state => state.canvasId);
  const { excuteTemp, pasteNode } = useFlowStore(state => state.actions);
  const { updateUserPoint, setNeedPoint } = usePointStore(state => state.actions);
  const { deleteSelection, confirmDialog, closeConfirmDialog } = useDeleteSelection();

  const { point: caculatePoint, loading: pointLoading } = useGroupPointCaculate(selectedNodes || []);

  // 添加执行状态
  const [isExecuting, setIsExecuting] = useState(false);
  // 创建资产弹窗显隐
  const [showAssetCreate, setShowAssetCreate] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const mediaFiles = useMemo(() => collectDownloadableMediaNodes(selectedNodes || []), [selectedNodes]);

  const assets = useMemo<ComponentProps<typeof AssetCollectionModal>['assets']>(() => {
    const getUrl = getImageNodeType.concat(getVideoNodeType).concat(['audio']);
    return (
      selectedNodes?.map(item => {
        const nodeType = item.type ?? '';
        const rawValue = (item as any)?.data?.value;
        const value = typeof rawValue === 'string' ? rawValue : '';
        return {
          type: nodeType,
          text: nodeType === 'text' ? value : '',
          url: getUrl.includes(nodeType) ? value : '',
        };
      }) || []
    );
  }, [selectedNodes]);

  const handleExcute = async () => {
    // 如果正在执行，则直接返回
    if (isExecuting) {
      return;
    }

    if (selectedNodes) {
      try {
        // 设置执行状态为true
        setIsExecuting(true);
        setNeedPoint(caculatePoint);
        const res = await excuteTemp(selectedNodes);
        if (res.type === 'warning') toast.warning(res.content);
        if (res.type === 'success') {
          toast.success(res.content);
          updateUserPoint();
          onExcuteSuccess();
        }
      } catch {
        toast.error('执行失败，请重试');
      } finally {
        // 无论成功还是失败，都要将执行状态设为false
        setIsExecuting(false);
      }
    }
  };

  const handleCopy = () => {
    if (selectedNodes) {
      const currentNodes = useFlowStore.getState().nodes;
      const latestNodes = selectedNodes.map(node => currentNodes.find(item => item.id === node.id) || node);
      pasteNode(latestNodes);
    }
  };

  const handleCreateAsset = () => {
    const hasEmptyNode = (selectedNodes || []).some(n => {
      const rawValue = (n as any)?.data?.value;
      const value = typeof rawValue === 'string' ? rawValue : '';
      return value.trim() === '';
    });
    if (hasEmptyNode) {
      toast.warning('你选择的节点中里包含空节点，请剔除后重新选择');
      return;
    }
    setShowAssetCreate(true);
  };

  const handleCreateWorkflow = () => {
    const state = useFlowStore.getState();
    const selectedIds = (selectedNodes || []).map(node => node.id);
    const workflow = buildPersonalWorkflowSubgraph(state.nodes, state.edges, selectedIds);
    if (workflow.nodes.length < 2) return;
    void openDialog(CreatePersonalWorkflowDialog, workflow).catch(() => undefined);
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!selectedNodes?.length) return;
    deleteSelection({ nodes: selectedNodes });
  };

  const handleDownload = async () => {
    if (downloading || mediaFiles.length === 0) return;
    try {
      setDownloading(true);
      if (mediaFiles.length === 1) {
        await downloadFile(mediaFiles[0].url, mediaFiles[0].filename);
      } else {
        await downloadFilesAsZip(mediaFiles);
      }
    } finally {
      setDownloading(false);
    }
  };

  const operationBtnClass = 'flex items-center justify-center rounded-lg transition-colors hover:bg-white/10';

  const actions = [
    {
      key: 'download',
      label: '下载',
      icon: downloading ? LoaderCircle : Download,
      onClick: handleDownload,
      show: mediaFiles.length > 0,
      className: downloading ? 'pointer-events-none opacity-50' : undefined,
      iconClassName: downloading ? 'animate-spin' : undefined,
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
      show: true,
      className: 'text-red-400 hover:bg-red-500/20',
    },
  ];

  return (
    <div className='flex items-center gap-1 border-2 rounded-[10px] p-1 bg-[#262626] border-black/25 text-white' onDoubleClick={e => e.stopPropagation()}>
      <div className={styles.excute_btn} onClick={handleExcute}>
        <div className='absolute w-full h-full top-0 left-0 rounded-lg bg-black/20 duration-200 hover:bg-black/0'></div>
        <div className='flex items-center gap-1'>
          <Play size={16} fill='white'></Play>
          <div className='text-sm'>开始执行</div>
        </div>
        <div className='flex items-center gap-1'>
          <img src={pointImage}></img>
          {pointLoading ? <LoaderCircle size={14} className='animate-spin' /> : <div>{caculatePoint}</div>}
        </div>
      </div>
      <div onClick={handleCreateAsset} className='flex items-center gap-1.5 h-8 px-3 cursor-pointer rounded-lg hover:bg-white/10 transition-colors text-sm text-white'>
        <CloudSync size={18} className='shrink-0' />
        <span>创建资产</span>
      </div>
      <button
        type='button'
        onClick={handleCreateWorkflow}
        className='flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm text-white transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60'
      >
        <Workflow size={18} className='shrink-0' />
        <span>创建工作流</span>
      </button>
      <div className='text-sm w-11 h-8 leading-8 text-center cursor-pointer rounded-lg hover:bg-white/10' onClick={onGroup}>
        组合
      </div>
      <LayoutMenu nodes={selectedNodes} />
      <TooltipProvider>
        {actions.map(action => {
          if (!action.show) return null;

          const Icon = action.icon;

          return (
            <Tooltip key={action.key}>
              <TooltipTrigger asChild>
                <div onClick={action.onClick} className={cn('h-8 w-8 cursor-pointer', operationBtnClass, action.className)}>
                  <Icon size={20} className={action.iconClassName} />
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p>{action.label}</p>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </TooltipProvider>
      {showAssetCreate && <AssetCollectionModal assets={assets} canvasId={canvasId} onClose={() => setShowAssetCreate(false)} />}
      <Dialog confirmDialog={confirmDialog} closeConfirmDialog={closeConfirmDialog} />
    </div>
  );
};

export default SelectionOperation;
