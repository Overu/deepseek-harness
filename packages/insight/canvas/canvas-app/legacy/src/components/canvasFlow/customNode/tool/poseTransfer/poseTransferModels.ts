export interface ParamChoice {
  value: string;
  label: string;
}

export interface PoseTransferModelConfig {
  modelId: string;
  label: string;
  description: string;
  resolutionChoices: ParamChoice[];
  aspectRatioChoices: ParamChoice[];
  defaultResolution?: string;
  defaultAspectRatio: string;
  videoLengthLimit: { min: number; max: number };
}

const SEEDANCE_MODEL_ID = 'pose_trans_video/seedance-2.0';
const KLING_MODEL_ID = 'pose_trans_video/kling-v3';
const SCAIL_MODEL_ID = 'pose_trans_video/wan2.1-scail-2.0';

/** 支持「保留参考背景」选项入口的模型（参数仍可照常传递，仅控制 UI 显隐） */
const PERSON_REPLACEMENT_MODEL_IDS = new Set([SCAIL_MODEL_ID]);

const MODEL_DEFINITIONS: Record<string, Omit<PoseTransferModelConfig, 'modelId'>> = {
  [SEEDANCE_MODEL_ID]: {
    label: 'seedance2.0 vip',
    description: '最长支持15秒视频参考',
    resolutionChoices: [{ value: '720p', label: '720P' }],
    aspectRatioChoices: [
      { value: '16:9', label: '16:9' },
      { value: '4:3', label: '4:3' },
      { value: '1:1', label: '1:1' },
      { value: '3:4', label: '3:4' },
      { value: '9:16', label: '9:16' },
      { value: '21:9', label: '21:9' },
      { value: 'adaptive', label: '自适应' },
    ],
    defaultResolution: '720p',
    defaultAspectRatio: '16:9',
    videoLengthLimit: { min: 3, max: 15 },
  },
  [KLING_MODEL_ID]: {
    label: 'Kling v3',
    description: '最长支持30秒视频参考',
    resolutionChoices: [],
    aspectRatioChoices: [{ value: 'adaptive', label: '自适应' }],
    defaultAspectRatio: 'adaptive',
    videoLengthLimit: { min: 3, max: 30 },
  },
  [SCAIL_MODEL_ID]: {
    label: 'Scail2.0',
    description: '最长支持20秒视频参考',
    resolutionChoices: [{ value: '720p', label: '720P' }],
    aspectRatioChoices: [{ value: 'adaptive', label: '自适应' }],
    defaultResolution: '720p',
    defaultAspectRatio: 'adaptive',
    videoLengthLimit: { min: 3, max: 20 },
  },
};

export const MODEL_IDS = Object.keys(MODEL_DEFINITIONS);

export const modelHasResolution = (modelId: string): boolean => {
  const config = getModelConfig(modelId);
  return Boolean(config?.resolutionChoices.length);
};

export const modelSupportsPersonReplacement = (modelId: string): boolean => {
  return PERSON_REPLACEMENT_MODEL_IDS.has(modelId);
};

export const getModelConfig = (modelId: string): PoseTransferModelConfig | undefined => {
  const def = MODEL_DEFINITIONS[modelId];
  if (!def) return undefined;
  return { modelId, ...def };
};

export const getAllModels = (): PoseTransferModelConfig[] => {
  return MODEL_IDS.map(id => getModelConfig(id)).filter((m): m is PoseTransferModelConfig => Boolean(m));
};

export const getDefaultParamsForModel = (modelId: string) => {
  const config = getModelConfig(modelId);
  if (!config) {
    return { modelId, resolution: '720p', aspect_ratio: '16:9' };
  }
  if (modelHasResolution(config.modelId)) {
    return {
      modelId: config.modelId,
      resolution: config.defaultResolution || '720p',
      aspect_ratio: config.defaultAspectRatio,
    };
  }
  return {
    modelId: config.modelId,
    aspect_ratio: config.defaultAspectRatio,
    resolution: '',
  };
};

export const getDefaultModelId = (): string => MODEL_IDS[0] || SEEDANCE_MODEL_ID;
