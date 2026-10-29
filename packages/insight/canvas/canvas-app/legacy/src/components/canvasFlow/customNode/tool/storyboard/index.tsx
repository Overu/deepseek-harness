import { NodeToolbar, Position, useUpdateNodeInternals } from '@xyflow/react';
import NodeTitle from '../../../components/nodeControl/NodeTitle';
import StatusOverlay from '../../../components/nodeControl/StatusOverlay';
import LimitHandler from '../../../customHandler/LimitHandler';
import UploadModal from '../../../components/uploadControl/UploadModal';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useFlowStore } from '@/store/flowStore';
import setting from '../../../settings/setting';
import hooks from '../../../hooks';
import type { Handler } from '../../../utils/type';
import StoryboardNodeOperation from './StoryboardNodeOperation';
import StoryboardPromptModel from './StoryboardPromptModel';
import StoryboardGenerateParamBar from './StoryboardGenerateParamBar';
import StoryboardTable from './StoryboardTable';
import { useStoryboardCanvasWheel } from './useStoryboardCanvasWheel';
import { useStoryboardTable } from './useStoryboardTable';
import { useStoryboardScriptTask } from './useStoryboardScriptTask';
import { useStoryboardBatchGenerate } from './useStoryboardBatchGenerate';
import { type StoryboardAspectRatio, type StoryboardInfo, type StoryboardMode, STORYBOARD_DEFAULT_ASPECT_RATIO } from './types';
import LockedPermissionBadge from '../../../components/nodeControl/LockedPermissionBadge';
import ToolModal from '../../../components/promptControl/ToolModal';

const nodeType = 'storyboardTool';
const { handlersMap } = setting;
const { useNodeOperations, useNodeResizeObserver, useToolPermissionDisabled, useToolOutputChildNodes, useTopNodeToolbarVisible } = hooks;

const handlers = handlersMap[nodeType];

