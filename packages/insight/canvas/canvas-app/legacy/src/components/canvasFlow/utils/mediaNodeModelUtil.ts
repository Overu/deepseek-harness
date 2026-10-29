// [media-node-model-unification] 视频/图片节点模型参数解析、切换、识别（可整文件删除回滚）
import { isSvgImageUrl } from '@/utils';
import type { ModelItem, SelectParam } from './util';
import {
  buildModelOptionMeta,
  getChoiceFlag,
  getModelRow,
  isChoiceUsable,
  isModelPermissionEnforced,
  isModelSelectable,
  paramValueLookupKey,
  paramValuesEqual,
  type NormalizedModelPermission,
} from './modelPermission';
// TODO 临时导入，后续有结构调整时注意位置
import { AudioModelType } from '../customNode/audio/types';

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

interface Cascade {
  [key: string]: {
    [subKey: string]: Array<{
      value: any;
      label: string;
      isDefult?: boolean;
      isDefault?: boolean;
    }>;
  };
}

interface ParamItem {
  field: string;
  label: string;
  choices?: Array<{ value?: unknown; isDefult?: boolean; isDefault?: boolean }>;
  default: string;
  value?: string;
  params?: Array<ParamItem>;
  seniorParams?: Array<ParamItem>;
  cascade?: Cascade;
  setItems?: Array<ParamItem>;
}

type ModelConfigItem = ParamItem & { value?: string; seniorParams?: ParamItem[] };

interface TransformItem {
  key: string;
  value?: string;
  option: SelectParam['option'];
}

export interface TransformByModelResult {
  otherParams: SelectParam[];
  timeParam: SelectParam;
  cameraControlParam: {
    key: string;
    label: string;
    setItems: Array<SelectParam>;
  };
}

export type MediaNodeType = 'image' | 'video';

export interface MediaModelsMap {
  image?: Array<ModelTypeItem>;
  video?: Array<ModelTypeItem>;
}

/** 含 audio 的两级 modelType 协议（creareDefaultParamsV2 使用） */
export interface V2ModelsMap extends MediaModelsMap {
  audio?: Array<ModelTypeItem>;
}

export interface ModelTypeItem {
  value: string;
  label: string;
  params: MediaModelItem[];
}

export interface MediaModelItem extends ModelItem {
  description?: string;
  point?: string;
  seniorParams?: ParamItem[];
  /** 同系列模型跨模式对齐；非空且相同则属同一系列 */
  canonicalModelId?: string;
}

export type MediaModelCategory = 'C' | 'B' | 'A';

export interface MediaModelOptionMeta {
  hidden?: boolean;
  disabled?: boolean;
  modeUnsupported?: boolean;
}

export type MediaModelOptionMetaMap = Record<string, MediaModelOptionMeta>;

export const MEDIA_NODE_MODEL_MODE_UNSUPPORTED_TIP = '该模式下当前模型不可用';
export const MEDIA_NODE_UNAVAILABLE_PARAMS_TIP = '存在不可用参数';
export const MEDIA_NODE_UNSELECTED_PARAMS_TIP = '存在未选参数';

export interface MediaNodeParamState {
  modelParam: MediaModelItem[];
  modelOptionMeta: MediaModelOptionMetaMap;
  otherParams: SelectParam[];
  timeParam: SelectParam;
  cameraControlParam: TransformByModelResult['cameraControlParam'];
  isModeSupported: boolean;
}

// ---------------------------------------------------------------------------
// 权限默认值辅助（creareDefaultParamsV2 专用）
// ---------------------------------------------------------------------------

const pickChoiceValue = (choices: any[], predicate?: (choice: any) => boolean) => {
  if (!Array.isArray(choices) || choices.length === 0) return undefined;
  if (!predicate) return choices[0]?.value;
  for (const c of choices) {
    if (predicate(c)) return c?.value;
  }
  return undefined;
};

const pickDefaultChoiceValue = (choices: any[]) => pickChoiceValue(choices, c => Boolean(c && (c.isDefult || c.isDefault))) ?? pickChoiceValue(choices);

const pickFirstVisibleChoiceValue = (args: {
  choices: any[];
  permActive: boolean;
  permRow: any;
  perm: NormalizedModelPermission | null;
  type: string;
  modelKey: string;
  field: string;
}) => {
  const { choices, permActive, permRow, perm, type, modelKey, field } = args;
  if (!permActive) return undefined;
  if (!permRow?.custom_parameters?.[field]) return undefined;
  return pickChoiceValue(choices, c => {
    const fl = getChoiceFlag(perm, type, modelKey, field, c?.value);
    return Boolean(fl?.visible);
  });
};

