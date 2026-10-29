import { request } from './request';

export type CommunityWorkType = 'VIDEO' | 'IMAGE';
export type CommunityWorkStatus = 'MACHINE_AUDITING' | 'PENDING_AUDIT' | 'PUBLISHED' | 'REJECTED' | 'DELETED_BY_USER' | 'DELETED_BY_ADMIN';
export type CommunityWorkSortType = 'COMPREHENSIVE' | 'LATEST_PUBLISH' | 'OLDEST_PUBLISH';

export interface CommunityWorkMedia {
  id: string;
  media_type: string;
  media_url: string;
  duration?: number;
  sort_order: number;
}

export interface CommunityWorkAuthor {
  user_id: number;
  user_name: string;
  avatar_url: string;
  signature: string;
  work_total: number;
  follower_total: number;
}

export interface CommunityCategory {
  id: number;
  parent_id: number;
  name: string;
  type: string;
  children: CommunityCategory[];
}

export interface CommunityUserProfile {
  user_id: number;
  user_name: string;
  avatar_url: string;
  signature: string;
  work_total: number;
  like_total: number;
  favorite_total: number;
  follower_total: number;
  following_total: number;
  followed: boolean;
}

export interface CommunityUserSummary {
  user_id: number;
  user_name: string;
  avatar_url: string;
  signature: string;
  work_total: number;
  follower_total: number;
  followed?: boolean;
}

export interface CommunityWorkPayload {
  work_id: number;
  title: string;
  description: string;
  work_type: string;
  canvas_share_url: string;
  cover_url: string;
  media_list: CommunityWorkMedia[];
  category_ids: number[];
  tags: string[];
}

export interface CommunityPublishResult {
  work_id: number;
  status: string;
  audit_scene: string;
}

export interface CommunityWorkShareResult {
  work_id: number;
  user_id: number;
  share_code: string;
}

export interface CommunityRepresentativeBatchParams {
  set_representative_work_ids: number[];
  cancel_representative_work_ids: number[];
}

export interface CommunityWorkDetail extends CommunityWorkPayload {
  work_no: string;
  user_id: number;
  status: CommunityWorkStatus | string;
  status_description?: string;
  audit_scene: string;
  machine_audit_result: string;
  machine_audit_detail: string;
  reject_reason: string;
  representative: number;
  featured: number;
  author: CommunityWorkAuthor;
  like_count: number;
  favorite_count: number;
  share_count: number;
  share_click_count?: number;
  view_count: number;
  author_follower_total: number;
  liked: boolean;
  favorited: boolean;
  followed: boolean;
  publish_time: string;
  create_time: string;
  update_time: string;
}

export interface CommunityWorksQueryParams {
  category_id?: number;
  user_id?: number;
  keyword?: string;
  author_keyword?: string;
  follow_only?: boolean;
  work_type?: string;
  status?: string;
  representative?: number;
  featured?: 0 | 1;
  favorite_only?: boolean;
  publish_start_time?: string;
  publish_end_time?: string;
  sort_type?: CommunityWorkSortType;
  sort_order?: 'asc' | 'desc';
  page_no: number;
  page_size: number;
}

export interface CommunityWorksQueryResult {
  total: number;
  items: CommunityWorkDetail[];
}

export interface CommunityUserRelationQueryParams {
  user_id?: number;
  relation_type?: string;
  page_no: number;
  page_size: number;
}

export interface CommunityUserRelationQueryResult {
  total: number;
  items: CommunityUserSummary[];
}

export const publishCommunityWork = (params: CommunityWorkPayload) => {
  return request<CommunityPublishResult>('community-service/api/works/publish', params);
};

export const getCommunityWorkDetail = (workId: number | string) => {
  return request<CommunityWorkDetail>(`community-service/api/works/${workId}`, null, {
    method: 'GET',
  });
};

export const queryCommunityWorks = (params: CommunityWorksQueryParams) => {
  return request<CommunityWorksQueryResult>('community-service/api/works/query', params);
};

