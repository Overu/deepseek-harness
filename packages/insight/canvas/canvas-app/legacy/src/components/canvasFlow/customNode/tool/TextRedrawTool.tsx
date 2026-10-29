import { NodeToolbar, Position, useUpdateNodeInternals } from '@xyflow/react';
import NodeOperation from '../../components/nodeControl/NodeOperation';
import NodeTitle from '../../components/nodeControl/NodeTitle';
import TextRedrawDefinition from '../../components/toolControl/TextRedrawDefinition';
import ToolContent from '../../components/nodeControl/ToolContent';
import LimitHandler from '../../customHandler/LimitHandler';
import ToolModal from '../../components/promptControl/ToolModal';
import OcrHighlightOverlay from './OcrHighlightOverlay';
import { useState, useMemo, useEffect, useRef, memo, useCallback } from 'react';
import setting from '../../settings/setting';
import { syncCanvasVersionNumber, useFlowStore } from '@/store/flowStore';
import hooks from '../../hooks';
import toolUtil from '../../utils/toolUtil';
import type { Handler, OcrInfo, OcrResult } from '../../utils/type';
import styles from './index.module.less';
import { createExternalTask, queryExternalTaskResult } from '@/api/tool';
import { usePointStore } from '@/store/pointStore';
import GifContent from '../../components/nodeControl/GifContent';
import util from '../../utils/util';
import { toast } from 'sonner';
import { debounce } from '@/utils';
import { Atom } from 'lucide-react';
import ToolCornerActionButton from '../../components/nodeControl/ToolCornerActionButton';

const nodeType = 'textRedrawTool';
const { handlersMap } = setting;
const { useImageNodeDimensions, useNodeOperations, useNodeResizeObserver, useSinglePointCaculate, useToolPermissionDisabled, useToolOutputChildNodes, useTopNodeToolbarVisible } = hooks;
const { getAllSourceNodeIds, defaultWidth, defaultHeight } = toolUtil;
const handlers = handlersMap[nodeType];
const { getSourceMap } = util;

const EMPTY_OCR_INFO: OcrInfo = {
  status: 'success',
  taskId: '',
  errorMsg: '',
};

const parseOcrPollResult = (result: unknown): OcrResult | undefined => {
  if (result == null) return undefined;
  if (typeof result === 'string') {
    try {
      return JSON.parse(result) as OcrResult;
    } catch {
      return undefined;
    }
  }
  return result as OcrResult;
};