const resolveDefaultValueWithPermission = (args: {
  param: any;
  defaultValue: any;
  permActive: boolean;
  permRow: any;
  perm: NormalizedModelPermission | null;
  type: string;
  modelKey: string;
  pickFirstVisibleChoice: (choices: any[], field: string) => any;
}) => {
  const { param, permActive, permRow, perm, type, modelKey, pickFirstVisibleChoice } = args;
  let defaultValue = args.defaultValue;

  if (defaultValue === undefined && param?.choices?.length) {
    const fallbackDefaultValue = pickDefaultChoiceValue(param.choices);
    if (fallbackDefaultValue !== undefined) defaultValue = fallbackDefaultValue;
  }
  if (param?.choices?.length && permActive && permRow?.custom_parameters?.[param.field]) {
    const flag = getChoiceFlag(perm, type, modelKey, param.field, defaultValue);
    if (!flag.visible) {
      const firstVisibleValue = pickFirstVisibleChoice(param.choices, param.field);
      if (firstVisibleValue !== undefined) defaultValue = firstVisibleValue;
    }
  }
  return defaultValue;
};

// ---------------------------------------------------------------------------
// 模型参数解析
// ---------------------------------------------------------------------------

/** 根据模型参数转化参数选项 */
export function transformByModel(models: ModelItem[], originParams: Record<string, any>, modelValue?: string): TransformByModelResult {
  const otherParams: SelectParam[] = [];
  let timeParam: SelectParam = { key: '', label: '', option: [] };
  let cameraControlParam: TransformByModelResult['cameraControlParam'] = { key: '', label: '', setItems: [] };
  let params: any;
  const model = modelValue || originParams.model;

  if (model) {
    models.forEach(item => {
      if (item.value == model) {
        params = item.params;
      }
    });
  } else if (models.length) {
    params = models[0].params;
  }

  if (params) {
    params.forEach((param: any) => {
      if (param.field == 'gen_count') {
        timeParam = { key: param.field, label: param.label, option: param.choices };
      } else if (param.field == 'cameraControl') {
        cameraControlParam = {
          key: param.field,
          label: param.label,
          setItems: param.setItems.map((setItem: any) => ({
            key: setItem.field,
            label: setItem.label,
            option: setItem.choices,
          })),
        };
      } else {
        otherParams.push({
          key: param.field,
          label: param.label,
          option: param.choices,
          cascade: param.cascade,
          type: param.type,
        });
      }
    });

    applyCascadeToOtherParams(otherParams, originParams);
  }

  return { otherParams, timeParam, cameraControlParam };
}

const applyCascadeToOtherParams = (otherParams: SelectParam[], originParams: Record<string, any>) => {
  const transformItems: Array<{ key: string; option: SelectParam['option'] }> = [];
  otherParams.forEach(item => {
    if (!item.cascade) return;
    const value = originParams[item.key];
    for (const paramValue in item.cascade) {
      if (paramValue == value) {
        const paramCascade = item.cascade[paramValue];
        for (const otherParamKey in paramCascade) {
          transformItems.push({
            key: otherParamKey,
            option: paramCascade[otherParamKey] as SelectParam['option'],
          });
        }
      }
    }
  });
  transformItems.forEach(item => {
    otherParams.forEach(selectParam => {
      if (selectParam.key == item.key) {
        selectParam.option = item.option;
      }
    });
  });
};

/** [media-node-model-unification] 当前模式选择型参数是否未选（空值且有可选项） */
export function isMediaParamValueUnselected(value: unknown, options: SelectParam['option'] | undefined): boolean {
  const hasOptions = Boolean(options?.length);
  const isEmpty = value === undefined || value === null || value === '';
  return isEmpty && hasOptions;
}

/** [media-node-model-unification] 当前模式选择型参数值是否不可用（空值且有可选项 / 有值但无法映射） */
export function isMediaParamValueUnavailable(value: unknown, options: SelectParam['option'] | undefined): boolean {
  if (isMediaParamValueUnselected(value, options)) return true;
  const hasOptions = Boolean(options?.length);
  if (!hasOptions) return true;
  return !options!.some(opt => paramValuesEqual(opt.value, value));
}

const resolveMediaParamBlockTipFromEntries = (entries: Array<{ value: unknown; options: SelectParam['option'] | undefined }>): string | undefined => {
  let hasUnselected = false;
  let hasInvalid = false;
  for (const { value, options } of entries) {
    if (isMediaParamValueUnselected(value, options)) {
      hasUnselected = true;
    } else if (isMediaParamValueUnavailable(value, options)) {
      hasInvalid = true;
    }
  }
  if (hasUnselected) return MEDIA_NODE_UNSELECTED_PARAMS_TIP;
  if (hasInvalid) return MEDIA_NODE_UNAVAILABLE_PARAMS_TIP;
  return undefined;
};

/** 联合参数摘要/生成按钮：未选参数优先提示「存在未选参数」，否则提示「存在不可用参数」 */
export function getMediaNodeUnavailableParamsTip(isModeSupported: boolean, otherParams: SelectParam[], originParams: Record<string, any>): string | undefined {
  if (!isModeSupported) return undefined;
  return resolveMediaParamBlockTipFromEntries(otherParams.map(param => ({ value: originParams[param.key], options: param.option })));
}

