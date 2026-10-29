import { expect, it, vi } from 'vitest';
vi.mock('@/utils', () => ({ isSvgImageUrl: () => false }));
import { audioNode, audioState, musicNode } from './audio-fixture';
import { createAgentAudioDefaults, resolveAgentAudioConfiguration, validateAgentAudioParams } from '../src/agent-audio-policy';
import { canConfigureAgentGeneration, canRunAgentGeneration } from '../src/agent-generation-policy';
import { normalizeModelNodeSettings } from '../legacy/src/components/canvasFlow/utils/modelPermission';
import { readAgentModels } from '../src/agent-model-policy';
import { createAgentNode, describeAgentNode, getAgentGenerationCounts, validateAgentRunInputs } from '../src/agent-node-policy';
import { readAgentGraph } from '../src/agent-graph-read';

it('catalog exposes three audio modes and keeps TTS defaults and hints', async () => {
  const result = await readAgentModels(audioState(), { action: 'canvas.models.read', nodeType: 'audio' });
  expect(result.modes.map(mode => mode.value)).toEqual(['text_to_audio', 'tts', 'audio_to_audio']); expect(result.model).toBe('fixture-tts');
  expect(result.seniorParamHints).toContainEqual({ field: 'speed', editable: true, min: 0.5, max: 2, step: 0.1, default: 1 });
  expect(result.paramHints).toContainEqual({ field: 'gen_count', editable: true, choices: [1], default: 1 });
});
it('an empty earlier music mode does not hide the available TTS native defaults', () => {
  const state = audioState(); (state.modelsMap as any).audio[0].params = [];
  expect(createAgentAudioDefaults(state)).toMatchObject({ modelType: 'tts', model: 'fixture-tts', voiceId: 'voice-public', seniorParams: { speed: 1 } });
});
it('native audio defaults reset on model switch, preserve prompt and merge partial senior fields', () => {
  const state = audioState(), node = state.nodes[0];
  const first = resolveAgentAudioConfiguration(state, node, { voiceId: 'voice-my', seniorParams: { speed: 1.2 } });
  expect(first.data.params).toMatchObject({ voiceId: 'voice-my', prompt: '保留指令', seniorParams: { speed: 1.2, pitch: 0, emotion: 'auto' } });
  const switched = resolveAgentAudioConfiguration(state, { ...node, data: { ...node.data, params: first.data.params } }, { model: 'fixture-tts-2' });
  expect(switched.data.params).toMatchObject({ model: 'fixture-tts-2', voiceId: 'voice-public', prompt: '保留指令', seniorParams: { speed: 1 } });
  expect(node).toEqual(audioNode());
});
it('wrong modes, hidden models, unknown fields, out-of-range and off-step values reject without mutation', () => {
  const state = audioState(), node = state.nodes[0];
  for (const input of [{ modelType: 'invented' }, { model: 'fake' }, { seniorParams: { speed: 1.15 } }, { seniorParams: { speed: 2.1 } }, { seniorParams: { instrumental: true } }, { seniorParams: { emotion: 'invented' } }, { params: { gen_count: 2 } }]) {
    expect(() => resolveAgentAudioConfiguration(state, node, input)).toThrow();
  }
  state.modelNodePermission = normalizeModelNodeSettings([{ model_category: 'audio', model_key: 'fixture-tts', visible: 1, enabled: 0 }]);
  expect(() => validateAgentAudioParams(state, node)).toThrow(expect.objectContaining({ code: 'CONFIGURATION_ERROR' }));
});
it('graph eligibility, audio counts and full node configuration agree, including source-only exclusions', () => {
  const state = audioState(), node = state.nodes[0];
  expect(canConfigureAgentGeneration(node)).toBe(true); expect(canRunAgentGeneration(node)).toBe(true);
  expect(getAgentGenerationCounts(state, node)).toEqual({ images: 0, videos: 0, audios: 1 });
  expect(describeAgentNode(state, node)).toMatchObject({ seniorParams: { speed: 1, pitch: 0, emotion: 'auto' } });
  expect(readAgentGraph(state, { action: 'canvas.graph.read' }).nodes[0].canConfigureGeneration).toBe(true);
  const music = { ...node, data: { ...node.data, params: { ...(node.data.params as object), modelType: 'text_to_audio' } } };
  expect(canConfigureAgentGeneration(music)).toBe(true); expect(canRunAgentGeneration(music)).toBe(true);
  expect(getAgentGenerationCounts(state, music)).toBeNull(); // Model must also belong to the selected mode.
  for (const type of ['upload', 'tool']) expect(canConfigureAgentGeneration({ ...node, data: { ...node.data, type } })).toBe(false);
});

