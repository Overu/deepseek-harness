import { NodeToolbar, Position, useUpdateNodeInternals } from '@xyflow/react';
import { useState, useMemo, useEffect, useRef, memo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { CircleQuestionMark, Globe } from 'lucide-react';
import NodeOperation from '../../../components/nodeControl/NodeOperation';
import NodeTitle from '../../../components/nodeControl/NodeTitle';
import StatusOverlay from '../../../components/nodeControl/StatusOverlay';
import UploadContent from '../../../components/nodeControl/UploadContent';
import UploadModal from '../../../components/uploadControl/UploadModal';
import LimitHandler from '../../../customHandler/LimitHandler';
import ToolModal from '../../../components/promptControl/ToolModal';
import GifContent from '../../../components/nodeControl/GifContent';
import PanoramaPromptModel from './PanoramaPromptModel';
import PanoramaViewer, { type PanoramaViewerHandle } from './PanoramaViewer';
import setting from '../../../settings/setting';
import { syncCanvasVersionNumber, useFlowStore } from '@/store/flowStore';
import hooks from '../../../hooks';
import toolUtil from '../../../utils/toolUtil';
import util from '../../../utils/util';
import type { Handler } from '../../../utils/type';
import styles from '../index.module.less';
import { createExternalTask, queryExternalTaskResult } from '@/api/tool';
import { usePointStore } from '@/store/pointStore';
import { syncCanvasUploadToAssetLibrary } from '@/components/canvasFlow/utils/canvasAssetSync';
import { useImageLocalPreview, type UploadSuccessMeta } from '../../image/useImageLocalPreview';
import {
  buildPanoramaExternalTaskParams,
  buildPanoramaCostParams,
  buildPanoramaPrompt,
  getPanoramaModelTypeMismatchReason,
  transformPanoramaType,
  PANORAMA_DEFAULT_ASPECT_RATIO,
  PANORAMA_MAX_NODE_SIZE,
  type PanoramaAspectRatio,
  type PanoramaViewState,
} from './panoramaUtil';
import { useExternalTaskCostPoints } from '../useExternalTaskCostPoints';
import { toast } from 'sonner';

const nodeType = 'panoramaTool';
const { handlersMap } = setting;
const { useImageNodeDimensions, useNodeOperations, useNodeResizeObserver, useToolPermissionDisabled, useToolOutputChildNodes, useTopNodeToolbarVisible } = hooks;
const { defaultWidth, defaultHeight, clearTemplatesByValue } = toolUtil;
const { buildMediaUploadNodeData, getSourceMap } = util;
const handlers = handlersMap[nodeType];

const PanoramaTool = (props: any) => {
  const toolPermissionDisabled = useToolPermissionDisabled(nodeType);
  const updateNodeInternals = useUpdateNodeInternals();
  const { data, id, selected, width, height } = props;
  const { value, taskInfo, title, titleStyle, time, tempFile, params } = data;
  const { status, errorMsg, taskId } = taskInfo || { status: 'success', errorMsg: '', taskId: '' };

  const [focus, setFocus] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [allowLocal, setAllowLocal] = useState(true);
  const [gifShow, setGifShow] = useState(false);
  const [hoverTimer, setHoverTimer] = useState<NodeJS.Timeout | null>(null);
  const [tempTaskId, setTempTaskId] = useState('');
  const [execute, setExecute] = useState(false);
  const [embeddedViewerVisible, setEmbeddedViewerVisible] = useState(false);
  const [fullscreenViewerVisible, setFullscreenViewerVisible] = useState(false);
  const [panoramaAspectRatio, setPanoramaAspectRatio] = useState<PanoramaAspectRatio>(PANORAMA_DEFAULT_ASPECT_RATIO);
  const [panoramaViewState, setPanoramaViewState] = useState<PanoramaViewState | null>(null);
  const [shouldLoadImage, setShouldLoadImage] = useState(false);

  const nodeRef = useRef<any>(null);
  const dataRef = useRef(data);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const prevImageCountRef = useRef<string | null>(null);
  const embeddedViewerRef = useRef<PanoramaViewerHandle>(null);
  const fullscreenViewerRef = useRef<PanoramaViewerHandle>(null);

  const isSelection = useFlowStore(state => state.isSelection);
  const canvasId = useFlowStore(state => state.canvasId);
  const { updateNodeData, updateNodeStatus } = useFlowStore(state => state.actions);
  const { setNeedPoint, updateUserPoint } = usePointStore(state => state.actions);

  const { handleCopy, handleDelete, handleEdit, handleChangeTitleStyle } = useNodeOperations(id, data);
  const topToolbarVisible = useTopNodeToolbarVisible(!focus && !isSelection && selected);
  const { attachUploadOutputNode } = useToolOutputChildNodes({
    toolNodeId: id,
    nodeWidth: width,
    sourceHandleId: 'image_source',
  });

  useNodeResizeObserver(nodeRef, id, updateNodeInternals);

  const currentUrl = value;
  const { localPreviewSrc, remoteSrc, remoteStatus, remoteAttempt, measureSrc, setLocalPreviewFromMeta, onRemoteLoad, onRemoteError } = useImageLocalPreview({
    remoteUrl: currentUrl,
    enabled: true,
  });
  useImageNodeDimensions(id, measureSrc || '', width, height, time, PANORAMA_MAX_NODE_SIZE);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  const actualTaskId = useMemo(() => tempTaskId || taskId || '', [taskId, tempTaskId]);
  const actualWidth = useMemo(() => width || defaultWidth, [width]);
  const actualHeight = useMemo(() => height || defaultHeight, [height]);
  const previewUrls = useMemo(() => (value ? [value] : []), [value]);

  const promptModalVisible = useMemo(() => !isSelection && selected, [isSelection, selected]);

  // 赛点仅与所选参数有关，参数变化时才重新计算
  const costKey = useMemo(() => {
    const modelType = String(params?.modelType || 'text_to_image');
    return [`m=${modelType}`, `r=${params?.resolution || '2K'}`].join('#');
  }, [params?.modelType, params?.resolution]);

  const buildCostParams = useCallback(() => {
    return buildPanoramaCostParams({
      canvasId: canvasId || '',
      nodeId: id,
      params: params || {},
    });
  }, [canvasId, id, params?.modelType, params?.resolution]);

  const { caculatePoint, pointLoading } = useExternalTaskCostPoints({
    selected: promptModalVisible,
    costKey,
    buildCostParams,
  });

  useEffect(() => {
    if (!promptModalVisible) {
      prevImageCountRef.current = null;
      return;
    }

    const syncInputMedia = () => {
      const { nodes: storeNodes, edges: storeEdges, actions } = useFlowStore.getState();
      const node = storeNodes.find(n => n.id === id);
      if (!node) return;

      const { images } = getSourceMap(storeNodes, storeEdges, id);
      const countKey = String(images.length);
      if (prevImageCountRef.current !== null && prevImageCountRef.current === countKey) return;
      prevImageCountRef.current = countKey;

      const nodeData = node.data as typeof data;
      const newModelType = transformPanoramaType(images.length);
      const newPrompt = clearTemplatesByValue(nodeData.params?.prompt || '', images.length);
      if (newModelType === nodeData.params?.modelType && newPrompt === nodeData.params?.prompt) return;

      actions.updateNodeData(
        id,
        {
          ...nodeData,
          params: {
            ...nodeData.params,
            modelType: newModelType,
            prompt: newPrompt,
          },
        },
        true
      );
    };

    syncInputMedia();
    return useFlowStore.subscribe((state, prev) => {
      if (state.nodes !== prev.nodes || state.edges !== prev.edges) syncInputMedia();
    });
  }, [promptModalVisible, id]);

  useEffect(() => {
    if (!value || tempFile) {
      setShouldLoadImage(false);
      return;
    }
    setShouldLoadImage(true);
  }, [value, tempFile]);

  // 产物 URL 变化时清空视角，避免沿用旧图姿态
  useEffect(() => {
    setPanoramaViewState(null);
  }, [value]);

  useEffect(() => {
    if (!selected) setGifShow(false);
  }, [selected]);

  const handleMouseEnter = () => {
    if (hoverTimer) clearTimeout(hoverTimer);
    const timer = setTimeout(() => setGifShow(true), 300);
    setHoverTimer(timer);
  };

  const handleMouseLeave = () => {
    if (hoverTimer) {
      clearTimeout(hoverTimer);
      setHoverTimer(null);
    }
    setGifShow(false);
  };

  useEffect(() => {
    return () => {
      if (hoverTimer) clearTimeout(hoverTimer);
    };
  }, [hoverTimer]);

  useEffect(() => {
    if (status !== 'running') return;

    const poll = async () => {
      try {
        if (!actualTaskId) {
          updateNodeStatus(id, 'failure', '任务ID缺失，请重试');
          setExecute(false);
          return;
        }

        const { code, data: resData }: any = await queryExternalTaskResult({ taskId: actualTaskId });
        syncCanvasVersionNumber(canvasId, resData?.versionNumber);
        if (code !== 'SUCCESS' || !resData) {
          updateNodeStatus(id, 'failure', resData?.message || '查询失败，请重试');
          setExecute(false);
          updateUserPoint();
          return;
        }

        if (resData.status === 'RUNNING') {
          intervalRef.current = setTimeout(poll, 3000);
          return;
        }

        if (resData.status === 'SUCCESS') {
          const imageUrl = resData.result?.imageList?.[0] || '';
          if (imageUrl) {
            const latestData = dataRef.current;
            updateNodeData(
              id,
              {
                ...latestData,
                value: imageUrl,
                product: [{ value: imageUrl }],
              },
              true,
              false
            );
          }
          updateNodeStatus(id, 'success');
          setExecute(false);
          updateUserPoint();
          return;
        }

        updateNodeStatus(id, 'failure', resData.message || '生成失败，请重试');
        setExecute(false);
        updateUserPoint();
      } catch {
        updateNodeStatus(id, 'failure', '超时错误，请重试');
        setExecute(false);
        updateUserPoint();
      }
    };

    intervalRef.current = setTimeout(poll, 200);
    return () => {
      if (intervalRef.current) clearTimeout(intervalRef.current);
    };
  }, [actualTaskId, id, status, updateNodeData, updateNodeStatus, updateUserPoint]);

  useEffect(() => {
    if (status === 'running') {
      setExecute(true);
      // 生成时退出全景，让 StatusOverlay 正常覆盖节点表面
      setEmbeddedViewerVisible(false);
      setFullscreenViewerVisible(false);
    }
  }, [status]);

  const handleUploadSuccess = (url: string, meta?: UploadSuccessMeta) => {
    setLocalPreviewFromMeta(url, meta);
    updateNodeData(id, buildMediaUploadNodeData(data, url), tempFile ? false : true);
    setModalVisible(false);
  };

  const handleOpenModal = (type?: string) => {
    setAllowLocal(type === 'all');
    setModalVisible(true);
  };

  const handleParamsChange = useCallback(
    (key: string, val: string) => {
      const latest = dataRef.current;
      updateNodeData(
        id,
        {
          ...latest,
          params: {
            ...latest.params,
            [key]: val,
          },
        },
        key !== 'prompt'
      );
    },
    [id, updateNodeData]
  );

  const handleChangePrompt = useCallback(
    (prompt: string) => {
      const latest = dataRef.current;
      updateNodeData(
        id,
        {
          ...latest,
          params: {
            ...latest.params,
            prompt,
          },
        },
        false
      );
    },
    [id, updateNodeData]
  );

  const exitPanoramaViewers = useCallback(() => {
    setEmbeddedViewerVisible(false);
    setFullscreenViewerVisible(false);
  }, []);

  const handleExecute = async () => {
    if (execute || toolPermissionDisabled || status === 'running') return;

    const { nodes: storeNodes, edges: storeEdges } = useFlowStore.getState();
    const { images, texts } = getSourceMap(storeNodes, storeEdges, id);
    const textValues = texts.map(t => t.value);
    const latest = dataRef.current;
    const modelType = String(latest.params?.modelType || 'text_to_image');
    const mismatch = getPanoramaModelTypeMismatchReason(modelType, images.length);
    if (mismatch) return;

    if (modelType === 'image_editing' && !images.length) return;
    if (modelType === 'text_to_image' && !buildPanoramaPrompt(latest.params?.prompt || '', textValues).trim()) return;

    // 生成前退出全景，保证 StatusOverlay 可见
    exitPanoramaViewers();
    setExecute(true);
    setNeedPoint(caculatePoint);
    try {
      const taskParams = buildPanoramaExternalTaskParams({
        canvasId: canvasId || '',
        nodeId: id,
        params: latest.params || {},
        imageUrlList: images.map(item => item.value),
        textMap: textValues,
      });

      const { code, data: resData, msg }: any = await createExternalTask(taskParams);
      syncCanvasVersionNumber(canvasId, resData?.versionNumber);
      if (code === 'SUCCESS' && resData?.taskId) {
        setTempTaskId(String(resData.taskId));
        updateNodeStatus(id, 'running');
        updateUserPoint();
      } else {
        setExecute(false);
        updateNodeStatus(id, 'failure', msg || '任务创建失败');
      }
    } catch (e: any) {
      setExecute(false);
      updateNodeStatus(id, 'failure', e.message || '任务创建失败');
    }
  };

  const handleCapture = useCallback(
    async (url: string) => {
      const childNodeId = await attachUploadOutputNode(url);
      if (childNodeId) {
        syncCanvasUploadToAssetLibrary(url, childNodeId, 'image', 1, nodeType);
        toast.success('截图已完成');
      }
    },
    [attachUploadOutputNode]
  );

  const handleOpenFullscreen = useCallback(() => {
    const view = embeddedViewerRef.current?.getViewState() ?? panoramaViewState;
    if (view) setPanoramaViewState(view);
    setFullscreenViewerVisible(true);
  }, [panoramaViewState]);

  const handleCloseFullscreen = useCallback(() => {
    const view = fullscreenViewerRef.current?.getViewState() ?? panoramaViewState;
    if (view) setPanoramaViewState(view);
    setFullscreenViewerVisible(false);
  }, [panoramaViewState]);

  const displayValue = value;
  const panoramaImageUrl = measureSrc || displayValue;
  const isRunning = status === 'running' || execute;
  // 全屏时卸载嵌入 Three 实例，关闭后用同一 viewState 恢复
  const showEmbeddedViewer = embeddedViewerVisible && !fullscreenViewerVisible;

  return (
    <div ref={nodeRef} className={`rounded-2xl relative hover:ring-2 ring-white/65 transition-all ${selected && 'ring-2'}`} style={{ width: actualWidth, height: actualHeight }}>
      {handlers.map((item: Handler) => (
        <LimitHandler
          type={item.type}
          position={item.position}
          id={item.id}
          style={embeddedViewerVisible ? { ...item.style, zIndex: 40 } : item.style}
          key={item.id}
          limit={item.limit}
        />
      ))}

      {displayValue && !tempFile ? (
        <div
          className='relative border border-white/25 rounded-2xl w-full h-full overflow-hidden'
          onDoubleClick={e => {
            if (isRunning || embeddedViewerVisible) return;
            e.stopPropagation();
            setEmbeddedViewerVisible(true);
          }}
        >
          {shouldLoadImage ? (
            <>
              <div className='absolute inset-0 bg-black/40 rounded-2xl' />
              {localPreviewSrc && remoteStatus !== 'ready' ? (
                <img src={localPreviewSrc} decoding='async' className='absolute inset-0 w-full h-full object-cover rounded-2xl' draggable={false} />
              ) : null}
              {remoteSrc ? (
                <img
                  key={`${remoteSrc}:${remoteAttempt}`}
                  src={remoteSrc}
                  loading='lazy'
                  decoding='async'
                  onLoad={onRemoteLoad}
                  onError={onRemoteError}
                  className={`absolute inset-0 w-full h-full object-cover rounded-2xl ${remoteStatus === 'ready' ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
                  draggable={false}
                />
              ) : null}
            </>
          ) : (
            <div className='w-full h-full bg-black/40 rounded-2xl' />
          )}
          {!isRunning && !embeddedViewerVisible ? (
            <button
              type='button'
              className='absolute bottom-3 right-3 z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black/60 text-sm text-white/95 hover:bg-black/75 transition-colors nodrag'
              onClick={e => {
                e.stopPropagation();
                setEmbeddedViewerVisible(true);
              }}
            >
              <Globe size={14} />
              进入全景
            </button>
          ) : null}
          {showEmbeddedViewer ? (
            <PanoramaViewer
              ref={embeddedViewerRef}
              key={panoramaImageUrl}
              imageUrl={panoramaImageUrl}
              visible={showEmbeddedViewer}
              mode='embedded'
              aspectRatio={panoramaAspectRatio}
              onAspectRatioChange={setPanoramaAspectRatio}
              initialView={panoramaViewState}
              onClose={() => setEmbeddedViewerVisible(false)}
              onCapture={handleCapture}
              onFullscreen={handleOpenFullscreen}
            />
          ) : null}
        </div>
      ) : (
        <div className={`relative border border-white/25 rounded-2xl w-full h-full ${styles.tool}`}>
          <div
            className='absolute top-3 right-3 z-10 w-6 h-6 rounded-full bg-white/10 flex items-center justify-center cursor-pointer nodrag'
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
          >
            <CircleQuestionMark size={14} className='text-white/80' />
          </div>
          <UploadContent type={nodeType} selected={selected} nodeId={id} tempFile={tempFile} onOk={handleUploadSuccess} onClick={() => handleOpenModal()} />
        </div>
      )}

      <StatusOverlay status={status} errorMsg={errorMsg} type={nodeType} id={id} />

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

      <NodeToolbar isVisible={topToolbarVisible} position={Position.Top} align='center' offset={36}>
        <NodeOperation
          type={nodeType}
          nodeId={id}
          url={displayValue || ''}
          status={status}
          previewUrls={previewUrls}
          showPreview={false}
          showUpload={Boolean(displayValue) && status !== 'running'}
          onUpload={() => handleOpenModal('all')}
          onCopy={handleCopy}
          onDelete={handleDelete}
        />
      </NodeToolbar>

      <NodeToolbar isVisible={promptModalVisible} position={Position.Bottom} align='center'>
        <ToolModal id={id} radius='large'>
          <PanoramaPromptModel
            isExcute={execute}
            props={props}
            status={status}
            caculatePoint={caculatePoint}
            pointLoading={pointLoading}
            onChangePrompt={handleChangePrompt}
            onSelectChange={handleParamsChange}
            onSend={handleExecute}
            onEnter={() => setFocus(true)}
            onLeave={() => setFocus(false)}
          />
        </ToolModal>
      </NodeToolbar>

      <NodeToolbar isVisible={gifShow} position={Position.Right} align='center'>
        <GifContent type={nodeType} />
      </NodeToolbar>

      {modalVisible &&
        createPortal(
          <UploadModal accept='image' allowLocal={allowLocal} maxSize={20} nodeId={id} visible={modalVisible} onCancel={() => setModalVisible(false)} onOk={handleUploadSuccess} />,
          document.body
        )}

      {fullscreenViewerVisible && panoramaImageUrl ? (
        <PanoramaViewer
          ref={fullscreenViewerRef}
          key={`fullscreen-${panoramaImageUrl}`}
          imageUrl={panoramaImageUrl}
          visible={fullscreenViewerVisible}
          mode='fullscreen'
          aspectRatio={panoramaAspectRatio}
          onAspectRatioChange={setPanoramaAspectRatio}
          initialView={panoramaViewState}
          closeLabel='关闭弹窗'
          onClose={handleCloseFullscreen}
          onCapture={handleCapture}
        />
      ) : null}
    </div>
  );
};

export default memo(PanoramaTool);
