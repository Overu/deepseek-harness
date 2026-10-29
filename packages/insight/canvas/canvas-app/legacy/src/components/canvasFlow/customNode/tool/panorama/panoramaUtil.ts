export type PanoramaModelType = 'text_to_image' | 'image_editing';

export const PANORAMA_RESOLUTION_OPTIONS = [
  { value: '1K', label: '1K' },
  { value: '2K', label: '2K' },
  { value: '4K', label: '4K' },
];

export const PANORAMA_MODEL_TYPE_TABS = [
  { key: 'text_to_image', label: '文生全景图' },
  { key: 'image_editing', label: '图生全景图' },
];

export const PANORAMA_ASPECT_RATIOS = ['16:9', '9:16', '1:1', '2:1', '1:2', '3:4', '4:3', '21:9', '9:21'] as const;

export type PanoramaAspectRatio = (typeof PANORAMA_ASPECT_RATIOS)[number];

export const PANORAMA_DEFAULT_ASPECT_RATIO: PanoramaAspectRatio = '16:9';

export const getPanoramaAspectRatioLabel = (ratio: string) => (ratio === PANORAMA_DEFAULT_ASPECT_RATIO ? `${ratio}（默认）` : ratio);

/** 全景图节点有产物时，按图片比例缩放的较长边上限 */
export const PANORAMA_MAX_NODE_SIZE = 800;

/** 嵌入/全屏切换时保持的视角状态（与 OrbitControls 的 position/target 对齐） */
export type PanoramaViewState = {
  position: [number, number, number];
  target: [number, number, number];
  zoom: number;
};

export const transformPanoramaType = (imageLength: number): PanoramaModelType => (imageLength > 0 ? 'image_editing' : 'text_to_image');

const PANORAMA_MODEL_TYPE_MISMATCH_TIP_MAP: Record<PanoramaModelType, string> = {
  text_to_image: '文生全景图模式不支持连入图像',
  image_editing: '图生全景图模式需要连入1张图像',
};

export const getPanoramaModelTypeMismatchReason = (modelType: string, imageLength: number): string | undefined => {
  if (modelType === 'text_to_image' && imageLength > 0) return PANORAMA_MODEL_TYPE_MISMATCH_TIP_MAP.text_to_image;
  if (modelType === 'image_editing' && imageLength <= 0) return PANORAMA_MODEL_TYPE_MISMATCH_TIP_MAP.image_editing;
  return undefined;
};

export const parseAspectRatio = (ratio: string): { w: number; h: number } => {
  const [w, h] = ratio.split(':').map(Number);
  if (!w || !h) return { w: 1, h: 1 };
  return { w, h };
};

export interface FrameRect {
  width: number;
  height: number;
}

/** 截图框在容器内 fit：长/宽占满容器对应边，另一边按比例 */
export const computeFrameRect = (containerW: number, containerH: number, aspectRatio: string): FrameRect => {
  const { w: ratioW, h: ratioH } = parseAspectRatio(aspectRatio);
  const containerAspect = containerW / containerH;
  const targetAspect = ratioW / ratioH;

  if (containerAspect > targetAspect) {
    const height = containerH;
    return { width: height * targetAspect, height };
  }
  const width = containerW;
  return { width, height: width / targetAspect };
};

export const isFullFrameRect = (frame: FrameRect, containerW: number, containerH: number, epsilon = 2) =>
  Math.abs(frame.width - containerW) < epsilon && Math.abs(frame.height - containerH) < epsilon;

interface BuildPanoramaTaskParamsArgs {
  canvasId: string;
  nodeId: string;
  params: {
    modelType?: string;
    prompt?: string;
    resolution?: string;
  };
  imageUrlList: string[];
  textMap?: string[];
}

export const buildPanoramaPrompt = (prompt: string, textMap: string[] = []) => {
  const basePrompt = String(prompt ?? '').trim();
  const inputTexts = textMap.map(t => String(t ?? '').trim()).filter(Boolean);
  return [basePrompt, ...inputTexts].filter(Boolean).join('。');
};

export const buildPanoramaExternalTaskParams = ({ canvasId, nodeId, params, imageUrlList, textMap = [] }: BuildPanoramaTaskParamsArgs) => {
  const modelType = (params.modelType || 'text_to_image') as PanoramaModelType;
  return {
    type: 'PANORAMA',
    canvasId: String(canvasId || ''),
    nodeId: String(nodeId || ''),
    data: {
      type: modelType,
      prompt: buildPanoramaPrompt(String(params.prompt ?? ''), textMap),
      imageUrlList,
      imageParam: {
        resolution: params.resolution || '2K',
      },
    },
  };
};

/** 赛点仅与所选参数（mode / resolution）有关，与 prompt、输入图无关 */
export const buildPanoramaCostParams = ({ canvasId, nodeId, params }: Pick<BuildPanoramaTaskParamsArgs, 'canvasId' | 'nodeId' | 'params'>) => {
  if (!canvasId || !nodeId) return null;
  const modelType = params.modelType || 'text_to_image';
  return {
    type: 'PANORAMA',
    canvasId: String(canvasId),
    nodeId: String(nodeId),
    data: {
      type: modelType,
      imageUrlList: [] as string[],
      imageParam: {
        resolution: params.resolution || '2K',
      },
    },
  };
};
