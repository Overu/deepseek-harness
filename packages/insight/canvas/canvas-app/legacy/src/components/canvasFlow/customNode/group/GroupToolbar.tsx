import { Download, LoaderCircle, Play, Workflow, Trash2 } from 'lucide-react';
import hooks from '../../hooks';
import toolUtil from '../../utils/toolUtil';
import styles from './index.module.less';
import pointImage from '@/assets/images/point.png';
import { useFlowStore } from '@/store/flowStore';
import { useMemo, useState } from 'react';
import { usePointStore } from '@/store/pointStore';
import { openDialog } from '@/components/globalDialog';
import CreatePersonalWorkflowDialog from '../../components/personalWorkflow/CreatePersonalWorkflowDialog';
import { buildPersonalWorkflowSubgraph } from '../../utils/personalWorkflow';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import Dialog from '../../components/common/Dialog';
import LayoutMenu from '../../components/canvasControl/LayoutMenu';
import { downloadFile, downloadFilesAsZip } from '@/utils';

const { useGroupPointCaculate, useDeleteSelection } = hooks;
const { getGroupAllChild, collectDownloadableMediaNodes } = toolUtil;

interface GroupToolbarProps {
  id: string;
  status: string;
  onExecute: () => void;
  onUngroup: () => void;
}

const GroupToolbar: React.FC<GroupToolbarProps> = ({ id, status, onExecute, onUngroup }) => {
  const { setNeedPoint } = usePointStore(state => state.actions);
  const { deleteSelection, confirmDialog, closeConfirmDialog } = useDeleteSelection();
  const nodes = useFlowStore(state => state.nodes);
  const [downloading, setDownloading] = useState(false);
  const childNodes = useMemo(() => {
    return getGroupAllChild(nodes, id);
  }, [id, nodes]);
  const mediaFiles = useMemo(() => collectDownloadableMediaNodes(childNodes || []), [childNodes]);
  const { point: caculatePoint, loading: pointLoading } = useGroupPointCaculate(childNodes || [], id);

  const handleExecute = () => {
    setNeedPoint(caculatePoint);
    onExecute();
  };

  const handleCreateWorkflow = () => {
    const state = useFlowStore.getState();
    const workflow = buildPersonalWorkflowSubgraph(state.nodes, state.edges, [id]);
    void openDialog(CreatePersonalWorkflowDialog, workflow).catch(() => undefined);
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    deleteSelection({ groupId: id });
  };

  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation();
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

  return (
    <div className='flex items-center gap-1 border-2 rounded-[10px] p-1 bg-[#262626] border-black/25 text-white'>
      {status === 'running' ? (
        <div className={styles.interrupt_btn} onClick={onExecute}>
          <div className='absolute w-full h-full top-0 left-0 rounded-lg bg-black/20 duration-200 hover:bg-black/0'></div>
          <div className='icon-termination iconfont text-lg'></div>
          <div className='text-sm'>中断执行</div>
        </div>
      ) : (
        <div className={styles.excute_btn} onClick={handleExecute}>
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
      )}
      <button
        type='button'
        onClick={handleCreateWorkflow}
        className='flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm text-white transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60'
      >
        <Workflow size={18} />
        <span>创建工作流</span>
      </button>
      <div className='text-sm w-11 h-8 leading-8 text-center cursor-pointer rounded-lg hover:bg-white/10' onClick={onUngroup}>
        解组
      </div>
      <LayoutMenu nodes={childNodes} />
      <TooltipProvider>
        {mediaFiles.length > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <div onClick={handleDownload} className={cn('h-8 w-8 cursor-pointer', operationBtnClass, downloading && 'pointer-events-none opacity-50')}>
                {downloading ? <LoaderCircle size={20} className='animate-spin' /> : <Download size={20} />}
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <p>下载</p>
            </TooltipContent>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <div onClick={handleDelete} className={cn('h-8 w-8 cursor-pointer text-red-400 hover:bg-red-500/20', operationBtnClass)}>
              <Trash2 size={20} />
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <p>删除</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <Dialog confirmDialog={confirmDialog} closeConfirmDialog={closeConfirmDialog} />
    </div>
  );
};

export default GroupToolbar;
