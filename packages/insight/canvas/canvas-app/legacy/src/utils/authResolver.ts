import { getUserInfo, refreshToken } from '@/api/auth';
import { AuthExpiredError } from '@/api/request';
import type { RouteAccessMeta } from '@/router/routeMeta';
import { readStoredAccessToken, writeStoredAccessToken } from '@/utils/authSession';
import { queryClient } from '@/utils/query';

const isAuthExpiredError = (error: unknown) => error instanceof AuthExpiredError || (typeof error === 'object' && error !== null && (error as any).name === 'AuthExpiredError');

export const queryUserInfo = () =>
  queryClient.fetchQuery({
    queryKey: ['auth', 'user-info'],
    queryFn: getUserInfo,
    retry: false,
  });

const refreshSession = async () => {
  try {
    const res: any = await refreshToken();
    if (res.code === 'SUCCESS' || res.code === 200) {
      const data = res.data || res.body;
      if (data?.accessToken || data?.token) {
        writeStoredAccessToken(data.accessToken || data.token);
        return true;
      }
    }
  } catch (error) {
    console.warn('Proactive refresh token failed:', error);
  }

  return false;
};

export const resolveSessionStatus = async (routeAccess: RouteAccessMeta) => {
  const storedAuth = readStoredAccessToken();
  const authResolution = routeAccess.authResolution ?? (routeAccess.auth === 'protected' ? 'verified' : 'optimistic');

  if (storedAuth) {
    if (authResolution === 'verified') {
      try {
        await queryUserInfo();
        return true;
      } catch (error) {
        if (isAuthExpiredError(error)) {
          return false;
        }

        console.warn('Stored access token validation failed, keeping optimistic auth state:', error);
      }
    }

    return true;
  }

  if (authResolution === 'verified') {
    return refreshSession();
  }

  return false;
};
