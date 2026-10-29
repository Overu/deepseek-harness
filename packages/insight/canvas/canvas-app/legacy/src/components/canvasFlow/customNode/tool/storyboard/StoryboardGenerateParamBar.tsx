import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import Selection from '../../../components/promptControl/Selection';
import CombinedParamSelection from '../../../components/promptControl/CombinedParamSelection';
import { useFlowStore } from '@/store/flowStore';
import util from '../../../utils/util';
import type { SelectParam } from '../../../utils/util';
import { buildFieldChoiceMeta, paramValueLookupKey } from '../../../utils/modelPermission';
import {
  buildMediaNodeParamState,
  findModelConfigInAnyMode,
  resolveParamsOnModelChange,
  type MediaModelItem,
  type MediaModelOptionMetaMap,
} from '../../../utils/mediaNodeModelUtil';
import { normalizeStoryboardGenCount, type StoryboardGenerateParams } from './types';

const { transformByModel, getTransformItems } = util;

interface StoryboardGenerateParamBarProps {
  params: StoryboardGenerateParams;
  /** 当前勾选行中是否存在图片（与整表无关）→ 为 true 时按图生图模式校验/置灰模型 */
  requireImageToImage: boolean;
  onChange: (next: StoryboardGenerateParams) => void;
}

/**
 * 勾选含图后 effectiveModelType 切到图生图时，CBA 合并可能丢掉仅文生图的当前 model。
 * 此时需把当前项补回列表，否则 Selection 找不到 label（会回退成裸 value）。
 */
const ensureCurrentModelVisible = (
  modelsMap: any,
  modelParam: MediaModelItem[],
  modelOptionMeta: MediaModelOptionMetaMap,
  currentModelKey: string,
  modeUnsupported: boolean
): { modelParam: MediaModelItem[]; modelOptionMeta: MediaModelOptionMetaMap } => {
  if (!currentModelKey) return { modelParam, modelOptionMeta };
  const exists = modelParam.some(m => String(m.value ?? '') === currentModelKey);
  if (exists) {
    if (!modeUnsupported) return { modelParam, modelOptionMeta };
    const optionKey = paramValueLookupKey(currentModelKey);
    return {
      modelParam,
      modelOptionMeta: {
        ...modelOptionMeta,
        [optionKey]: {
          ...(modelOptionMeta[optionKey] ?? {}),
          hidden: false,
          disabled: true,
          modeUnsupported: true,
        },
      },
    };
  }

  const found = findModelConfigInAnyMode(modelsMap, 'image', currentModelKey);
  if (!found?.modelItem) return { modelParam, modelOptionMeta };

  const optionKey = paramValueLookupKey(currentModelKey);
  return {
    modelParam: [found.modelItem, ...modelParam],
    modelOptionMeta: {
      ...modelOptionMeta,
      [optionKey]: {
        hidden: false,
        disabled: modeUnsupported,
        modeUnsupported,
      },
    },
  };
};

/**
 * 分镜生成模式参数条：复用图片节点模型/联合参数解析，不展示 gen_count。
 * 图生图置灰仅依据「当前勾选行」是否含图片（requireImageToImage），与整表无关。
 */
