export type MediaDimensionType = 'image' | 'video';

export type MediaDimensionStatus = 'pending' | 'valid' | 'failed';

export type MediaDimensionMode = 'auto' | 'manual';

export interface MediaDimensionMeta {
  sourceValue: string;
  status: MediaDimensionStatus;
  mode: MediaDimensionMode;
}

export interface IntrinsicMediaDimensions {
  width: number;
  height: number;
}

export interface MediaNodeMeasuredSize {
  width: number;
  height: number;
  measured: {
    width: number;
    height: number;
  };
}

export interface MediaDimensionPolicy {
  mediaType: MediaDimensionType;
  maxSize: number;
  preserveCurrentSizeWhenSameRatio: boolean;
  aspectRatioThreshold: number;
}

interface MediaDimensionNodeLike {
  type?: string;
  width?: number;
  height?: number;
  measured?: {
    width?: number;
    height?: number;
  };
  data: {
    value?: unknown;
    dimensionMeta?: unknown;
  };
}

const DEFAULT_MAX_SIZE = 400;
const PANORAMA_MAX_SIZE = 800;
const DEFAULT_ASPECT_RATIO_THRESHOLD = 0.05;

const IMAGE_NODE_TYPES = new Set([
  'image',
  'poseTool',
  'highDefinitionTool',
  'imageLayoutTool',
  'textRedrawTool',
  'imageEditorTool',
  'multiViewTool',
  'sizeAdaptTool',
  'imageInpaintTool',
  'panoramaTool',
]);

const VIDEO_NODE_TYPES = new Set(['video', 'highDefinitionVideoTool', 'videoClipTool', 'imageLipSyncTool']);

const isPositiveFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;

export const getMediaDimensionPolicy = (nodeType?: string): MediaDimensionPolicy | null => {
  if (!nodeType) return null;

  if (IMAGE_NODE_TYPES.has(nodeType)) {
    return {
      mediaType: 'image',
      maxSize: nodeType === 'panoramaTool' ? PANORAMA_MAX_SIZE : DEFAULT_MAX_SIZE,
      preserveCurrentSizeWhenSameRatio: true,
      aspectRatioThreshold: DEFAULT_ASPECT_RATIO_THRESHOLD,
    };
  }

  if (VIDEO_NODE_TYPES.has(nodeType)) {
    return {
      mediaType: 'video',
      maxSize: DEFAULT_MAX_SIZE,
      preserveCurrentSizeWhenSameRatio: true,
      aspectRatioThreshold: DEFAULT_ASPECT_RATIO_THRESHOLD,
    };
  }

  return null;
};

export const getMediaNodeValue = (node: MediaDimensionNodeLike): string => {
  return typeof node.data?.value === 'string' ? node.data.value : '';
};

export const getMediaDimensionMeta = (node: MediaDimensionNodeLike): MediaDimensionMeta | null => {
  const meta = node.data?.dimensionMeta;
  if (!meta || typeof meta !== 'object') return null;

  const candidate = meta as Partial<MediaDimensionMeta>;
  if (typeof candidate.sourceValue !== 'string') return null;
  if (candidate.status !== 'pending' && candidate.status !== 'valid' && candidate.status !== 'failed') return null;
  if (candidate.mode !== 'auto' && candidate.mode !== 'manual') return null;

  return candidate as MediaDimensionMeta;
};

export const getCompleteMediaNodeDimensions = (node: MediaDimensionNodeLike): MediaNodeMeasuredSize | null => {
  const measuredWidth = node.measured?.width;
  const measuredHeight = node.measured?.height;
  const hasMeasuredPair = isPositiveFiniteNumber(measuredWidth) && isPositiveFiniteNumber(measuredHeight);
  const hasExplicitPair = isPositiveFiniteNumber(node.width) && isPositiveFiniteNumber(node.height);
  if (!hasMeasuredPair && !hasExplicitPair) return null;

  // React Flow 渲染优先使用 measured，因此历史数据两组字段不一致时也以 measured 为准。
  const width = hasMeasuredPair ? measuredWidth : node.width;
  const height = hasMeasuredPair ? measuredHeight : node.height;
  if (!isPositiveFiniteNumber(width) || !isPositiveFiniteNumber(height)) return null;

  return {
    width,
    height,
    measured: {
      width,
      height,
    },
  };
};

