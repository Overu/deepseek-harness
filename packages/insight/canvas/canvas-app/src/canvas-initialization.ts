import { getFlowData, getModelParams, listModelNodeSetting, listToolNodeSetting, type CanvasRequestOptions, type CanvasVersionNumber } from '../legacy/src/api/workflow';
import util from '../legacy/src/components/canvasFlow/utils/util';
import { normalizeModelNodeSettings, normalizeToolNodeSettings } from '../legacy/src/components/canvasFlow/utils/modelPermission';
import { mergeDevToolAllowlist } from '../legacy/src/components/canvasFlow/utils/devToolAllowlist';
import type { Node, Edge } from '@xyflow/react';

const object = (value: unknown): value is Record<string, any> => typeof value === 'object' && value !== null && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
export const isTrustedCanvasVersion = (version: unknown): version is CanvasVersionNumber =>
  typeof version === 'string' ? version.trim().length > 0 && version.length <= 100
    : typeof version === 'number' && Number.isSafeInteger(version) && version >= 0;

export interface CanvasMetadata {
  name: string;
  temp: boolean;
  thumbnailUrl: string;
  templateId: string | number;
}
export interface NativeCanvasRow extends CanvasMetadata {
  data: string;
  taskStatus: string;
  versionNumber?: CanvasVersionNumber;
}

/** Validate before native init; an absent/broken graph is never an empty canvas. */
export async function loadNativeCanvas(canvasId: string, options?: CanvasRequestOptions): Promise<NativeCanvasRow> {
  const res: any = await getFlowData({ id: canvasId }, options);
  if (res?.code !== 'SUCCESS' || !object(res.data)) throw new Error('画布不存在或无访问权限');
  const row = res.data;
  const graph: unknown = typeof row.data === 'string' ? JSON.parse(row.data) : null;
  if (!object(graph) || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) throw new Error('画布图结构无效');
  const nodeIds = new Set<string>(); const edgeIds = new Set<string>();
  for (const node of graph.nodes as Node[]) {
    if (!object(node) || !id(node.id) || nodeIds.has(node.id) || !object(node.data)
      || !object(node.position) || !Number.isFinite(node.position.x) || !Number.isFinite(node.position.y)) throw new Error('画布节点结构无效');
    nodeIds.add(node.id);
  }
  for (const edge of graph.edges as Edge[]) {
    if (!object(edge) || !id(edge.id) || edgeIds.has(edge.id) || !id(edge.source) || !id(edge.target)) throw new Error('画布连线结构无效');
    edgeIds.add(edge.id);
  }
  return {
    data: row.data, taskStatus: typeof row.taskStatus === 'string' ? row.taskStatus : '',
    versionNumber: isTrustedCanvasVersion(row.versionNumber) ? row.versionNumber : undefined,
    name: typeof row.name === 'string' ? row.name : '', temp: row.temp === true,
    thumbnailUrl: typeof row.thumbnailUrl === 'string' ? row.thumbnailUrl : '',
    templateId: typeof row.templateId === 'string' || typeof row.templateId === 'number' ? row.templateId : 0,
  };
}

/** The UI and context use the same native transform/normalization rules. */
export async function loadNativeModels(options?: CanvasRequestOptions) {
  const res: any = await getModelParams(options);
  if (res?.code !== 'SUCCESS' || !Array.isArray(res.data) || typeof res.data[0]?.config !== 'string') throw new Error('获取模型参数失败');
  const config: unknown = JSON.parse(res.data[0].config);
  if (!object(config)) throw new Error('模型参数结构无效');
  return util.transformModelMapWithPromptLimit(config);
}

export async function loadNativeModelPermission(options?: CanvasRequestOptions) {
  const res: any = await listModelNodeSetting(options);
  if (res?.code !== 'SUCCESS' || !Array.isArray(res.data)) throw new Error('获取模型权限失败');
  return res.data.length ? normalizeModelNodeSettings(res.data) : null;
}

export async function loadNativeToolPermission(options?: CanvasRequestOptions) {
  const res: any = await listToolNodeSetting(options);
  if (res?.code !== 'SUCCESS' || !Array.isArray(res.data)) throw new Error('获取工具权限失败');
  return mergeDevToolAllowlist(normalizeToolNodeSettings(res.data));
}
