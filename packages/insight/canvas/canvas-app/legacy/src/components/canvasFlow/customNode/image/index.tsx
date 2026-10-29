import { Handle, NodeToolbar, Position, NodeResizer, useUpdateNodeInternals } from '@xyflow/react';
import PromptModel from './ImagePromptModel';
import NodeOperation from '../../components/nodeControl/NodeOperation';
import ProductList from '../../components/nodeControl/ProductList';
import UploadModal from '../../components/uploadControl/UploadModal';
import UploadContent from '../../components/nodeControl/UploadContent';
import StatusOverlay from '../../components/nodeControl/StatusOverlay';
import NodeTitle from '../../components/nodeControl/NodeTitle';
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
import { isSvgImageUrl } from '@/utils';
import CanvasAssetPreview from '../../components/CanvasAssetPreview';
import ReadOnlyPromptGuard from '../../components/promptControl/ReadOnlyPromptGuard';
import { useImageLocalPreview, type UploadSuccessMeta } from './useImageLocalPreview';
import GridCropMenu from './GridCropMenu';
import { cropAndUploadGridImage, isGridCropAbortError } from './gridCropImage';
import { buildGridCropNodes } from './gridCropNodes';
import { toast } from 'sonner';
import { addAssetList } from '@/api/asset';

import { applyMediaModelTypeChange } from '../../utils/mediaNodeModelUtil';
import { calculateAspectRatioNodeDimensions } from '../../utils/mediaDimensions';

const nodeType = 'image';
// [media-node-model-unification] modelType 切换保留参数；同系列则同步切 model
const { resolveParamsOnModelChange, buildMediaUploadNodeData, getSourceMap, transformImageType, getImageModelTypeMismatchReason } = util;
const { defaultWidth, defaultHeight, minHeight, minWidth, clearTemplatesByValue } = toolUtil;
const { useImageNodeDimensions, useNodeOperations, useNodeResizeObserver, useButtonScale, useHandleSend, useTopNodeToolbarVisible } = hooks;
const { handlersMap } = setting;
const handlers = handlersMap[nodeType];
const pendingImageLoadCallbacks = new Set<() => void>();
let imageLoadTimer: ReturnType<typeof setTimeout> | null = null;

const isSafariBrowser = () => typeof navigator !== 'undefined' && /safari/i.test(navigator.userAgent) && !/chrome|chromium|crios|fxios|android/i.test(navigator.userAgent);
const getImageLoadBatchSize = () => (isSafariBrowser() ? 2 : 8);
const getImageLoadBatchDelay = () => (isSafariBrowser() ? 220 : 80);
const getImageLoadInitialDelay = () => (isSafariBrowser() ? 600 : 0);

const scheduleImageLoadBatch = () => {
  if (imageLoadTimer || pendingImageLoadCallbacks.size === 0) return;

  imageLoadTimer = setTimeout(() => {
    imageLoadTimer = null;
    const callbacks = Array.from(pendingImageLoadCallbacks).slice(0, getImageLoadBatchSize());
    callbacks.forEach(callback => {
      if (!pendingImageLoadCallbacks.delete(callback)) return;
      callback();
    });
    scheduleImageLoadBatch();
  }, getImageLoadBatchDelay());
};

const requestImageLoad = (callback: () => void) => {
  let enqueueTimer: ReturnType<typeof setTimeout> | null = null;
  const enqueue = () => {
    enqueueTimer = null;
    pendingImageLoadCallbacks.add(callback);
    scheduleImageLoadBatch();
  };

  const initialDelay = getImageLoadInitialDelay();
  if (initialDelay > 0) {
    enqueueTimer = setTimeout(enqueue, initialDelay);
  } else {
    enqueue();
  }

  return () => {
    if (enqueueTimer) clearTimeout(enqueueTimer);
    pendingImageLoadCallbacks.delete(callback);
  };
};

interface productItem {
  value: string;
}

