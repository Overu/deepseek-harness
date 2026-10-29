import { uploadAssetToLibrary } from '@/api/upload';
import { useFlowStore } from '@/store/flowStore';
import setting from '../settings/setting';

export type CanvasAssetMediaType = 'image' | 'video' | 'audio';

/** 资产来源：0=上传，1=生成 */
export type CanvasAssetSource = 0 | 1;

export interface CanvasAssetSyncOptions {
  source?: CanvasAssetSource;
  toolNodeKey?: string;
  duration?: number;
}

const { nodeTitleMap } = setting;

const ASSET_TYPE_BY_MEDIA: Record<CanvasAssetMediaType, number> = {
  image: 1,
  video: 2,
  audio: 3,
};

function buildToolSourceParam(toolNodeKey: string): string {
  const toolNodeName = nodeTitleMap[toolNodeKey as keyof typeof nodeTitleMap] || toolNodeKey;
  return JSON.stringify({ toolNodeName, toolNodeKey });
}

/** 画布文件上传 OSS 成功后，fire-and-forget 登记到资产库；canvasId 从 flowStore 读取 */
export function syncCanvasUploadToAssetLibrary(
  fileUrl: string,
  nodeId: string,
  mediaType: CanvasAssetMediaType,
  sourceOrOptions: CanvasAssetSource | CanvasAssetSyncOptions = 0,
  legacyToolNodeKey?: string
): void {
  const options: CanvasAssetSyncOptions = typeof sourceOrOptions === 'number' ? { source: sourceOrOptions, toolNodeKey: legacyToolNodeKey } : sourceOrOptions;
  const { source = 0, toolNodeKey, duration } = options;
  const resolvedCanvasId = useFlowStore.getState().canvasId;
  if (!fileUrl || !nodeId || !resolvedCanvasId) return;

  const canvasIdNum = Number(resolvedCanvasId);
  if (!Number.isFinite(canvasIdNum) || canvasIdNum <= 0) return;

  const assetDuration = mediaType !== 'image' && Number.isInteger(duration) && Number(duration) > 0 ? duration : undefined;

  void uploadAssetToLibrary({
    assetType: ASSET_TYPE_BY_MEDIA[mediaType],
    fileUrl,
    canvasId: canvasIdNum,
    nodeId,
    source,
    sourceType: source === 1 ? 'workflow' : 'upload',
    ...(source === 1 && toolNodeKey ? { sourceParam: buildToolSourceParam(toolNodeKey) } : {}),
    ...(assetDuration !== undefined ? { duration: assetDuration } : {}),
  });
}
