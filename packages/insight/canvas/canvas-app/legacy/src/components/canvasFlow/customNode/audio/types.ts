import type { ModelItem } from '@/components/canvasFlow/utils/util';

export enum AudioModelType {
  TTS = 'tts',
  MUSIC_GEN = 'text_to_audio',
  MUSIC_COVER = 'audio_to_audio',
}

export interface MusicStyleOption {
  id: number;
  name: string;
  value: string;
}

interface Parameter {
  label: string;
  field: string;
  default: unknown;
}

interface ChoicesItem {
  value: string;
  label: string;
}

export interface Choices extends Parameter {
  choices: ChoicesItem[];
  default: string;
}

export interface Slider extends Parameter {
  min: number;
  max: number;
  step: number;
  default: number;
}

interface SeniorChoices extends Choices {
  type: 'choices';
}

export interface SeniorSlider extends Slider {
  type: 'number';
}

export type BaseParameter = Choices | Slider;
export type SeniorParamerter = SeniorSlider | SeniorChoices;

export interface Model {
  value: string;
  label: string;
  description: string;
  maxPrompt: number;
  params: BaseParameter[];
  seniorParams: SeniorParamerter[];
  point?: string;
}

// TODO: 先兼容之前结构，后续再统一处理
export interface ModelType extends Omit<ModelItem, 'params'> {
  params: Model[];
}

interface NodeParams {
  model: string;
  gen_count: number;
}

interface BaseAudioNodeParams extends NodeParams {
  gen_count: number;
  prompt: string;
}

export interface TTSAudioNodeParams extends BaseAudioNodeParams {
  modelType: AudioModelType.TTS;
  voiceId: string;
  seniorParams: {
    emotion: string;
    language_boost: string;
    auto: string;
    pitch: number;
    speed: number;
    vol: number;
  };
}

export interface MusicCoverAudioNodeParams extends BaseAudioNodeParams {
  modelType: AudioModelType.MUSIC_COVER;
  audioWeight: number;
  seniorParams: {
    title: string; // TODO
    lyrics?: string; // TODO
    customMode: boolean;
    instrumental: boolean;
    description: string;
    styleWeight: number;
    vocalGender: string;
    weirdnessConstraint: number;
    uploadUrl: string;
  };
}

export interface MusicGenAudioNodeParams extends BaseAudioNodeParams {
  modelType: AudioModelType.MUSIC_GEN;
  seniorParams: {
    title: string; // TODO
    lyrics?: string; // TODO
    audioWeight: number;
    instrumental: boolean;
    customMode: boolean;
    styleWeight: number;
    vocalGender: number;
    weirdnessConstraint: number;
  };
}

export type AudioNodeParams = TTSAudioNodeParams | MusicCoverAudioNodeParams | MusicGenAudioNodeParams;

export function isMusicCover(o: any): o is MusicCoverAudioNodeParams {
  return o.modelType === AudioModelType.MUSIC_COVER;
}
export function isTTS(o: any): o is TTSAudioNodeParams {
  return o.modelType === AudioModelType.TTS;
}
export function isMusicGen(o: any): o is MusicGenAudioNodeParams {
  return o.modelType === AudioModelType.MUSIC_GEN;
}
