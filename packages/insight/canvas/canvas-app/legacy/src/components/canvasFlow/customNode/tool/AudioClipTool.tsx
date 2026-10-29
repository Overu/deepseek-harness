import { NodeToolbar, Position, useUpdateNodeInternals } from '@xyflow/react';
import { useState, useMemo, memo, useEffect, useRef, useCallback } from 'react';
import setting from '../../settings/setting';
import { useFlowStore } from '@/store/flowStore';
import hooks from '../../hooks';
import toolUtil from '../../utils/toolUtil';
import util from '../../utils/util';
import type { Handler } from '../../utils/type';
import styles from './index.module.less';
import NodeOperation from '../../components/nodeControl/NodeOperation';
import NodeTitle from '../../components/nodeControl/NodeTitle';
import ToolContent from '../../components/nodeControl/ToolContent';
import LimitHandler from '../../customHandler/LimitHandler';
import ToolModal from '../../components/promptControl/ToolModal';
import GifContent from '../../components/nodeControl/GifContent';
import AudioPlayer from '@/components/common/fileControl/AudioPlayer';
import { toast } from 'sonner';
import { AudioClipBar, getAudioDuration, runClipAndUpload } from '../../components/toolControl/AudioClip';
import { syncCanvasUploadToAssetLibrary } from '@/components/canvasFlow/utils/canvasAssetSync';

const nodeType = 'audioClipTool';
const { handlersMap } = setting;
const { useNodeOperations, useNodeResizeObserver, useGetNodeInput, useToolPermissionDisabled, useToolOutputChildNodes, useTopNodeToolbarVisible } = hooks;
const { getAllSourceNodeIds, defaultWidth, defaultHeight } = toolUtil;
const { getSourceMap } = util;
const handlers = handlersMap[nodeType];

const MIN_CLIP_DURATION = 2;