/** 创建默认参数（image/video/audio 两级 modelType → model） */
export function creareDefaultParamsV2(modelsMap: V2ModelsMap, type: string, modelType?: string, modelValue?: string, modelNodePermission?: NormalizedModelPermission | null) {
  const modals = modelsMap[type as keyof V2ModelsMap];
  if (!modals || !modals.length || !modals[0].params.length) {
    return {
      modelType: '',
      model: '',
      gen_count: 1,
      prompt: '',
      seniorParams: {},
    };
  }
  let modal: ModelTypeItem;
  let modelArray: ModelTypeItem['params'];
  let model: ModelTypeItem['params'][number];

  if (!modelType && !modelValue) {
    const perm = modelNodePermission;
    const permActive = Boolean(perm && perm.byCategoryAndKey.size > 0);
    let pickedModal: ModelTypeItem | undefined;
    let pickedModel: ModelTypeItem['params'][number] | undefined;
    outer: for (const m of modals) {
      for (const item of m.params || []) {
        if (item?.value === undefined || item?.value === null) continue;
        if (!permActive) {
          pickedModal = m;
          pickedModel = item;
          break outer;
        }
        if (isModelSelectable(perm ?? null, type, String(item.value))) {
          pickedModal = m;
          pickedModel = item;
          break outer;
        }
      }
    }
    if (!pickedModal || pickedModel === undefined) {
      return {
        modelType: '',
        model: '',
        gen_count: 1,
        prompt: '',
        seniorParams: {},
      };
    }
    modal = pickedModal;
    modelArray = pickedModal.params;
    model = pickedModel;
  } else {
    modal = modals[0];
    modelArray = modals[0].params;
    model = modals[0].params[0];
    if (modelType) {
      modals.forEach(item => {
        if (item.value === modelType) {
          modal = item;
          modelArray = item.params;
          model = item.params[0];
        }
      });
    }
    if (modelValue) {
      modelArray.forEach(item => {
        if (item.value === modelValue) {
          model = item;
        }
      });
    }
  }
  if (modelNodePermission != null && !modelValue && isModelPermissionEnforced(modelNodePermission)) {
    model = modelArray.find(item => isModelSelectable(modelNodePermission, type, String(item.value))) ?? model;
  }
  const seniorParams: any = model.seniorParams;
  const params: any = model.params;
  const perm = modelNodePermission ?? null;
  const permActive = isModelPermissionEnforced(perm);
  const modelKey = String(model.value);
  const permRow = permActive ? getModelRow(perm, type, modelKey) : undefined;

  const pickFirstVisibleChoice = (choices: any[], field: string): any => pickFirstVisibleChoiceValue({ choices, permActive, permRow, perm, type, modelKey, field });

  const defaultParams: any = {
    modelType: modal.value,
    model: model.value,
    gen_count: 1,
    prompt: '',
    seniorParams: {},
  };
  params.forEach((param: any) => {
    if (param.setItems) {
      defaultParams[param.field] = {};
      param.setItems.forEach((setItem: any) => {
        defaultParams[param.field][setItem.field] = setItem.default;
      });
    } else {
      const defaultValue = resolveDefaultValueWithPermission({
        param,
        defaultValue: param.default,
        permActive,
        permRow,
        perm,
        type,
        modelKey,
        pickFirstVisibleChoice,
      });
      defaultParams[param.field] = defaultValue;
    }
  });
  seniorParams?.forEach((param: any) => {
    if (param) {
      defaultParams.seniorParams[param.field] = param.default;
    }
  });
  return defaultParams;
}

/** 根据模型/生成数量以外的参数转化级联选项 */
export function getTransformItems(otherParams: SelectParam[], key: string, value: string | number | boolean) {
  let matchParam: SelectParam | undefined;
  const transformItems: TransformItem[] = [];
  otherParams.forEach(item => {
    if (item.key == key) {
      matchParam = item;
    }
  });
  if (matchParam && matchParam.cascade) {
    for (const paramValue in matchParam.cascade) {
      if (paramValue == value) {
        const paramCascade = matchParam.cascade[paramValue];
        for (const otherParamKey in paramCascade) {
          const transformItem: TransformItem = {
            key: otherParamKey,
            option: paramCascade[otherParamKey] as SelectParam['option'],
            value: paramCascade[otherParamKey][0].value,
          };
          transformItem.option.forEach(item => {
            if ((item as { isDefult?: boolean }).isDefult || item.isDefault) {
              transformItem.value = item.value;
            }
          });
          transformItems.push(transformItem);
        }
      }
    }
  }
  return transformItems;
}

// ---------------------------------------------------------------------------
// modelType 推导与连线识别
// ---------------------------------------------------------------------------

/** 根据连入图片/视频/音频数量推导视频 modelType（旧协议兼容） */
export function transformVideoType(imageLength: number, hasVideoOrAudioInput = false) {
  if (hasVideoOrAudioInput) return 'reference_image_to_video';
  if (imageLength === 0) return 'text_to_video';
  if (imageLength === 1) return 'image_to_video';
  if (imageLength === 2) return 'first_last_frame_to_video';
  return 'reference_image_to_video';
}

