import { beforeEach, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ public: vi.fn(), my: vi.fn(), detail: vi.fn() }));
vi.mock('../legacy/src/api/tone', () => ({ fetchPublicToneList: api.public, fetchUserTonePage: api.my, fetchToneDetailByVoiceId: api.detail }));
import { readAgentVoices, verifyAgentAudioVoice } from '../src/canvas-voices';
import { audioNode, audioState, musicNode } from './audio-fixture';
import { normalizeModelNodeSettings } from '../legacy/src/components/canvasFlow/utils/modelPermission';
const context = { requestOptions: () => ({ onAuthExpired: vi.fn() }) };
beforeEach(() => {
  vi.clearAllMocks();
  api.public.mockResolvedValue({ data: { records: [{ voiceId: 'voice-public', name: '公共音色', platform: 'fixture', modelId: 'm' }], total: 21 } });
  api.my.mockResolvedValue({ data: { list: [{ voiceId: 'voice-my', name: '我的音色' }], total: 1 } });
  api.detail.mockResolvedValue({ data: { voiceType: 'PUBLIC_VOICE', publicVoice: { voiceId: 'voice-public', name: '公共音色', onSale: 1 } } });
});
it('uses native public/my paging, bounded results and safe metadata without media URLs', async () => {
  const signal = new AbortController().signal;
  const result = await readAgentVoices(context, audioState(), { action: 'canvas.voices.read', nodeType: 'audio', limit: 20, language: 'Chinese' }, signal);
  expect(result).toMatchObject({ model: 'fixture-tts', nextPage: 2, total: 21, voices: [{ voiceId: 'voice-public', compatibility: 'model_declared', platform: 'fixture', modelId: 'm' }] });
  expect(api.public).toHaveBeenCalledWith(expect.objectContaining({ size: 20, language: 'Chinese', onSale: 1 }), expect.objectContaining({ signal, receiptMode: 'agent', silentError: true }));
  expect(await readAgentVoices(context, audioState(), { action: 'canvas.voices.read', nodeType: 'audio', voiceSource: 'my' })).toMatchObject({ source: 'my', nextPage: null, voices: [{ compatibility: 'not_declared' }] });
  await expect(readAgentVoices(context, audioState(), { action: 'canvas.voices.read', nodeType: 'audio', voiceSource: 'my', language: 'Chinese' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
});
it('allows an accessible existing personal voice absent from static choices; customization permission is unrelated', async () => {
  const node = audioNode(); (node.data.params as any).voiceId = 'voice-my';
  const state = audioState(node);
  state.modelNodePermission = normalizeModelNodeSettings([{ model_category: 'audio', model_key: 'fixture-tts', visible: 1, enabled: 1, voice_customizable: 0 }]);
  api.detail.mockResolvedValue({ data: { voiceType: 'USER_TONE', personalVoice: { voiceId: 'voice-my', name: '我的音色', originUrl: 'https://private.example/voice.wav' } } });
  const voice = await verifyAgentAudioVoice(context, state, node);
  expect(voice).toMatchObject({ voiceId: 'voice-my', source: 'my', compatibility: 'not_declared' }); expect(voice).not.toHaveProperty('originUrl');
});
it('rejects absent, off-sale, identity mismatch and explicit model/platform conflicts', async () => {
  const state = audioState(), node = state.nodes[0];
  for (const data of [null, { voiceType: 'PUBLIC_VOICE', publicVoice: { voiceId: 'other', name: 'x' } }, { voiceType: 'PUBLIC_VOICE', publicVoice: { voiceId: 'voice-public', name: 'x', onSale: 0 } }]) {
    api.detail.mockResolvedValue({ data });
    await expect(verifyAgentAudioVoice(context, state, node)).rejects.toMatchObject({ code: 'CONFIGURATION_ERROR' });
  }
  (state.modelsMap as any).audio[1].params[0].platform = 'expected';
  api.detail.mockResolvedValue({ data: { voiceType: 'PUBLIC_VOICE', publicVoice: { voiceId: 'voice-public', name: 'x', platform: 'different' } } });
  await expect(verifyAgentAudioVoice(context, state, node)).rejects.toMatchObject({ code: 'CONFIGURATION_ERROR' });
});
it('voice read errors remain not_sent and cannot mark a save or generation submission unknown', async () => {
  api.detail.mockRejectedValue(Object.assign(new Error('read timeout'), { requestPhase: 'sent_unknown' }));
  await expect(verifyAgentAudioVoice(context, audioState(), audioNode())).rejects.toMatchObject({ requestPhase: 'not_sent' });
});

it.each(['text_to_audio', 'audio_to_audio'])('does not query or require voices for %s', async modelType => {
  const node = musicNode(modelType), state = audioState(node);
  expect(await verifyAgentAudioVoice(context, state, node)).toBeUndefined();
  await expect(readAgentVoices(context, state, { action: 'canvas.voices.read', nodeType: 'audio', model: (node.data.params as any).model })).rejects.toThrow();
  expect(api.detail).not.toHaveBeenCalled(); expect(api.public).not.toHaveBeenCalled();
});
