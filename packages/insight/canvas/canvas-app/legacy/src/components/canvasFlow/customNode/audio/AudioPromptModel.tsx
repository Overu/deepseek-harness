import { Textarea } from '@/components/ui/textarea';
import InputParams from '../../components/promptControl/InputParams';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFlowStore } from '@/store/flowStore';
import CustomTabs from '../../components/common/CustomTabs';
import Selection from '../../components/promptControl/Selection';
import SendButton from '../../components/promptControl/SendButton';
import hooks from '../../hooks';
import { getModelRow, isBasicNodePermissionBlocked, isModelPermissionEnforced, isModelSelectable } from '../../utils/modelPermission';
import util from '../../utils/util';
import MusicStyleRecommendation from './MusicStyleRecommendation';
import ToneSelectorButton from './ToneSelectorButton';
import {
  type AudioNodeParams,
  type MusicStyleOption,
  type ModelType,
  type Model,
  type SeniorParamerter,
  type BaseParameter,
  type MusicCoverAudioNodeParams,
  type MusicGenAudioNodeParams,
} from './types';
import { isTTS, isMusicCover, AudioModelType } from './types';
import { TtsSeniorParams, CoverSeniorParams, GenSeniorParams } from './SeniorParams';
import { useAutoResizeHeight } from '@/hooks/useAutoResizeHeight';
import { transformModelParams, appendStyle } from './utils';
import { buildMediaModelOptionMeta, classifyMediaModel, collectUnifiedModels, sortModelsCBA, type MediaModelOptionMetaMap } from '../../utils/mediaNodeModelUtil';

const { useGetNodeInput, usePromptModelCommon, useNodeCostQuery } = hooks;
const { getAudioModelTypeMismatchReason, creareDefaultParamsV2 } = util;
const TTS_IGNORE_CACHED_KEYS: string[] = [];

interface PromptModelProps {
  isExcute: boolean;
  props: any;
  status: string;
  onChangePrompt: (value: string) => void;
  onSelectChange: (key: string, value: string | number | boolean | object) => void;
  onSend: () => void;
  onEnter?: () => void;
  onLeave?: () => void;
}