const StoryboardTool = (props: any) => {
  const updateNodeInternals = useUpdateNodeInternals();
  const { data, id, selected } = props;
  const toolPermissionDisabled = useToolPermissionDisabled(nodeType);
  const { taskInfo, title, titleStyle, table: nodeTable, storyboardInfo: nodeStoryboardInfo } = data;
  const mode = (data?.params?.mode || 'custom') as StoryboardMode;
  const { status, errorMsg, taskId } = taskInfo || { status: 'success', errorMsg: '', taskId: '' };
  const storyboardInfo: StoryboardInfo = nodeStoryboardInfo || { status: 'success', errorMsg: '', taskId: '' };
  const storyboardStatus = storyboardInfo.status || 'success';
  const storyboardTaskId = storyboardInfo.taskId || '';
  const disableHoverMask = status === 'running' || status === 'failure';
  const isSelection = useFlowStore(state => state.isSelection);
  const aspectRatio = (data?.params?.aspectRatio || STORYBOARD_DEFAULT_ASPECT_RATIO) as StoryboardAspectRatio;

  const dataRef = useRef(data);
  const nodeRef = useRef<HTMLDivElement | null>(null);
  const anyTaskRunningRef = useRef(false);
  /** 仅脚本任务忙碌：用于表格编辑/行列/宫格等操作锁（分镜运行中不锁表） */
  const tableOpsLockedRef = useRef(false);
  const isStoryboardExcuteRef = useRef(false);
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [focus, setFocus] = useState(false);

  const { handleCopy, handleDelete, handleEdit, handleChangeTitleStyle } = useNodeOperations(id, data);
  const topToolbarVisible = useTopNodeToolbarVisible(!focus && !isSelection && selected);
  // 表格内滚轮：阻止冒泡到画布缩放，仅滚动分镜表
  const { handleWheel: handleStoryboardWheel } = useStoryboardCanvasWheel();
  useNodeResizeObserver(nodeRef as React.RefObject<HTMLElement>, id, updateNodeInternals);

  const { prepareChildNodes, attachUploadOutputNode } = useToolOutputChildNodes({
    toolNodeId: id,
    nodeWidth: 800,
    sourceHandleId: 'image_source',
  });

  // 同步 dataRef（供各 hook 在异步回调中读取最新节点 data）
  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  // 表格协议与编辑侧：行列/比例/上传/拖出画布/合成宫格/Excel；缩表确认弹窗态也在此
  const tableApi = useStoryboardTable({
    id,
    dataRef,
    nodeTable,
    aspectRatio,
    tableOpsLockedRef,
    attachUploadOutputNode,
  });

  // 脚本生成（taskInfo）：输入连线统计、赛点、底部 prompt/mode、创建任务与轮询回填表格
  const scriptApi = useStoryboardScriptTask({
    id,
    data,
    dataRef,
    selected,
    mode,
    status,
    taskId,
    storyboardStatus,
    isStoryboardExcuteRef,
    setTable: tableApi.setTable,
  });

  // 分镜批量生成（storyboardInfo）：生成模式/勾选行/参数条、提交拓扑与轮询回写子节点
  const batchApi = useStoryboardBatchGenerate({
    id,
    data,
    dataRef,
    table: tableApi.table,
    storyboardStatus,
    storyboardTaskId,
    toolPermissionDisabled,
    anyTaskRunningRef,
    nodeRef,
    prepareChildNodes,
  });

  // 脚本/分镜任务互斥：ref 供 hook 内异步/回调读取最新忙碌态，避免 hook 间循环依赖
  const scriptTaskBusy = status === 'running' || scriptApi.isExcute;
  const storyboardTaskBusy = storyboardStatus === 'running' || batchApi.isStoryboardExcute;
  const anyTaskRunning = scriptTaskBusy || storyboardTaskBusy;
  anyTaskRunningRef.current = anyTaskRunning;
  tableOpsLockedRef.current = scriptTaskBusy;
  isStoryboardExcuteRef.current = batchApi.isStoryboardExcute;

  // 仅脚本任务进行中退出编辑；分镜运行中允许改表
  useEffect(() => {
    if (!scriptTaskBusy) return;
    if (editing) setEditing(false);
  }, [scriptTaskBusy, editing]);

  const filteredHandlers = useMemo(() => {
    if (!Array.isArray(handlers)) return [];
    if (mode === 'gen_script') return handlers.filter(h => h.id === 'text_target' || h.type === 'source');
    if (mode === 'video_understand') return handlers.filter(h => h.id === 'video_target' || h.type === 'source');
    return handlers;
  }, [mode]);

  // 模式切换时刷新句柄位置
  useEffect(() => {
    updateNodeInternals(id);
  }, [id, mode, updateNodeInternals]);

  const handleExitEdit = () => setEditing(false);
  const handleToggleExpand = () => setExpanded(prev => !prev);

  // 双击表格进入编辑态（分镜运行中允许；脚本运行中 / 生成模式内仍禁止）
  const handleTableDoubleClick = () => {
    if (toolPermissionDisabled || batchApi.generateMode || scriptTaskBusy) return;
    if (!editing) setEditing(true);
  };

  const promptModalVisible = useMemo(() => {
    return !isSelection && selected;
  }, [isSelection, selected]);

  // 编辑态时屏蔽节点拖拽
  const interactionClassName = editing || batchApi.generateMode ? 'nodrag' : '';

  // 编辑态仅通过顶部“退出编辑”按钮退出（满足外部节点拖入时连续操作）

  return (
    <div
      ref={nodeRef}
      className={`${editing ? '' : 'group/node'} relative rounded-2xl transition-all ${
        editing ? 'ring-2 ring-[#4155F0]' : selected ? 'ring-2 ring-white/65' : ''
      } ${editing ? '' : 'hover:ring-2 hover:ring-white/45'} ${interactionClassName}`}
      onWheel={handleStoryboardWheel}
    >
      <div className='relative z-0' onDoubleClick={handleTableDoubleClick}>
        <StoryboardTable
          nodeId={id}
          table={tableApi.table}
          editing={editing}
          expanded={expanded}
          selectionMode={batchApi.generateMode}
          selectedRowIndexes={batchApi.selectedRowIndexes}
          onToggleRow={batchApi.handleToggleRow}
          onToggleAllRows={batchApi.handleToggleAllRows}
          defaultCellWidth={tableApi.presetCellSize.width}
          defaultCellHeight={tableApi.presetCellSize.height}
          onChange={tableApi.setTable}
          onCellSizeManualChange={tableApi.handleCellSizeManualChange}
          onOpenUploadFor={tableApi.handleOpenUploadFor}
          onDragCellOutToCanvas={tableApi.handleDragCellOutToCanvas}
        />
      </div>

      {filteredHandlers.map((item: Handler) => (
        <LimitHandler type={item.type} position={item.position} id={item.id} style={{ ...item.style, zIndex: 10 }} key={item.id} limit={item.limit} />
      ))}

      <NodeTitle
        name={title}
        nodeType={nodeType}
        selected={selected}
        titleStyle={titleStyle}
        setTitleStyle={handleChangeTitleStyle}
        onEdit={handleEdit}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
      />

      <StatusOverlay status={status as any} errorMsg={errorMsg} type={nodeType} id={id} />

      {!editing && !batchApi.generateMode && !disableHoverMask && (
        <div
          aria-hidden
          className='pointer-events-none absolute inset-0 rounded-2xl bg-black/45 opacity-0 group-hover/node:opacity-100 transition-opacity z-10 flex items-center justify-center'
        >
          {toolPermissionDisabled ? (
            <div className='px-4 py-2 rounded-lg bg-[#00000073] backdrop-blur-xl ring-1 ring-white/10'>
              <LockedPermissionBadge />
            </div>
          ) : (
            <span className='px-4 py-2 rounded-lg bg-[#4155F0] text-white text-xs whitespace-nowrap select-none'>双击表格进入编辑状态</span>
          )}
        </div>
      )}

      <NodeToolbar isVisible={topToolbarVisible} position={Position.Top} align='center' offset={36}>
        <StoryboardNodeOperation
          rowsCount={tableApi.rowsCount}
          colsCount={tableApi.colsCount}
          editing={editing}
          expanded={expanded}
          aspectRatio={aspectRatio}
          canCompose={tableApi.canCompose}
          composing={tableApi.composing}
          tableOpsDisabled={scriptTaskBusy}
          generateMode={batchApi.generateMode}
          generateLoading={anyTaskRunning}
          generatePoint={batchApi.generateTotalPoint}
          generatePointLoading={false}
          canSubmitGenerate={batchApi.canSubmitGenerate && !toolPermissionDisabled}
          generateDisabledReason={batchApi.generateDisabledReason}
          generateParamBar={
            <StoryboardGenerateParamBar params={batchApi.storyboardParams} requireImageToImage={batchApi.rowsHaveImage} onChange={batchApi.handleStoryboardParamsChange} />
          }
          onEnterGenerateMode={batchApi.handleEnterGenerateMode}
          onCancelGenerateMode={batchApi.handleCancelGenerateMode}
          onSubmitGenerate={batchApi.handleSubmitGenerate}
          onAspectRatioChange={tableApi.handleAspectRatioChange}
          onComposeGrid={tableApi.handleComposeGrid}
          onRowsCountChange={tableApi.handleRowsCountChange}
          onColsCountChange={tableApi.handleColsCountChange}
          countInputRevert={tableApi.countInputRevert ?? undefined}
          onExitEdit={handleExitEdit}
          onToggleExpand={handleToggleExpand}
          onDownloadExcel={tableApi.handleDownloadExcel}
          onCopy={handleCopy}
          onDelete={handleDelete}
        />
      </NodeToolbar>

      {/* 仅在选中时挂载；进生成模式用 isVisible 隐藏而非卸载，避免初次未选中就挂载导致定位错乱 */}
      {promptModalVisible ? (
        <NodeToolbar isVisible={!batchApi.generateMode} position={Position.Bottom} align='center'>
          <ToolModal id={id} radius='large'>
            <StoryboardPromptModel
              isExcute={scriptApi.isExcute || storyboardTaskBusy}
              status={status as string}
              mode={mode}
              data={data}
              inputConnections={scriptApi.inputConnections}
              textMap={scriptApi.textMap}
              imageMap={scriptApi.imageMap}
              videoMap={scriptApi.videoMap}
              mediaInputs={scriptApi.mediaInputs}
              caculatePoint={scriptApi.caculatePoint}
              pointLoading={scriptApi.pointLoading}
              onChangePrompt={scriptApi.handlePromptChange}
              onSelectChange={scriptApi.handlePromptSelect}
              onSend={scriptApi.handleSend}
            />
          </ToolModal>
        </NodeToolbar>
      ) : null}

      {tableApi.uploadState.visible &&
        createPortal(
          <UploadModal
            visible={tableApi.uploadState.visible}
            accept={tableApi.uploadState.accept}
            maxSize={tableApi.uploadState.accept === 'video' ? 200 : 20}
            nodeId={id}
            onCancel={tableApi.handleCloseUpload}
            onOk={tableApi.handleUploadSuccess}
          />,
          document.body
        )}

      {/* 缩小行列时的二次确认弹窗 */}
      {tableApi.confirmDialog.open &&
        createPortal(
          <div className='fixed inset-0 z-[1000] bg-black/65 flex items-center justify-center'>
            <div className='bg-[#262626] border border-white/10 rounded-lg p-6 max-w-[420px] w-full text-white'>
              <div className='text-base font-medium mb-3'>{tableApi.confirmDialog.title}</div>
              <div className='text-sm text-white/70 mb-6'>{tableApi.confirmDialog.content}</div>
              <div className='flex justify-end gap-2'>
                <button className='h-8 px-3 rounded-lg bg-white/10 hover:bg-white/15 text-sm' onClick={tableApi.handleShrinkCountCancel}>
                  取消
                </button>
                <button className='h-8 px-3 rounded-lg bg-[#4155F0] hover:bg-[#4155F0]/90 text-sm' onClick={tableApi.confirmDialog.onConfirm}>
                  确定
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};

export default memo(StoryboardTool);
