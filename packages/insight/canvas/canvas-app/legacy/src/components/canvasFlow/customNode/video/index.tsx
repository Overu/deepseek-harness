import { Handle, NodeToolbar, Position, NodeResizer, useUpdateNodeInternals } from '@xyflow/react';
import VideoPromptModel from './VideoPromptModel';
import NodeOperation from '../../components/nodeControl/NodeOperation';
import ProductList from '../../components/nodeControl/ProductList';
import UploadModal from '../../components/uploadControl/UploadModal';
import UploadContent from '../../components/nodeControl/UploadContent';
import StatusOverlay from '../../components/nodeControl/StatusOverlay';
import NodeTitle from '../../components/nodeControl/NodeTitle';
import VideoPlayer from '@/components/common/fileControl/VideoPlayer';
import { useState, useMemo, useEffect, useRef, memo } from 'react';
import setting from '../../settings/setting';
import { useFlowStore } from '@/store/flowStore';
import util from '../../utils/util';
import hooks from '../../hooks';
import toolUtil from '../../utils/toolUtil';
import type { Handler } from '../../utils/type';
import { isNonGenerativeMedia } from '../../utils/type';
import { ChevronRight, ChevronLeft } from 'lucide-react';
import { createPortal } from 'react-dom';
import styles from './index.module.less';
import CanvasAssetPreview from '../../components/CanvasAssetPreview';
import ReadOnlyPromptGuard from '../../components/promptControl/ReadOnlyPromptGuard';
import type { CameraMovementParam } from './cameraMovementTypes';

import { applyMediaModelTypeChange } from '../../utils/mediaNodeModelUtil';
import { calculateAspectRatioNodeDimensions } from '../../utils/mediaDimensions';

const nodeType = 'video';
// [media-node-model-unification] modelType 切换保留参数；同系列则同步切 model
const { resolveParamsOnModelChange, getSourceMap, buildMediaUploadNodeData, resolveVideoModelTypeOnInputChange, getVideoModelTypeMismatchReason } = util;
const { useVideoNodeDimensions, useNodeOperations, useNodeResizeObserver, useButtonScale, useHandleSend, useTopNodeToolbarVisible } = hooks;
const { handlersMap } = setting;
const { defaultWidth, defaultHeight, minHeight, minWidth, clearMentionTemplatesByCounts } = toolUtil;
const handlers = handlersMap[nodeType];

interface productItem {
  value: string;
}

