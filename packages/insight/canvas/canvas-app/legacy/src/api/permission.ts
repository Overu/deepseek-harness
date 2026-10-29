import { request } from './request';

// 权限数据接口
export interface PermissionItem {
  id: number;
  parentId: number;
  name: string;
  code: string;
  path: string | null;
  description: string | null;
  type: number;
  sort: number;
  status: number;
  createTime: string;
  updateTime: string | null;
}

export interface PermissionResponse {
  code: string;
  data: PermissionItem[];
  msg: string;
}

// 模拟权限数据，实际项目中会从服务器获取
const mockPermissionResponse: PermissionResponse = {
  code: 'SUCCESS',
  data: [
    {
      id: 328,
      parentId: 6,
      name: '灵感库页面',
      code: 'idea_gallery:page',
      path: null,
      description: null,
      type: 1,
      sort: 1,
      status: 1,
      createTime: '2026-03-05 16:39:34',
      updateTime: null,
    },
  ],
  msg: '',
};

/**
 * 获取用户菜单权限
 * @returns 用户菜单权限数据
 */
export const getMenuPermissions = () => {
  // 实际项目中会调用真实接口
  return request<PermissionResponse>('/user-server/getUserPermissions', null, {
    method: 'get',
  });

  // 模拟 API 调用，返回模拟数据
  // return new Promise<PermissionResponse>((resolve) => {
  //   setTimeout(() => {
  //     resolve(mockPermissionResponse);
  //   }, 100);
  // });
};
