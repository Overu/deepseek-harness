import { create } from 'zustand';
import { getMenuPermissions } from '@/api/permission';
import type { PermissionResponse } from '@/api/permission';

interface PermissionState {
  permissions: PermissionResponse | null;
  isLoading: boolean;
  hasFetched: boolean;
  hasPermission: (code: string) => boolean;
  fetchPermissions: () => Promise<void>;
}

// 创建 store
export const usePermissionStore = create<PermissionState>((set, get) => ({
  permissions: null,
  isLoading: false,
  hasFetched: false,

  hasPermission: (code: string) => {
    const { permissions } = get();
    if (!permissions) return false;
    return permissions.data.some(item => item.code === code);
  },

  fetchPermissions: async () => {
    const { isLoading, hasFetched } = get();
    if (isLoading || hasFetched) return;

    set({ isLoading: true });
    try {
      const response = await getMenuPermissions();
      // 检查返回类型
      if ('body' in response) {
        // 如果是 CustomResponse 类型，使用 body 字段
        set({ permissions: response.body, isLoading: false, hasFetched: true });
      } else if ('code' in response && 'data' in response && 'msg' in response) {
        // 如果直接是 PermissionResponse 类型，使用整个对象
        set({ permissions: response as PermissionResponse, isLoading: false, hasFetched: true });
      } else {
        console.error('获取权限数据失败: 响应格式不正确');
        set({ isLoading: false, hasFetched: true });
      }
    } catch (error) {
      console.error('获取权限数据失败:', error);
      set({ isLoading: false, hasFetched: true });
    }
  },
}));

// 应用启动时不再自动获取权限数据，改为在需要时手动调用
