import { NodeToolbar, Position, useUpdateNodeInternals } from '@xyflow/react';
import NodeOperation from '../../components/nodeControl/NodeOperation';
import NodeTitle from '../../components/nodeControl/NodeTitle';
import PoseCreate from '../../components/toolControl/PoseCreate';
import StatusOverlay from '../../components/nodeControl/StatusOverlay';
import ToolContent from '../../components/nodeControl/ToolContent';
import LimitHandler from '../../customHandler/LimitHandler';
import ToolModal from '../../components/promptControl/ToolModal';
import { useState, useMemo, useEffect, useRef, memo, useCallback } from 'react';
import setting from '../../settings/setting';
import { useFlowStore } from '@/store/flowStore';
import hooks from '../../hooks';
import toolUtil from '../../utils/toolUtil';
import util from '../../utils/util';
import type { Handler } from '../../utils/type';
import styles from './index.module.less';
import { compressImage } from '@/utils';
import GifContent from '../../components/nodeControl/GifContent';
import { syncCanvasUploadToAssetLibrary } from '@/components/canvasFlow/utils/canvasAssetSync';

const nodeType = 'poseTool';
const { handlersMap } = setting;
const { useImageNodeDimensions, useNodeOperations, useNodeResizeObserver, useToolOutputChildNodes, useTopNodeToolbarVisible } = hooks;
const { getAllSourceNodeIds, defaultWidth, defaultHeight, measureMediaNodeSize } = toolUtil;
const { getSourceMap } = util;
const handlers = handlersMap[nodeType];

type statusPros = 'running' | 'success' | 'failure' | 'interrupt';