/** 连线变化时推导视频 modelType */
export function resolveVideoModelTypeOnInputChange(imageLength: number, videoLength: number, audioLength: number) {
  const hasAnyMediaInput = imageLength > 0 || videoLength > 0 || audioLength > 0;
  return hasAnyMediaInput ? 'reference_image_to_video' : 'text_to_video';
}

/** 根据连入图片数量推导图片 modelType */
export function transformImageType(imageLength: number) {
  return imageLength > 0 ? 'reference_image_to_image' : 'text_to_image';
}

const VIDEO_MODEL_TYPE_MISMATCH_TIP_MAP: Record<string, string> = {
  text_to_video: '仅支持文本输入',
  image_to_video: '仅支持连入1张图像',
  first_last_frame_to_video: '仅支持连入2张图像',
  reference_image_to_video: '需要连入图像',
};

const IMAGE_MODEL_TYPE_MISMATCH_TIP_MAP: Record<string, string> = {
  text_to_image: '仅支持文本输入',
  reference_image_to_image: '需要连入图像',
};

export function getVideoModelTypeMismatchReason(modelType: string, imageLength: number, hasVideoOrAudioInput = false) {
  if (modelType === 'text_to_video' && (imageLength > 0 || hasVideoOrAudioInput)) {
    return VIDEO_MODEL_TYPE_MISMATCH_TIP_MAP.text_to_video;
  }
  if (modelType === 'image_to_video' && (imageLength !== 1 || hasVideoOrAudioInput)) {
    return VIDEO_MODEL_TYPE_MISMATCH_TIP_MAP.image_to_video;
  }
  if (modelType === 'first_last_frame_to_video' && (imageLength !== 2 || hasVideoOrAudioInput)) {
    return VIDEO_MODEL_TYPE_MISMATCH_TIP_MAP.first_last_frame_to_video;
  }
  if (modelType === 'reference_image_to_video' && imageLength <= 0 && !hasVideoOrAudioInput) {
    return VIDEO_MODEL_TYPE_MISMATCH_TIP_MAP.reference_image_to_video;
  }
  return undefined;
}

export function getImageModelTypeMismatchReason(modelType: string, imageLength: number) {
  if (modelType === 'text_to_image' && imageLength > 0) return IMAGE_MODEL_TYPE_MISMATCH_TIP_MAP.text_to_image;
  if (modelType === 'reference_image_to_image' && imageLength <= 0) return IMAGE_MODEL_TYPE_MISMATCH_TIP_MAP.reference_image_to_image;
  return undefined;
}

/** 支持连入 SVG 的图片模型白名单 */
const SVG_UNSUPPORTED_MODEL_WHITELIST = new Set(['recraftv4_1_pro_vector-t2i', 'recraftv4_1_pro_vector-i2i']);
export const IMAGE_SVG_UNSUPPORTED_TIP = '模型不支持svg格式';

/** 非白名单模型连入 SVG 时的生成按钮提示 */
export function getImageSvgUnsupportedReason(model: string, imageUrls: Array<{ value?: string } | string>): string | undefined {
  if (SVG_UNSUPPORTED_MODEL_WHITELIST.has(String(model || ''))) return undefined;
  const hasSvg = imageUrls.some(item => {
    const url = typeof item === 'string' ? item : String(item?.value || '');
    return isSvgImageUrl(url);
  });
  return hasSvg ? IMAGE_SVG_UNSUPPORTED_TIP : undefined;
}

const AUDIO_MODEL_TYPE_MISMATCH_TIP_MAP: Record<string, string> = {
  text: '仅支持文本输入',
  music_cover: '需要且仅支持连入1个音频',
};

/** 当前连线不满足音频 modelType 时返回生成按钮提示文案，否则 undefined */
export const getAudioModelTypeMismatchReason = (modelType: string, nonTextInputLength: number, audioInputLength: number) => {
  if (modelType !== AudioModelType.MUSIC_COVER && nonTextInputLength > 0) return AUDIO_MODEL_TYPE_MISMATCH_TIP_MAP.text;
  if (modelType === AudioModelType.MUSIC_COVER && (nonTextInputLength !== 1 || audioInputLength !== 1)) return AUDIO_MODEL_TYPE_MISMATCH_TIP_MAP.music_cover;
  return undefined;
};

// ---------------------------------------------------------------------------
// 跨模式模型合集（新交互）
// ---------------------------------------------------------------------------

export function findModelConfig(modelsMap: V2ModelsMap, type: string, modelType: string, modelKey: string): ModelConfigItem | undefined {
  const modals = modelsMap[type as keyof V2ModelsMap];
  if (!modals?.length) return undefined;
  const modal = modals.find(item => item.value === modelType);
  if (!modal?.params?.length) return undefined;
  return modal.params.find(item => item.value === modelKey) as ModelConfigItem | undefined;
}

