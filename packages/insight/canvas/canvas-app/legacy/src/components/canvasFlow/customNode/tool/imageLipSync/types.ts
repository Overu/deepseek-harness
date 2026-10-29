export type LipSyncMode = 'single' | 'multiple';

export type CharacterInfoStatus = 'idle' | 'loading' | 'success' | 'failure';

export interface CharacterInfo {
  imageUrl: string;
  status: CharacterInfoStatus;
  maskUrls?: string[];
  bboxInfo?: number[][];
  selectedIndexes?: number[];
  errorMsg?: string;
}

export interface LipSyncParams {
  mode: LipSyncMode;
  modelId: string;
  prompt: string;
  resolution: string;
  audioStartSecond: number;
  audioEndSecond: number;
  selectedCharacterIndexes: number[];
}

export const EMPTY_CHARACTER_INFO: CharacterInfo = {
  imageUrl: '',
  status: 'idle',
};