const AudioPromptModel = ({ isExcute, props, status, onChangePrompt, onSelectChange, onSend, onEnter = () => {}, onLeave = () => {} }: PromptModelProps) => {
  const { data, type, id } = props;
  const params = data.params as AudioNodeParams; // TODO
  const { modelsMap, modelNodePermission } = useFlowStore(state => state);
  const modelTypes = modelsMap[type as keyof typeof modelsMap] as ModelType[]; // TODO
  const category = String(type);
  const edges = useFlowStore(state => state.edges);
  const nodes = useFlowStore(state => state.nodes);
  const { textMap, imageMap, mediaInputs } = useGetNodeInput(id, nodes, edges);
  const nonTextInputs = mediaInputs;
  const audioInputs = mediaInputs.filter(item => item.kind === 'audio');
  const textValues = useMemo(() => textMap.map(t => t.value), [textMap]);
  const previousNonTextInputCountRef = useRef(0);
  const [selectedStyleIds, setSelectedStyleIds] = useState<Record<string, number[]>>({});
  const [defaultNodeParam, setDefaultNodeParam] = useState<AudioNodeParams>(params);
  const [modelParam, setModelParam] = useState<Model[]>([]);
  const [modelOptionMeta, setModelOptionMeta] = useState<MediaModelOptionMetaMap>({});
  const [modelParamsOption, setModelParamsOption] = useState<BaseParameter[]>([]);
  const [seniorParamsOption, setSeniorParamsOption] = useState<SeniorParamerter[]>([]);
  const maxPrompt = useMemo(() => {
    const model = modelParam.find(item => item.value == params.model) || modelParam[0];
    return model?.maxPrompt;
  }, [modelParam, params.model]);

  const {
    prompt: editorValue,
    setPrompt: setEditorValue,
    allowSend: promptAllowSend,
    disabledReason,
    updateValue,
    debouncedUpdateValue,
    flushPrompt,
  } = usePromptModelCommon({
    nodeId: id,
    nodePrompt: params.prompt,
    model: params.model,
    status,
    hasExtraInputs: Boolean(textMap.length),
    inputTextsForLen: textValues,
    maxPrompt,
    onChangePrompt,
  });
  const editorRef = useAutoResizeHeight(editorValue);

  const applyAudioParamState = useCallback(
    (modelTypeOverride?: string, modelOverride?: string) => {
      const modelType = String(modelTypeOverride ?? params.modelType ?? '');
      const currentModelKey = modelOverride ?? params.model ?? '';
      const unifiedModels = collectUnifiedModels(modelsMap, type, modelType, currentModelKey);
      const classify = (modelKey: string) => classifyMediaModel(modelsMap, type, modelType, modelKey, modelNodePermission);
      const modelParam = sortModelsCBA(unifiedModels, classify);
      const modelOptionMeta = buildMediaModelOptionMeta(modelNodePermission, type, unifiedModels, modelType, modelsMap, type);
      setModelParam(modelParam as any);
      setModelOptionMeta(modelOptionMeta);
      const { params: modelParams, seniorParams } = transformModelParams(modelParam as any, currentModelKey);
      setModelParamsOption(modelParams);
      setSeniorParamsOption(seniorParams);
      setDefaultNodeParam({
        ...params,
        ...creareDefaultParamsV2(modelsMap, type, modelType, currentModelKey, modelNodePermission),
      });
    },
    [category, modelNodePermission, modelTypes, params.model, params.modelType]
  );

  const handleChange = useCallback(
    (key: string, value: string | number | boolean | object) => {
      if (key == 'modelType' && modelTypes && typeof value === 'string') {
        applyAudioParamState(value, params.model);
      } else if (key == 'model') {
        applyAudioParamState(params.modelType, String(value));
      }
      onSelectChange(key, value);
    },
    [applyAudioParamState, onSelectChange]
  );

  useEffect(() => {
    const previousCount = previousNonTextInputCountRef.current;
    if (previousCount === 0 && nonTextInputs.length > 0 && params.modelType !== AudioModelType.MUSIC_COVER) handleChange('modelType', AudioModelType.MUSIC_COVER);
    previousNonTextInputCountRef.current = nonTextInputs.length;
  }, [nonTextInputs.length, handleChange, params.modelType]);

  const modelTypeTabs = useMemo(() => modelTypes.map(item => ({ key: item.value, label: item.label })), [modelTypes]);

  const findSeniorOption = useCallback((field: string) => seniorParamsOption.find(option => option.field === field), [modelParamsOption]);

  const permissionBlocked = useMemo(() => isBasicNodePermissionBlocked(modelNodePermission, category, data.params), [modelNodePermission, category, data.params]);
  const modelSelectable = useMemo(() => {
    if (!isModelPermissionEnforced(modelNodePermission)) return true;
    return modelParam.some(model => isModelSelectable(modelNodePermission, category, String(model.value)));
  }, [category, modelNodePermission, modelParam]);

  const voiceCustomizable = useMemo(() => {
    if (!isModelPermissionEnforced(modelNodePermission)) return true;
    const row = getModelRow(modelNodePermission, category, String(params.model || ''));
    return row ? row._voiceCustomizable : false;
  }, [modelNodePermission, category, params.model]);

  const renderConfig = useMemo(() => {
    if (isTTS(params) || isTTS(defaultNodeParam)) {
      return {
        instrumental: false,
        customMode: false,
      };
    }
    return {
      instrumental: params.seniorParams.instrumental ?? defaultNodeParam.seniorParams.instrumental,
      customMode: params.seniorParams.customMode ?? defaultNodeParam.seniorParams.customMode,
    };
  }, [params, defaultNodeParam]);

  const modelTypeMismatchTip = useMemo(
    () => getAudioModelTypeMismatchReason(String(params.modelType || ''), nonTextInputs.length, audioInputs.length),
    [audioInputs.length, nonTextInputs.length, params.modelType]
  );

  const seniorParamsMismatchTip = useMemo(() => {
    if (isTTS(params)) return undefined;

    if (renderConfig.customMode && !isTTS(params)) {
      const title = params.seniorParams.title;
      const lyrics = params.seniorParams.lyrics;

      if (!title || !title.trim()) {
        return '请输入歌曲标题';
      }
      if (!renderConfig.instrumental && (!lyrics || !lyrics.trim())) {
        return '请输入歌词';
      }
    }
    return undefined;
  }, [params, renderConfig]);

  const queryEnabled = !permissionBlocked && modelSelectable && !modelTypeMismatchTip;
  const {
    data: cost,
    isFetching: pointLoading,
    isSuccess: pointSuccess,
    isError: pointError,
    error: pointErrorObj,
  } = useNodeCostQuery(id, data.params, queryEnabled, isTTS(params) ? TTS_IGNORE_CACHED_KEYS : undefined);
  const caculatePoint = cost?.caculatePoint ?? 0;
  const allowSend = promptAllowSend && queryEnabled && pointSuccess && !pointLoading && !seniorParamsMismatchTip;
  const sendDisabledReason = pointError ? pointErrorObj?.message : (modelTypeMismatchTip ?? seniorParamsMismatchTip ?? disabledReason);

  const handleSend = () => {
    if (isExcute || !allowSend) return;
    flushPrompt();
    onSend();
  };

  useEffect(() => {
    if (modelTypes) {
      applyAudioParamState();
    }
  }, [applyAudioParamState, modelNodePermission, modelTypes, modelsMap, onSelectChange, params, type]);

  const handleStyleSelect = (item: MusicStyleOption) => {
    const nextValue = appendStyle(editorValue, item.value);
    const modelType = String(params.modelType || '');
    setEditorValue(nextValue);
    setSelectedStyleIds(current => ({ ...current, [modelType]: [...new Set([...(current[modelType] || []), item.id])] }));
    updateValue(nextValue);
  };

  const renderSelection = (field: string, params: MusicCoverAudioNodeParams | MusicGenAudioNodeParams, onChange: (v: unknown) => void) => {
    const option = findSeniorOption(field);
    if (!option) {
      return null;
    }
    const value = (params.seniorParams as Record<string, any>)[field] ?? option.default ?? '';
    return 'choices' in option ? <Selection options={option.choices} label={option.label} value={value} onChange={onChange} /> : null;
  };

  return (
    <div
      className='z-10 grid w-max min-w-[560px] grid-cols-[minmax(0,1fr)] select-none overflow-hidden rounded-2xl border border-white/10 bg-[#262626] pt-4'
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <div className='px-4'>
        <CustomTabs tabs={modelTypeTabs} activeKey={params.modelType} onChange={value => handleChange('modelType', value)} />
        <InputParams textMap={textMap} imageMap={imageMap} mediaMap={mediaInputs} />
        <div className='mb-4 min-h-24 min-w-0 [contain:inline-size]'>
          <Textarea
            ref={editorRef}
            value={editorValue}
            preventWheelZoom
            onKeyDown={event => event.stopPropagation()}
            onChange={event => {
              setEditorValue(event.target.value);
              debouncedUpdateValue(event.target.value);
            }}
            rows={4}
            placeholder={isTTS(params) ? '请输入你的指令……' : '描述你想要的音乐风格，请输入你的指令……'}
            className='nowheel resize-none border-none bg-transparent px-0 focus-visible:ring-0 focus-visible:ring-offset-0 [&::-webkit-scrollbar]:hidden'
          />
        </div>
        <div className='mb-4 flex items-center justify-between gap-2 nodrag'>
          <div className='flex min-w-0 items-center'>
            <Selection options={modelParam} label='模型' value={params.model} onChange={value => handleChange('model', value)} optionMeta={modelOptionMeta} />
            <div className='mx-1 my-2 h-5 w-px bg-white/25' />
            {isTTS(params) ? (
              <ToneSelectorButton voiceId={params.voiceId} allowCustomTone={voiceCustomizable} onSelectVoice={voiceId => handleChange('voiceId', voiceId)} />
            ) : (
              <>
                {renderSelection('instrumental', params, value => handleChange('seniorParams', { instrumental: value, lyrics: '' }))}
                <div className='mx-1 my-2 h-5 w-px bg-white/25' />
                {renderSelection('customMode', params, value => handleChange('seniorParams', { customMode: value, title: '', lyrics: '' }))}
              </>
            )}
          </div>
          <div className='shrink-0'>
            <SendButton
              isExcute={isExcute}
              allowSend={allowSend}
              caculatePoint={caculatePoint}
              originalPoint={cost?.originalPoints}
              onClick={handleSend}
              disabledReason={sendDisabledReason}
              pointLoading={pointLoading}
            />
          </div>
        </div>
      </div>

      {isTTS(params) ? (
        <TtsSeniorParams nodeId={id} params={params} seniorParamsOption={seniorParamsOption} onSelectChange={handleChange} />
      ) : (
        <>
          <MusicStyleRecommendation selectedStyleIds={selectedStyleIds[String(params.modelType || '')] || []} onSelect={handleStyleSelect} />
          {renderConfig.customMode ? (
            isMusicCover(params) ? (
              <CoverSeniorParams nodeId={id} params={params} instrumental={renderConfig.instrumental} seniorParamsOption={seniorParamsOption} onSelectChange={handleChange} />
            ) : (
              <GenSeniorParams nodeId={id} params={params} instrumental={renderConfig.instrumental} seniorParamsOption={seniorParamsOption} onSelectChange={handleChange} />
            )
          ) : null}
        </>
      )}
    </div>
  );
};

export default memo(AudioPromptModel);
