import { Textarea } from '@/components/ui/textarea';
import { Eye, Music4, SlidersHorizontal } from 'lucide-react';
import MediaPreview from '@/components/common/MediaPreview';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { compressImage, debounce } from '@/utils';
import audioIcon from '@/assets/images/audio_black.png';
import Selection from '../../../components/promptControl/Selection';
import SendButton from '../../../components/promptControl/SendButton';
import hooks from '../../../hooks';
import { getDefaultParamsForMode, getDefaultParamsForModel, getModelConfig, getModelsForMode, LIP_SYNC_MODE_OPTIONS } from './imageLipSyncModels';
import type { CharacterInfo, LipSyncMode } from './types';
import AudioClipPopover, { getAudioDuration } from '../../../components/toolControl/AudioClip';
import { CharacterMultiSelect, useCharacterSearch } from './character';
import { useAutoResizeHeight } from '@/hooks/useAutoResizeHeight';

const { useToolPermissionDisabled } = hooks;

const SINGLE_PLACEHOLDER = '描述：添加动作描述和镜头语言，如:镜头推进，他摘下眼镜，对着镜头笑着说';
const MULTIPLE_PLACEHOLDER = '描述：请描述哪个角色说、动作描述和镜头语言，如:镜头推进，左边黑发男子说，同时右边女子摘下眼镜';

interface ImageLipSyncPromptModelProps {
  nodeId: string;
  canvasId: string;
  data: any;
  status: string;
  isExcute: boolean;
  imageUrl: string;
  audioUrl: string;
  characterInfo?: CharacterInfo;
  onChangePrompt: (value: string) => void;
  onParamsChange: (patch: Record<string, unknown>, options?: { characterInfo?: CharacterInfo }) => void;
  onCharacterInfoChange: (info: CharacterInfo, selectedIndexes?: number[]) => void;
  onSend: () => void;
  caculatePoint: number;
  pointLoading?: boolean;
}

