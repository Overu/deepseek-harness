import { useMemo } from 'react';
import canvasFlowUtil from '@/components/canvasFlow/utils/util';

const { buildFieldChoicesFromMap, buildFieldLabelsFromMap } = canvasFlowUtil;

/** 从画布 flowStore 已有的 modelsMap 构建参数解析用的 field 映射，不再请求 getModelParams */
export function useFieldMapsFromModelsMap(modelsMap: Record<string, any> | null | undefined) {
  const fieldChoicesMap = useMemo(() => {
    if (!modelsMap) return {};
    return buildFieldChoicesFromMap(modelsMap);
  }, [modelsMap]);

  const fieldLabelsMap = useMemo(() => {
    if (!modelsMap) return {};
    return buildFieldLabelsFromMap(modelsMap);
  }, [modelsMap]);

  return { fieldChoicesMap, fieldLabelsMap };
}