const VideoNode = (props: any) => {
  const updateNodeInternals = useUpdateNodeInternals();
  const { data, id, selected, width, height, positionAbsoluteX, positionAbsoluteY } = props;
  const position = {
    x: positionAbsoluteX,
    y: positionAbsoluteY,
  };
  const { product, value, taskInfo, title, titleStyle, tempFile, time, type: contentType } = data;
  const { status, errorMsg } = taskInfo;
  const [isSingleExcute, setIsSingleExcute] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [showProduct, setShowProduct] = useState(false);
  const [focus, setFocus] = useState(false);
  const [allowLocal, setAllowLocal] = useState(true);
  const [displayValue, setDisplayValue] = useState<string | undefined>(value);
  const [displayProduct, setDisplayProduct] = useState<productItem[]>(product ?? []);
  const nodeRef = useRef<any>(null);
  const isSelection = useFlowStore(state => state.isSelection);
  const modelsMap = useFlowStore(state => state.modelsMap);
  const { updateNode, updateNodeData } = useFlowStore(state => state.actions);
  const modelNodePermission = useFlowStore(state => state.modelNodePermission);

  const { handleCopy, handleDelete, handleEdit, handleChangePrompt, handleChangeTitleStyle, handleAddNextNode } = useNodeOperations(id, data);
  const { isExcute, handleSend } = useHandleSend(id, setIsSingleExcute);
  useNodeResizeObserver(nodeRef, id, updateNodeInternals);
  const currentUrl = displayValue ?? value;
  useVideoNodeDimensions(id, currentUrl, width, height, time);
  const buttonScale = useButtonScale();

  const actualWidth = useMemo(() => {
    return width || defaultWidth;
  }, [width]);
  const actualHeight = useMemo(() => {
    return height || defaultHeight;
  }, [height]);

  const otherProduct = useMemo(() => {
    const current = displayValue ?? value;
    return displayProduct.filter((item: productItem) => item.value !== current);
  }, [displayProduct, displayValue, value]);

  const previewUrls = useMemo(() => {
    if (displayProduct.length > 0) {
      return displayProduct.map((item: productItem) => item.value);
    }
    return [displayValue ?? value];
  }, [displayProduct, displayValue, value]);

  const promptModalVisible = useMemo(() => {
    return !isSelection && selected && !isNonGenerativeMedia(contentType);
  }, [isSelection, selected, contentType]);

  // NodeResizer / NodeOperation 共用显隐：单选且未在编辑标题时显示；只读预览不展示操作栏与缩放
  const nodeControlVisible = useTopNodeToolbarVisible(!focus && !isSelection && selected);
  useEffect(() => {
    setDisplayValue(value);
  }, [value]);

  useEffect(() => {
    setDisplayProduct(product ?? []);
  }, [product]);

  useEffect(() => {
    if (status === 'running') {
      setShowProduct(false);
    }
  }, [status]);

  useEffect(() => {
    // 单点执行时自动展开所有生成物
    if (isSingleExcute) {
      setIsSingleExcute(false);
      setShowProduct(true);
    }
  }, [value]);

  const prevMediaCountsRef = useRef<string | null>(null);

  useEffect(() => {
    if (!promptModalVisible) {
      prevMediaCountsRef.current = null;
      return;
    }

    const syncInputMedia = () => {
      const { nodes, edges, actions, modelsMap: storeModelsMap } = useFlowStore.getState();
      const node = nodes.find(n => n.id === id);
      if (!node) return;

      const { images, videos, audios } = getSourceMap(nodes, edges, id);
      const countsKey = `${images.length}-${videos.length}-${audios.length}`;
      if (prevMediaCountsRef.current !== null && prevMediaCountsRef.current === countsKey) return;
      prevMediaCountsRef.current = countsKey;

      const nodeData = node.data as typeof data;
      const { params } = nodeData;
      const newPrompt = clearMentionTemplatesByCounts(params.prompt, {
        图片: images.length,
        视频: videos.length,
        音频: audios.length,
      });
      const newModelType = resolveVideoModelTypeOnInputChange(images.length, videos.length, audios.length);
      const mismatch = getVideoModelTypeMismatchReason(String(params.modelType || ''), images.length, videos.length > 0 || audios.length > 0);
      const switchModel = mismatch && newModelType !== params.modelType;
      if (!switchModel && newPrompt === params.prompt) return;

      let nextParams = { ...params };
      if (switchModel) {
        nextParams = applyMediaModelTypeChange(storeModelsMap, nodeType, newModelType, params);
        if (params.cameraMovement) nextParams.cameraMovement = params.cameraMovement;
      }
      nextParams.prompt = newPrompt;
      actions.updateNodeData(id, { ...nodeData, params: nextParams }, true);
    };

    syncInputMedia();
    return useFlowStore.subscribe((state, prev) => {
      if (state.nodes !== prev.nodes || state.edges !== prev.edges) syncInputMedia();
    });
  }, [promptModalVisible, id]);

  const getEmptyNodeAspectRatioDimensions = (aspectRatio: string) => {
    if (value || tempFile) return null;

    return calculateAspectRatioNodeDimensions(aspectRatio, actualWidth, actualHeight);
  };

  const getUpdatedAspectRatioDimensions = (params: any) => {
    if (params.aspect_ratio === data.params.aspect_ratio) return null;
    return getEmptyNodeAspectRatioDimensions(String(params.aspect_ratio || ''));
  };

  const updateNodeParams = (params: any, ignore = false) => {
    const dimensions = getUpdatedAspectRatioDimensions(params);
    updateNode(
      id,
      {
        data: {
          ...data,
          params,
        },
        ...(dimensions
          ? {
              width: dimensions.width,
              height: dimensions.height,
              measured: dimensions.measured,
            }
          : {}),
      },
      !ignore
    );
  };

  const handleSelectChange = (key: string, value: string | number | boolean | CameraMovementParam, ignore?: boolean) => {
    let params = { ...data.params };
    if (key === 'modelType') {
      params = applyMediaModelTypeChange(modelsMap, nodeType, String(value), data.params);
      params.prompt = data.params.prompt;
      if (data.params.cameraMovement) {
        params.cameraMovement = data.params.cameraMovement;
      }
    } else if (key === 'model') {
      params = resolveParamsOnModelChange(modelsMap, nodeType, String(value), data.params, modelNodePermission);
    } else {
      params[key] = value;
    }
    updateNodeParams(params, ignore);
  };

  const handleCascadeChange = (changeParams: Record<string, string>) => {
    updateNodeParams({ ...data.params, ...changeParams });
  };

  const handleUploadSuccess = (url: string) => {
    updateNodeData(id, buildMediaUploadNodeData(data, url), tempFile ? false : true);
    setModalVisible(false);
  };

  const handleOpenModal = (type?: string) => {
    if (type === 'all') {
      setAllowLocal(true);
    } else {
      setAllowLocal(false);
    }
    setModalVisible(true);
  };

  const handleSet = (url: string) => {
    setDisplayValue(url);
    let newProduct = [...(product ?? [])];
    const index = newProduct.findIndex(item => item.value === url);
    if (index !== -1) {
      const [movedItem] = newProduct.splice(index, 1);
      newProduct = [movedItem, ...newProduct];
    }
    setDisplayProduct(newProduct);
    updateNodeData(id, {
      ...data,
      value: url,
      product: newProduct,
    });
  };

  const toggoleProduct = () => {
    setShowProduct(!showProduct);
  };

  return (
    // 修改容器样式，使用动态计算的尺寸
    <div ref={nodeRef} className={`rounded-2xl relative hover:ring-2 ring-white/65 transition-all ${selected && 'ring-2'}`} style={{ width: actualWidth, height: actualHeight }}>
      <NodeResizer
        minWidth={value ? minWidth : defaultWidth}
        minHeight={minHeight}
        keepAspectRatio={true}
        isVisible={nodeControlVisible && data.dimensionMeta?.status !== 'pending'}
      />
      {handlers.map((item: Handler) => {
        return <Handle type={item.type} position={item.position} id={item.id} style={item.style} key={item.id} />;
      })}
      {displayValue && !tempFile ? (
        <div className='relative border border-white/25 rounded-2xl w-full h-full'>
          <VideoPlayer url={displayValue} pauseWhileRunning={status === 'running'} playOnHover onPreview={() => setPreviewVisible(true)}></VideoPlayer>
          {displayProduct.length > 1 ? (
            <div
              className='absolute top-2 right-2 bg-black/45 text-white text-sm rounded-lg cursor-pointer w-20 h-8 flex items-center justify-center gap-2'
              onClick={toggoleProduct}
              style={{ transform: `scale(${buttonScale})`, transformOrigin: 'top right' }}
            >
              <div>{showProduct ? '收起' : '展开'}</div>
              <div>{displayProduct.length}</div>
              {showProduct ? <ChevronLeft size={16}></ChevronLeft> : <ChevronRight size={16}></ChevronRight>}
            </div>
          ) : null}
          {showProduct && (
            <ProductList type={nodeType} width={actualWidth} height={actualHeight} list={otherProduct} previewUrls={previewUrls} nodeId={id} onSet={handleSet}></ProductList>
          )}
        </div>
      ) : (
        <div className={styles.video}>
          <UploadContent type={nodeType} nodeId={id} selected={selected} tempFile={tempFile} onClick={() => handleOpenModal()} onOk={handleUploadSuccess}></UploadContent>
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
      <StatusOverlay status={status} errorMsg={errorMsg} type={nodeType} id={id} />
      <NodeToolbar isVisible={nodeControlVisible} position={Position.Top} align='center' offset={36}>
        <NodeOperation
          type={nodeType}
          nodeId={id}
          url={currentUrl}
          status={status}
          previewUrls={previewUrls}
          contentType={contentType}
          onAddNextTool={toolType => handleAddNextNode(nodeType, toolType, position)}
          onUpload={() => handleOpenModal('all')}
          onCopy={handleCopy}
          onDelete={handleDelete}
        ></NodeOperation>
      </NodeToolbar>
      {promptModalVisible && (
        <NodeToolbar isVisible={promptModalVisible} position={Position.Bottom} align='center'>
          <ReadOnlyPromptGuard>
            <VideoPromptModel
              isExcute={isExcute}
              props={props}
              status={status}
              onChangePrompt={handleChangePrompt}
              onSelectChange={handleSelectChange}
              onCascadeChange={handleCascadeChange}
              onSend={handleSend}
            ></VideoPromptModel>
          </ReadOnlyPromptGuard>
        </NodeToolbar>
      )}
      {modalVisible &&
        createPortal(
          <UploadModal
            accept={nodeType}
            allowLocal={allowLocal}
            maxSize={200}
            nodeId={id}
            visible={modalVisible}
            onCancel={() => setModalVisible(false)}
            onOk={handleUploadSuccess}
          ></UploadModal>,
          document.body
        )}
      {previewVisible && createPortal(<CanvasAssetPreview visible={previewVisible} nodeId={id} urls={previewUrls} onClose={() => setPreviewVisible(false)} />, document.body)}
    </div>
  );
};

export default memo(VideoNode);