const ImageLipSyncPromptModel = ({
  nodeId,
  canvasId,
  data,
  status,
  isExcute,
  imageUrl,
  audioUrl,
  characterInfo,
  onChangePrompt,
  onParamsChange,
  onCharacterInfoChange,
  onSend,
  caculatePoint,
  pointLoading = false,
}: ImageLipSyncPromptModelProps) => {
  const toolPermissionDisabled = useToolPermissionDisabled('imageLipSyncTool');
  const params = data.params || {};
  const mode: LipSyncMode = params.mode || 'single';
  const modelId: string = params.modelId || 'omni_v15';
  const resolution: string = params.resolution || '720p';
  const audioStartSecond: number = params.audioStartSecond ?? 0;
  const audioEndSecond: number = params.audioEndSecond ?? 0;
  const selectedCharacterIndexes: number[] = params.selectedCharacterIndexes || [];

  const [prompt, setPrompt] = useState(params.prompt || '');
  const [audioClipOpen, setAudioClipOpen] = useState(false);
  const [audioDuration, setAudioDuration] = useState(0);
  const [imageHovered, setImageHovered] = useState(false);
  const [imagePreviewVisible, setImagePreviewVisible] = useState(false);
  const editorRef = useAutoResizeHeight(prompt);

  const modelConfig = useMemo(() => getModelConfig(modelId), [modelId]);
  const audioLengthLimit = useMemo(() => {
    if (!modelConfig) return undefined;
    return modelConfig.audioLengthLimit[resolution] ?? modelConfig.audioLengthLimit[modelConfig.defaultResolution];
  }, [modelConfig, resolution]);

  const handleUpdateCharacterInfo = useCallback(
    (info: CharacterInfo, indexes?: number[]) => {
      onCharacterInfoChange(info, indexes);
    },
    [onCharacterInfoChange]
  );

  const { characterInfo: activeCharacterInfo } = useCharacterSearch({
    canvasId,
    nodeId,
    imageUrl,
    mode,
    characterInfo,
    onUpdateCharacterInfo: handleUpdateCharacterInfo,
  });

  const debouncedUpdatePrompt = useMemo(
    () =>
      debounce((value: string) => {
        if (value !== (params.prompt || '')) onChangePrompt(value);
      }, 500),
    [onChangePrompt, params.prompt]
  );

  useEffect(() => {
    setPrompt(params.prompt || '');
  }, [params.prompt]);

  useEffect(() => {
    if (!audioUrl) {
      setAudioDuration(0);
      return;
    }

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
  }, [audioUrl]);

  const clipDuration = useMemo(() => {
    const end = audioEndSecond > 0 ? audioEndSecond : audioDuration;
    return Math.max(0, end - audioStartSecond);
  }, [audioStartSecond, audioEndSecond, audioDuration]);

  const audioLimitIssue = useMemo<'too_short' | 'too_long' | null>(() => {
    if (!audioLengthLimit || !audioUrl || audioDuration <= 0) return null;
    const { min, max } = audioLengthLimit;
    if (clipDuration < min) return 'too_short';
    if (clipDuration > max) return 'too_long';
    return null;
  }, [audioLengthLimit, audioUrl, audioDuration, clipDuration]);

  const audioOverLimit = audioLimitIssue !== null;

  const maxPrompt = modelConfig?.maxPrompt;
  const promptOverLimit = maxPrompt ? prompt.length > maxPrompt : false;

  const allowSend = useMemo(() => {
    if (status === 'running' || toolPermissionDisabled) return false;
    if (!imageUrl || !audioUrl) return false;
    if (!prompt.trim()) return false;
    if (audioOverLimit || promptOverLimit) return false;
    if (mode === 'multiple') {
      if (activeCharacterInfo.status !== 'success') return false;
      if (!selectedCharacterIndexes.length) return false;
    }
    return true;
  }, [status, toolPermissionDisabled, imageUrl, audioUrl, prompt, audioOverLimit, promptOverLimit, mode, activeCharacterInfo.status, selectedCharacterIndexes.length]);

  const disabledReason = useMemo(() => {
    if (promptOverLimit && maxPrompt) {
      return { currentTextLen: prompt.length, maxPrompt };
    }
    if (audioLimitIssue === 'too_short' && audioLengthLimit) {
      return `截取音频时长不能少于 ${audioLengthLimit.min} 秒，请调整截取范围`;
    }
    if (audioLimitIssue === 'too_long' && audioLengthLimit) {
      return `截取音频时长不能超过 ${audioLengthLimit.max} 秒，请调整截取范围`;
    }
    if (mode === 'multiple' && activeCharacterInfo.status === 'loading') {
      return '正在检测角色，请稍候';
    }
    if (mode === 'multiple' && activeCharacterInfo.status === 'failure') {
      return '识别失败，请更换图片';
    }
    if (mode === 'multiple' && activeCharacterInfo.status === 'success' && !selectedCharacterIndexes.length) {
      return '请至少选择一个角色';
    }
    if (!imageUrl || !audioUrl) {
      return '请连接图片和音频';
    }
    return undefined;
  }, [promptOverLimit, maxPrompt, prompt.length, audioLimitIssue, audioLengthLimit, mode, activeCharacterInfo.status, selectedCharacterIndexes.length, imageUrl, audioUrl]);

  const modeOptions = useMemo(() => LIP_SYNC_MODE_OPTIONS.map(o => ({ value: o.value, label: o.label, description: o.description })), []);
  const modelOptions = useMemo(() => getModelsForMode(mode).map(m => ({ value: m.modelId, label: m.label, description: m.description })), [mode]);
  const resolutionOptions = useMemo(() => modelConfig?.resolutionChoices.map(c => ({ value: c.value, label: c.label })) || [], [modelConfig]);

  const handleModeChange = (value: string | number | boolean) => {
    const nextMode = value as LipSyncMode;
    const defaults = getDefaultParamsForMode(nextMode);
    const paramsPatch = {
      mode: nextMode,
      modelId: defaults.modelId,
      resolution: defaults.resolution,
      selectedCharacterIndexes: [] as number[],
    };
    if (nextMode === 'multiple' && imageUrl) {
      onParamsChange(paramsPatch, { characterInfo: { imageUrl, status: 'idle' } });
    } else {
      onParamsChange(paramsPatch);
    }
  };

  const handleModelChange = (value: string | number | boolean) => {
    const nextModelId = String(value);
    const defaults = getDefaultParamsForModel(nextModelId);
    onParamsChange({
      modelId: nextModelId,
      resolution: defaults.resolution,
    });
  };

  const handleResolutionChange = (value: string | number | boolean) => {
    onParamsChange({ resolution: String(value) });
  };

  const handleAudioClipSave = (start: number, end: number) => {
    onParamsChange({ audioStartSecond: start, audioEndSecond: end });
  };

  const hasImage = Boolean(imageUrl);
  const hasAudio = Boolean(audioUrl);
  const hasMediaRow = hasImage || hasAudio;

  return (
    <div className='grid w-max min-w-[672px] grid-cols-[minmax(0,1fr)] p-4' style={{ userSelect: 'none' }}>
      {hasMediaRow ? (
        <div className='flex items-center gap-2 mb-2'>
          {hasImage ? (
            <div className='relative w-[42px] h-[42px] shrink-0' onMouseEnter={() => setImageHovered(true)} onMouseLeave={() => setImageHovered(false)}>
              <button
                type='button'
                className='block w-full h-full p-0 border-0 bg-transparent cursor-pointer'
                onClick={e => {
                  e.stopPropagation();
                  setImagePreviewVisible(true);
                }}
              >
                <div className='relative w-full h-full rounded-lg overflow-hidden bg-black/40'>
                  <img className='w-full h-full object-cover' src={compressImage(imageUrl, 80)} alt='' />
                  {imageHovered ? (
                    <div className='absolute inset-0 z-[1] bg-black/45 flex items-center justify-center pointer-events-none'>
                      <Eye className='text-white' size={20} />
                    </div>
                  ) : null}
                </div>
              </button>
              <span className='absolute z-10 -top-1 -right-1 bg-black text-white rounded-full w-4 h-4 border border-white flex items-center justify-center text-[10px]'>1</span>
            </div>
          ) : null}
          {hasImage && hasAudio ? <span className='px-2 text-white/25'>|</span> : null}
          {hasAudio ? (
            <AudioClipPopover
              open={audioClipOpen}
              onOpenChange={setAudioClipOpen}
              audioUrl={audioUrl}
              minDuration={audioLengthLimit?.min ?? 2}
              maxDuration={audioLengthLimit?.max ?? 60}
              startSecond={audioStartSecond}
              endSecond={audioEndSecond > 0 ? audioEndSecond : audioDuration}
              onSave={handleAudioClipSave}
              anchor={
                <button type='button' className='group relative block w-[42px] h-[42px] shrink-0 p-0 border-0 bg-transparent cursor-pointer'>
                  <div className='relative w-full h-full rounded-lg overflow-hidden'>
                    <img className='w-full h-full object-cover' src={audioIcon} alt='' />
                    <div className='absolute inset-0 flex items-center justify-center text-white pointer-events-none transition-opacity group-hover:opacity-0'>
                      <Music4 size={20} />
                    </div>
                    <div className='absolute inset-0 flex items-center justify-center bg-black/45 text-white pointer-events-none opacity-0 transition-opacity group-hover:opacity-100'>
                      <SlidersHorizontal size={20} />
                    </div>
                    {audioOverLimit ? <div className='absolute inset-0 bg-red-500/40 rounded-lg pointer-events-none' /> : null}
                  </div>
                  <span className='absolute -top-1 -right-1 z-10 bg-black text-white rounded-full w-4 h-4 border border-white flex items-center justify-center text-[10px]'>1</span>
                </button>
              }
            />
          ) : null}
        </div>
      ) : null}

      {hasMediaRow ? <div className='w-full h-px bg-white/25 mb-2' /> : null}

      <Textarea
        ref={editorRef}
        value={prompt}
        preventWheelZoom
        onPointerDown={e => e.stopPropagation()}
        onKeyDown={e => e.stopPropagation()}
        onChange={e => {
          setPrompt(e.target.value);
          debouncedUpdatePrompt(e.target.value);
        }}
        rows={4}
        placeholder={mode === 'multiple' ? MULTIPLE_PLACEHOLDER : SINGLE_PLACEHOLDER}
        className='nodrag nopan nowheel select-text min-w-0 [contain:inline-size] [&::-webkit-scrollbar]:hidden px-0 resize-none border-none bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 mb-2'
      />

      <div className='flex items-center justify-between gap-2'>
        <div className='flex flex-wrap items-center gap-1 min-w-0'>
          <Selection options={modeOptions} label='模式' value={mode} onChange={handleModeChange} />
          <div className='w-px h-5 bg-white/25 mx-1' />
          <Selection options={modelOptions} label='模型' value={modelId} onChange={handleModelChange} />
          <div className='w-px h-5 bg-white/25 mx-1' />
          <Selection options={resolutionOptions} label='分辨率' value={resolution} onChange={handleResolutionChange} />
          {mode === 'multiple' ? (
            <>
              <div className='w-px h-5 bg-white/25 mx-1' />
              <CharacterMultiSelect
                characterInfo={activeCharacterInfo}
                imageUrl={imageUrl}
                value={selectedCharacterIndexes}
                onChange={indexes => onParamsChange({ selectedCharacterIndexes: indexes })}
              />
            </>
          ) : null}
        </div>
        <SendButton
          isExcute={isExcute}
          allowSend={allowSend}
          caculatePoint={caculatePoint}
          pointLoading={pointLoading}
          onClick={() => {
            if (!isExcute && allowSend) onSend();
          }}
          disabledReason={disabledReason}
        />
      </div>
      <MediaPreview visible={imagePreviewVisible} url={imageUrl ? [imageUrl] : []} type={['image']} initialIndex={0} onClose={() => setImagePreviewVisible(false)} />
    </div>
  );
};

export default memo(ImageLipSyncPromptModel);