const PoseTool = (props: any) => {
  const updateNodeInternals = useUpdateNodeInternals();
  const { data, id, selected, width, height } = props;
  const { value, taskInfo, title, titleStyle, params, time } = data;
  const { status, errorMsg } = taskInfo;
  const [focus, setFocus] = useState(false);
  const nodeRef = useRef<any>(null);
  const dataRef = useRef(data);
  const isSelection = useFlowStore(state => state.isSelection);
  const edges = useFlowStore(state => state.edges);
  const nodes = useFlowStore(state => state.nodes);
  const { updateNodeData, updateNodeMeasured } = useFlowStore(state => state.actions);
  const { attachUploadOutputNode } = useToolOutputChildNodes({
    toolNodeId: id,
    nodeWidth: width,
    sourceHandleId: 'image_source',
  });
  const tooControlRef = useRef<{ intoEdit: () => void }>(null);
  const [gifShow, setGifShow] = useState(false);

  const { handleCopy, handleDelete, handleEdit, handleChangeTitleStyle } = useNodeOperations(id, data);
  const topToolbarVisible = useTopNodeToolbarVisible(!focus && !isSelection && selected);
  useNodeResizeObserver(nodeRef, id, updateNodeInternals);
  useImageNodeDimensions(id, value, width, height, time);

  const actualWidth = useMemo(() => {
    return width || defaultWidth;
  }, [width]);
  const actualHeight = useMemo(() => {
    return height || defaultHeight;
  }, [height]);

  const previewUrls = useMemo(() => {
    return [value];
  }, [value]);

  const sourceNodeIds = useMemo(() => getAllSourceNodeIds(edges, id), [edges, id]);

  const sourceImageCount = useMemo(() => {
    const { images } = getSourceMap(nodes, edges, id);
    return images.length;
  }, [nodes, edges, id]);

  const promptModalVisible = useMemo(() => !isSelection && selected, [isSelection, selected]);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(() => {
    if (!selected) {
      setGifShow(false);
    }
  }, [selected]);

  const handleChangeMode = useCallback(
    (createMode: string) => {
      const latestData = dataRef.current;
      if (latestData.params?.createMode === createMode) {
        return;
      }
      updateNodeData(id, {
        ...latestData,
        params: {
          ...latestData.params,
          createMode,
        },
      });
    },
    [id, updateNodeData]
  );

  // 根据上游图片连线同步 createMode，避免在 PoseCreate 挂载时重复触发
  useEffect(() => {
    const currentMode = params.createMode || 'userDefined';
    if (sourceImageCount > 0 && currentMode === 'userDefined') {
      handleChangeMode('consult');
    } else if (sourceImageCount === 0 && currentMode === 'consult') {
      handleChangeMode('userDefined');
    }
  }, [sourceImageCount, params.createMode, handleChangeMode]);

  const handleSuccess = useCallback(
    async (url: string) => {
      const latestData = dataRef.current;
      if (latestData.value === url) {
        return;
      }
      const measured = await measureMediaNodeSize('image', url);
      updateNodeData(id, {
        ...latestData,
        value: url,
        product: [{ value: url }],
      });
      if (measured) {
        updateNodeMeasured(id, measured.measured, true);
      }
      const childNodeId = await attachUploadOutputNode(url, { measured });
      if (childNodeId) {
        syncCanvasUploadToAssetLibrary(url, childNodeId, 'image', 1, nodeType);
      }
    },
    [id, updateNodeData, updateNodeMeasured, attachUploadOutputNode]
  );

  const handleStatus = useCallback((status: statusPros) => {
    void status;
  }, []);

  const handleOpenModal = () => {
    tooControlRef.current?.intoEdit();
  };

  return (
    // 修改容器样式，使用动态计算的尺寸
    <div
      ref={nodeRef}
      className={`rounded-2xl relative hover:ring-2 ring-white/65 transition-all ${selected && 'ring-2'} min-w-[270px]`}
      style={{ width: actualWidth, height: actualHeight }}
    >
      {handlers.map((item: Handler) => {
        return <LimitHandler type={item.type} position={item.position} id={item.id} style={item.style} key={item.id} limit={item.limit} />;
      })}
      {value ? (
        <div className='relative border border-white/25 rounded-2xl w-full h-full'>
          <img src={compressImage(value)} className='rounded-2xl w-full h-full bg-[#262626]'></img>
          <div className={`${styles.toolNoBg} absolute inset-0`}>
            <ToolContent
              onClick={() => handleOpenModal()}
              type={nodeType}
              sourceNodeIds={sourceNodeIds}
              sourceValue={value}
              createMode={params.createMode}
              onTipClick={flag => setGifShow(flag)}
              hasValue={!!value}
            ></ToolContent>
          </div>
        </div>
      ) : (
        <div className={styles.tool}>
          <ToolContent
            onClick={() => handleOpenModal()}
            type={nodeType}
            sourceNodeIds={sourceNodeIds}
            sourceValue={value}
            createMode={params.createMode}
            onTipClick={flag => setGifShow(flag)}
          ></ToolContent>
        </div>
      )}
      <NodeTitle
        name={title}
        nodeType={nodeType}
        selected={selected}
        titleStyle={titleStyle}
        setTitleStyle={handleChangeTitleStyle}
        onEdit={handleEdit}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
      ></NodeTitle>
      {status === 'failure' && <StatusOverlay status={status} errorMsg={errorMsg} type={nodeType} id={id} />}
      <NodeToolbar isVisible={topToolbarVisible} position={Position.Top} align='center' offset={36}>
        <NodeOperation type={nodeType} url={value} status={status} previewUrls={previewUrls} onCopy={handleCopy} onDelete={handleDelete}></NodeOperation>
      </NodeToolbar>
      <NodeToolbar isVisible={promptModalVisible} position={Position.Bottom} align='center'>
        <ToolModal id={id}>
          <PoseCreate ref={tooControlRef} createMode={params.createMode} onSuccess={handleSuccess} uploadStatus={handleStatus} onChangeMode={handleChangeMode} />
        </ToolModal>
      </NodeToolbar>
      <NodeToolbar isVisible={gifShow} position={Position.Right} align='center'>
        <GifContent type={nodeType}></GifContent>
      </NodeToolbar>
    </div>
  );
};

export default memo(PoseTool);
