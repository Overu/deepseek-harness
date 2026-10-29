import React, { useEffect, useMemo, useState } from 'react';
import { Separator } from '@/components/ui/separator';
import SendButton from '../promptControl/SendButton';
import Selection from '../promptControl/Selection';
import { useFlowStore } from '@/store/flowStore';
import { usePointStore } from '@/store/pointStore';
import { useQuery } from '@tanstack/react-query';
import { calculateExternalTaskCost } from '@/api/tool';
import util from '../../utils/util';
import type { SelectParam, ModelItem } from '../../utils/util';
import { buildFieldChoiceMeta, buildModelOptionMeta, isModelSelectable } from '../../utils/modelPermission';
import { resolveDefaultParams, type ImageLayoutParams } from './imageLayoutParams';
import { sortModelsCBA } from '../../utils/mediaNodeModelUtil';

const { transformByModel } = util;

const nodeType = 'imageLayoutTool';

interface ImageLayoutProps {
  textList?: string[]; // 传入的文本列表
  imageList?: string[]; // 传入的图片列表
  status: string; // 任务状态
  params?: Record<string, any>;
  onParamsChange?: (params: ImageLayoutParams | Record<string, any>) => void; // 参数变化回调
  execute: boolean; // 执行状态
  onLayerClick: (imageList: string[] | undefined, params: ImageLayoutParams) => void; // 点击回调
  permissionDisabled?: boolean;
}

const ImageLayoutDefinition: React.FC<ImageLayoutProps> = ({ imageList, status, params = {}, onParamsChange, execute, onLayerClick, permissionDisabled = false }) => {
  const { modelsMap, modelNodePermission } = useFlowStore(state => state);
  const { setNeedPoint } = usePointStore(state => state.actions);
  const models = (modelsMap?.[nodeType as keyof typeof modelsMap] as ModelItem[] | undefined) || [];
  const category = nodeType;

  const [otherParams, setOtherParams] = useState<SelectParam[]>([]);
  const [modelsOption, setModelsOption] = useState<ModelItem[]>([]);

  const currentModelItem = useMemo(() => {
    return models.find(m => m.value === params.model) || models[0];
  }, [models, params.model]);

  // 通用默认值补齐：如果属性在 params 中不存在，则取默认值
  const effectiveParams = useMemo(() => {
    return resolveDefaultParams(currentModelItem, params);
  }, [currentModelItem, params]);

  const numLayers = effectiveParams.num_layers;
  const resolution = effectiveParams.resolution;

  const modelOptionMeta = useMemo(() => {
    if (!modelsOption.length) return undefined;
    return buildModelOptionMeta(
      modelNodePermission,
      category,
      modelsOption.map(m => m.value)
    );
  }, [modelNodePermission, category, modelsOption]);

  useEffect(() => {
    if (models && models.length) {
      const modelParam = sortModelsCBA(models, (modelKey: string) => (isModelSelectable(modelNodePermission, nodeType, modelKey) ? 'C' : 'B'));
      setModelsOption(modelParam);
      const { otherParams: nextOtherParams } = transformByModel(modelParam, params, effectiveParams.model);
      setOtherParams(nextOtherParams);
    }
  }, [models, effectiveParams.model, params]);

  // 计算是否允许发送
  const allowSend = useMemo(() => {
    if (permissionDisabled || status === 'running' || !imageList || !imageList.length || execute) {
      return false;
    }
    return true;
  }, [imageList, status, execute, permissionDisabled]);

  // 赛点计算（React Query 缓存与去重，参考标准模型节点设计）
  const queryEnabled = Boolean(allowSend && effectiveParams.model && numLayers && resolution);

  const { data: caculatePoint = 0, isFetching: pointLoading } = useQuery({
    queryKey: ['externalTaskCost', 'IMAGE_LAYERING', effectiveParams.model, numLayers, resolution],
    queryFn: async () => {
      const response = await calculateExternalTaskCost({
        type: 'IMAGE_LAYERING',
        model: effectiveParams.model,
        numLayers,
        resolution,
      });
      const { code, data: result }: any = response;
      if (code === 'SUCCESS' && result != null) {
        return result;
      }
      return 0;
    },
    enabled: queryEnabled,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  // 同步赛点到 pointStore
  useEffect(() => {
    setNeedPoint(caculatePoint);
  }, [caculatePoint, setNeedPoint]);

  // 选项变化
  const handleChange = (key: string, value: string | any) => {
    if (key === 'model' && models) {
      const { otherParams: nextOtherParams } = transformByModel(models, params, value);
      setOtherParams(nextOtherParams);

      const targetModel = models.find(m => m.value === value) || models[0];
      const candidateParams: Record<string, any> = { ...params, model: value };

      // 仅保留在新模型选项中依然有效的选项，失效项清除后由 resolveDefaultParams 自动回退默认值
      nextOtherParams.forEach(param => {
        const currentVal = params[param.key];
        const isValid = param.option?.some(opt => String(opt.value) === String(currentVal));
        if (!isValid) {
          delete candidateParams[param.key];
        }
      });

      onParamsChange?.(resolveDefaultParams(targetModel, candidateParams));
    } else {
      onParamsChange?.({ [key]: value });
    }
  };

  const handleSend = () => {
    const finalParams: ImageLayoutParams = {
      ...params,
      ...effectiveParams,
    };
    onLayerClick(imageList, finalParams);
  };

  return (
    <div className='flex items-center justify-between gap-2 p-1 text-sm nodrag'>
      <div className='flex items-center gap-1 min-w-0'>
        {modelsOption.length > 0 && (
          <>
            <Selection options={modelsOption} label='模型' value={effectiveParams.model} onChange={value => handleChange('model', value)} optionMeta={modelOptionMeta} />
            <Separator className='mx-1 bg-white/20 h-4' orientation='vertical' />
          </>
        )}
        {otherParams.map(item => {
          return (
            <Selection
              key={item.key}
              options={item.option}
              label={item.label}
              value={effectiveParams[item.key] != null ? effectiveParams[item.key] : undefined}
              onChange={value => handleChange(item.key, value)}
              optionMeta={buildFieldChoiceMeta(
                modelNodePermission,
                category,
                effectiveParams.model,
                item.key,
                item.option.map(o => o.value)
              )}
            />
          );
        })}
      </div>
      <div className='flex items-center gap-2 flex-shrink-0'>
        <Separator className='mx-1 bg-white/20 h-4' orientation='vertical' />
        <SendButton isExcute={execute} allowSend={allowSend} caculatePoint={caculatePoint} onClick={handleSend} pointLoading={pointLoading} />
      </div>
    </div>
  );
};

export default ImageLayoutDefinition;