export const hasTrustedMediaNodeDimensions = (node: MediaDimensionNodeLike, allowLegacy = true): boolean => {
  if (!getCompleteMediaNodeDimensions(node)) return false;

  const value = getMediaNodeValue(node);
  const meta = getMediaDimensionMeta(node);
  if (!meta) return allowLegacy;

  return Boolean(value && meta.status === 'valid' && meta.sourceValue === value);
};

export const calculateMediaNodeDimensions = (
  intrinsic: IntrinsicMediaDimensions,
  maxSize = DEFAULT_MAX_SIZE,
  currentDimensions?: MediaNodeMeasuredSize | null
): MediaNodeMeasuredSize | null => {
  if (currentDimensions && isPositiveFiniteNumber(currentDimensions.width) && isPositiveFiniteNumber(currentDimensions.height)) {
    return calculateAspectRatioNodeDimensions(`${intrinsic.width}:${intrinsic.height}`, currentDimensions.width, currentDimensions.height);
  }
  return calculateAspectRatioNodeDimensions(`${intrinsic.width}:${intrinsic.height}`, maxSize, maxSize);
};

export const calculateAspectRatioNodeDimensions = (aspectRatio: string, currentWidth: number, currentHeight: number): MediaNodeMeasuredSize | null => {
  const match = aspectRatio.trim().match(/^(\d+(?:\.\d+)?)\s*[:：/]\s*(\d+(?:\.\d+)?)$/);
  if (!match || !isPositiveFiniteNumber(currentWidth) || !isPositiveFiniteNumber(currentHeight)) return null;

  const ratioWidth = Number(match[1]);
  const ratioHeight = Number(match[2]);
  if (!isPositiveFiniteNumber(ratioWidth) || !isPositiveFiniteNumber(ratioHeight)) return null;

  const shortestSide = Math.min(currentWidth, currentHeight);
  const scale = shortestSide / Math.min(ratioWidth, ratioHeight);
  const width = Math.round(ratioWidth * scale);
  const height = Math.round(ratioHeight * scale);

  return {
    width,
    height,
    measured: {
      width,
      height,
    },
  };
};

export const shouldUpdateMediaNodeDimensions = (
  currentWidth: number,
  currentHeight: number,
  newWidth: number,
  newHeight: number,
  threshold = DEFAULT_ASPECT_RATIO_THRESHOLD
): boolean => {
  if (!isPositiveFiniteNumber(currentWidth) || !isPositiveFiniteNumber(currentHeight)) return true;
  if (!isPositiveFiniteNumber(newWidth) || !isPositiveFiniteNumber(newHeight)) return false;

  return Math.abs(currentWidth / currentHeight - newWidth / newHeight) >= threshold;
};

export const resolveMediaNodeDimensions = (
  intrinsic: IntrinsicMediaDimensions,
  policy: MediaDimensionPolicy,
  currentDimensions?: MediaNodeMeasuredSize | null,
  currentDimensionsTrusted = false
): MediaNodeMeasuredSize | null => {
  const calculated = calculateMediaNodeDimensions(intrinsic, policy.maxSize, currentDimensions);
  if (!calculated) return null;

  if (
    currentDimensions &&
    policy.preserveCurrentSizeWhenSameRatio &&
    currentDimensionsTrusted &&
    !shouldUpdateMediaNodeDimensions(currentDimensions.width, currentDimensions.height, calculated.width, calculated.height, policy.aspectRatioThreshold)
  ) {
    return {
      width: currentDimensions.width,
      height: currentDimensions.height,
      measured: {
        width: currentDimensions.width,
        height: currentDimensions.height,
      },
    };
  }

  return calculated;
};
