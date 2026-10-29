import type { ModelItem } from '../../utils/util';

export interface ImageLayoutParams {
  model?: string;
  num_layers?: number;
  resolution?: string;
  taskId?: string;
  [key: string]: any;
}

/**
 * 获取单个属性的有效值：若属性在 params 中不存在（为 undefined / null / 空字符串），则取模型配置中的默认值
 */
export const getParamWithDefault = (key: string, modelItem?: ModelItem, currentParams: Record<string, any> = {}) => {
  const currentVal = currentParams[key];
  if (currentVal != null && currentVal !== '') {
    return currentVal;
  }
  if (key === 'model') {
    return modelItem?.value ?? '';
  }
  const targetParam = modelItem?.params?.find((p: any) => p.field === key);
  return targetParam?.default ?? targetParam?.choices?.[0]?.value ?? (targetParam as any)?.option?.[0]?.value;
};

/**
 * 通用默认值赋值：若属性在 params 中不存在，则取模型配置中的默认值
 */
export const resolveDefaultParams = (modelItem?: ModelItem, currentParams: Record<string, any> = {}): Record<string, any> => {
  const resolved: Record<string, any> = { ...currentParams };

  if (resolved.model == null || resolved.model === '') {
    resolved.model = getParamWithDefault('model', modelItem, currentParams);
  }

  modelItem?.params?.forEach((param: any) => {
    const key = param.field;
    if (resolved[key] == null || resolved[key] === '') {
      const defaultVal = getParamWithDefault(key, modelItem, currentParams);
      if (defaultVal != null) {
        resolved[key] = defaultVal;
      }
    }
  });

  return resolved;
};
