import { useMemo, useState, useEffect, memo, useCallback } from 'react';
// [media-node-model-unification] 跨模式模型列表与模式不支持置灰
import { buildFieldChoiceMeta, isBasicNodePermissionBlocked } from '../../utils/modelPermission';
import InputParams from '../../components/promptControl/InputParams';
import Selection from '../../components/promptControl/Selection';
import CombinedParamSelection from '../../components/promptControl/CombinedParamSelection';
import { useFlowStore } from '@/store/flowStore';
import util from '../../utils/util';
import type { SelectParam } from '../../utils/util';
import hooks from '../../hooks';
import SendButton from '../../components/promptControl/SendButton';
import CustomTabs from '../../components/common/CustomTabs';
import ProseMirrorEditor from '../../components/common/ProseMirrorEditor';
import type { MentionItem } from '@/lib/mentionPlugin';
import type { MediaInputItem } from '../../utils/util';
import audioIcon from '@/assets/images/audio.png';
import ProfessionalCameraMovement from './ProfessionalCameraMovement';
import type { CameraMovementParam } from './cameraMovementTypes';
import {
  buildMediaNodeParamState,
  getMediaNodeModelModeUnsupportedTip,
  getMediaNodeUnavailableParamsTip,
  resolveSeriesModelForMode,
  MEDIA_NODE_MODEL_MODE_UNSUPPORTED_TIP,
  type MediaModelItem,
  type MediaModelOptionMetaMap,
} from '../../utils/mediaNodeModelUtil';

const { transformByModel, getTransformItems, getVideoModelTypeMismatchReason } = util;
const { useGetNodeInput, usePromptModelCommon, useNodeCostQuery } = hooks;

// 各视频模型类型对应的输入提示词
const VIDEO_MODEL_TYPE_PLACEHOLDERS: Record<string, string> = {
  text_to_video: '输入视频描述的文本，如采用“主体 + 场景 + 动作 + 镜头语言 + 光影 + 氛围”的公式精准定义视频画面与叙事节奏',
  image_to_video: '上传1张首帧图，搭配画面细节描述 + 专业运镜方式创作，让视频动画的画面表现更专业、镜头更可控',
  first_last_frame_to_video: '上传2张图，调整好它们的先后顺序，通过描述两帧间的画面过渡方式 + 运镜逻辑，就可以得到丝滑的首尾帧视频了',
  reference_image_to_video:
    '上传 1-5 张参考图或视频，可自由组合人物、角色、道具、服装、场景等元素，定义他们之间的精彩互动。如:@图片1作为首帧，@图片2作为尾帧，模仿 @视频1的动作跳舞',
};
const DEFAULT_VIDEO_PLACEHOLDER = '输入视频提示词...';

interface ChangeParams {
  [key: string]: string;
}

interface VideoPromptModelProps {
  isExcute: boolean; // 是否正在执行
  props: any; // 节点props
  status: string;
  onChangePrompt: (value: string) => void;
  onSelectChange: (key: string, value: string | number | boolean | CameraMovementParam) => void;
  onCascadeChange: (changeParams: ChangeParams) => void;
  onSend: (serverPoint?: number) => void;
  onEnter?: () => void;
  onLeave?: () => void;
}

