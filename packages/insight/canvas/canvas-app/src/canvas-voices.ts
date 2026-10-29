import type { Node } from '@xyflow/react';
import { CanvasAgentError, type CanvasOperation, type CanvasVoice } from '../../src/shared/canvas-agent-protocol';
import { fetchPublicToneList, fetchUserTonePage, fetchToneDetailByVoiceId } from '../legacy/src/api/tone';
import { getPagePayload, normalizePublicItem, normalizeUserItem, mapToneDetailToItem, type ToneListItem } from '../legacy/src/components/ToneLibrary/types';
import { createAgentAudioDefaults, getAgentAudioModel, type AgentAudioModel } from './agent-audio-policy';
import type { AgentNodeState } from './agent-node-policy';
import type { CanvasContext } from './canvas-context';

type VoicesQuery = Extract<CanvasOperation, { action: 'canvas.voices.read' }>;
type VoiceContext = Pick<CanvasContext, 'requestOptions'>;
function reject(message: string): never { throw new CanvasAgentError('CONFIGURATION_ERROR', message); }
const text = (value: unknown): value is string => typeof value === 'string' && !!value.trim() && value.length <= 200;

function describeVoice(item: ToneListItem, model: AgentAudioModel): CanvasVoice | null {
  if (!text(item.voiceId) || !text(item.name) || item.onSale === 0) return null;
  // Only compare metadata explicitly declared by both systems. Names and prefixes are not a platform mapping.
  if (model.platform && item.platform && model.platform !== item.platform || model.modelId && item.modelId && model.modelId !== item.modelId) return null;
  const declared = model.params.find(field => field.field === 'voiceId')?.choices?.some(choice => choice.value === item.voiceId);
  return { voiceId: item.voiceId, name: item.name, source: item.voiceType === 'PUBLIC_VOICE' ? 'public' : 'my',
    compatibility: declared ? 'model_declared' : 'not_declared',
    ...Object.fromEntries(['platform', 'modelId', 'language', 'gender'].flatMap(key => {
      const value = item[key as keyof ToneListItem]; return text(value) ? [[key, value]] : [];
    })) };
}

async function readDetail(context: VoiceContext, voiceId: string, signal?: AbortSignal) {
  try {
    const response = await fetchToneDetailByVoiceId({ voiceId }, { ...context.requestOptions(), signal, silentError: true, receiptMode: 'agent' });
    if (response.data?.voiceType !== 'PUBLIC_VOICE' && response.data?.voiceType !== 'USER_TONE') reject('音色详情未确认来源');
    const item = mapToneDetailToItem(response.data);
    if (!item || item.voiceId !== voiceId || item.voiceType !== response.data.voiceType) reject('音色不存在、无权访问或返回身份不符，请重新选择音色');
    return item;
  } catch (error) {
    // This is a read; even a network failure cannot imply a generation/save submission.
    throw Object.assign(error instanceof Error ? error : new Error('音色详情读取失败'), { requestPhase: 'not_sent' });
  }
}

export async function verifyAgentAudioVoice(context: VoiceContext, state: AgentNodeState, node: Node, signal?: AbortSignal): Promise<CanvasVoice | undefined> {
  const params = node.data.params as Record<string, unknown>, model = getAgentAudioModel(state, params);
  if (params.modelType !== 'tts') return undefined;
  if (!text(params.voiceId)) reject('请先选择有效音色');
  const voice = describeVoice(await readDetail(context, params.voiceId, signal), model);
  if (!voice) reject('音色已下架或与所选模型的明确平台/模型配置不匹配');
  return voice;
}

export async function readAgentVoices(context: VoiceContext, state: AgentNodeState, query: VoicesQuery, signal?: AbortSignal) {
  const model = getAgentAudioModel(state, createAgentAudioDefaults(state, query.model, 'tts'));
  const page = query.page ?? 1, limit = query.limit ?? 20, source = query.voiceSource ?? 'public';
  if (query.voiceId) {
    const voice = describeVoice(await readDetail(context, query.voiceId, signal), model);
    if (!voice || query.voiceSource && voice.source !== query.voiceSource) reject('指定音色不可用于当前查询，请重新选择');
    return { model: model.value, source: voice.source, page: 1, limit, total: 1, nextPage: null, voices: [voice] };
  }
  if (source === 'my' && (query.language !== undefined || query.gender !== undefined)) throw new CanvasAgentError('INVALID_ARGUMENT', '我的音色不支持语言或性别筛选');
  const options = { ...context.requestOptions(), signal, silentError: true, receiptMode: 'agent' as const };
  try {
    const response = source === 'public'
      ? await fetchPublicToneList({ page, size: limit, onSale: 1, name: query.name, language: query.language, gender: query.gender }, options)
      : await fetchUserTonePage({ page, size: limit, name: query.name }, options);
    const payload = getPagePayload(response.data);
    if (!Number.isSafeInteger(payload.total) || payload.total < 0) reject('音色分页总数无效');
    const voices = payload.list.slice(0, limit).flatMap(item => {
      const voice = describeVoice(source === 'public' ? normalizePublicItem(item) : normalizeUserItem(item), model);
      return voice ? [voice] : [];
    });
    return { model: model.value, source, page, limit, total: payload.total, nextPage: page * limit < payload.total ? page + 1 : null, voices };
  } catch (error) {
    throw Object.assign(error instanceof Error ? error : new Error('音色列表读取失败'), { requestPhase: 'not_sent' });
  }
}
