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
import VideoPlayer from '@/components/common/fileControl/VideoPlayer';
import VideoPreviewDialog from '@/components/common/fileControl/VideoPreviewDialog';
import { LoaderCircle } from 'lucide-react';
import { toast } from 'sonner';
import { preloadClipSource, resetClipSources } from '@/utils/videoClip';
import { getVideoDurationFromUrl } from '@/utils/mediaDuration';
import { MIN_CLIP_DURATION, runClipAndUpload, VideoClipBar } from '../../components/toolControl/VideoClip';
import { syncCanvasUploadToAssetLibrary } from '@/components/canvasFlow/utils/canvasAssetSync';

const nodeType = 'videoClipTool';
const { handlersMap } = setting;
const { useNodeOperations, useNodeResizeObserver, useGetNodeInput, useToolPermissionDisabled, useToolOutputChildNodes, useVideoNodeDimensions, useTopNodeToolbarVisible } = hooks;
const { getAllSourceNodeIds, defaultWidth, defaultHeight } = toolUtil;
const { getSourceMap } = util;
const handlers = handlersMap[nodeType];

const getVideoPoster = (src: string, width = 64) => `${src}?x-oss-process=video/snapshot,t_0,f_jpg,w_${width},m_fast`;

type ClipRange = { start: number; end: number };
type SeekRequest = { time: number; seq: number; play: boolean };

