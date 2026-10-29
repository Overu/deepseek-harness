import type { Node } from '@xyflow/react';
import type { AgentNodeState } from '../src/agent-node-policy';

const model = (value: string) => ({ value, label: value, params: [{ field: 'voiceId', type: 'choices', default: 'voice-public', choices: [{ value: 'voice-public', label: '测试音色' }] }], seniorParams: [
  { field: 'speed', label: '语速', type: 'number', min: 0.5, max: 2, step: 0.1, default: 1 },
  { field: 'pitch', label: '语调', type: 'number', min: -12, max: 12, step: 1, default: 0 },
  { field: 'emotion', label: '情绪', type: 'choices', default: 'auto', choices: [{ value: 'auto', label: '自动' }, { value: 'calm', label: '平静' }] },
] });
export const audioNode = (): Node => ({ id: 'audio', type: 'audio', position: { x: 0, y: 0 }, data: { title: '旁白', value: '', product: [], taskInfo: { status: 'success' }, params: {
  modelType: 'tts', model: 'fixture-tts', prompt: '保留指令', gen_count: 1, voiceId: 'voice-public', seniorParams: { speed: 1, pitch: 0, emotion: 'auto' },
} } });
export const musicModel = (value = 'fixture-music') => ({ value, label: value, params: [
  { field: 'gen_count', type: 'choices', default: 1, choices: [{ value: 1 }, { value: 2 }] },
  { field: 'audioWeight', type: 'number', min: 0, max: 1, step: 0.1, default: 0.5 },
], seniorParams: [
  { field: 'customMode', type: 'choices', default: false, choices: [{ value: false }, { value: true }] },
  { field: 'instrumental', type: 'choices', default: true, choices: [{ value: false }, { value: true }] },
  { field: 'styleWeight', type: 'number', min: 0, max: 1, step: 0.1, default: 0.5 },
] });
export const musicNode = (modelType = 'text_to_audio'): Node => ({ ...audioNode(), data: { ...audioNode().data, params: {
  modelType, model: modelType === 'audio_to_audio' ? 'fixture-cover' : 'fixture-music', prompt: '轻快的钢琴音乐', gen_count: 1, audioWeight: 0.5,
  seniorParams: { title: '', lyrics: '', customMode: false, instrumental: true, styleWeight: 0.5 },
} } });
export const audioState = (node = audioNode()): AgentNodeState => ({ nodes: [node], edges: [], modelNodePermission: null, modelsMap: {
  audio: [{ value: 'text_to_audio', label: '音乐', params: [musicModel()] }, { value: 'tts', label: '配音', params: [model('fixture-tts'), model('fixture-tts-2')] }, { value: 'audio_to_audio', label: '音乐参考', params: [musicModel('fixture-cover')] }],
} } as unknown as AgentNodeState);