const TextRedrawTool = (props: any) => {
  const toolPermissionDisabled = useToolPermissionDisabled(nodeType);
  const updateNodeInternals = useUpdateNodeInternals();
  const { data, id, selected, width, height, positionAbsoluteX, positionAbsoluteY } = props;
  const position = {
    x: positionAbsoluteX,
    y: positionAbsoluteY,
  };
  const { taskInfo, title, titleStyle, time, params, ocrInfo: ocrInfoProp } = data;
  const ocrInfo: OcrInfo = ocrInfoProp || EMPTY_OCR_INFO;
  const { status, taskId } = taskInfo || {};
  const [focus, setFocus] = useState(false);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [tempTaskId, setTempTaskId] = useState('');
  const [execute, setExecute] = useState(false);
  const nodeRef = useRef<any>(null);
  const dataRef = useRef(data);
  const prevSourceImageRef = useRef('');
  const ocrPollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const redrawPollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ocrPollingRef = useRef(false);
  const redrawPollingRef = useRef(false);

  const isSelection = useFlowStore(state => state.isSelection);
  const edges = useFlowStore(state => state.edges);
  const canvasId = useFlowStore(state => state.canvasId);
  const nodes = useFlowStore(state => state.nodes);
  const { updateNodeData, updateNodeStatus } = useFlowStore(state => state.actions);
  const { prepareChildNodes, attachChildNodes, markChildNodesFailure, applyChildNodeInfoFromPollData } = useToolOutputChildNodes({
    toolNodeId: id,
    nodeWidth: width,
    sourceHandleId: 'image_source',
  });
  const { updateUserPoint, setNeedPoint } = usePointStore(state => state.actions);
  const [gifShow, setGifShow] = useState(false);

  const caculatePoint = useSinglePointCaculate(params, { nodeType });

  const sourceNodeIds = useMemo(() => getAllSourceNodeIds(edges, id), [edges, id]);

  const currentImage = useMemo(() => {
    const { images } = getSourceMap(nodes, edges, id);
    return images[0]?.value || '';
  }, [edges, nodes, id]);

  const actualTaskId = useMemo(() => tempTaskId || taskId, [taskId, tempTaskId]);

  const { handleCopy, handleDelete, handleEdit, handleChangeTitleStyle, handleAddPrevNode } = useNodeOperations(id, data);
  const topToolbarVisible = useTopNodeToolbarVisible(!focus && !isSelection && selected);
  useNodeResizeObserver(nodeRef, id, updateNodeInternals);
  useImageNodeDimensions(id, currentImage, width, height, time);

  const actualWidth = useMemo(() => width || defaultWidth, [width]);
  const actualHeight = useMemo(() => height || defaultHeight, [height]);

  const promptModalVisible = useMemo(
    () => !isSelection && selected && sourceNodeIds.length > 0 && (ocrInfo.status === 'running' || Boolean(ocrInfo.result?.editTexts?.length)),
    [isSelection, selected, sourceNodeIds, ocrInfo]
  );

  const showParseButton = useMemo(() => {
    return Boolean(currentImage) && ocrInfo.status !== 'running' && !ocrInfo.result?.editTexts?.length;
  }, [currentImage, ocrInfo]);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(() => {
    if (!selected) setGifShow(false);
  }, [selected]);

  useEffect(() => {
    setNeedPoint(caculatePoint);
  }, [caculatePoint, setNeedPoint]);

  const updateOcrInfo = useCallback(
    (patch: Partial<OcrInfo>, options?: { isRecord?: boolean; isSubmit?: boolean; showFailureToast?: boolean }) => {
      const { isRecord = false, isSubmit = false, showFailureToast = false } = options ?? {};
      updateNodeData(
        id,
        {
          ...dataRef.current,
          ocrInfo: {
            ...(dataRef.current.ocrInfo || EMPTY_OCR_INFO),
            ...patch,
          },
        },
        isRecord,
        isSubmit
      );
      if (showFailureToast) {
        toast.error('文字解析失败');
      }
    },
    [id, updateNodeData]
  );

  const resetOcrInfo = useCallback(() => {
    // 换图时需整段替换 ocrInfo，避免 merge 残留上一轮 result
    updateNodeData(
      id,
      {
        ...dataRef.current,
        ocrInfo: { ...EMPTY_OCR_INFO },
      },
      false,
      false
    );
  }, [id, updateNodeData]);

  useEffect(() => {
    if (prevSourceImageRef.current && prevSourceImageRef.current !== currentImage) {
      resetOcrInfo();
    }
    prevSourceImageRef.current = currentImage;
  }, [currentImage, resetOcrInfo]);

  const debouncedPersistEditTexts = useMemo(
    () =>
      debounce((editTexts: string[]) => {
        const latest = dataRef.current;
        const prevResult = latest.ocrInfo?.result;
        if (!prevResult) return;
        updateOcrInfo(
          {
            result: {
              ...prevResult,
              editTexts,
            },
          },
          { isSubmit: true }
        );
      }, 500),
    [updateOcrInfo]
  );

  const handleEditTextsChange = (editTexts: string[]) => {
    const latest = dataRef.current;
    const prevResult = latest.ocrInfo?.result as OcrResult | undefined;
    if (!prevResult) return;
    const nextData = {
      ...latest,
      ocrInfo: {
        ...(latest.ocrInfo || EMPTY_OCR_INFO),
        result: {
          ...prevResult,
          editTexts,
        },
      },
    };
    dataRef.current = nextData;
    debouncedPersistEditTexts(editTexts);
  };

  const handleParamsChange = (change: { resolution?: string }) => {
    const latest = dataRef.current;
    updateNodeData(id, {
      ...latest,
      params: {
        ...latest.params,
        ...(change.resolution && { resolution: change.resolution }),
      },
    });
  };

  const clearOcrPollTimer = () => {
    if (ocrPollTimerRef.current) {
      clearTimeout(ocrPollTimerRef.current);
      ocrPollTimerRef.current = null;
    }
  };

  const clearRedrawPollTimer = () => {
    if (redrawPollTimerRef.current) {
      clearTimeout(redrawPollTimerRef.current);
      redrawPollTimerRef.current = null;
    }
  };

  const pollOcrResult = useCallback(
    (ocrTaskId: string) => {
      if (!ocrTaskId || ocrPollingRef.current) return;
      ocrPollingRef.current = true;
      clearOcrPollTimer();

      ocrPollTimerRef.current = setTimeout(async () => {
        try {
          const { code, data: resData }: any = await queryExternalTaskResult(ocrTaskId);
          syncCanvasVersionNumber(canvasId, resData?.versionNumber);
          if (code === 'SUCCESS' && resData) {
            if (resData.status === 'RUNNING') {
              ocrPollingRef.current = false;
              pollOcrResult(ocrTaskId);
              return;
            }
            if (resData.status === 'SUCCESS') {
              updateOcrInfo({
                status: 'success',
                taskId: ocrTaskId,
                result: parseOcrPollResult(resData?.result),
              });
            } else if (resData.status === 'FAILURE') {
              updateOcrInfo(
                {
                  status: 'failure',
                  taskId: ocrTaskId,
                  errorMsg: resData.errInfo || resData.message || '文字解析失败',
                },
                { showFailureToast: true }
              );
            }
          } else if (code === 'FAILURE') {
            updateOcrInfo(
              {
                status: 'failure',
                errorMsg: resData?.errInfo || '文字解析失败',
              },
              { showFailureToast: true }
            );
          }
        } catch {
          updateOcrInfo({ status: 'failure', errorMsg: '文字解析失败' }, { showFailureToast: true });
        } finally {
          ocrPollingRef.current = false;
        }
      }, 3000);
    },
    [updateOcrInfo]
  );

  const handleStartParse = async () => {
    if (!currentImage || ocrInfo.status === 'running') return;

    try {
      const { code, data: resData }: any = await createExternalTask({
        type: 'TEXT_REDRAWING_OCR',
        canvasId: canvasId || '',
        nodeId: id,
        data: {
          imageUrlList: [currentImage],
        },
      });
      syncCanvasVersionNumber(canvasId, resData?.versionNumber);
      if (code === 'SUCCESS' && resData?.taskId) {
        updateOcrInfo({
          status: 'running',
          taskId: resData.taskId,
          errorMsg: '',
          result: undefined,
        });
        pollOcrResult(resData.taskId);
      } else {
        toast.error('文字解析任务创建失败');
      }
    } catch {
      toast.error('文字解析任务创建失败');
    }
  };

  const handleStatus = (nextStatus: 'running' | 'success' | 'failure', errorMsg?: string) => {
    updateNodeStatus(id, nextStatus, errorMsg);
  };

  const handleRedrawFailure = useCallback(
    (errorMsg?: string) => {
      const message = errorMsg || '文本重绘失败，请重试';
      setExecute(false);
      handleStatus('failure', message);
      clearRedrawPollTimer();
      markChildNodesFailure(message);
      setTimeout(() => updateUserPoint(), 500);
    },
    [markChildNodesFailure, updateUserPoint]
  );

  const pollRedrawResult = useCallback(
    (pollTaskId?: string) => {
      const taskIdToPoll = pollTaskId || actualTaskId;
      if (!taskIdToPoll || redrawPollingRef.current) return;
      redrawPollingRef.current = true;
      clearRedrawPollTimer();

      redrawPollTimerRef.current = setTimeout(async () => {
        try {
          const { code, data: resData }: any = await queryExternalTaskResult(taskIdToPoll);
          syncCanvasVersionNumber(canvasId, resData?.versionNumber);
          if (code === 'SUCCESS' && resData) {
            if (resData.status === 'RUNNING') {
              redrawPollingRef.current = false;
              pollRedrawResult(taskIdToPoll);
              return;
            }
            if (resData.status === 'SUCCESS') {
              applyChildNodeInfoFromPollData(resData);
              setExecute(false);
              handleStatus('success');
              clearRedrawPollTimer();
              updateUserPoint();
            } else if (resData.status === 'FAILURE') {
              handleRedrawFailure(resData?.errInfo || resData?.message);
            }
          } else if (code === 'FAILURE') {
            handleRedrawFailure(resData?.errInfo);
          }
        } catch {
          handleRedrawFailure();
        } finally {
          redrawPollingRef.current = false;
        }
      }, 3000);
    },
    [actualTaskId, applyChildNodeInfoFromPollData, updateUserPoint, handleRedrawFailure, handleStatus]
  );

  const handleGenerate = async () => {
    if (!currentImage || status === 'running' || execute || ocrInfo.status !== 'success' || !ocrInfo.result) {
      return;
    }

    const { editTexts, recPolys, recTexts } = ocrInfo.result;
    const childNodes = prepareChildNodes();
    if (!childNodes.length) {
      toast.error('创建输出节点失败');
      return;
    }

    setTempTaskId('');
    setExecute(true);
    setNeedPoint(caculatePoint);

    const childNodeIds = childNodes.map(node => node.id);

    try {
      const { code, data: resData }: any = await createExternalTask({
        type: params?.model || 'TEXT_REDRAWING_IMAGE_GENERATION',
        canvasId: canvasId || '',
        nodeId: id,
        data: {
          imageUrl: currentImage,
          imageParams: {
            resolution: params?.resolution || '1K',
          },
          childNodeIds,
          editedOcrResult: {
            recTexts,
            editTexts,
            recPolys,
          },
        },
      });

      syncCanvasVersionNumber(canvasId, resData?.versionNumber);

      if (code === 'SUCCESS' && resData?.taskId) {
        const redrawTaskId = resData.taskId;
        await attachChildNodes(childNodes);
        setTempTaskId(redrawTaskId);
        handleStatus('running');
        updateNodeData(
          id,
          {
            ...dataRef.current,
            taskInfo: {
              ...(dataRef.current.taskInfo || {}),
              taskId: redrawTaskId,
              status: 'running',
            },
          },
          false,
          false
        );
        setTimeout(() => updateUserPoint(), 500);
        pollRedrawResult(redrawTaskId);
      } else {
        setExecute(false);
        toast.error('文本重绘任务创建失败');
        handleRedrawFailure();
      }
    } catch {
      setExecute(false);
      toast.error('文本重绘任务创建失败');
      handleRedrawFailure();
    }
  };

  useEffect(() => {
    if (status === 'running') {
      setExecute(true);
    }
    return () => {
      clearOcrPollTimer();
      clearRedrawPollTimer();
    };
  }, []);

  useEffect(() => {
    if (status === 'running' && actualTaskId) {
      pollRedrawResult();
    }
  }, [status, actualTaskId, pollRedrawResult]);

  useEffect(() => {
    if (ocrInfo.status === 'running' && ocrInfo.taskId) {
      pollOcrResult(ocrInfo.taskId);
    }
  }, [ocrInfo.status, ocrInfo.taskId, pollOcrResult]);

  return (
    <div ref={nodeRef} className='rounded-2xl relative hover:ring-2 ring-white/65 transition-all' style={{ width: actualWidth, height: actualHeight }}>
      {handlers.map((item: Handler) => (
        <LimitHandler type={item.type} position={item.position} id={item.id} style={item.style} key={item.id} limit={item.limit} />
      ))}
      {currentImage ? (
        <div className='relative border border-white/25 rounded-2xl w-full h-full overflow-hidden'>
          <OcrHighlightOverlay imageUrl={currentImage} recPolys={ocrInfo.result?.recPolys} hoverIndex={hoverIndex} className='w-full h-full' />
          {showParseButton && (
            <div className='absolute bottom-3 right-3'>
              <ToolCornerActionButton toolType={nodeType} active={true} label='开始解析' icon={<Atom size={22} />} onClick={() => handleStartParse()} />
            </div>
          )}
        </div>
      ) : (
        <div className={styles.tool}>
          <ToolContent onTryConnect={() => handleAddPrevNode(nodeType, position)} type={nodeType} sourceNodeIds={sourceNodeIds} onTipClick={flag => setGifShow(flag)} />
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
      />
      <NodeToolbar isVisible={topToolbarVisible} position={Position.Top} align='center' offset={36}>
        <NodeOperation type={nodeType} url={currentImage} status={status} previewUrls={currentImage ? [currentImage] : []} onCopy={handleCopy} onDelete={handleDelete} />
      </NodeToolbar>
      <NodeToolbar isVisible={promptModalVisible} position={Position.Right} align='center'>
        <ToolModal id={id} radius='large'>
          <TextRedrawDefinition
            ocrInfo={ocrInfo}
            status={status}
            resolution={params?.resolution}
            execute={execute}
            caculatePoint={caculatePoint}
            hasImage={Boolean(currentImage)}
            onParamsChange={handleParamsChange}
            onEditTextsChange={handleEditTextsChange}
            onHoverIndex={setHoverIndex}
            onGenerate={handleGenerate}
            permissionDisabled={toolPermissionDisabled}
          />
        </ToolModal>
      </NodeToolbar>
      <NodeToolbar isVisible={gifShow} position={Position.Right} align='center'>
        <GifContent type={nodeType} />
      </NodeToolbar>
    </div>
  );
};

export default memo(TextRedrawTool);
