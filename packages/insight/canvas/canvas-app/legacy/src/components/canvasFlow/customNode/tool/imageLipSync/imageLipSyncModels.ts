import type { LipSyncMode } from './types';

export interface ResolutionChoice {
  value: string;
  label: string;
}

export interface AudioLengthLimit {
  min: number;
  max: number;
}

export interface LipSyncModelConfig {
  modelId: string;
  label: string;
  description: string;
  maxPrompt: number;
  audioLengthLimit: Record<string, AudioLengthLimit>;
  resolutionChoices: ResolutionChoice[];
  defaultResolution: string;
}

const MODEL_DEFINITIONS: Record<string, Omit<LipSyncModelConfig, 'modelId'>> = {
  omni_v15: {
    label: '即梦',
    description: '最长支持60秒对口型',
    maxPrompt: 300,
    audioLengthLimit: {
      '720p': { min: 2, max: 60 },
      '1080p': { min: 2, max: 60 },
    },
    resolutionChoices: [
      { value: '720p', label: '720p' },
      { value: '1080p', label: '1080p' },
    ],
    defaultResolution: '720p',
  },
  'ltx-2.3-a2v': {
    label: 'LTX-2.3',
    description: '720p 最长支持30秒，1080p 最长支持20秒',
    maxPrompt: 300,
    audioLengthLimit: {
      '720p': { min: 3, max: 30 },
      '1080p': { min: 3, max: 20 },
    },
    resolutionChoices: [
      { value: '720p', label: '720p' },
      { value: '1080p', label: '1080p' },
    ],
    defaultResolution: '720p',
  },
  'viduq2-turbo-digital-human': {
    label: 'Vidu',
    description: '最长支持300秒对口型',
    maxPrompt: 2000,
    audioLengthLimit: {
      '720p': { min: 2, max: 300 },
      '1080p': { min: 2, max: 300 },
    },
    resolutionChoices: [
      { value: '720p', label: '720p' },
      { value: '1080p', label: '1080p' },
    ],
    defaultResolution: '720p',
  },
};

export const MODELS_BY_MODE: Record<LipSyncMode, string[]> = {
  single: ['omni_v15', 'ltx-2.3-a2v', 'viduq2-turbo-digital-human'],
  multiple: ['omni_v15'],
};

export const LIP_SYNC_MODE_OPTIONS: { value: LipSyncMode; label: string; description: string }[] = [
  { value: 'single', label: '单人模式', description: '仅支持单图单人主体对口型' },
  { value: 'multiple', label: '多人模式', description: '支持单图多人主体对口型' },
];

export const getModelConfig = (modelId: string): LipSyncModelConfig | undefined => {
  const def = MODEL_DEFINITIONS[modelId];
  if (!def) return undefined;
  return { modelId, ...def };
};

export const getModelsForMode = (mode: LipSyncMode): LipSyncModelConfig[] => {
  return MODELS_BY_MODE[mode].map(id => getModelConfig(id)).filter((m): m is LipSyncModelConfig => Boolean(m));
};

export const getDefaultParamsForMode = (mode: LipSyncMode) => {
  const models = getModelsForMode(mode);
  const first = models[0];
  if (!first) {
    return { mode, modelId: '', resolution: '720p' };
  }
  return {
    mode,
    modelId: first.modelId,
    resolution: first.defaultResolution,
  };
};

export const getDefaultParamsForModel = (modelId: string) => {
  const config = getModelConfig(modelId);
  if (!config) return { resolution: '720p' };
  return { resolution: config.defaultResolution };
};

export const getModeLabel = (mode: LipSyncMode) => LIP_SYNC_MODE_OPTIONS.find(o => o.value === mode)?.label || mode;

export const getResolutionLabel = (resolution: string) => resolution.toUpperCase();
