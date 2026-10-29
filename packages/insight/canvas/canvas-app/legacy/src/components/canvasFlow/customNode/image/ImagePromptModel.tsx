import { useState, useEffect, memo, useCallback, useMemo } from 'react';
// [media-node-model-unification] 跨模式模型列表与模式不支持置灰
import InputParams from '../../components/promptControl/InputParams';
import Selection from '../../components/promptControl/Selection';
import CombinedParamSelection from '../../components/promptControl/CombinedParamSelection';
import { useFlowStore } from '@/store/flowStore';
import util from '../../utils/util';
import type { SelectParam, MediaInputItem } from '../../utils/util';
import hooks from '../../hooks';
import SendButton from '../../components/promptControl/SendButton';
import CameraControl from './CameraControl';
import CustomTabs from '../../components/common/CustomTabs';
import ProseMirrorEditor from '../../components/common/ProseMirrorEditor';
import type { MentionItem } from '@/lib/mentionPlugin';
import { buildFieldChoiceMeta, isBasicNodePermissionBlocked } from '../../utils/modelPermission';
import {
  buildMediaNodeParamState,
  getMediaNodeModelModeUnsupportedTip,
  getMediaNodeUnavailableParamsTip,
  resolveSeriesModelForMode,
  MEDIA_NODE_MODEL_MODE_UNSUPPORTED_TIP,
  type MediaModelItem,
  type MediaModelOptionMetaMap,
} from '../../utils/mediaNodeModelUtil';

const { transformByModel, getTransformItems, getImageModelTypeMismatchReason, getImageSvgUnsupportedReason } = util;
const { useGetNodeInput, usePromptModelCommon, useNodeCostQuery } = hooks;

const IMAGE_MODEL_TYPE_PLACEHOLDERS: Record<string, string> = {
  text_to_image: '输入画面描述，如主体、场景、风格、光影、构图等',
  reference_image_to_image: '上传参考图，通过 @图片1、@图片2 指定参考元素，并补充画面描述',
};
const DEFAULT_IMAGE_PLACEHOLDER = '输入图片提示词...';

interface ChangeParams {
  [key: string]: string;
}

interface PromptModelProps {
  isExcute: boolean; // 是否正在执行
  props: any; // 节点props
  status: string;
  onChangePrompt: (value: string) => void;
  onSelectChange: (key: string, value: string | number | boolean) => void;
  onCascadeChange: (changeParams: ChangeParams) => void;
  onSend: () => void;
  onEnter?: () => void;
  onLeave?: () => void;
}

interface CameraControlParam {
  key: string;
  label: string;
  setItems: Array<SelectParam>;
}