const AudioClipTool = (props: any) => {
  const toolPermissionDisabled = useToolPermissionDisabled(nodeType);
  const updateNodeInternals = useUpdateNodeInternals();
  const { data, id, selected, width, height, positionAbsoluteX, positionAbsoluteY } = props;
  const position = {
    x: positionAbsoluteX,
    y: positionAbsoluteY,
  };
  const { value, taskInfo, title, titleStyle, params } = data;
  const { status } = taskInfo || {};
  const dataRef = useRef(data);
  const nodeRef = useRef<HTMLDivElement>(null);
  const prevAudioUrlRef = useRef('');
  const [focus, setFocus] = useState(false);
  const [gifShow, setGifShow] = useState(false);
  const [audioDuration, setAudioDuration] = useState(0);
  const [clipSessionKey, setClipSessionKey] = useState(0);

  const isSelection = useFlowStore(state => state.isSelection);
  const edges = useFlowStore(state => state.edges);
  const nodes = useFlowStore(state => state.nodes);
  const { updateNodeData } = useFlowStore(state => state.actions);
  const { attachUploadOutputNode } = useToolOutputChildNodes({
    toolNodeId: id,
    nodeWidth: width,
    childType: 'audio',
    sourceHandleId: 'audio_source',
  });

  const { handleCopy, handleDelete, handleEdit, handleChangeTitleStyle, handleAddPrevNode } = useNodeOperations(id, data);
  const topToolbarVisible = useTopNodeToolbarVisible(!focus && !isSelection && selected);
  useNodeResizeObserver(nodeRef as React.RefObject<HTMLElement>, id, updateNodeInternals);
  useGetNodeInput(id, nodes, edges);

  const actualWidth = useMemo(() => width || defaultWidth, [width]);
  const actualHeight = useMemo(() => height || defaultHeight, [height]);

  const sourceNodeIds = useMemo(() => getAllSourceNodeIds(edges, id), [edges, id]);

  const audioUrl = useMemo(() => {
    const { audios } = getSourceMap(nodes, edges, id);
    return audios[0]?.value || '';
  }, [nodes, edges, id]);

  const promptModalVisible = useMemo(() => !isSelection && selected && sourceNodeIds.length > 0, [isSelection, selected, sourceNodeIds]);

  const audioStartSecond: number = params?.audioStartSecond ?? 0;
  const audioEndSecond: number = params?.audioEndSecond ?? 0;
  const confirmLoading = status === 'running';

  const effectiveEndSecond = audioEndSecond > 0 ? audioEndSecond : audioDuration;
  const maxDuration = audioDuration > 0 ? audioDuration : 9999;

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(() => {
    if (!audioUrl) {
      prevAudioUrlRef.current = '';
      setAudioDuration(0);
      return;
    }

    const previousUrl = prevAudioUrlRef.current;
    if (previousUrl === audioUrl) return;

    const isSourceChange = previousUrl !== '';
    const hasSavedClip = (dataRef.current.params?.audioEndSecond ?? 0) > 0;
    prevAudioUrlRef.current = audioUrl;

    if (isSourceChange) {
      const latest = dataRef.current;
      updateNodeData(
        id,
        {
          ...latest,
          value: '',
          params: { ...latest.params, audioStartSecond: 0, audioEndSecond: 0 },
        },
        true,
        true
      );
    } else if (hasSavedClip) {
      // 刷新/重载：保留持久化裁切区间，仅拉取时长供 UI 使用
      let cancelled = false;
      getAudioDuration(audioUrl)
        .then(duration => {
          if (!cancelled) setAudioDuration(duration);
        })
        .catch(() => {
          if (!cancelled) setAudioDuration(0);
        });
      return () => {
        cancelled = true;
      };
    }

    let cancelled = false;
    getAudioDuration(audioUrl)
      .then(duration => {
        if (cancelled) return;
        setAudioDuration(duration);
        const latest = dataRef.current;
        updateNodeData(
          id,
          {
            ...latest,
            params: { ...latest.params, audioStartSecond: 0, audioEndSecond: duration },
          },
          true,
          true
        );
      })
      .catch(() => {
        if (!cancelled) setAudioDuration(0);
      });

    return () => {
      cancelled = true;
    };
  }, [audioUrl, id, updateNodeData]);

  useEffect(() => {
    if (!selected) setGifShow(false);
  }, [selected]);

  const handleClipConfirm = useCallback(
    (start: number, end: number) => {
      if (toolPermissionDisabled) return;
      if (!audioUrl) {
        toast.error('请先接入音频');
        return;
      }
      if (status === 'running') return;
      const clipLen = end - start;
      if (clipLen < MIN_CLIP_DURATION) {
        toast.error('裁切时长过短，请重新选择');
        return;
      }
      runClipAndUpload({
        nodeId: id,
        sourceUrl: audioUrl,
        startSecond: start,
        endSecond: end,
        onComplete: async url => {
          const childNodeId = await attachUploadOutputNode(url);
          if (childNodeId) {
            syncCanvasUploadToAssetLibrary(url, childNodeId, 'audio', 1, nodeType);
          }
        },
      });
    },
    [audioUrl, status, id, toolPermissionDisabled, attachUploadOutputNode]
  );

  const handleClipCancel = useCallback(() => {
    setClipSessionKey(k => k + 1);
  }, []);

  const previewUrls = value ? [value] : [];

  return (
    <div ref={nodeRef} className={`rounded-2xl relative hover:ring-2 ring-white/65 transition-all ${selected && 'ring-2'}`} style={{ width: actualWidth, height: actualHeight }}>
      {handlers.map((item: Handler) => (
        <LimitHandler type={item.type} position={item.position} id={item.id} style={item.style} key={item.id} limit={item.limit} />
      ))}
      {value ? (
        <div className='relative border border-white/25 rounded-2xl w-full h-full bg-[#1f1f1f] overflow-hidden'>
          <AudioPlayer url={value} height={Math.max(120, actualHeight - 16)} />
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
        <NodeOperation type={nodeType} url={value} status={status} previewUrls={previewUrls} onCopy={handleCopy} onDelete={handleDelete} />
      </NodeToolbar>
      <NodeToolbar isVisible={promptModalVisible} position={Position.Bottom} align='center'>
        <ToolModal id={id} variant='bare'>
          {audioUrl ? (
            <AudioClipBar
              key={`${audioUrl}-${clipSessionKey}`}
              audioUrl={audioUrl}
              minDuration={MIN_CLIP_DURATION}
              maxDuration={maxDuration}
              startSecond={audioStartSecond}
              endSecond={effectiveEndSecond}
              confirmLoading={confirmLoading}
              permissionDisabled={toolPermissionDisabled}
              onSave={handleClipConfirm}
              onCancel={handleClipCancel}
            />
          ) : null}
        </ToolModal>
      </NodeToolbar>
      <NodeToolbar isVisible={gifShow} position={Position.Right} align='center'>
        <GifContent type={nodeType} />
      </NodeToolbar>
    </div>
  );
};

export default memo(AudioClipTool);
