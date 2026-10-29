import { useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useNavigate, useLocation, useParams, useRouter } from '@tanstack/react-router';
import { usePermissionStore } from '@/store/permissionStore';
import { resolveRouteAccess } from '@/router/routeConfig';
import { subscribeLoginRequired } from '@/utils/authSession';

interface AuthGuardProps {
  children: React.ReactNode;
}

export function AuthGuard({ children }: AuthGuardProps) {
  const { authStatus, isLoading: authLoading, refreshAuth } = useAuth();
  const { isLoading: permLoading, hasFetched, hasPermission, fetchPermissions } = usePermissionStore();
  const navigate = useNavigate();
  const location = useLocation();
  const router = useRouter();
  const routeParams = useParams({ strict: false }) as { s_code?: string };

  const fallbackPath = '/squeeze';

  // 获取 s_code 参数
  const getSCode = () => {
    const search = new URLSearchParams(window.location.search);
    return routeParams.s_code || location.pathname.split('/s/')[1] || search.get('sCode') || search.get('inviteCode') || '';
  };

  const currentMatch = router.state.matches[router.state.matches.length - 1];
  const currentRoute = currentMatch ? (router.routesById[currentMatch.routeId] as any) : null;
  const currentAccess = currentRoute?.options?.auth
    ? {
        auth: currentRoute.options.auth,
        authResolution: currentRoute.options.authResolution,
        permissions: currentRoute.options.permissions ?? [],
      }
    : resolveRouteAccess(location.pathname);
  const isPublic = currentAccess.auth === 'public';
  const isLoginRoute = location.pathname === '/login';

  // 检查当前路径是否需要权限
  const currentRequiredPermissions = currentAccess.permissions ?? [];

  // 检查是否有权限
  const checkPermissionsAccess = () => {
    if (currentRequiredPermissions.length === 0) return true;

    return currentRequiredPermissions.every((requiredPermission: string) => hasPermission(requiredPermission));
  };

  useEffect(() => {
    if (isLoginRoute || currentAccess.auth !== 'public' || currentAccess.authResolution !== 'verified') {
      return;
    }

    void refreshAuth();
  }, [currentAccess.auth, currentAccess.authResolution, isLoginRoute, location.pathname, refreshAuth]);

  useEffect(() => {
    const sCode = getSCode();
    if (sCode) {
      // console.log('get code', sCode, authStatus.status);
      if (authStatus.status !== 'logged_in') {
        localStorage.setItem('sCode', sCode);
      }

      const isShareRoute = Boolean(routeParams.s_code || location.pathname.split('/s/')[1]);
      if (isShareRoute) {
        // 使用 replaceState 修改 URL 为根路径，不触发页面刷新
        window.history.replaceState(window.history.state, '', '/');
      } else {
        const url = new URL(window.location.href);
        url.searchParams.delete('sCode');
        url.searchParams.delete('inviteCode');
        window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
      }
    }

    // 登录后获取权限数据 - 只在未获取过权限时请求，无论是否是公共页面
    if (!authLoading && authStatus.status === 'logged_in' && !hasFetched) {
      fetchPermissions();
    }
    if (isLoginRoute || isPublic) {
      // 登录页不做任何处理
      return;
    }

    if (!authLoading && authStatus.status === 'logged_out') {
      const searchStr = location.searchStr || '';
      const currentPath = location.pathname + searchStr;
      console.log('AuthGuard redirecting to login. Saved path:', currentPath);
      sessionStorage.setItem('redirectPath', currentPath);

      navigate({ to: '/login' });
    }
  }, [authStatus, authLoading, navigate, location.pathname, location.searchStr, hasFetched, fetchPermissions, isLoginRoute, isPublic]);

  useEffect(() => {
    return subscribeLoginRequired(() => {
      if (!isLoginRoute) {
        navigate({ to: '/login' });
      }
    });
  }, [navigate, isLoginRoute]);

  // 登录页直接显示，不考虑权限加载状态
  if (isLoginRoute) {
    return <>{children}</>;
  }

  // 公开路径直接显示，即使权限正在加载
  if (isPublic) {
    return <>{children}</>;
  }

  // 非公开路径需要考虑加载状态
  // const isLoading = authLoading || permLoading;
  // 非公开路径需要考虑加载状态
  const isLoading = authLoading || (currentRequiredPermissions.length > 0 && (permLoading || !hasFetched));

  if (isLoading) {
    return (
      <div className='flex items-center justify-center min-h-screen'>
        <div className='animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600'></div>
      </div>
    );
  }

  if (authStatus.status === 'logged_out') {
    return null;
  }

  // 权限检查 - 只有登录了才做权限控制，且只在非公共页面检查
  if (!checkPermissionsAccess()) {
    // 权限不足，跳转到 fallback 路径
    navigate({ to: fallbackPath, replace: true });
    return null;
  }

  return <>{children}</>;
}
