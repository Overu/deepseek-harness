import { memo, useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { useFlowStore } from '@/store/flowStore';
import InputParams from '../../../components/promptControl/InputParams';
import Selection from '../../../components/promptControl/Selection';
import CombinedParamSelection from '../../../components/promptControl/CombinedParamSelection';
import SendButton from '../../../components/promptControl/SendButton';
import hooks from '../../../hooks';
import type { MediaInputItem } from '../../../utils/util';
import { getVideoDurationFromUrl } from '@/utils/mediaDuration';
import { useAutoResizeHeight } from '@/hooks/useAutoResizeHeight';
import { getAllModels, getDefaultModelId, getDefaultParamsForModel, getModelConfig, modelHasResolution, modelSupportsPersonReplacement } from './poseTransferModels';

const { useToolPermissionDisabled, usePromptModelCommon } = hooks;

interface PoseTransferPromptModelProps {
  status: string;
  isExcute: boolean;
  imageUrl: string;
  videoUrl: string;
  mediaInputs: MediaInputItem[];
  data: { params?: Record<string, unknown> };
  onParamsChange: (patch: Record<string, unknown>) => void;
  onChangePrompt: (value: string) => void;
  onSend: () => void;
  caculatePoint: number;
  pointLoading?: boolean;
}

const PoseTransferPromptModel = ({
  status,
  isExcute,
  imageUrl,
  videoUrl,
  mediaInputs,
  data,
  onParamsChange,
  onChangePrompt,
  onSend,
  caculatePoint,
  pointLoading = false,
}: PoseTransferPromptModelProps) => {
  const toolPermissionDisabled = useToolPermissionDisabled('poseTransVideoTool');
  const { edgeOrderChange } = useFlowStore(state => state.actions);

  const { prompt, setPrompt, debouncedUpdateValue, flushPrompt } = usePromptModelCommon({
    nodePrompt: String(data.params?.prompt ?? ''),
    status,
    hasExtraInputs: Boolean(imageUrl && videoUrl),
    onChangePrompt,
  });
  const editorRef = useAutoResizeHeight(prompt);

  const params = data.params || {};
  const modelId: string = String(params.modelId || getDefaultModelId());
  const resolution: string = String(params.resolution || '720p');
  const aspectRatio: string = String(params.aspect_ratio || getModelConfig(modelId)?.defaultAspectRatio || '16:9');
  const personReplacement = Boolean(params.personReplacement);

  const [videoDuration, setVideoDuration] = useState(0);

  const modelConfig = useMemo(() => getModelConfig(modelId), [modelId]);

  useEffect(() => {
    if (!videoUrl) {
      setVideoDuration(0);
      return;
    }

    let cancelled = false;
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
  }, [videoUrl]);

  const videoLimitIssue = useMemo<'too_short' | 'too_long' | null>(() => {
    if (!modelConfig || !videoUrl || videoDuration <= 0) return null;
    const { min, max } = modelConfig.videoLengthLimit;
    if (videoDuration < min) return 'too_short';
    if (videoDuration > max) return 'too_long';
    return null;
  }, [modelConfig, videoUrl, videoDuration]);

  const videoOverLimit = videoLimitIssue !== null;

  const allowSend = useMemo(() => {
    if (status === 'running' || toolPermissionDisabled) return false;
    if (!imageUrl || !videoUrl) return false;
    if (videoOverLimit) return false;
    return true;
  }, [status, toolPermissionDisabled, imageUrl, videoUrl, videoOverLimit]);

  const disabledReason = useMemo(() => {
    if (videoLimitIssue === 'too_short' && modelConfig) {
      return `连入视频时长不能少于 ${modelConfig.videoLengthLimit.min} 秒`;
    }
    if (videoLimitIssue === 'too_long' && modelConfig) {
      return `连入视频时长不能超过 ${modelConfig.videoLengthLimit.max} 秒`;
    }
    if (!imageUrl || !videoUrl) {
      return '请连接图片和视频';
    }
    return undefined;
  }, [videoLimitIssue, modelConfig, imageUrl, videoUrl]);

  const modelOptions = useMemo(() => getAllModels().map(m => ({ value: m.modelId, label: m.label, description: m.description })), []);

  const combinedSections = useMemo(() => {
    if (!modelConfig) return [];
    const sections = [];
    if (modelHasResolution(modelId)) {
      sections.push({
        key: 'resolution',
        label: '分辨率',
        value: resolution,
        options: modelConfig.resolutionChoices.map(c => ({ value: c.value, label: c.label })),
      });
    }
    sections.push({
      key: 'aspect_ratio',
      label: '比例',
      value: aspectRatio,
      options: modelConfig.aspectRatioChoices.map(c => ({ value: c.value, label: c.label })),
    });
    return sections;
  }, [modelConfig, modelId, resolution, aspectRatio]);

  const handleModelChange = (value: string | number | boolean) => {
    const nextModelId = String(value);
    onParamsChange(getDefaultParamsForModel(nextModelId));
  };

  const handleCombinedChange = (key: string, value: string | number | boolean) => {
    onParamsChange({ [key]: value });
  };

  const handlePersonReplacementToggle = (e: MouseEvent) => {
    e.stopPropagation();
    onParamsChange({ personReplacement: !personReplacement });
  };

  const handleEdgeOrderChange = useCallback(
    (order: MediaInputItem[]) => {
      edgeOrderChange(order);
    },
    [edgeOrderChange]
  );

  return (
    <div className='grid w-max min-w-[672px] grid-cols-[minmax(0,1fr)] p-4' style={{ userSelect: 'none' }}>
      <InputParams textMap={[]} imageMap={[]} mediaMap={mediaInputs} invalidVideoOverlay={videoOverLimit} onMediaOrderChange={handleEdgeOrderChange} />

      <div className='mb-2 min-w-0 [contain:inline-size]'>
        <Textarea
          ref={editorRef}
          value={prompt}
          preventWheelZoom
          onKeyDown={e => e.stopPropagation()}
          onChange={e => {
            setPrompt(e.target.value);
            debouncedUpdateValue(e.target.value);
          }}
          rows={4}
          placeholder='请输入提示词...'
          className='nowheel [&::-webkit-scrollbar]:hidden px-0 resize-none border-none bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0'
        />
      </div>

      <div className='flex items-center justify-between gap-2'>
        <div className='flex flex-wrap items-center gap-1 min-w-0'>
          <Selection options={modelOptions} label='模型' value={modelId} onChange={handleModelChange} />
          {combinedSections.length > 0 ? (
            <>
              <div className='w-px h-5 bg-white/25 mx-1' />
              <CombinedParamSelection sections={combinedSections} onChange={handleCombinedChange} />
            </>
          ) : null}
          {modelSupportsPersonReplacement(modelId) ? (
            <>
              <div className='w-px h-5 bg-white/25 mx-1' />
              <div onClick={handlePersonReplacementToggle} className='inline-flex items-center space-x-3 hover:bg-white/10 px-3 py-1.5 rounded-lg cursor-pointer transition-colors'>
                <div
                  className={`w-10 h-6 rounded-full p-1 transition-colors duration-200 ease-in-out cursor-pointer flex items-center ${personReplacement ? 'bg-[#4155F0]' : 'bg-[#333]'}`}
                >
                  <div
                    className={`w-4 h-4 bg-white rounded-full shadow-sm transform transition-transform duration-200 ease-in-out ${personReplacement ? 'translate-x-4' : 'translate-x-0'}`}
                  />
                </div>
                <span className='text-gray-300 font-medium text-sm'>保留参考背景</span>
              </div>
            </>
          ) : null}
        </div>
        <SendButton
          isExcute={isExcute}
          allowSend={allowSend}
          caculatePoint={caculatePoint}
          pointLoading={pointLoading}
          onClick={() => {
            if (!isExcute && allowSend) {
              flushPrompt();
              onSend();
            }
          }}
          disabledReason={disabledReason}
        />
      </div>
    </div>
  );
};

export default memo(PoseTransferPromptModel);