export function isModelInModelType(modelsMap: MediaModelsMap, type: MediaNodeType, modelType: string, modelKey: string): boolean {
  if (!modelKey || !modelType) return false;
  return Boolean(findModelConfig(modelsMap, type, modelType, modelKey));
}

export function findModelConfigInAnyMode(modelsMap: MediaModelsMap, type: MediaNodeType, modelKey: string): { modelType: string; modelItem: MediaModelItem } | undefined {
  if (!modelKey) return undefined;
  const modelTypes = modelsMap[type];
  if (!modelTypes?.length) return undefined;
  for (const mode of modelTypes) {
    const found = mode.params?.find(item => item.value === modelKey);
    if (found) return { modelType: mode.value, modelItem: found };
  }
  return undefined;
}

/** canonicalId → (modelType → modelValue) */
export type CanonicalSeriesIndex = Map<string, Map<string, string>>;

export function buildCanonicalSeriesIndex(modelsMap: MediaModelsMap, type: MediaNodeType): CanonicalSeriesIndex {
  const index: CanonicalSeriesIndex = new Map();
  const modelTypes = modelsMap[type];
  if (!modelTypes?.length) return index;

  for (const mode of modelTypes) {
    const modelType = String(mode.value ?? '');
    if (!modelType) continue;
    for (const model of mode.params || []) {
      const canonicalId = model.canonicalModelId ? String(model.canonicalModelId) : '';
      const modelValue = String(model.value ?? '');
      if (!canonicalId || !modelValue) continue;
      let byMode = index.get(canonicalId);
      if (!byMode) {
        byMode = new Map();
        index.set(canonicalId, byMode);
      }
      if (!byMode.has(modelType)) {
        byMode.set(modelType, modelValue);
      }
    }
  }
  return index;
}

export function findCanonicalIdByModel(modelsMap: MediaModelsMap, type: MediaNodeType, modelValue: string): string | undefined {
  if (!modelValue) return undefined;
  const modelTypes = modelsMap[type];
  if (!modelTypes?.length) return undefined;
  for (const mode of modelTypes) {
    const found = mode.params?.find(item => String(item.value ?? '') === modelValue);
    if (found?.canonicalModelId) return String(found.canonicalModelId);
  }
  return undefined;
}

/** 当前模型若属系列且目标模式有成员，返回该模式的 model value */
export function resolveSeriesModelForMode(modelsMap: MediaModelsMap, type: MediaNodeType, currentModel: string, targetModelType: string): string | undefined {
  const modelKey = String(currentModel || '');
  const targetType = String(targetModelType || '');
  if (!modelKey || !targetType) return undefined;
  const canonicalId = findCanonicalIdByModel(modelsMap, type, modelKey);
  if (!canonicalId) return undefined;
  const seriesIndex = buildCanonicalSeriesIndex(modelsMap, type);
  return seriesIndex.get(canonicalId)?.get(targetType);
}

/** 切 modelType：有同系列目标则同步改 model，其余参数保留 */
export function applyMediaModelTypeChange(modelsMap: MediaModelsMap, type: MediaNodeType, newModelType: string, originParams: Record<string, any>): Record<string, any> {
  const nextModelType = String(newModelType || '');
  const currentModel = String(originParams.model || '');
  const counterpart = resolveSeriesModelForMode(modelsMap, type, currentModel, nextModelType);
  if (counterpart) {
    return { ...originParams, modelType: nextModelType, model: counterpart };
  }
  return { ...originParams, modelType: nextModelType };
}

export function classifyMediaModel(
  modelsMap: MediaModelsMap,
  type: MediaNodeType,
  currentModelType: string,
  modelKey: string,
  perm: NormalizedModelPermission | null
): MediaModelCategory {
  const selectable = isModelSelectable(perm, type, modelKey);
  if (!selectable) return 'A';
  if (isModelInModelType(modelsMap, type, currentModelType, modelKey)) return 'C';
  return 'B';
}

