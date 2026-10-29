export type VideoResolution = '720p' | '1080p';

type InputDurationTier = 'none' | 'within5' | 'within10' | 'within15' | 'above15';

type ResolutionPricing = Record<InputDurationTier, number>;

type VideoDurationPricingTable = Record<VideoResolution, ResolutionPricing>;

const SEEDANCE_2_PRICING: VideoDurationPricingTable = {
  '720p': { none: 53, within5: 73, within10: 112, within15: 152, above15: 152 },
  '1080p': { none: 116, within5: 157, within10: 243, within15: 328, above15: 328 },
};

const SEEDANCE_2_VIP_PRICING: VideoDurationPricingTable = {
  '720p': { none: 142, within5: 154, within10: 240, within15: 325, above15: 325 },
  '1080p': { none: 279, within5: 382, within10: 594, within15: 807, above15: 807 },
};

export const VIDEO_DURATION_PRICING_MODELS: Record<string, VideoDurationPricingTable> = {
  'seedance-2.0': SEEDANCE_2_PRICING,
  'seedance-2.0-vip-t2v': SEEDANCE_2_VIP_PRICING,
  'seedance-2.0-vip-i2v': SEEDANCE_2_VIP_PRICING,
  'seedance-2.0-vip-fl2v': SEEDANCE_2_VIP_PRICING,
  'seedance-2.0-vip-r2v': SEEDANCE_2_VIP_PRICING,
};

export function isVideoDurationPricingModel(modelId: string): boolean {
  return Boolean(modelId && modelId in VIDEO_DURATION_PRICING_MODELS);
}

export function normalizeVideoResolution(value: unknown): VideoResolution {
  const raw = String(value ?? '')
    .toLowerCase()
    .includes('1080');
  return raw ? '1080p' : '720p';
}

function resolveInputDurationTier(totalInputSec: number, hasVideoInput: boolean): InputDurationTier {
  if (!hasVideoInput) return 'none';
  if (totalInputSec <= 5) return 'within5';
  if (totalInputSec <= 10) return 'within10';
  if (totalInputSec <= 15) return 'within15';
  return 'above15';
}

export function calcVideoDurationBasedPoints(modelId: string, resolution: VideoResolution, outputDurationSec: number, totalInputSec: number, hasVideoInput: boolean): number {
  const outputSec = Number(outputDurationSec) || 0;
  if (!outputSec) return 0;
  const table = VIDEO_DURATION_PRICING_MODELS[modelId];
  if (!table) return 0;
  const tier = resolveInputDurationTier(totalInputSec, hasVideoInput);
  const unitPrice = table[resolution]?.[tier] ?? 0;
  return unitPrice * outputSec;
}
