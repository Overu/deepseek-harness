import { NodeToolbar, Position } from '@xyflow/react';
import { useFlowStore } from '@/store/flowStore';
import { interruptWorkFlow } from '@/api/workflow';
import { toast } from 'sonner';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import GroupToolbar from './GroupToolbar';
import NodeTitle from '../../components/nodeControl/NodeTitle';
import hooks from '../../hooks';
import { usePointStore } from '@/store/pointStore';

const nodeType = 'group';
const { useNodeOperations, useTopNodeToolbarVisible } = hooks;

const Group = (props: any) => {
  const { id, data, selected } = props;
  const { taskInfo = {}, title, titleStyle } = data;
  const { status, taskId } = taskInfo;
  const { ungroupNodes, excuteGroup, updateNodeStatus } = useFlowStore(state => state.actions);
  const { updateUserPoint } = usePointStore(state => state.actions);
  const { handleEdit, handleChangeTitleStyle } = useNodeOperations(id, data);
  const inited = useRef(false);
  const statusList = ['interrupt', 'failure', 'success'];
  const [isExecuting, setIsExecuting] = useState(false);
  const [tempTaskId, setTempTaskId] = useState('');
  const [focus, setFocus] = useState(false);
  const topToolbarVisible = useTopNodeToolbarVisible(!focus && selected);

  const actualTaskId = useMemo(() => {
    return tempTaskId || taskId;
  }, [taskId, tempTaskId]);

  useEffect(() => {
    if (inited.current) {
      if (statusList.includes(status)) {
        updateUserPoint();
      }
    } else {
      inited.current = true;
    }
    return () => {
      inited.current = false;
    };
  }, [status]);

  const handleExcute = async () => {
    if (isExecuting) {
      return;
    }

    if (status === 'running') {
      const params = {
        taskId: actualTaskId,
        nodeIds: [id],
      };
      const res: any = await interruptWorkFlow(params);
      if (res.code === 'SUCCESS') {
        toast.success('中断成功，请等待当前正在执行任务结束');
        updateNodeStatus(id, 'fakeInterrupt');
      }
    } else {
      try {
        setIsExecuting(true);
        const res = await excuteGroup(id);
        if (res.type === 'warning') toast.warning(res.content);
        if (res.type === 'success') {
          if (res.taskId) {
            setTempTaskId(res.taskId);
          }
          toast.success(res.content);
          updateNodeStatus(id, 'running');
          updateUserPoint();
        }
      } catch {
        toast.error('执行失败，请重试');
      } finally {
        setIsExecuting(false);
      }
    }
  };

  const handleUnGroup = () => {
    ungroupNodes(id);
  };

  const handleNodeDoubleClick = (event: React.MouseEvent) => {
    event.stopPropagation();
  };

  return (
    <div
      className='relative w-full h-full border-2 rounded border-gray-400'
      style={{
        backgroundColor: 'rgba(128, 128, 128, 0.2)',
      }}
      onDoubleClick={handleNodeDoubleClick}
    >
      <NodeTitle
        name={title || '组'}
        nodeType={nodeType}
        selected={selected}
        titleStyle={titleStyle}
        setTitleStyle={handleChangeTitleStyle}
        onEdit={handleEdit}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
      />
      <NodeToolbar isVisible={topToolbarVisible} position={Position.Top} align='center' offset={36}>
        <GroupToolbar id={id} status={status} onExecute={handleExcute} onUngroup={handleUnGroup} />
      </NodeToolbar>
    </div>
  );
};

export default memo(Group);