export function collectUnifiedModels(modelsMap: MediaModelsMap, type: MediaNodeType, currentModelType?: string, currentModel?: string): MediaModelItem[] {
  const modelTypes = modelsMap[type];
  if (!modelTypes?.length) return [];

  const byKey = new Map<string, MediaModelItem>();
  const orderKeys: string[] = [];
  const currentType = currentModelType ? String(currentModelType) : '';
  const preferredModel = currentModel ? String(currentModel) : '';

  // [media-node-model-unification] 有当前模式成员 → 只留该成员；缺成员 → 同系列折叠为 1 个 B（优先当前已选 model）
  const seriesWithCurrentModeMember = new Set<string>();
  if (currentType) {
    const currentMode = modelTypes.find(item => item.value === currentType);
    for (const model of currentMode?.params || []) {
      const canonicalId = model.canonicalModelId ? String(model.canonicalModelId) : '';
      if (canonicalId) seriesWithCurrentModeMember.add(canonicalId);
    }
  }

  /** 缺成员系列已保留的代表 key */
  const missingSeriesKept = new Map<string, string>();
  if (preferredModel && currentType) {
    const preferredCanonical = findCanonicalIdByModel(modelsMap, type, preferredModel);
    if (preferredCanonical && !seriesWithCurrentModeMember.has(preferredCanonical)) {
      const found = findModelConfigInAnyMode(modelsMap, type, preferredModel);
      if (found && String(found.modelType) !== currentType) {
        missingSeriesKept.set(preferredCanonical, preferredModel);
      }
    }
  }

  for (const mode of modelTypes) {
    const modeValue = String(mode.value ?? '');
    for (const model of mode.params || []) {
      const key = String(model.value ?? '');
      if (!key || byKey.has(key)) continue;
      const canonicalId = model.canonicalModelId ? String(model.canonicalModelId) : '';
      if (canonicalId && currentType && modeValue !== currentType) {
        if (seriesWithCurrentModeMember.has(canonicalId)) continue;
        const kept = missingSeriesKept.get(canonicalId);
        if (kept && kept !== key) continue;
        if (!kept) missingSeriesKept.set(canonicalId, key);
      }
      byKey.set(key, { ...model });
      orderKeys.push(key);
    }
  }

  if (currentType) {
    const currentMode = modelTypes.find(item => item.value === currentType);
    for (const model of currentMode?.params || []) {
      const key = String(model.value ?? '');
      const existing = byKey.get(key);
      if (!existing) continue;
      byKey.set(key, {
        ...existing,
        label: model.label ?? existing.label,
        description: model.description ?? existing.description,
        point: model.point ?? existing.point,
        canonicalModelId: model.canonicalModelId ?? existing.canonicalModelId,
      });
    }
  }

  return orderKeys.map(key => byKey.get(key)!).filter(Boolean);
}

export function sortModelsCBA(models: MediaModelItem[], classify: (modelKey: string) => MediaModelCategory): MediaModelItem[] {
  const order: Record<MediaModelCategory, number> = { C: 0, B: 1, A: 2 };
  return models
    .map((model, index) => ({
      model,
      index,
      category: classify(String(model.value ?? '')),
    }))
    .sort((a, b) => order[a.category] - order[b.category] || a.index - b.index)
    .map(item => item.model);
}

export function buildMediaModelOptionMeta(
  perm: NormalizedModelPermission | null,
  category: string,
  unifiedModels: MediaModelItem[],
  currentModelType: string,
  modelsMap: MediaModelsMap,
  type: MediaNodeType
): MediaModelOptionMetaMap {
  const modelValues = unifiedModels.map(m => m.value);
  const permMeta = buildModelOptionMeta(perm, category, modelValues);
  const meta: MediaModelOptionMetaMap = {};

  for (const model of unifiedModels) {
    const modelKey = String(model.value ?? '');
    const optionKey = paramValueLookupKey(model.value);
    const categoryType = classifyMediaModel(modelsMap, type, currentModelType, modelKey, perm);

    if (categoryType === 'B') {
      meta[optionKey] = {
        hidden: false,
        disabled: true,
        modeUnsupported: true,
      };
    } else {
      meta[optionKey] = { ...(permMeta[optionKey] ?? {}) };
    }
  }

  return meta;
}

export function isMediaNodeModelModeSupported(modelsMap: MediaModelsMap, type: MediaNodeType, modelType: string, modelKey: string): boolean {
  if (!modelKey) return true;
  return isModelInModelType(modelsMap, type, modelType, modelKey);
}

export function getMediaNodeModelModeUnsupportedTip(modelsMap: MediaModelsMap, type: MediaNodeType, modelType: string, modelKey: string): string | undefined {
  if (!modelKey || isMediaNodeModelModeSupported(modelsMap, type, modelType, modelKey)) return undefined;
  return MEDIA_NODE_MODEL_MODE_UNSUPPORTED_TIP;
}

export function buildMediaNodeParamState(
  modelsMap: MediaModelsMap,
  type: MediaNodeType,
  originParams: Record<string, any>,
  perm: NormalizedModelPermission | null,
  options?: { modelTypeOverride?: string; modelOverride?: string }
): MediaNodeParamState {
  const modelTypes = modelsMap[type] ?? [];
  const modelType = String(options?.modelTypeOverride ?? originParams.modelType ?? '');
  const currentModelKey = String(options?.modelOverride ?? originParams.model ?? '');

  const unifiedModels = collectUnifiedModels(modelsMap, type, modelType, currentModelKey);
  const classify = (modelKey: string) => classifyMediaModel(modelsMap, type, modelType, modelKey, perm);
  const modelParam = sortModelsCBA(unifiedModels, classify);
  const modelOptionMeta = buildMediaModelOptionMeta(perm, type, unifiedModels, modelType, modelsMap, type);

  const isModeSupported = !currentModelKey || isMediaNodeModelModeSupported(modelsMap, type, modelType, currentModelKey);

  let transformSource: MediaModelItem[] = [];
  const currentMode = modelTypes.find(item => item.value === modelType);
  if (currentMode?.params?.length) {
    transformSource = currentMode.params;
  }

  if (!isModeSupported && currentModelKey) {
    const fallback = findModelConfigInAnyMode(modelsMap, type, currentModelKey);
    if (fallback) {
      transformSource = [fallback.modelItem];
    }
  }

  const { otherParams, timeParam, cameraControlParam } = transformByModel(transformSource as ModelItem[], originParams, currentModelKey || undefined);

  return {
    modelParam,
    modelOptionMeta,
    otherParams,
    timeParam,
    cameraControlParam,
    isModeSupported,
  };
}

