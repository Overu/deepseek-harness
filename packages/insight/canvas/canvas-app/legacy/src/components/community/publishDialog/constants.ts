import type { CommunityWorkType } from '@/api/community';

export const WORK_TYPE_OPTIONS: { label: string; value: CommunityWorkType }[] = [
  { label: '视频作品', value: 'VIDEO' },
  { label: '图片作品', value: 'IMAGE' },
];

export const TITLE_MAX_LENGTH = 15;
export const TAG_MAX_COUNT = 5;
export const TAG_MAX_LENGTH = 10;
export const DESCRIPTION_MAX_LENGTH = 500;
export const IMAGE_WORK_MAX_COUNT = 20;
export const VIDEO_WORK_MAX_COUNT = 1;
export const IMAGE_WORK_MAX_SIZE_MB = 20;
export const VIDEO_WORK_MAX_SIZE_MB = 200;
export const VIDEO_WORK_ALLOWED_EXTENSIONS = ['.mp4', '.mov', '.mkv'] as const;
export const COVER_MAX_SIZE_MB = 20;
