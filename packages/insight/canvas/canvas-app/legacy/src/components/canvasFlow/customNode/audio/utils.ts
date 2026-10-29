import type { Model, ModelType } from './types';

export function transformModelParams(models: Model[] = [], modelValue?: string) {
  const model = models.find(item => item.value === modelValue) || models[0];
  return {
    params: model?.params ?? [],
    seniorParams: model?.seniorParams || [],
  };
}

export function findModelParams(models: ModelType[] = [], modelType: string): Model[] {
  return (models.find(item => item.value === modelType) || models[0])?.params || [];
}

export function appendStyle(prompt: string, value: string) {
  const trimmedPrompt = prompt.trimEnd();
  if (!trimmedPrompt) return value;
  return `${trimmedPrompt}, ${value}`;
}

export function getModelMaxPrompt(models: Model[] = [], modelValue?: string): number | undefined {
  const model = models.find(item => item.value === modelValue) || models[0];
  return model?.maxPrompt;
}
