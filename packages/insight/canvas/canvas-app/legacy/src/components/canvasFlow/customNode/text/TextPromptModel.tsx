import { Textarea } from '@/components/ui/textarea';
import { useState, useEffect, memo, useCallback, useMemo } from 'react';
import InputParams from '../../components/promptControl/InputParams';
import Selection from '../../components/promptControl/Selection';
import { useFlowStore } from '@/store/flowStore';
import util from '../../utils/util';
import type { SelectParam, ModelItem, MediaInputItem } from '../../utils/util';
import hooks from '../../hooks';
import SendButton from '../../components/promptControl/SendButton';
import { buildFieldChoiceMeta, buildModelOptionMeta, isBasicNodePermissionBlocked } from '../../utils/modelPermission';
import { useAutoResizeHeight } from '@/hooks/useAutoResizeHeight';
import Check from '../../components/promptControl/Check';

const { transformByModel, getTransformItems } = util;
const { useGetNodeInput, usePromptModelCommon, useNodeCostQuery } = hooks;

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

const TextPromptModel = ({ isExcute, props, status, onChangePrompt, onSelectChange, onCascadeChange, onSend, onEnter = () => {}, onLeave = () => {} }: PromptModelProps) => {
  const { data, type, id } = props;
  const { modelsMap, modelNodePermission } = useFlowStore(state => state);
  const models = modelsMap[type as keyof typeof modelsMap];
  const category = String(type);
  const edges = useFlowStore(state => state.edges);
  const nodes = useFlowStore(state => state.nodes);
  const { edgeOrderChange } = useFlowStore(state => state.actions);
  const [otherParams, setOtherParams] = useState<SelectParam[]>([]);
  const [modelsOption, setModelsOption] = useState<ModelItem[]>([]);

  const { textMap, mediaInputs } = useGetNodeInput(id, nodes, edges);
  const textValues = useMemo(() => textMap.map(t => t.value), [textMap]);

  const { prompt, setPrompt, allowSend, disabledReason, debouncedUpdateValue, flushPrompt } = usePromptModelCommon({
    nodeId: id,
    nodePrompt: data.params.prompt || '',
    model: data.params.model,
    status,
    hasExtraInputs: Boolean(textMap.length),
    inputTextsForLen: textValues,
    onChangePrompt,
  });
  const editorRef = useAutoResizeHeight(prompt);

  const currentModelKey = String(data.params.model || '');

  const modelOptionMeta = useMemo(() => {
    if (!modelsOption.length) return undefined;
    return buildModelOptionMeta(
      modelNodePermission,
      category,
      modelsOption.map(m => m.value)
    );
  }, [modelNodePermission, category, modelsOption]);

  const permissionBlocked = useMemo(() => isBasicNodePermissionBlocked(modelNodePermission, category, data.params), [modelNodePermission, category, data.params]);

  const queryEnabled = allowSend && !permissionBlocked;
  const { data: cost, isFetching: pointLoading, isSuccess: pointSuccess, isError: pointError, error: pointErrorObj } = useNodeCostQuery(id, data.params, queryEnabled);
  const caculatePoint = cost?.caculatePoint ?? 0;
  const sendDisabledReason = pointError ? pointErrorObj?.message : disabledReason;
  const allowSendEffective = queryEnabled && pointSuccess && !pointLoading;

  useEffect(() => {
    if (models) {
      setModelsOption(models);
      const { otherParams } = transformByModel(models, data.params);
      setOtherParams(otherParams);
    }
  }, [models, data.params.model]);

  const handleSend = () => {
    if (!isExcute && allowSendEffective) {
      flushPrompt();
      onSend();
    }
  };

  // 选项变化
  const handleChange = (key: string, value: string | any) => {
    if (key == 'model' && models) {
      const { otherParams } = transformByModel(models, data.params, value);
      setOtherParams(otherParams);
      onSelectChange(key, value);
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

  return (
    <div
      className='grid w-max min-w-[672px] grid-cols-[minmax(0,1fr)] rounded-2xl border border-white/10 bg-[#262626] p-4 z-10'
      style={{ userSelect: 'none' }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <InputParams textMap={textMap} imageMap={[]} mediaMap={mediaInputs} onMediaOrderChange={handleEdgeOrderChange} />
      <div className='mb-2 min-w-0 [contain:inline-size]'>
        <Textarea
          ref={editorRef}
          value={prompt}
          preventWheelZoom
          onKeyDown={e => e.stopPropagation()}
          onChange={e => {
            setPrompt(e.target.value);
            debouncedUpdateValue(e.target.value); // 使用防抖更新
          }}
          rows={4}
          placeholder='请输入内容...'
          className='nowheel [&::-webkit-scrollbar]:hidden px-0 resize-none border-none bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0'
        />
      </div>

      <div className='flex items-center justify-between gap-2 nodrag'>
        <div className='flex flex-wrap'>
          <Selection options={modelsOption} label='模型' value={data.params.model} onChange={value => handleChange('model', value)} optionMeta={modelOptionMeta} />
          {otherParams.map(item =>
            item.type === 'switch' ? (
              <Check key={item.key} checked={Boolean(data.params[item.key])} label={item.label} onChange={value => handleChange(item.key, value)} />
            ) : (
              <Selection
                key={item.key}
                options={item.option}
                label={item.label}
                value={data.params[item.key] != null ? data.params[item.key] : undefined}
                onChange={value => handleChange(item.key, value)}
                optionMeta={buildFieldChoiceMeta(
                  modelNodePermission,
                  category,
                  currentModelKey,
                  item.key,
                  item.option.map(o => o.value)
                )}
              />
            )
          )}
        </div>

        <div className='flex gap-2 shrink-0'>
          <SendButton
            isExcute={isExcute}
            allowSend={allowSendEffective}
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

export default memo(TextPromptModel);