const VideoClipTool = (props: any) => {
  const toolPermissionDisabled = useToolPermissionDisabled(nodeType);
  const updateNodeInternals = useUpdateNodeInternals();
  const { data, id, selected, width, height, positionAbsoluteX, positionAbsoluteY } = props;
  const position = {
    x: positionAbsoluteX,
    y: positionAbsoluteY,
  };
  const { value, taskInfo, title, titleStyle, params, time } = data;
  const { status } = taskInfo || {};
  const dataRef = useRef(data);
  const nodeRef = useRef<HTMLDivElement>(null);
  const prevVideoUrlRef = useRef('');
  const cmdSeqRef = useRef(0);
  const isPlayingRef = useRef(false);
  const wasPlayingBeforeDragRef = useRef(false);

  const [focus, setFocus] = useState(false);
  const [gifShow, setGifShow] = useState(false);
  const [videoDuration, setVideoDuration] = useState(0);
  const [clipSessionKey, setClipSessionKey] = useState(0);
  const [seekRequest, setSeekRequest] = useState<SeekRequest | undefined>();
  const [pauseRequest, setPauseRequest] = useState<{ seq: number } | undefined>();
  const [playRange, setPlayRange] = useState<ClipRange | undefined>();
  const [playbackTime, setPlaybackTime] = useState(0);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState('');

  const isSelection = useFlowStore(state => state.isSelection);
  const edges = useFlowStore(state => state.edges);
  const nodes = useFlowStore(state => state.nodes);
  const { updateNodeData } = useFlowStore(state => state.actions);
  const { attachUploadOutputNode } = useToolOutputChildNodes({
    toolNodeId: id,
    nodeWidth: width,
    childType: 'video',
    sourceHandleId: 'video_source',
  });

  const { handleCopy, handleDelete, handleEdit, handleChangeTitleStyle, handleAddPrevNode } = useNodeOperations(id, data);
  const topToolbarVisible = useTopNodeToolbarVisible(!focus && !isSelection && selected);
  useNodeResizeObserver(nodeRef as React.RefObject<HTMLElement>, id, updateNodeInternals);
  useGetNodeInput(id, nodes, edges);

  const actualWidth = useMemo(() => width || defaultWidth, [width]);
  const actualHeight = useMemo(() => height || defaultHeight, [height]);
  const sourceNodeIds = useMemo(() => getAllSourceNodeIds(edges, id), [edges, id]);
  const videoUrl = useMemo(() => {
    const { videos } = getSourceMap(nodes, edges, id);
    return videos[0]?.value || '';
  }, [nodes, edges, id]);
  const promptModalVisible = useMemo(() => !isSelection && selected && sourceNodeIds.length > 0, [isSelection, selected, sourceNodeIds]);

  const videoStartSecond: number = params?.videoStartSecond ?? 0;
  const videoEndSecond: number = params?.videoEndSecond ?? 0;
  const confirmLoading = status === 'running';
  const effectiveEndSecond = videoEndSecond > 0 ? videoEndSecond : videoDuration;
  const maxDuration = videoDuration > 0 ? videoDuration : 9999;
  const displayUrl = value || videoUrl;
  const isEditingSource = Boolean(videoUrl && !value);

  useVideoNodeDimensions(id, displayUrl, width, height, time);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  const clearPreviewControl = useCallback((resetTime = true) => {
    setSeekRequest(undefined);
    setPauseRequest(undefined);
    setPlayRange(undefined);
    if (resetTime) setPlaybackTime(0);
  }, []);

  const requestSeek = useCallback((time: number, range: ClipRange, play: boolean) => {
    cmdSeqRef.current += 1;
    setPlaybackTime(time);
    setPlayRange(range);
    setSeekRequest({ time, seq: cmdSeqRef.current, play });
  }, []);

  useEffect(() => {
    if (!videoUrl) {
      prevVideoUrlRef.current = '';
      setVideoDuration(0);
      clearPreviewControl();
      return;
    }

    const previousUrl = prevVideoUrlRef.current;
    if (previousUrl === videoUrl) return;

    const isSourceChange = previousUrl !== '';
    const hasSavedClip = (dataRef.current.params?.videoEndSecond ?? 0) > 0;
    let cancelled = false;
    prevVideoUrlRef.current = videoUrl;
    clearPreviewControl();
    void resetClipSources().then(() => {
      if (!cancelled) void preloadClipSource(videoUrl);
    });

    if (isSourceChange) {
      const latest = dataRef.current;
      updateNodeData(
        id,
        {
          ...latest,
          value: '',
          params: { ...latest.params, videoStartSecond: 0, videoEndSecond: 0 },
        },
        true,
        true
      );
    } else if (hasSavedClip) {
      getVideoDurationFromUrl(videoUrl)
        .then(duration => {
          if (!cancelled) setVideoDuration(duration ?? 0);
        })
        .catch(() => {
          if (!cancelled) setVideoDuration(0);
        });
      return () => {
        cancelled = true;
      };
    }

    getVideoDurationFromUrl(videoUrl)
      .then(duration => {
        if (cancelled) return;
        const d = duration ?? 0;
        setVideoDuration(d);
        const latest = dataRef.current;
        updateNodeData(
          id,
          {
            ...latest,
            params: { ...latest.params, videoStartSecond: 0, videoEndSecond: d },
          },
          true,
          true
        );
      })
      .catch(() => {
        if (!cancelled) setVideoDuration(0);
      });

    return () => {
      cancelled = true;
    };
  }, [videoUrl, id, updateNodeData, clearPreviewControl]);

  useEffect(() => {
    if (!selected) setGifShow(false);
  }, [selected]);

  const canEditPreview = Boolean(videoUrl && !value);

  const handleSeekPlay = useCallback(
    (time: number, range: ClipRange) => {
      if (!canEditPreview) return;
      requestSeek(time, range, true);
    },
    [canEditPreview, requestSeek]
  );

  const handleClipDragStart = useCallback(() => {
    if (!canEditPreview) return;
    wasPlayingBeforeDragRef.current = isPlayingRef.current;
    setSeekRequest(undefined);
    cmdSeqRef.current += 1;
    setPauseRequest({ seq: cmdSeqRef.current });
  }, [canEditPreview]);

  const handleClipDragEnd = useCallback(
    (time: number, range: ClipRange) => {
      if (!canEditPreview) return;
      requestSeek(time, range, wasPlayingBeforeDragRef.current);
    },
    [canEditPreview, requestSeek]
  );

  const handleDraftChange = useCallback(
    (draft: ClipRange & { playhead?: number }) => {
      if (!canEditPreview) return;
      setPlayRange({ start: draft.start, end: draft.end });
      if (draft.playhead == null) return;
      requestSeek(draft.playhead, { start: draft.start, end: draft.end }, false);
    },
    [canEditPreview, requestSeek]
  );

  const handleClipConfirm = useCallback(
    (start: number, end: number) => {
      if (toolPermissionDisabled) return;
      if (!videoUrl) {
        toast.error('请先接入视频');
        return;
      }
      if (status === 'running') return;
      if (end - start < MIN_CLIP_DURATION) {
        toast.error('裁切时长过短，请重新选择');
        return;
      }
      clearPreviewControl(false);
      runClipAndUpload({
        nodeId: id,
        sourceUrl: videoUrl,
        startSecond: start,
        endSecond: end,
        onComplete: async url => {
          clearPreviewControl(false);
          const childNodeId = await attachUploadOutputNode(url);
          if (childNodeId) {
            syncCanvasUploadToAssetLibrary(url, childNodeId, 'video', 1, nodeType);
          }
        },
      });
    },
    [videoUrl, status, id, toolPermissionDisabled, attachUploadOutputNode, clearPreviewControl]
  );

  const handleClipCancel = useCallback(() => {
    clearPreviewControl(false);
    setPlaybackTime(videoStartSecond);
    setClipSessionKey(k => k + 1);
  }, [clearPreviewControl, videoStartSecond]);

  const previewUrls = value ? [value] : displayUrl ? [displayUrl] : [];
  const editPlayRangeStart = isEditingSource ? (playRange?.start ?? videoStartSecond) : undefined;
  const editPlayRangeEnd = isEditingSource ? (playRange?.end ?? (effectiveEndSecond > 0 ? effectiveEndSecond : undefined)) : undefined;

  return (
    <div ref={nodeRef} className={`rounded-2xl relative hover:ring-2 ring-white/65 transition-all ${selected && 'ring-2'}`} style={{ width: actualWidth, height: actualHeight }}>
      {handlers.map((item: Handler) => (
        <LimitHandler type={item.type} position={item.position} id={item.id} style={item.style} key={item.id} limit={item.limit} />
      ))}
      {videoUrl || value ? (
        <div className='relative border border-white/25 rounded-2xl w-full h-full bg-[#1f1f1f] overflow-hidden'>
          <VideoPlayer
            url={displayUrl}
            hideProgressBar
            seekRequest={isEditingSource ? seekRequest : undefined}
            playRangeStart={editPlayRangeStart}
            playRangeEnd={editPlayRangeEnd}
            pauseRequest={isEditingSource ? pauseRequest : undefined}
            onPlaybackTimeChange={isEditingSource ? setPlaybackTime : undefined}
            onPlayingChange={
              isEditingSource
                ? playing => {
                    isPlayingRef.current = playing;
                  }
                : undefined
            }
            pauseWhileRunning={confirmLoading}
            onPreview={displayUrl ? () => setVideoPreviewUrl(displayUrl) : undefined}
          />
          {confirmLoading ? (
            <div className='absolute inset-0 z-[2] bg-black/45 flex items-center justify-center backdrop-blur-[2px]'>
              <LoaderCircle size={32} className='animate-spin text-white' />
            </div>
          ) : null}
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
          {videoUrl ? (
            <VideoClipBar
              key={`${videoUrl}-${clipSessionKey}`}
              videoUrl={videoUrl}
              minDuration={MIN_CLIP_DURATION}
              maxDuration={maxDuration}
              startSecond={videoStartSecond}
              endSecond={effectiveEndSecond}
              confirmLoading={confirmLoading}
              permissionDisabled={toolPermissionDisabled}
              onSave={handleClipConfirm}
              onCancel={handleClipCancel}
              onSeekPlay={handleSeekPlay}
              onClipDragStart={handleClipDragStart}
              onClipDragEnd={handleClipDragEnd}
              onDraftChange={handleDraftChange}
              playbackTime={playbackTime}
            />
          ) : null}
        </ToolModal>
      </NodeToolbar>
      <NodeToolbar isVisible={gifShow} position={Position.Right} align='center'>
        <GifContent type={nodeType} />
      </NodeToolbar>
      {videoPreviewUrl ? (
        <VideoPreviewDialog
          open={Boolean(videoPreviewUrl)}
          url={videoPreviewUrl}
          poster={getVideoPoster(videoPreviewUrl, 480)}
          initialMuted={false}
          initialVolume={1}
          onOpenChange={open => {
            if (!open) setVideoPreviewUrl('');
          }}
        />
      ) : null}
    </div>
  );
};

export default memo(VideoClipTool);