const VideoPromptModel = ({ isExcute, props, status, onChangePrompt, onSelectChange, onCascadeChange, onSend, onEnter = () => {}, onLeave = () => {} }: VideoPromptModelProps) => {
  const { data, type, id } = props;
  const { modelsMap, modelNodePermission } = useFlowStore(state => state);
  const category = String(type);
  const edges = useFlowStore(state => state.edges);
  const nodes = useFlowStore(state => state.nodes);
  const { edgeOrderChange } = useFlowStore(state => state.actions);
  const [otherParams, setOtherParams] = useState<SelectParam[]>([]);
  const [modelTypeParam, setModelTypeParam] = useState<Array<{ value: string; label: string }>>([]);
  const [modelParam, setModelParam] = useState<MediaModelItem[]>([]);
  const [modelOptionMeta, setModelOptionMeta] = useState<MediaModelOptionMetaMap>({});
  const [isModeSupported, setIsModeSupported] = useState(true);
  const [timeParam, setTimeParam] = useState<SelectParam>({ key: '', label: '', option: [] });

  const { textMap, imageMap, mediaInputs } = useGetNodeInput(id, nodes, edges);

  const textValues = useMemo(() => textMap.map(t => t.value), [textMap]);

  // 仅「自身 prompt 有内容」或「外部连入文本」可生成；连入图片/视频/音频等媒体不算有 prompt
  const { prompt, setPrompt, allowSend, disabledReason, debouncedUpdateValue, flushPrompt } = usePromptModelCommon({
    nodeId: id,
    nodePrompt: data.params.prompt || '',
    model: data.params.model,
    status,
    hasExtraInputs: Boolean(textMap.length),
    inputTextsForLen: textValues,
    onChangePrompt,
  });

  const currentModelKey = String(data.params.model || '');

  const applyMediaParamState = useCallback(
    (modelTypeOverride?: string, modelOverride?: string) => {
      const state = buildMediaNodeParamState(modelsMap, 'video', data.params, modelNodePermission, {
        modelTypeOverride,
        modelOverride,
      });
      setModelParam(state.modelParam);
      setModelOptionMeta(state.modelOptionMeta);
      setOtherParams(state.otherParams);
      setTimeParam(state.timeParam);
      setIsModeSupported(state.isModeSupported);
    },
    [modelsMap, data.params, modelNodePermission]
  );

  const combinedSections = useMemo(() => {
    return otherParams.map(p => ({
      key: p.key,
      label: p.label,
      options: p.option.map(o => ({
        value: o.value,
        label: o.label,
        description: o.description,
      })),
      value: data.params[p.key] != null ? data.params[p.key] : undefined,
      optionMeta: buildFieldChoiceMeta(
        modelNodePermission,
        category,
        currentModelKey,
        p.key,
        p.option.map(o => o.value)
      ),
    }));
  }, [otherParams, data.params, modelNodePermission, category, currentModelKey]);

  const genCountMeta = useMemo(() => {
    const opts = timeParam.option || [];
    if (!opts.length) return undefined;
    return buildFieldChoiceMeta(
      modelNodePermission,
      category,
      currentModelKey,
      'gen_count',
      opts.map(o => o.value)
    );
  }, [timeParam.option, modelNodePermission, category, currentModelKey]);

  const permissionBlocked = useMemo(() => isBasicNodePermissionBlocked(modelNodePermission, category, data.params), [modelNodePermission, category, data.params]);

  const modelTypeMismatchTip = useMemo(() => {
    const hasVideoOrAudioInput = mediaInputs.some(item => item.kind === 'video' || item.kind === 'audio');
    return getVideoModelTypeMismatchReason(String(data.params.modelType || ''), imageMap.length, hasVideoOrAudioInput);
  }, [data.params.modelType, imageMap.length, mediaInputs]);

  const modelModeUnsupportedTip = useMemo(() => {
    if (isModeSupported) return undefined;
    return getMediaNodeModelModeUnsupportedTip(modelsMap, 'video', String(data.params.modelType || ''), currentModelKey) ?? MEDIA_NODE_MODEL_MODE_UNSUPPORTED_TIP;
  }, [isModeSupported, modelsMap, data.params.modelType, currentModelKey]);

  const unavailableParamsTip = getMediaNodeUnavailableParamsTip(isModeSupported, otherParams, data.params);

  const queryEnabled = !permissionBlocked && !modelTypeMismatchTip && !modelModeUnsupportedTip && !unavailableParamsTip;
  const { data: cost, isFetching: pointLoading, isSuccess: pointSuccess, isError: pointError, error: pointErrorObj } = useNodeCostQuery(id, data.params, queryEnabled);
  const caculatePoint = cost?.caculatePoint ?? 0;

  const sendDisabledReason = pointError ? pointErrorObj?.message : (modelTypeMismatchTip ?? modelModeUnsupportedTip ?? unavailableParamsTip ?? disabledReason);
  const canSend = allowSend && queryEnabled && pointSuccess && !pointLoading;

  useEffect(() => {
    const modelTypes = modelsMap.video;
    if (modelTypes) {
      setModelTypeParam(modelTypes.map((m: { value: string; label: string }) => ({ value: m.value, label: m.label })));
      applyMediaParamState();
    }
  }, [modelsMap, data.params.modelType, data.params.model, applyMediaParamState]);

  const mentions = useMemo<MentionItem[]>(() => {
    let imageN = 0;
    let videoN = 0;
    let audioN = 0;
    return mediaInputs.map(item => {
      if (item.kind === 'image') {
        imageN += 1;
        return {
          id: item.edgeId + '-' + item.value,
          name: `图片${imageN}`,
          avatar: item.value,
          mediaKind: 'image' as const,
        };
      }
      if (item.kind === 'video') {
        videoN += 1;
        return {
          id: item.edgeId + '-' + item.value,
          name: `视频${videoN}`,
          avatar: item.value,
          mediaKind: 'video' as const,
        };
      }
      audioN += 1;
      return {
        id: item.edgeId + '-' + item.value,
        name: `音频${audioN}`,
        avatar: audioIcon,
        mediaKind: 'audio' as const,
      };
    });
  }, [mediaInputs]);

  const placeholder = useMemo(() => {
    return VIDEO_MODEL_TYPE_PLACEHOLDERS[data.params.modelType] ?? DEFAULT_VIDEO_PLACEHOLDER;
  }, [data.params.modelType]);

  const handleSend = () => {
    if (!isExcute && canSend) {
      flushPrompt();
      onSend(caculatePoint);
    }
  };

  // 选项变化
  const handleChange = (key: string, value: string | number | boolean) => {
    if (key == 'modelType') {
      const counterpart = resolveSeriesModelForMode(modelsMap, 'video', String(data.params.model || ''), String(value));
      applyMediaParamState(String(value), counterpart ?? data.params.model);
      onSelectChange(key, value);
    } else if (key == 'model') {
      const currentModeModels = modelsMap.video?.find((item: { value: string }) => item.value === data.params.modelType)?.params ?? [];
      const { otherParams, timeParam } = transformByModel(currentModeModels, data.params, String(value));
      setOtherParams(otherParams);
      setTimeParam(timeParam);
      applyMediaParamState(undefined, String(value));
      onSelectChange(key, value);
    } else if (!isModeSupported) {
      return;
    } else if (key !== 'gen_count') {
      const transformItems = getTransformItems(otherParams, key, value);
      if (transformItems.length) {
        const transformParams: any = {
          [key]: value,
        };
        transformItems.forEach(item => {
          otherParams.forEach(param => {
            if (param.key == item.key) {
              param.option = item.option;
            }
          });
          transformParams[item.key] = item.value;
        });
        setOtherParams(otherParams);
        onCascadeChange(transformParams);
      } else {
        onSelectChange(key, value);
      }
    } else {
      onSelectChange(key, value);
    }
  };

  const handleEdgeOrderChange = useCallback((order: MediaInputItem[]) => {
    edgeOrderChange(order);
  }, []);

  return (
    <div
      className='grid w-max min-w-[640px] grid-cols-[minmax(0,1fr)] rounded-2xl border border-white/10 bg-[#262626] p-4 z-10'
      style={{ userSelect: 'none' }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <div className='w-full min-w-0 [contain:inline-size]'>
        <CustomTabs tabs={modelTypeParam.map(m => ({ key: m.value, label: m.label }))} activeKey={data.params.modelType} onChange={value => handleChange('modelType', value)} />
        <InputParams textMap={textMap} imageMap={[]} mediaMap={mediaInputs} onMediaOrderChange={handleEdgeOrderChange} />
        <div className='mb-2' onKeyDown={e => e.stopPropagation()}>
          <ProseMirrorEditor
            value={prompt} // 传入值
            mentions={mentions}
            placeholder={placeholder}
            onChange={value => {
              setPrompt(value);
              debouncedUpdateValue(value); // 使用防抖更新
            }} // 响应值变化
          />
        </div>
      </div>

      <div className='flex items-center justify-between gap-2 nodrag'>
        <div className='flex flex-nowrap items-center shrink-0'>
          <Selection options={modelParam} label='模型' value={data.params.model} onChange={value => handleChange('model', value)} optionMeta={modelOptionMeta} />
          {otherParams.length > 0 ? (
            <>
              <div className='w-[1px] h-5 bg-white/25 my-2 mx-1' />
              <CombinedParamSelection nodeId={id} sections={combinedSections} summaryMuted={permissionBlocked || !isModeSupported} onChange={(key, value) => handleChange(key, value)} />
            </>
          ) : null}
          <div className='w-[1px] h-5 bg-white/25 my-2 mx-1' />
          <ProfessionalCameraMovement value={data.params.cameraMovement} onChange={info => onSelectChange('cameraMovement', info)} />
        </div>

        <div className='flex gap-2 shrink-0'>
          <Selection
            options={timeParam.option || []}
            label={timeParam.label}
            value={data.params.gen_count != null ? data.params.gen_count : undefined}
            onChange={value => handleChange('gen_count', value)}
            optionMeta={genCountMeta}
            forceMuted={!isModeSupported}
          />
          <SendButton
            isExcute={isExcute}
            allowSend={canSend}
            caculatePoint={caculatePoint}
            originalPoint={cost?.originalPoints}
            onClick={handleSend}
            disabledReason={sendDisabledReason}
            pointLoading={pointLoading}
          />
        </div>
      </div>
    </div>
  );
};

export default memo(VideoPromptModel);