const ImageNode = (props: any) => {
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
  const [displayProduct, setDisplayProduct] = useState<productItem[]>(Array.isArray(product) ? product : []);
  const [shouldLoadImage, setShouldLoadImage] = useState(false);
  const [isGridCropping, setIsGridCropping] = useState(false);
  const nodeRef = useRef<any>(null);
  const gridCropAbortControllerRef = useRef<AbortController | null>(null);
  const isSelection = useFlowStore(state => state.isSelection);
  const modelsMap = useFlowStore(state => state.modelsMap);
  const canvasId = useFlowStore(state => state.canvasId);
  const { updateNode, updateNodeData } = useFlowStore(state => state.actions);
  const modelNodePermission = useFlowStore(state => state.modelNodePermission);
  const { handleCopy, handleDelete, handleEdit, handleChangePrompt, handleChangeTitleStyle, handleAddNextNode } = useNodeOperations(id, data);
  const { isExcute, handleSend } = useHandleSend(id, setIsSingleExcute);
  useNodeResizeObserver(nodeRef, id, updateNodeInternals);

  const currentUrl = displayValue ?? value;
  const remoteUrl = currentUrl;
  const { localPreviewSrc, remoteSrc, remoteStatus, remoteAttempt, measureSrc, setLocalPreviewFromMeta, onRemoteLoad, onRemoteError } = useImageLocalPreview({
    remoteUrl,
    enabled: true,
  });
  useImageNodeDimensions(id, measureSrc || '', width, height, time);
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
  const isSvgImage = useMemo(() => isSvgImageUrl(currentUrl || ''), [currentUrl]);
  const hasMultipleProduct = displayProduct.length > 1;

  useEffect(
    () => () => {
      gridCropAbortControllerRef.current?.abort();
    },
    []
  );

  const prevImageCountRef = useRef<string | null>(null);

  useEffect(() => {
    if (!promptModalVisible) {
      prevImageCountRef.current = null;
      return;
    }

    const syncInputMedia = () => {
      const { nodes, edges, actions, modelsMap: storeModelsMap } = useFlowStore.getState();
      const node = nodes.find(n => n.id === id);
      if (!node) return;

      const { images } = getSourceMap(nodes, edges, id);
      const countKey = String(images.length);
      if (prevImageCountRef.current !== null && prevImageCountRef.current === countKey) return;
      prevImageCountRef.current = countKey;

      const nodeData = node.data as typeof data;
      const { params } = nodeData;
      const newPrompt = clearTemplatesByValue(params.prompt, images.length);
      const newModelType = transformImageType(images.length);
      const mismatch = getImageModelTypeMismatchReason(String(params.modelType || ''), images.length);
      const switchModel = mismatch && newModelType !== params.modelType;
      if (!switchModel && newPrompt === params.prompt) return;

      let nextParams = { ...params };
      if (switchModel) {
        nextParams = applyMediaModelTypeChange(storeModelsMap, nodeType, newModelType, params);
        if (params.cameraControl) nextParams.cameraControl = params.cameraControl;
      }
      nextParams.prompt = newPrompt;
      actions.updateNodeData(id, { ...nodeData, params: nextParams }, true);
    };

    syncInputMedia();
    return useFlowStore.subscribe((state, prev) => {
      if (state.nodes !== prev.nodes || state.edges !== prev.edges) syncInputMedia();
    });
  }, [promptModalVisible, id]);

  useEffect(() => {
    setDisplayValue(value);
  }, [value]);

  useEffect(() => {
    setDisplayProduct(Array.isArray(product) ? product : []);
  }, [product]);

  useEffect(() => {
    if (status === 'running') {
      setShowProduct(false);
    }
  }, [status]);

  useEffect(() => {
    if (!displayValue || tempFile) {
      setShouldLoadImage(false);
      return;
    }

    if (shouldLoadImage) return;

    let cancelPendingLoad: (() => void) | undefined;
    const queueImageLoad = () => {
      if (cancelPendingLoad) return;
      if (selected) {
        setShouldLoadImage(true);
        return;
      }
      cancelPendingLoad = requestImageLoad(() => setShouldLoadImage(true));
    };

    const nodeElement = nodeRef.current;
    if (!nodeElement || typeof IntersectionObserver === 'undefined') {
      queueImageLoad();
      return () => {
        cancelPendingLoad?.();
      };
    }

    const observer = new IntersectionObserver(
      entries => {
        if (!entries.some(entry => entry.isIntersecting)) return;
        queueImageLoad();
        observer.disconnect();
      },
      { rootMargin: '1000px' }
    );

    observer.observe(nodeElement);

    return () => {
      observer.disconnect();
      cancelPendingLoad?.();
    };
  }, [displayValue, selected, tempFile, shouldLoadImage]);

  useEffect(() => {
    // 单点执行时自动展开所有生成物
    if (isSingleExcute) {
      setIsSingleExcute(false);
      setShowProduct(true);
    }
  }, [value]);

  const getEmptyNodeAspectRatioDimensions = (aspectRatio: string) => {
    if (value || tempFile) return null;

    return calculateAspectRatioNodeDimensions(aspectRatio, actualWidth, actualHeight);
  };

  const getUpdatedAspectRatioDimensions = (params: any) => {
    if (params.aspect_ratio === data.params.aspect_ratio) return null;
    return getEmptyNodeAspectRatioDimensions(String(params.aspect_ratio || ''));
  };

  const updateNodeParams = (params: any) => {
    const dimensions = getUpdatedAspectRatioDimensions(params);
    updateNode(id, {
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
    });
  };

  const handleSelectChange = (key: string, value: string | number | boolean) => {
    let params = { ...data.params };
    if (key === 'modelType') {
      params = applyMediaModelTypeChange(modelsMap, nodeType, String(value), data.params);
      params.prompt = data.params.prompt;
      // 切换模型类型保留相机控制参数但禁用
      if (data.params.cameraControl) {
        params.cameraControl = data.params.cameraControl;
      }
    } else if (key === 'model') {
      params = resolveParamsOnModelChange(modelsMap, nodeType, String(value), data.params, modelNodePermission);
    } else {
      params[key] = value;
    }
    updateNodeParams(params);
  };

  const handleCascadeChange = (changeParams: Record<string, string>) => {
    updateNodeParams({ ...data.params, ...changeParams });
  };

  const handleUploadSuccess = (url: string, meta?: UploadSuccessMeta) => {
    // 上传成功后先用本地预览图占位，避免远端 URL 加载耗时导致空白
    setDisplayValue(url);
    setLocalPreviewFromMeta(url, meta);
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

  const handleGridCropSelect = async (columns: number, rows: number) => {
    if (isGridCropping || (columns === 1 && rows === 1)) return;
    if (!currentUrl) {
      toast.error('请先添加图片素材');
      return;
    }
    if (isSvgImage) {
      toast.error('SVG 图片暂不支持宫格裁切');
      return;
    }
    if (useFlowStore.getState().readOnly) return;

    const sourceUrl = currentUrl;
    const controller = new AbortController();
    gridCropAbortControllerRef.current?.abort();
    gridCropAbortControllerRef.current = controller;
    setIsGridCropping(true);

    try {
      const crops = await cropAndUploadGridImage({
        url: sourceUrl,
        sourceNodeId: id,
        columns,
        rows,
        signal: controller.signal,
      });
      const latestState = useFlowStore.getState();
      const sourceNode = latestState.nodes.find(node => node.id === id);
      if (!sourceNode || sourceNode.data.value !== sourceUrl) {
        throw new Error('原图片已发生变化，请重新裁切');
      }
      await addAssetList(crops.map(({ url }) => ({ assetType: 1, fileUrl: url, canvasId: Number(canvasId), nodeId: id })));

      const nodes = buildGridCropNodes({
        crops,
        existingNodes: latestState.nodes,
        sourcePosition: position,
        sourceWidth: actualWidth,
        modelsMap: latestState.modelsMap,
        modelNodePermission: latestState.modelNodePermission,
      });

      await latestState.actions.addNode(nodes);
      toast.success(`已生成 ${crops.length} 张裁切图片`);
    } catch (error) {
      controller.abort();
      if (!isGridCropAbortError(error)) {
        toast.error(error instanceof Error ? error.message : '宫格裁切失败，请重试');
      }
    } finally {
      if (gridCropAbortControllerRef.current === controller) {
        gridCropAbortControllerRef.current = null;
        setIsGridCropping(false);
      }
    }
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
          {shouldLoadImage ? (
            <>
              <div className='absolute inset-0 rounded-2xl bg-[#262626]' />
              {localPreviewSrc && remoteStatus !== 'ready' ? (
                <img
                  src={localPreviewSrc}
                  decoding='async'
                  draggable={false}
                  onDoubleClick={() => setPreviewVisible(true)}
                  className='absolute inset-0 rounded-2xl w-full h-full bg-[#262626]'
                />
              ) : null}
              {remoteSrc ? (
                <img
                  key={`${remoteSrc}:${remoteAttempt}`}
                  src={remoteSrc}
                  loading='lazy'
                  decoding='async'
                  draggable={false}
                  onLoad={onRemoteLoad}
                  onError={onRemoteError}
                  onDoubleClick={() => setPreviewVisible(true)}
                  className={`absolute inset-0 rounded-2xl w-full h-full bg-[#262626] ${remoteStatus === 'ready' ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
                />
              ) : null}
            </>
          ) : (
            <div className='rounded-2xl w-full h-full bg-[#262626]' />
          )}
          {isSvgImage ? (
            <div
              className={`absolute top-2 bg-black/45 text-white text-xs rounded-md px-2 h-6 flex items-center justify-center pointer-events-none ${
                hasMultipleProduct ? 'right-[5.5rem]' : 'right-2'
              }`}
              style={{ transform: `scale(${buttonScale})`, transformOrigin: 'top right' }}
            >
              SVG
            </div>
          ) : null}
          {hasMultipleProduct ? (
            <div
              className='absolute top-2 right-2 bg-black/45 text-white text-sm rounded-lg cursor-pointer w-20 h-8 flex items-center justify-center gap-2'
              onClick={toggoleProduct}
              style={{ transform: `scale(${buttonScale})`, transformOrigin: 'top right' }}
            >
              <div>{showProduct ? '收起' : '展开'}</div>
              <div>{displayProduct.length}</div>
              {showProduct ? <ChevronLeft size={14}></ChevronLeft> : <ChevronRight size={14}></ChevronRight>}
            </div>
          ) : null}
          {showProduct && (
            <ProductList type={nodeType} width={actualWidth} height={actualHeight} list={otherProduct} previewUrls={previewUrls} nodeId={id} onSet={handleSet}></ProductList>
          )}
        </div>
      ) : (
        <div className={styles.image}>
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
      {nodeControlVisible && (
        <NodeToolbar isVisible={nodeControlVisible} position={Position.Top} align='center' offset={36}>
          <NodeOperation
            type={nodeType}
            nodeId={id}
            url={currentUrl}
            status={status}
            previewUrls={previewUrls}
            contentType={contentType}
            onAddNextTool={toolType => {
              if (toolType === 'gridCrop') return;
              handleAddNextNode(nodeType, toolType, position);
            }}
            renderToolItem={(tool, disabled) =>
              tool.type === 'gridCrop' ? <GridCropMenu tool={tool} onSelect={handleGridCropSelect} disabled={disabled || isGridCropping} loading={isGridCropping} /> : undefined
            }
            onUpload={() => handleOpenModal('all')}
            onCopy={handleCopy}
            onDelete={handleDelete}
          ></NodeOperation>
        </NodeToolbar>
      )}
      {promptModalVisible && (
        <NodeToolbar isVisible={promptModalVisible} position={Position.Bottom} align='center'>
          <ReadOnlyPromptGuard>
            <PromptModel
              isExcute={isExcute}
              status={status}
              props={props}
              onChangePrompt={handleChangePrompt}
              onSelectChange={handleSelectChange}
              onCascadeChange={handleCascadeChange}
              onSend={handleSend}
            ></PromptModel>
          </ReadOnlyPromptGuard>
        </NodeToolbar>
      )}
      {modalVisible &&
        createPortal(
          <UploadModal
            accept={nodeType}
            allowLocal={allowLocal}
            maxSize={20}
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

export default memo(ImageNode);