const StoryboardGenerateParamBar = ({ params, requireImageToImage, onChange }: StoryboardGenerateParamBarProps) => {
  const modelsMap = useFlowStore(state => state.modelsMap);
  const modelNodePermission = useFlowStore(state => state.modelNodePermission);
  const [otherParams, setOtherParams] = useState<SelectParam[]>([]);
  const [modelParam, setModelParam] = useState<MediaModelItem[]>([]);
  const [modelOptionMeta, setModelOptionMeta] = useState<MediaModelOptionMetaMap>({});
  const [isModeSupported, setIsModeSupported] = useState(true);

  // 仅由勾选行是否含图决定；勿回退到已持久化的 params.modelType（避免整表有图/历史值误置灰）
  const effectiveModelType = requireImageToImage ? 'reference_image_to_image' : 'text_to_image';
  const currentModelKey = String(params?.model || '');

  const applyMediaParamState = useCallback(
    (modelTypeOverride?: string, modelOverride?: string) => {
      const state = buildMediaNodeParamState(modelsMap, 'image', params || {}, modelNodePermission, {
        modelTypeOverride: modelTypeOverride ?? effectiveModelType,
        modelOverride,
      });
      const modelKey = String(modelOverride ?? params?.model ?? '');
      const ensured = ensureCurrentModelVisible(modelsMap, state.modelParam, state.modelOptionMeta, modelKey, !state.isModeSupported);
      setModelParam(ensured.modelParam);
      setModelOptionMeta(ensured.modelOptionMeta);
      setOtherParams(state.otherParams);
      setIsModeSupported(state.isModeSupported);
    },
    [modelsMap, params, modelNodePermission, effectiveModelType]
  );

  useEffect(() => {
    if (!modelsMap?.image) return;
    applyMediaParamState();
  }, [modelsMap, params?.model, params?.modelType, requireImageToImage, applyMediaParamState]);

  const combinedSections = useMemo(() => {
    return otherParams.map(p => ({
      key: p.key,
      label: p.label,
      options: p.option.map(o => ({
        value: o.value,
        label: o.label,
        description: o.description,
      })),
      value: params?.[p.key] != null ? params[p.key] : undefined,
      optionMeta: buildFieldChoiceMeta(
        modelNodePermission,
        'image',
        currentModelKey,
        p.key,
        p.option.map(o => o.value)
      ),
    }));
  }, [otherParams, params, modelNodePermission, currentModelKey]);

  const commitParams = useCallback(
    (next: StoryboardGenerateParams) => {
      onChange(normalizeStoryboardGenCount(next));
    },
    [onChange]
  );

  const handleChange = (key: string, value: string | number | boolean) => {
    if (key === 'model') {
      const next = resolveParamsOnModelChange(modelsMap, 'image', String(value), { ...params, modelType: effectiveModelType }, modelNodePermission);
      const currentModeModels = modelsMap.image?.find((item: { value: string }) => item.value === effectiveModelType)?.params ?? [];
      const { otherParams: nextOther } = transformByModel(currentModeModels, next, String(value));
      setOtherParams(nextOther);
      applyMediaParamState(effectiveModelType, String(value));
      commitParams({ ...next, modelType: effectiveModelType });
      return;
    }

    if (!isModeSupported && requireImageToImage) return;

    if (key !== 'gen_count') {
      const transformItems = getTransformItems(otherParams, key, value);
      if (transformItems.length) {
        const transformParams: StoryboardGenerateParams = { [key]: value };
        transformItems.forEach(item => {
          otherParams.forEach(param => {
            if (param.key === item.key) {
              param.option = item.option;
            }
          });
          transformParams[item.key] = item.value;
        });
        setOtherParams([...otherParams]);
        commitParams({ ...params, ...transformParams });
        return;
      }
    }

    commitParams({ ...params, [key]: value });
  };

  /** 勾选含图且当前模型不支持图生图时置灰触发器；下拉内不支持项由 optionMeta.modeUnsupported 置灰 */
  const modelForceMuted = requireImageToImage && !isModeSupported;

  return (
    <div className='flex flex-nowrap items-center shrink-0 nodrag nopan'>
      <Selection
        options={modelParam}
        label='模型'
        value={params?.model}
        onChange={value => handleChange('model', value)}
        optionMeta={modelOptionMeta}
        showDropdownIcon
        forceMuted={modelForceMuted}
      />
      {otherParams.length > 0 ? (
        <>
          <div className='w-[1px] h-5 bg-white/25 my-2 mx-1' />
          <CombinedParamSelection sections={combinedSections} summaryMuted={modelForceMuted} onChange={(key, value) => handleChange(key, value)} />
        </>
      ) : null}
    </div>
  );
};

export default memo(StoryboardGenerateParamBar);