export const queryCommunityCategories = () => {
  return request<CommunityCategory[]>('community-service/api/categories/query');
};

export const deleteCommunityWork = (workId: number | string) => {
  return request<boolean>(`community-service/api/works/${workId}/delete`, null);
};

export const editCommunityWork = (workId: number | string, params: CommunityWorkPayload) => {
  return request<CommunityWorkDetail>(`community-service/api/works/${workId}/edit`, params);
};

export const setCommunityWorkRepresentative = (workId: number | string, active: boolean) => {
  return request<CommunityWorkDetail>(`community-service/api/works/${workId}/representative`, {
    active,
  });
};

export const batchSetCommunityWorkRepresentative = (params: CommunityRepresentativeBatchParams) => {
  return request<boolean>('community-service/api/works/representative/batch', params);
};

/** 分享作品 */
export const shareCommunityWork = (workId: number | string) => {
  return request<CommunityWorkShareResult>(`community-service/api/works/${workId}/share`, null);
};

/** 点赞或取消点赞作品 */
export const likeCommunityWork = (workId: number | string, active: boolean) => {
  return request<boolean>(`community-service/api/works/${workId}/like`, {
    active,
  });
};

/** 收藏或取消收藏作品 */
export const favoriteCommunityWork = (workId: number | string, active: boolean) => {
  return request<boolean>(`community-service/api/works/${workId}/favorite`, {
    active,
  });
};

/**
 * 社区门户用户接口
 */

/** 查询用户主页信息 */
export const getCommunityUserProfile = (userId: number | string) => {
  return request<CommunityUserProfile>(`community-service/api/users/${userId}/profile`, null, {
    method: 'GET',
  });
};

/** 分页查询指定用户作品 */
export const queryCommunityUserWorks = (userId: number | string, params: CommunityWorksQueryParams) => {
  return request<CommunityWorksQueryResult>(`community-service/api/users/${userId}/works/query`, params);
};

/** 关注或取消关注用户 */
export const followCommunityUser = (userId: number | string, active: boolean) => {
  return request<string>(`community-service/api/users/${userId}/follow`, {
    active,
  });
};

/**
 * 社区门户当前用户接口
 */

/** 分页查询我的作品 */
export const queryMyCommunityWorks = (params: CommunityWorksQueryParams) => {
  return request<CommunityWorksQueryResult>('community-service/api/me/works/query', params);
};

/** 分页查询我的关注 */
export const queryMyCommunityFollowing = (params: CommunityUserRelationQueryParams) => {
  return request<CommunityUserRelationQueryResult>('community-service/api/me/following/query', params);
};

/** 分页查询我的粉丝 */
export const queryMyCommunityFollowers = (params: CommunityUserRelationQueryParams) => {
  return request<CommunityUserRelationQueryResult>('community-service/api/me/followers/query', params);
};

/** 分页查询我的收藏 */
export const queryMyCommunityFavorites = (params: CommunityWorksQueryParams) => {
  return request<CommunityWorksQueryResult>('community-service/api/me/favorites/query', params);
};

export const communityApi = {
  categories: {
    query: queryCommunityCategories,
  },
  works: {
    publish: publishCommunityWork,
    getDetail: getCommunityWorkDetail,
    query: queryCommunityWorks,
    delete: deleteCommunityWork,
    edit: editCommunityWork,
    representative: setCommunityWorkRepresentative,
    representativeBatch: batchSetCommunityWorkRepresentative,
    share: shareCommunityWork,
    like: likeCommunityWork,
    favorite: favoriteCommunityWork,
  },
  users: {
    getProfile: getCommunityUserProfile,
    queryWorks: queryCommunityUserWorks,
    follow: followCommunityUser,
  },
  me: {
    queryWorks: queryMyCommunityWorks,
    queryFollowing: queryMyCommunityFollowing,
    queryFollowers: queryMyCommunityFollowers,
    queryFavorites: queryMyCommunityFavorites,
  },
};
