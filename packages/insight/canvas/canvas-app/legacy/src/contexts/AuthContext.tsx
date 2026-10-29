/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { logout as apiLogout } from '@/api/auth';
import { resolveRouteAccess } from '@/router/routeConfig';
import { clearStoredAccessToken, readStoredAccessToken, subscribeAuthInvalidation, subscribeStoredAccessTokenChanged } from '@/utils/authSession';
import { queryUserInfo, resolveSessionStatus } from '@/utils/authResolver';
import { usePointStore } from '@/store/pointStore';
import { useUserStore } from '@/store/userStore';
import { CANVAS_ONBOARDING_STORAGE_KEY } from '@/components/canvasFlow/onboarding';

interface AuthStatus {
  status: 'logged_in' | 'logged_out';
  tokenExpired: boolean;
}

interface AuthContextType {
  authStatus: AuthStatus;
  isLoading: boolean;
  refreshAuth: () => Promise<void>;
  login: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const authRefreshIdRef = useRef(0);
  const userInfoLoadingRef = useRef(false);
  const userInfo = useUserStore(state => state.userInfo);
  const setUserInfo = useUserStore(state => state.actions.setUserInfo);
  const [authStatus, setAuthStatus] = useState<AuthStatus>({
    status: 'logged_out',
    tokenExpired: false,
  });
  const [isLoading, setIsLoading] = useState(true);

  const markLoggedOut = useCallback(() => {
    authRefreshIdRef.current += 1;
    usePointStore.getState().actions.resetUserPoint('session-invalidated');
    useUserStore.setState({ userInfo: null, currentMembershipPlan: null });
    setAuthStatus({
      status: 'logged_out',
      tokenExpired: false,
    });
    setIsLoading(false);
  }, []);

  const markLoggedIn = useCallback(() => {
    if (!readStoredAccessToken()) {
      markLoggedOut();
      return;
    }

    authRefreshIdRef.current += 1;
    setAuthStatus({
      status: 'logged_in',
      tokenExpired: false,
    });
    setIsLoading(false);
  }, [markLoggedOut]);

  const refreshAuth = useCallback(async () => {
    const refreshId = authRefreshIdRef.current + 1;
    authRefreshIdRef.current = refreshId;

    try {
      setIsLoading(true);
      const routeAccess = resolveRouteAccess(window.location.pathname);
      const isLoggedIn = await resolveSessionStatus(routeAccess);

      if (refreshId !== authRefreshIdRef.current) {
        return;
      }

      const status: AuthStatus = {
        status: isLoggedIn ? 'logged_in' : 'logged_out',
        tokenExpired: false,
      };

      setAuthStatus(status);
    } catch (error) {
      console.error('获取认证状态失败:', error);
    } finally {
      if (refreshId === authRefreshIdRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  // 登录函数：accessToken 已由登录页写入 localStorage，这里只做状态同步
  const login = async () => {
    markLoggedIn();
  };

  // 登出函数
  const logout = async () => {
    try {
      await apiLogout();
    } catch (error) {
      console.error('登出接口调用失败:', error);
    } finally {
      clearStoredAccessToken();
      usePointStore.getState().actions.resetUserPoint('logout');
      // 需要在登出时保留的 localStorage 键名白名单
      const keysToKeep = ['theme', 'insight_announcement_cache', CANVAS_ONBOARDING_STORAGE_KEY]; // TODO: 临时处理新手引导，在登出后保留，后续有更好的实现后再修改
      Object.keys(localStorage).forEach(key => {
        if (!keysToKeep.includes(key)) {
          localStorage.removeItem(key);
        }
      });

      // 清除cookie
      document.cookie.split(';').forEach(cookie => {
        const [name] = cookie.split('=');
        document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
      });

      // 既然要跳转了，就不需要在当前页面生命周期内刷新状态了
      // 避免在页面卸载过程中触发重新渲染导致的 Context 丢失报错
      // await refreshAuth();

      // 跳转到登录页
      // window.location.href = '/login';
      window.location.reload();
    }
  };

  useEffect(() => {
    const unsubscribeInvalidation = subscribeAuthInvalidation(markLoggedOut);
    const unsubscribeAccessToken = subscribeStoredAccessTokenChanged(markLoggedIn);
    refreshAuth();

    return () => {
      unsubscribeInvalidation();
      unsubscribeAccessToken();
    };
  }, [markLoggedIn, markLoggedOut, refreshAuth]);

  useEffect(() => {
    if (authStatus.status !== 'logged_in' || userInfo || userInfoLoadingRef.current) {
      return;
    }

    let cancelled = false;
    userInfoLoadingRef.current = true;

    void queryUserInfo()
      .then((response: any) => {
        if (cancelled) return;
        if (response.code === 'SUCCESS' && response.data) {
          setUserInfo(response.data);
        }
      })
      .catch(error => {
        if (!cancelled) {
          console.error('获取用户信息失败:', error);
        }
      })
      .finally(() => {
        userInfoLoadingRef.current = false;
      });

    return () => {
      cancelled = true;
    };
  }, [authStatus.status, setUserInfo, userInfo]);

  return <AuthContext.Provider value={{ authStatus, isLoading, refreshAuth, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (context === undefined) {
    // 允许在某些特定生命周期（如退出登录时页面销毁）下，如果不处于 AuthProvider 中，返回一个默认的登出状态
    // 而不是抛出异常导致整个 React 树崩溃
    console.warn('useAuth called outside of AuthProvider, returning default logout state.');
    return {
      authStatus: { status: 'logged_out' as const, tokenExpired: false },
      isLoading: false,
      refreshAuth: async () => {},
      login: async () => {},
      logout: async () => {},
    };
  }

  return context;
}
