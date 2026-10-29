import { NodeToolbar, Position, Handle, useUpdateNodeInternals, type HandleType, type Position as PsoitionType } from '@xyflow/react';
import NodeOperation from '../../components/nodeControl/NodeOperation';
import NodeTitle from '../../components/nodeControl/NodeTitle';
import { useState, useMemo, useEffect, memo, useRef } from 'react';
import setting from '../../settings/setting';
import { useFlowStore } from '@/store/flowStore';
import hooks from '../../hooks';
import toolUtil from '../../utils/toolUtil';
import util from '../../utils/util';
import styles from './index.module.less';
import { compressImage } from '@/utils';
import EditorModal from '@/routes/editor';
import { CircleQuestionMark } from 'lucide-react';
import GifContent from '../../components/nodeControl/GifContent';
import ToolCornerActionButton from '../../components/nodeControl/ToolCornerActionButton';
import { syncCanvasUploadToAssetLibrary } from '@/components/canvasFlow/utils/canvasAssetSync';

const nodeType = 'imageEditorTool';
const { handlersMap } = setting;
const { useImageNodeDimensions, useNodeOperations, useNodeResizeObserver, useToolOutputChildNodes, useTopNodeToolbarVisible } = hooks;
const { defaultWidth, defaultHeight } = toolUtil;
const { getSourceMap } = util;
const handlers = handlersMap[nodeType];

interface Handler {
  type: HandleType;
  position: PsoitionType;
  id: string;
  style: any;
  limit?: number;
}

const ImageEditorTool = (props: any) => {
  const updateNodeInternals = useUpdateNodeInternals();
  const { data, id, selected, width, height } = props;
  const { value, taskInfo, title, titleStyle, time } = data;
  const { status } = taskInfo;
  const [focus, setFocus] = useState(false);
  const [imageList, setImageList] = useState<string[]>([]);
  const isSelection = useFlowStore(state => state.isSelection);
  const canvasId = useFlowStore(state => state.canvasId);
  const nodeRef = useRef<any>(null);
  const dataRef = useRef(data);
  const edges = useFlowStore(state => state.edges);
  const nodes = useFlowStore(state => state.nodes);
  const [editorVisible, setEditorVisible] = useState(false);
  const [gifShow, setGifShow] = useState(false);
  const [hoverTimer, setHoverTimer] = useState<NodeJS.Timeout | null>(null);

  const { updateNodeData, setShortCutLock, updateNodeSelected } = useFlowStore(state => state.actions);
  const { attachUploadOutputNode } = useToolOutputChildNodes({
    toolNodeId: id,
    nodeWidth: width,
    sourceHandleId: 'image_source',
  });

  const { handleCopy, handleDelete, handleEdit, handleChangeTitleStyle } = useNodeOperations(id, data);
  const topToolbarVisible = useTopNodeToolbarVisible(!focus && !isSelection && selected);
  useNodeResizeObserver(nodeRef, id, updateNodeInternals);
  useImageNodeDimensions(id, value, width, height, time);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  const actualWidth = useMemo(() => {
    return width || defaultWidth;
  }, [width]);
  const actualHeight = useMemo(() => {
    return height || defaultHeight;
  }, [height]);

  const previewUrls = useMemo(() => {
    return [value];
  }, [value]);

  const handleMouseEnter = () => {
    // 清除之前的定时器
    if (hoverTimer) {
      clearTimeout(hoverTimer);
    }
    // 设置新的定时器，300ms后显示GIF
    const timer = setTimeout(() => {
      setGifShow(true);
    }, 300);
    setHoverTimer(timer);
  };

  const handleMouseLeave = () => {
    // 清除定时器
    if (hoverTimer) {
      clearTimeout(hoverTimer);
      setHoverTimer(null);
    }
    // 鼠标移走时隐藏GIF
    setGifShow(false);
  };

  useEffect(() => {
    const { images } = getSourceMap(nodes, edges, id);
    setImageList(images.map(item => item.value));
  }, [edges, id, nodes]);

  useEffect(() => {
    setShortCutLock(editorVisible);
  }, [editorVisible, setShortCutLock]);

  const handleSuccess = async (url: string) => {
    updateNodeData(id, {
      ...dataRef.current,
      value: url,
      product: [{ value: url }],
    });
    const childNodeId = await attachUploadOutputNode(url);
    if (childNodeId) {
      syncCanvasUploadToAssetLibrary(url, childNodeId, 'image', 1, nodeType);
    }
    // setEditorVisible(false);
  };

  const handleShow = (e: React.MouseEvent) => {
    e.stopPropagation();
    // 强制关闭画布菜单
    window.dispatchEvent(new CustomEvent('canvas:hide-context-menu'));
    setEditorVisible(true);
    updateNodeSelected(id, false);
  };

  return (
    // 修改容器样式，使用动态计算的尺寸
    <div
      ref={nodeRef}
      className={`rounded-2xl relative hover:ring-2 ring-white/65 transition-all ${selected && 'ring-2'} min-w-[270px]`}
      style={{ width: actualWidth, height: actualHeight }}
    >
      {handlers.map((item: Handler) => {
        return <Handle type={item.type} position={item.position} id={item.id} style={item.style} key={item.id} />;
      })}
      <div className={`relative border border-white/25 rounded-2xl w-full h-full ${!value ? styles.tool : ''}`}>
        {value && <img src={compressImage(value)} className='rounded-2xl w-full h-full bg-[#262626] object-cover' />}
        <div
          className={`z-[2] absolute top-3 right-3 flex items-center justify-center duration-200 cursor-pointer`}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          <CircleQuestionMark className='text-white/65 text-3xl hover:text-white/95'></CircleQuestionMark>
        </div>
        <div
          className='absolute bottom-3 right-3'
          style={{
            right: !value ? '50%' : '',
            bottom: !value ? '50%' : '',
            transform: !value ? 'translate(50%, 50%)' : '',
          }}
        >
          <ToolCornerActionButton toolType={nodeType} active={true} label='点击进入编辑器' icon={<div className='iconfont text-3xl icon-import' />} onClick={e => handleShow(e)} />
        </div>
      </div>
      {editorVisible && (
        <div onClick={e => e.stopPropagation()}>
          <EditorModal canvasId={canvasId} nodeId={id} imageList={imageList} value={value} onClose={() => setEditorVisible(false)} onSuccess={handleSuccess}></EditorModal>
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
      <NodeToolbar isVisible={topToolbarVisible} position={Position.Top} align='center' offset={36}>
        <NodeOperation type={nodeType} url={value} status={status} previewUrls={previewUrls} onCopy={handleCopy} onDelete={handleDelete}></NodeOperation>
      </NodeToolbar>
      <NodeToolbar isVisible={gifShow} position={Position.Right} align='center'>
        <GifContent type={nodeType}></GifContent>
      </NodeToolbar>
    </div>
  );
};

export default memo(ImageEditorTool);
