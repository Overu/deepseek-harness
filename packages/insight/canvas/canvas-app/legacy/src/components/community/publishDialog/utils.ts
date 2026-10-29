import type { CommunityWorkDetail, CommunityWorkMedia, CommunityWorkPayload, CommunityWorkType } from '@/api/community';
import { DESCRIPTION_MAX_LENGTH, TAG_MAX_COUNT, TAG_MAX_LENGTH, TITLE_MAX_LENGTH } from './constants';
import type { PublishWorkDraft, PublishWorkDrafts, PublishWorkInitialValue, PublishWorkValidation } from './types';

export const createEmptyDraft = (): PublishWorkDraft => ({
  workId: 0,
  title: '',
  description: '',
  categoryIds: [],
  tags: [],
  tagInput: '',
  canvasShareUrl: '',
  canvasShareTitle: '',
  canvasShareCoverUrl: '',
  canvasShareTime: '',
  coverUrl: '',
  mediaList: [],
  usePrimaryMediaAsCover: true,
});

export const createInitialDrafts = (initialValue?: Partial<Record<CommunityWorkType, PublishWorkInitialValue>>): PublishWorkDrafts => {
  const videoDraft = createEmptyDraft();
  const imageDraft = createEmptyDraft();

  return {
    VIDEO: {
      ...videoDraft,
      ...initialValue?.VIDEO,
      categoryIds: initialValue?.VIDEO?.categoryIds ?? videoDraft.categoryIds,
      mediaList: initialValue?.VIDEO?.mediaList ?? [],
    },
    IMAGE: {
      ...imageDraft,
      ...initialValue?.IMAGE,
      categoryIds: initialValue?.IMAGE?.categoryIds ?? imageDraft.categoryIds,
      mediaList: initialValue?.IMAGE?.mediaList ?? [],
    },
  };
};

export const createDraftsFromWorkDetail = (detail: CommunityWorkDetail): PublishWorkDrafts => {
  const workType = detail.work_type === 'IMAGE' ? 'IMAGE' : 'VIDEO';
  const drafts = createInitialDrafts();

  drafts[workType] = {
    ...drafts[workType],
    workId: detail.work_id,
    title: detail.title || '',
    description: detail.description || '',
    categoryIds: detail.category_ids || [],
    tags: detail.tags || [],
    tagInput: '',
    canvasShareUrl: detail.canvas_share_url || '',
    canvasShareTitle: detail.canvas_share_url ? '已选择工作流' : '',
    canvasShareCoverUrl: '',
    canvasShareTime: '',
    coverUrl: detail.cover_url || '',
    mediaList: detail.media_list || [],
    usePrimaryMediaAsCover: !detail.cover_url,
  };

  return drafts;
};

export const normalizeTag = (value: string) => {
  const tagText = value
    .trim()
    .replace(/^#+/, '')
    .slice(0, TAG_MAX_LENGTH - 1);
  return tagText ? `#${tagText}` : '';
};

const appendOssProcess = (url: string, process: string) => {
  if (!url) return '';

  const [withoutHash, hash] = url.split('#');
  const [base, query = ''] = withoutHash.split('?');
  const keptQuery = query
    .split('&')
    .filter(item => item && !item.startsWith('x-oss-process='))
    .join('&');
  const separator = keptQuery ? `?${keptQuery}&` : '?';

  return `${base}${separator}x-oss-process=${process}${hash ? `#${hash}` : ''}`;
};

export const getVideoFirstFrameCover = (url: string, width = 720) => appendOssProcess(url, `video/snapshot,t_0,f_jpg,w_${width},h_0,m_fast`);

export const getPrimaryMediaCover = (mediaList: CommunityWorkMedia[], workType: CommunityWorkType) => {
  const primaryUrl = mediaList[0]?.media_url || '';
  if (!primaryUrl) return '';
  return workType === 'VIDEO' ? getVideoFirstFrameCover(primaryUrl) : primaryUrl;
};

export const validateDraft = (draft: PublishWorkDraft): PublishWorkValidation => {
  if (!draft.title.trim()) {
    return { valid: false, message: '请填写作品标题' };
  }

  if (draft.title.trim().length > TITLE_MAX_LENGTH) {
    return { valid: false, message: `作品标题不能超过${TITLE_MAX_LENGTH}个字` };
  }

  if (draft.categoryIds.length === 0) {
    return { valid: false, message: '请选择作品分区' };
  }

  if (draft.tags.length > TAG_MAX_COUNT) {
    return { valid: false, message: `作品标签不能超过${TAG_MAX_COUNT}个` };
  }

  if (draft.tags.some(tag => tag.length > TAG_MAX_LENGTH)) {
    return { valid: false, message: `单个标签不能超过${TAG_MAX_LENGTH}个字` };
  }

  if (draft.description.length > DESCRIPTION_MAX_LENGTH) {
    return { valid: false, message: `作品简介不能超过${DESCRIPTION_MAX_LENGTH}个字` };
  }

  if (!draft.description.trim()) {
    return { valid: false, message: '请填写作品简介' };
  }

  if (!draft.canvasShareUrl.trim()) {
    return { valid: false, message: '请添加工作流分享链接' };
  }

  if (draft.mediaList.length === 0) {
    return { valid: false, message: '请先上传作品内容' };
  }

  return { valid: true, message: '' };
};

export const toCommunityWorkPayload = (workType: CommunityWorkType, draft: PublishWorkDraft): CommunityWorkPayload => {
  const mediaCover = draft.usePrimaryMediaAsCover ? getPrimaryMediaCover(draft.mediaList, workType) : '';

  return {
    work_id: draft.workId,
    title: draft.title.trim(),
    description: draft.description.trim(),
    work_type: workType,
    canvas_share_url: draft.canvasShareUrl.trim(),
    cover_url: draft.usePrimaryMediaAsCover ? mediaCover : draft.coverUrl,
    media_list: draft.mediaList.map((item, index) => ({
      ...item,
      sort_order: item.sort_order ?? index,
    })),
    category_ids: draft.categoryIds,
    tags: draft.tags,
  };
};