const ImagePromptModel = ({ isExcute, props, status, onChangePrompt, onSelectChange, onCascadeChange, onSend, onEnter = () => {}, onLeave = () => {} }: PromptModelProps) => {
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
  const [cameraControlParam, setCameraControlParam] = useState<CameraControlParam>({ key: '', label: '', setItems: [] });

  const { textMap, imageMap, mediaInputs } = useGetNodeInput(id, nodes, edges);
  const textValues = useMemo(() => textMap.map(t => t.value), [textMap]);

  // 仅「自身 prompt 有内容」或「外部连入文本」可生成；连入图片等媒体不算有 prompt
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
      const state = buildMediaNodeParamState(modelsMap, 'image', data.params, modelNodePermission, {
        modelTypeOverride,
        modelOverride,
      });
      setModelParam(state.modelParam);
      setModelOptionMeta(state.modelOptionMeta);
      setOtherParams(state.otherParams);
      setTimeParam(state.timeParam);
      setCameraControlParam(state.cameraControlParam);
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

  const modelTypeMismatchTip = useMemo(() => getImageModelTypeMismatchReason(String(data.params.modelType || ''), imageMap.length), [data.params.modelType, imageMap.length]);

  const svgUnsupportedTip = useMemo(() => getImageSvgUnsupportedReason(currentModelKey, imageMap), [currentModelKey, imageMap]);

  const modelModeUnsupportedTip = useMemo(() => {
    if (isModeSupported) return undefined;
    return getMediaNodeModelModeUnsupportedTip(modelsMap, 'image', String(data.params.modelType || ''), currentModelKey) ?? MEDIA_NODE_MODEL_MODE_UNSUPPORTED_TIP;
  }, [isModeSupported, modelsMap, data.params.modelType, currentModelKey]);

  const unavailableParamsTip = getMediaNodeUnavailableParamsTip(isModeSupported, otherParams, data.params);

  const queryEnabled = !permissionBlocked && !modelTypeMismatchTip && !svgUnsupportedTip && !modelModeUnsupportedTip && !unavailableParamsTip;
  const { data: cost, isFetching: pointLoading, isSuccess: pointSuccess, isError: pointError, error: pointErrorObj } = useNodeCostQuery(id, data.params, queryEnabled);
  const caculatePoint = cost?.caculatePoint ?? 0;

  const sendDisabledReason = pointError ? pointErrorObj?.message : (modelTypeMismatchTip ?? svgUnsupportedTip ?? modelModeUnsupportedTip ?? unavailableParamsTip ?? disabledReason);
  const canSend = allowSend && queryEnabled && pointSuccess && !pointLoading;

  useEffect(() => {
    const modelTypes = modelsMap.image;
    if (modelTypes) {
      setModelTypeParam(modelTypes.map((m: { value: string; label: string }) => ({ value: m.value, label: m.label })));
      applyMediaParamState();
    }
  }, [modelsMap, data.params.modelType, data.params.model, applyMediaParamState]);

  const mentions = useMemo<MentionItem[]>(() => {
    return imageMap.map((item, index) => ({
      id: item.edgeId + '-' + item.value,
      name: `图片${index + 1}`,
      avatar: item.value,
      mediaKind: 'image' as const,
    }));
  }, [imageMap]);

  const placeholder = useMemo(() => {
    return IMAGE_MODEL_TYPE_PLACEHOLDERS[data.params.modelType] ?? DEFAULT_IMAGE_PLACEHOLDER;
  }, [data.params.modelType]);

  const handleSend = () => {
    if (!isExcute && canSend) {
      flushPrompt();
      onSend();
    }
  };

  // 选项变化
  const handleChange = (key: string, value: string | any) => {
    if (key == 'modelType') {
      const counterpart = resolveSeriesModelForMode(modelsMap, 'image', String(data.params.model || ''), String(value));
      applyMediaParamState(String(value), counterpart ?? data.params.model);
      onSelectChange(key, value);
    } else if (key == 'model') {
      const currentModeModels = modelsMap.image?.find((item: { value: string }) => item.value === data.params.modelType)?.params ?? [];
      const { otherParams, timeParam, cameraControlParam } = transformByModel(currentModeModels, data.params, String(value));
      setOtherParams(otherParams);
      setTimeParam(timeParam);
      setCameraControlParam(cameraControlParam);
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

  const handleEdgeOrderChange = useCallback(
    (order: MediaInputItem[]) => {
      edgeOrderChange(order);
    },
    [edgeOrderChange]
  );

  const handleSaveCameraControl = (info: any) => {
    onSelectChange('cameraControl', info);
  };

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
            value={prompt}
            mentions={mentions}
            placeholder={placeholder}
            onChange={value => {
              setPrompt(value);
              debouncedUpdateValue(value);
            }}
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
          {cameraControlParam.setItems.length ? (
            <>
              <div className='w-[1px] h-5 bg-white/25 my-2 mx-1' />
              <CameraControl valueMap={data.params.cameraControl} optionMap={cameraControlParam.setItems} onSave={handleSaveCameraControl}></CameraControl>
            </>
          ) : null}
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

export default memo(ImagePromptModel);
