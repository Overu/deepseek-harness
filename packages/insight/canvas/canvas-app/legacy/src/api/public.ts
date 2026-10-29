import { request } from './request';

export interface HomeBannerButton {
  color?: string;
  text: string;
  jumpUrl?: string;
}

export interface HomeBannerMediaItem {
  type?: 'IMAGE' | 'VIDEO' | string;
  url?: string;
}

export interface HomeBannerItem {
  id: number;
  sceneCode?: string;
  mainTitle?: string;
  subTitle?: string;
  content?: string;
  imageUrl?: string;
  videoUrl?: string;
  jumpUrl?: string;
  bottoms?: HomeBannerButton[];
  mediaItems?: HomeBannerMediaItem[];
  weight?: number;
  shelfStatus?: number;
  startTime?: string;
  endTime?: string;
  createTime?: string;
  updateTime?: string;
  bottomButtons?: HomeBannerButton[];
  enableJump?: boolean;
  externalUrl?: string;
}

export const getHomeBanner = () => {
  return request<HomeBannerItem[]>('game-ai-editor-center/api/banner?sceneCode=LANDING_PAGE_BANNER', null, {
    method: 'GET',
    silentError: true,
  });
};

export const getHomeBannerDetail = (id: number) => {
  return request<HomeBannerItem>(`game-ai-editor-center/api/banner/${id}`, null, {
    method: 'GET',
    silentError: true,
  });
};

/* ======================= 会员购买页 Banner 场景常量 ======================= */

/** 会员购买页顶部促销广告 Banner：sceneCode */
export const MEMBERSHIP_PURCHASE_AD = 'MEMBERSHIP_PURCHASE_AD' as const;
/** 会员购买页底部常见问题 FAQ：sceneCode（每一条 banner 相当于一个问题，详情 content 用作答案） */
export const MEMBERSHIP_PURCHASE_FAQ = 'MEMBERSHIP_PURCHASE_FAQ' as const;

/**
 * 按场景获取 banner 列表（复用 getHomeBanner 的底层实现：game-ai-editor-center/api/banner?sceneCode=xxx）
 * 与 L34 getHomeBanner 等价，只是 sceneCode 改为参数化传入，方便复用
 */
export const getHomeBannerByScene = (sceneCode: string) => {
  return request<HomeBannerItem[]>(`game-ai-editor-center/api/banner?sceneCode=${encodeURIComponent(sceneCode)}`, null, {
    method: 'GET',
    silentError: true,
  });
};