/** image/video 执行前校验：模型模式不支持 / 参数值不在可选项 */
export function validateMediaNodesForRun(nodes: Array<{ type?: string; data?: { params?: Record<string, unknown> } }>, modelsMap: MediaModelsMap): string | undefined {
  for (const node of nodes) {
    const nodeType = String(node.type || '');
    if (nodeType !== 'image' && nodeType !== 'video') continue;
    const params = node.data?.params as Record<string, any> | undefined;
    if (!params) continue;
    const modelKey = String(params.model || '');
    const modelType = String(params.modelType || '');
    if (!modelKey) continue;
    if (!isMediaNodeModelModeSupported(modelsMap, nodeType as MediaNodeType, modelType, modelKey)) {
      return MEDIA_NODE_MODEL_MODE_UNSUPPORTED_TIP;
    }
    const currentMode = modelsMap[nodeType as MediaNodeType]?.find(item => item.value === modelType);
    if (!currentMode?.params?.length) continue;
    const { otherParams } = transformByModel(currentMode.params as ModelItem[], params, modelKey);
    const blockTip = resolveMediaParamBlockTipFromEntries(otherParams.map(param => ({ value: params[param.key], options: param.option })));
    if (blockTip) {
      return blockTip;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// 切换 model：旧值在新模型可选项内则保留，否则回落默认/第一项
// ---------------------------------------------------------------------------

const COMPATIBLE_PARAM_EXCLUDED_FIELDS = new Set(['prompt', 'cameraControl', 'cameraMovement']);

const isValueInChoices = (choices: Array<{ value?: unknown }> | undefined, value: unknown): boolean => {
  if (!choices?.length || value === undefined || value === null) return false;
  return choices.some(c => c.value == value);
};

const isParamValueSupported = (
  perm: NormalizedModelPermission | null,
  type: string,
  modelKey: string,
  field: string,
  value: unknown,
  choices: Array<{ value?: unknown }> | undefined
): boolean => {
  if (value === undefined || value === null) return false;
  if (!isValueInChoices(choices, value)) return false;
  return isChoiceUsable(getChoiceFlag(perm, type, modelKey, field, value));
};

const collectCascadeChildFields = (params: ParamItem[]): Set<string> => {
  const childFields = new Set<string>();
  params.forEach(param => {
    if (!param.cascade) return;
    Object.values(param.cascade).forEach(childMap => {
      Object.keys(childMap).forEach(field => childFields.add(field));
    });
  });
  return childFields;
};

const getCascadeChildChoices = (params: ParamItem[], childField: string, resolvedParams: Record<string, unknown>): Array<{ value?: unknown }> | undefined => {
  for (const param of params) {
    if (!param.cascade) continue;
    const parentValue = resolvedParams[param.field];
    if (parentValue === undefined || parentValue === null) continue;
    const cascadeForParent = param.cascade[String(parentValue)] ?? param.cascade[parentValue as string];
    if (cascadeForParent?.[childField]) {
      return cascadeForParent[childField];
    }
  }
  return undefined;
};

const resolveCompatibleParamValue = (args: {
  originValue: unknown;
  defaultValue: unknown;
  choices: Array<{ value?: unknown }> | undefined;
  perm: NormalizedModelPermission | null;
  type: string;
  modelKey: string;
  field: string;
}): unknown => {
  const { originValue, defaultValue, choices, perm, type, modelKey, field } = args;
  if (isParamValueSupported(perm, type, modelKey, field, originValue, choices)) {
    return originValue;
  }
  return defaultValue;
};

const preserveSpecialMediaParams = (result: Record<string, any>, originParams: Record<string, any>, includeCamera = false): Record<string, any> => {
  result.prompt = originParams.prompt ?? '';
  if (includeCamera) {
    if (originParams.cameraControl) {
      result.cameraControl = originParams.cameraControl;
    }
    if (originParams.cameraMovement) {
      result.cameraMovement = originParams.cameraMovement;
    }
  }
  return result;
};

/** 按新模型协议合并：旧值在 choices 且权限可用则保留，否则用 defaults */
const mergeCompatibleParamsWithModelConfig = (
  defaults: Record<string, any>,
  originParams: Record<string, any>,
  modelConfig: ModelConfigItem,
  perm: NormalizedModelPermission | null,
  type: string,
  modelKey: string
): Record<string, any> => {
  const result = { ...defaults };
  const modelParams: ParamItem[] = modelConfig.params || [];
  const cascadeChildFields = collectCascadeChildFields(modelParams);

  modelParams.forEach(param => {
    const field = param.field;
    if (!field || COMPATIBLE_PARAM_EXCLUDED_FIELDS.has(field) || param.setItems) return;
    if (cascadeChildFields.has(field)) return;

    result[field] = resolveCompatibleParamValue({
      field,
      originValue: originParams[field],
      defaultValue: defaults[field],
      choices: param.choices,
      perm,
      type,
      modelKey,
    });
  });

  cascadeChildFields.forEach(field => {
    if (COMPATIBLE_PARAM_EXCLUDED_FIELDS.has(field)) return;
    const choices = getCascadeChildChoices(modelParams, field, result);
    result[field] = resolveCompatibleParamValue({
      field,
      originValue: originParams[field],
      defaultValue: defaults[field],
      choices,
      perm,
      type,
      modelKey,
    });
  });

  const seniorParamDefs: ParamItem[] = modelConfig.seniorParams || [];
  if (seniorParamDefs.length) {
    result.seniorParams = { ...(defaults.seniorParams || {}) };
    seniorParamDefs.forEach(param => {
      if (!param?.field) return;
      const originSenior = originParams.seniorParams?.[param.field];
      result.seniorParams[param.field] = resolveCompatibleParamValue({
        field: param.field,
        originValue: originSenior,
        defaultValue: defaults.seniorParams?.[param.field],
        choices: param.choices,
        perm,
        type,
        modelKey,
      });
    });
  }

  result.prompt = originParams.prompt ?? '';
  return result;
};

/** 切换 model：当前 modelType 不变，兼容保留旧参数 */
export function resolveParamsOnModelChange(
  modelsMap: V2ModelsMap,
  type: string,
  newModel: string,
  originParams: Record<string, any>,
  modelNodePermission?: NormalizedModelPermission | null
): Record<string, any> {
  const perm = modelNodePermission ?? null;
  const modelType = String(originParams.modelType || '');
  const modelKey = String(newModel || '');
  const defaults = creareDefaultParamsV2(modelsMap, type, modelType, modelKey, perm);
  const modelConfig = findModelConfig(modelsMap, type, modelType, modelKey);
  if (!modelConfig) {
    return preserveSpecialMediaParams(defaults, originParams, true);
  }
  return preserveSpecialMediaParams(mergeCompatibleParamsWithModelConfig(defaults, originParams, modelConfig, perm, type, modelKey), originParams, true);
}

// ---------------------------------------------------------------------------
// [legacy] 旧 modelType 切换交互（保留供回滚，当前 image/video 已不再调用）
// ---------------------------------------------------------------------------

const isModelSupportedInModelType = (modelsMap: V2ModelsMap, type: string, modelType: string, modelKey: string, perm: NormalizedModelPermission | null): boolean => {
  if (!modelKey) return false;
  if (!findModelConfig(modelsMap, type, modelType, modelKey)) return false;
  return isModelSelectable(perm, type, modelKey);
};

/**
 * @legacy 切换 modelType 时智能保留模型与参数（回滚旧交互时使用）
 */
export function resolveParamsOnModelTypeChange(
  modelsMap: V2ModelsMap,
  type: string,
  newModelType: string,
  originParams: Record<string, any>,
  modelNodePermission?: NormalizedModelPermission | null
): Record<string, any> {
  const perm = modelNodePermission ?? null;
  const currentModel = String(originParams.model || '');

  if (!isModelSupportedInModelType(modelsMap, type, newModelType, currentModel, perm)) {
    const defaults = creareDefaultParamsV2(modelsMap, type, newModelType, undefined, perm);
    defaults.prompt = originParams.prompt ?? '';
    return defaults;
  }

  const defaults = creareDefaultParamsV2(modelsMap, type, newModelType, currentModel, perm);
  const modelConfig = findModelConfig(modelsMap, type, newModelType, currentModel);
  if (!modelConfig) {
    defaults.prompt = originParams.prompt ?? '';
    return defaults;
  }

  return mergeCompatibleParamsWithModelConfig(defaults, originParams, modelConfig, perm, type, currentModel);
}

/**
 * @legacy 根据 modelType 转化模型列表与参数可选项（回滚旧 PromptModel 交互时使用）
 */
export function transformByModelType(models: ModelItem[], originParams: any, modelTypeValue?: string, modelValue?: string) {
  let modelParam: ModelItem[] = [];
  const modelType = modelTypeValue || originParams.modelType;
  let model = modelValue;
  if (modelType) {
    models.forEach(item => {
      if (item.value == modelType) {
        modelParam = item.params as ModelItem[];
      }
    });
  } else {
    modelParam = models[0].params as ModelItem[];
  }
  if (modelTypeValue) {
    const explicitModel = modelValue ?? originParams.model;
    const found = modelParam.find(item => item.value == explicitModel);
    model = found?.value ?? modelParam[0]?.value;
  }
  const { otherParams, timeParam } = transformByModel(modelParam, originParams, model);
  return {
    modelParam,
    otherParams,
    timeParam,
  };
}
