import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2, // 失败重试次数
      refetchOnWindowFocus: false, // 窗口聚焦时刷新数据
      staleTime: 1000, //  1s 数据新鲜时间
      gcTime: 1000, // 缓存保留1s
    },
  },
});
