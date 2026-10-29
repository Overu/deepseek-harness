import ErrorBoundary from '@/components/common/ErrorBoundary';
import { createRootRoute, Outlet, useLocation } from '@tanstack/react-router';
// import { TanStackRouterDevtools } from '@tanstack/react-router-devtools';
import { AuthGuard } from '@/components/auth/AuthGuard';
import HeaderBar from '../components/HeaderBar';
import { GlobalAnnouncement } from '@/components/common/GlobalAnnouncement';
import NotFound from './NotFound';
import { hasDeclaredRoute } from '@/router/routeConfig';

// 不需要显示 HeaderBar 的页面路径
const noHeaderPathPrefixes = ['/login', '/canvas', '/share', '/editor', '/inspiration/detail', '/community/works', '/s/'];

function RootLayout() {
  const location = useLocation();
  const isKnownRoute = hasDeclaredRoute(location.pathname);
  const showHeader = isKnownRoute && !noHeaderPathPrefixes.some(prefix => location.pathname.startsWith(prefix)) && location.pathname !== '/';

  const content = (
    <>
      {showHeader && <HeaderBar />}
      <Outlet />
      <GlobalAnnouncement />
      {/* <TanStackRouterDevtools position='bottom-right' /> */}
    </>
  );

  return <AuthGuard>{content}</AuthGuard>;
}

export const Route: any = createRootRoute({
  component: RootLayout,
  errorComponent: ErrorBoundary,
  notFoundComponent: NotFound,
});