it.each(['text_to_audio', 'audio_to_audio'])('queries and configures %s with native music hints and resets incompatible fields', async modelType => {
  const state = audioState(), node = state.nodes[0];
  const catalog = await readAgentModels(state, { action: 'canvas.models.read', nodeType: 'audio', modelType });
  expect(catalog.modelType).toBe(modelType); expect(catalog.voiceSelection).toBeUndefined();
  expect(catalog.seniorParamHints).toContainEqual({ field: 'title', type: 'string', maxLength: 100, default: '', editable: true });
  expect(catalog.seniorParamHints).toContainEqual({ field: 'lyrics', type: 'string', maxLength: 500, default: '', editable: true });
  const patch = resolveAgentAudioConfiguration(state, node, { modelType, model: catalog.model!, params: { gen_count: 2 }, seniorParams: { title: '新歌', lyrics: '歌词', customMode: true, instrumental: false } });
  expect(patch.data.params).toMatchObject({ modelType, prompt: '保留指令', gen_count: 2, seniorParams: { title: '新歌', lyrics: '歌词', customMode: true, styleWeight: 0.5 } });
  expect(patch.data.params).not.toHaveProperty('voiceId'); expect(patch.data.params.seniorParams).not.toHaveProperty('speed');
  const configured = { ...node, data: { ...node.data, ...patch.data } };
  expect(getAgentGenerationCounts(state, configured)).toEqual({ images: 0, videos: 0, audios: 2 });
  expect(describeAgentNode(state, configured)).toMatchObject({ params: { modelType }, seniorParams: { title: '新歌', lyrics: '歌词' }, seniorParamHints: catalog.seniorParamHints });
  const tts = resolveAgentAudioConfiguration(state, configured, { modelType: 'tts' });
  expect(tts.data.params).toMatchObject({ modelType: 'tts', voiceId: 'voice-public', prompt: '保留指令' });
  expect(tts.data.params.seniorParams).not.toHaveProperty('lyrics');
});

it('creates music without TTS, skips empty modes and rejects unavailable model/mode pairs', () => {
  const state = audioState(); (state.modelsMap as any).audio[1].params = [];
  expect(createAgentNode(state, { type: 'audio' }).data.params).toMatchObject({ modelType: 'text_to_audio', model: 'fixture-music' });
  (state.modelsMap as any).audio[0].params = [];
  expect(createAgentAudioDefaults(state)).toMatchObject({ modelType: 'audio_to_audio', model: 'fixture-cover' });
  expect(() => createAgentAudioDefaults(state, 'fixture-cover', 'tts')).toThrow();
  expect(() => createAgentAudioDefaults(state, 'fixture-tts', 'audio_to_audio')).toThrow();
});

it('keeps model defaults bound to the selected mode when model values are shared', async () => {
  const state = audioState(), cover = (state.modelsMap as any).audio[2].params[0];
  cover.value = 'fixture-music'; cover.params[0].default = 2;
  const catalog = await readAgentModels(state, { action: 'canvas.models.read', nodeType: 'audio', modelType: 'audio_to_audio', model: 'fixture-music' });
  expect(catalog.paramHints).toContainEqual({ field: 'gen_count', editable: true, choices: [1, 2], default: 2 });
  expect(createAgentAudioDefaults(state, 'fixture-music', 'audio_to_audio')).toMatchObject({ modelType: 'audio_to_audio', gen_count: 2 });
});

it('music rejects incompatible fields, arbitrary reference URLs, text overflow and off-step values', () => {
  const node = musicNode(), state = audioState(node);
  for (const input of [{ voiceId: 'voice-public' }, { params: { audioWeight: 0.55 } }, { params: { audioWeight: 1.1 } }, { params: { uploadUrl: 'https://x.test/a.mp3' } }, { seniorParams: { uploadUrl: 'https://x.test/a.mp3' } }, { seniorParams: { title: 'x'.repeat(101) } }, { seniorParams: { lyrics: 'x'.repeat(501) } }, { seniorParams: { customMode: 'true' } }, { seniorParams: { styleWeight: null } }, { seniorParams: { speed: 1 } }]) {
    expect(() => resolveAgentAudioConfiguration(state, node, input)).toThrow();
  }
  const updated = resolveAgentAudioConfiguration(state, node, { seniorParams: { title: 'x'.repeat(100), lyrics: 'x'.repeat(500) } });
  expect(updated.data.params.seniorParams).toMatchObject({ title: 'x'.repeat(100), lyrics: 'x'.repeat(500) });
  state.modelNodePermission = normalizeModelNodeSettings([{ model_category: 'audio', model_key: 'fixture-music', visible: 1, enabled: 0 }]);
  expect(() => validateAgentAudioParams(state, node)).toThrow();
});

it('music reference requires exactly one ready audio, and text modes reject audio inputs', () => {
  const target = musicNode('audio_to_audio'), state = audioState(target);
  const source = { ...audioNode(), id: 'source', data: { type: 'upload', value: 'https://assets.example/reference.mp3' } };
  const edge = { id: 'reference', source: 'source', target: target.id, sourceHandle: 'audio_source', targetHandle: 'audio_target' };
  expect(() => validateAgentRunInputs(state, target)).toThrow('需要且仅支持连入1个音频');
  state.nodes.push(source); state.edges.push(edge);
  expect(() => validateAgentRunInputs(state, target)).not.toThrow();
  expect(() => validateAgentRunInputs(state, musicNode())).toThrow('仅支持文本输入');
  expect(() => validateAgentRunInputs(state, audioNode())).toThrow('仅支持文本输入');
  source.data.value = '';
  expect(() => validateAgentRunInputs(state, target)).toThrow('上游素材尚无可用产物');
  source.data.value = 'https://assets.example/reference.mp3';
  state.nodes.push({ ...source, id: 'second' }); state.edges.push({ ...edge, id: 'second-edge', source: 'second' });
  expect(() => validateAgentRunInputs(state, target)).toThrow('需要且仅支持连入1个音频');
});

it('custom music requires a title and non-instrumental lyrics before generation', () => {
  const node = musicNode(), state = audioState(node), params = node.data.params as any;
  Object.assign(params.seniorParams, { customMode: true, instrumental: false });
  expect(() => validateAgentRunInputs(state, node)).toThrow('请输入歌曲标题');
  params.seniorParams.title = '新歌';
  expect(() => validateAgentRunInputs(state, node)).toThrow('请输入歌词');
  params.seniorParams.lyrics = '歌词';
  expect(() => validateAgentRunInputs(state, node)).not.toThrow();
});
