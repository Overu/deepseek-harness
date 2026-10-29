import setting from '@/components/canvasFlow/settings/setting';
import { getModelConfig as getLipSyncModelConfig } from '@/components/canvasFlow/customNode/tool/imageLipSync/imageLipSyncModels';
import { getModelConfig as getPoseTransferModelConfig } from '@/components/canvasFlow/customNode/tool/poseTransfer/poseTransferModels';
import type { SourceParamParsed } from '../types';

const { nodeTitleMap } = setting;

export interface ToolSourceParamFieldConfig {
  key: string;
  /** 从 params 取值时的 fallback key（如 modelId） */
  fallbackKey?: string;
  resolveLabel: (value: unknown, params: Record<string, unknown>) => string;
}

export interface ToolSourceParamRegistryEntry {
  extraFields?: ToolSourceParamFieldConfig[];
}

const DEFAULT_PARAM_KEYS = ['aspect_ratio', 'resolution'] as const;

const ASPECT_RATIO_LABEL_MAP: Record<string, string> = {
  custom: '自定义',
  original: '原比例',
  adaptive: '自适应',
};

function resolveDefaultParamLabel(key: string, value: unknown): string {
  const str = String(value);
  if (key === 'aspect_ratio') {
    return ASPECT_RATIO_LABEL_MAP[str] ?? str;
  }
  return str;
}

const TOOL_SOURCE_PARAM_REGISTRY: Record<string, ToolSourceParamRegistryEntry> = {
  imageLipSyncTool: {
    extraFields: [
      {
        key: 'model',
        fallbackKey: 'modelId',
        resolveLabel: value => getLipSyncModelConfig(String(value))?.label ?? String(value ?? ''),
      },
    ],
  },
  poseTransVideoTool: {
    extraFields: [
      {
        key: 'model',
        fallbackKey: 'modelId',
        resolveLabel: value => getPoseTransferModelConfig(String(value))?.label ?? String(value ?? ''),
      },
      {
        key: 'personReplacement',
        resolveLabel: value => (value === true ? '保留背景' : '不保留背景'),
      },
    ],
  },
};

export function isToolSourceParam(sourceParam: SourceParamParsed | null | undefined): boolean {
  return Boolean(sourceParam?.toolNodeKey);
}

export function resolveToolNodeName(sourceParam: SourceParamParsed | null | undefined): string | undefined {
  if (!sourceParam?.toolNodeKey) return undefined;
  if (sourceParam.toolNodeName) return sourceParam.toolNodeName;
  const fallback = nodeTitleMap[sourceParam.toolNodeKey as keyof typeof nodeTitleMap];
  return fallback || sourceParam.toolNodeKey;
}

function getParamValue(params: Record<string, unknown>, key: string, fallbackKey?: string): unknown {
  if (Object.prototype.hasOwnProperty.call(params, key)) {
    const value = params[key];
    // 布尔 false 是有效值；空字符串/null/undefined 仍走 fallback
    if (typeof value === 'boolean') return value;
    if (value != null && value !== '') return value;
  }
  if (fallbackKey && Object.prototype.hasOwnProperty.call(params, fallbackKey)) {
    return params[fallbackKey];
  }
  return undefined;
}

function hasParamKey(params: Record<string, unknown>, key: string, fallbackKey?: string): boolean {
  if (Object.prototype.hasOwnProperty.call(params, key)) return true;
  if (fallbackKey) return Object.prototype.hasOwnProperty.call(params, fallbackKey);
  return false;
}

function formatParamValue(value: unknown): string | null {
  if (value == null || value === '') return null;
  return String(value);
}

export function buildToolParamDisplayValues(toolNodeKey: string, params: Record<string, unknown> | undefined): string[] {
  if (!params) return [];

  const values: string[] = [];
  for (const key of DEFAULT_PARAM_KEYS) {
    const raw = params[key];
    const formatted = formatParamValue(raw);
    if (formatted) values.push(resolveDefaultParamLabel(key, raw));
  }

  const registry = TOOL_SOURCE_PARAM_REGISTRY[toolNodeKey];
  for (const field of registry?.extraFields ?? []) {
    // 字段不存在时不展示（如历史资产无 personReplacement）
    if (!hasParamKey(params, field.key, field.fallbackKey)) continue;
    const raw = getParamValue(params, field.key, field.fallbackKey);
    const formatted = formatParamValue(raw);
    // 布尔 false 也需要展示（如 personReplacement: false）
    if (formatted || typeof raw === 'boolean') {
      values.push(field.resolveLabel(raw, params));
    }
  }

  return values;
}

export function buildToolPromptTexts(params: Record<string, unknown> | undefined, inputTexts: string[] | undefined): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  const prompt = params?.prompt;
  if (typeof prompt === 'string' && prompt.trim()) {
    result.push(prompt);
    seen.add(prompt);
  }

  for (const text of inputTexts ?? []) {
    const str = typeof text === 'string' ? text : String(text ?? '');
    if (!str.trim() || seen.has(str)) continue;
    result.push(str);
    seen.add(str);
  }

  return result;
}
