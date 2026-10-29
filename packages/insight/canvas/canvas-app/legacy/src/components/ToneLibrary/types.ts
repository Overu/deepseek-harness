import type { ToneCategoryTreeItem, ToneDetail } from '@/api/tone';

export type TonePrimaryTab = 'public' | 'my';

export type ToneFilterKey = 'language' | 'gender' | 'age' | 'category';

export interface ToneFilterOption {
  label: string;
  value: string;
}

export interface ToneFilterConfig {
  key: ToneFilterKey;
  label: string;
  options: ToneFilterOption[];
}

export interface ToneListItem {
  id: number;
  voiceId: string;
  // 兼容后端/历史字段拼写：vocieId（用于删除等场景）
  vocieId?: string;
  name: string;
  demoUrl?: string;
  isFavorite: boolean;
  voiceType: 'PUBLIC_VOICE' | 'USER_TONE';
  language?: string;
  gender?: string;
  age?: string;
  category?: string;
  accent?: string;
  platform?: string;
  modelId?: string;
  onSale?: number;
  originUrl?: string;
  createTime?: string;
}

export interface ToneLibraryModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  voiceId?: string;
  onSelect?: (item: ToneListItem) => void;
  /** 为 false 时隐藏「我的」Tab 中的「定制音色」入口（模型权限 voice_customizable=0） */
  allowCustomTone?: boolean;
}

export interface ToneListResponse {
  list: ToneListItem[];
  total: number;
}

export interface ToneLibraryFilters {
  language?: string;
  gender?: string;
  age?: string;
  category?: string;
  keyword?: string;
}

export const TONE_FILTER_KEYS: ToneFilterKey[] = ['language', 'gender', 'age', 'category'];

export const TONE_FILTER_LABEL: Record<ToneFilterKey, string> = {
  language: '语言',
  gender: '性别',
  age: '年龄',
  category: '类别',
};

const normalizeFilterKey = (value?: string): ToneFilterKey | null => {
  if (!value) return null;
  const key = value.toLowerCase();
  if (key.includes('language') || value.includes('语言')) return 'language';
  if (key.includes('gender') || value.includes('性别')) return 'gender';
  if (key.includes('age') || value.includes('年龄')) return 'age';
  if (key.includes('category') || value.includes('类别')) return 'category';
  return null;
};

const findFilterNode = (tree: ToneCategoryTreeItem[], key: ToneFilterKey) => {
  const queue: ToneCategoryTreeItem[] = [...tree];
  while (queue.length > 0) {
    const node = queue.shift();
    if (!node) continue;
    if (normalizeFilterKey(node.name) === key) return node;
    if (node.children?.length) queue.push(...node.children);
  }
  return undefined;
};

export const buildFilterConfigsFromTree = (tree: ToneCategoryTreeItem[]): ToneFilterConfig[] => {
  return TONE_FILTER_KEYS.map(key => {
    const root = findFilterNode(tree, key);
    const options =
      root?.children
        ?.map(item => ({
          label: item.name || '',
          value: item.name || '',
        }))
        ?.filter(item => item.value) || [];
    return {
      key,
      label: TONE_FILTER_LABEL[key],
      options,
    };
  });
};

export const mapToneDetailToItem = (detail?: ToneDetail): ToneListItem | null => {
  if (!detail) return null;
  if (detail.voiceType === 'PUBLIC_VOICE' && detail.publicVoice?.voiceId) {
    const voice = detail.publicVoice;
    return {
      id: voice.id || 0,
      voiceId: voice.voiceId || '',
      name: voice.name || '',
      demoUrl: voice.demoUrl,
      isFavorite: !!voice.isFavorite,
      voiceType: 'PUBLIC_VOICE',
      language: voice.language,
      gender: voice.gender,
      age: voice.age,
      category: voice.category,
      accent: voice.accent,
      platform: voice.platform,
      modelId: voice.modelId,
      onSale: voice.onSale,
    };
  }

  if (detail.personalVoice?.voiceId) {
    const voice = detail.personalVoice;
    return {
      id: voice.id || 0,
      voiceId: voice.voiceId || '',
      name: voice.name || '',
      demoUrl: voice.demoUrl,
      isFavorite: !!voice.isFavorite,
      voiceType: 'USER_TONE',
      platform: voice.platform,
      originUrl: voice.originUrl,
    };
  }

  return null;
};

// Shared native response mapping; usable without mounting the tone-library UI.
export const getPagePayload = (data: any): ToneListResponse => {
  const records = data?.records || data?.list || data?.rows || data?.dataList || [];
  return { list: Array.isArray(records) ? records : [], total: data?.total || 0 };
};
export const normalizePublicItem = (item: any): ToneListItem => ({
  id: item?.id || 0, voiceId: item?.voiceId || '', name: item?.name || '', demoUrl: item?.demoUrl,
  isFavorite: !!item?.isFavorite, voiceType: 'PUBLIC_VOICE', language: item?.language, gender: item?.gender,
  age: item?.age, category: item?.category, accent: item?.accent, platform: item?.platform, modelId: item?.modelId, onSale: item?.onSale,
});
export const normalizeUserItem = (item: any): ToneListItem => ({
  id: item?.id || 0, voiceId: item?.voiceId || '', name: item?.name || '', demoUrl: item?.demoUrl,
  isFavorite: !!item?.isFavorite, voiceType: 'USER_TONE', platform: item?.platform,
  originUrl: item?.originUrl, createTime: item?.createTime,
});
