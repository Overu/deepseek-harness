import type { RouteAccessMeta } from './routeMeta';
import { HOME_BANNER_DETAIL_ROUTE } from '@/routes/home/components/HomeBanner/bannerDetailRoute';

export interface AppRouteDefinition extends RouteAccessMeta {
  path: string;
  importFn: () => Promise<any>;
  exportName?: string;
  parseParams?: (params: Record<string, string>) => any;
  stringifyParams?: (params: any) => Record<string, string>;
}

export const appRoutes: AppRouteDefinition[] = [
  { path: '/login', importFn: () => import('../routes/login/index'), exportName: 'Login', auth: 'public' },
  { path: '/asset', importFn: () => import('../routes/Asset'), auth: 'protected' },
  { path: '/workflow', importFn: () => import('../routes/WorkFlow'), auth: 'protected' },
  { path: '/workflow/folder/$folderId', importFn: () => import('../routes/WorkflowFolder'), auth: 'protected' },
  { path: '/canvas/$id', importFn: () => import('../routes/Canvas'), auth: 'protected' },
  { path: '/share/$id', importFn: () => import('../routes/Share'), auth: 'public', authResolution: 'verified' },
  { path: '/inspiration', importFn: () => import('../routes/inspiration/Inspiration'), auth: 'protected', permissions: ['idea_gallery:page'] },
  { path: '/inspiration/detail/$caseId', importFn: () => import('../routes/inspiration/CaseDetail'), auth: 'protected' },
  { path: '/', importFn: () => import('../routes/home/Home'), auth: 'public' },
  { path: '/s/$s_code', importFn: () => import('../routes/home/Home'), auth: 'public' },
  { path: '/home', importFn: () => import('../routes/home/homePage'), auth: 'public', authResolution: 'verified' },
  { path: HOME_BANNER_DETAIL_ROUTE, importFn: () => import('../routes/home/components/HomeBanner/HomeBannerDetailDialog'), auth: 'public', authResolution: 'verified' },
  { path: '/community', importFn: () => import('../routes/Community'), auth: 'public', authResolution: 'verified' },
  { path: '/community/works/$workId', importFn: () => import('../routes/CommunityWorkDetail'), auth: 'public', authResolution: 'verified' },
  { path: '/squeeze', importFn: () => import('../routes/squeeze'), auth: 'public' },
  { path: '/price', importFn: () => import('../routes/Price'), auth: 'public' },
  { path: '/aichat', importFn: () => import('../routes/AIChat'), auth: 'protected' },
  { path: '/aichat/$sessionId', importFn: () => import('../routes/AIChat'), auth: 'protected' },
  { path: '/aigroup', importFn: () => import('../routes/AiGroup'), auth: 'protected' },
  { path: '/aigroup/$sessionId', importFn: () => import('../routes/AiGroup'), auth: 'protected' },
  { path: '/usercenter', importFn: () => import('../routes/UserCenter'), auth: 'protected' },
];

const normalizePath = (path: string) => {
  if (!path || path === '/') {
    return '/';
  }

  return path.endsWith('/') ? path.slice(0, -1) : path;
};

const matchRoutePattern = (routePath: string, pathname: string) => {
  const normalizedRoutePath = normalizePath(routePath);
  const normalizedPathname = normalizePath(pathname);

  if (normalizedRoutePath === normalizedPathname) {
    return true;
  }

  const routeSegments = normalizedRoutePath.split('/').filter(Boolean);
  const pathnameSegments = normalizedPathname.split('/').filter(Boolean);

  if (routeSegments.length !== pathnameSegments.length) {
    return false;
  }

  return routeSegments.every((segment, index) => segment.startsWith('$') || segment === pathnameSegments[index]);
};

export const resolveRouteAccess = (pathname: string): RouteAccessMeta => {
  const matchedRoute = appRoutes.find(route => matchRoutePattern(route.path, pathname));

  if (!matchedRoute) {
    return {
      auth: 'public',
      authResolution: 'optimistic',
      permissions: [],
    };
  }

  return {
    auth: matchedRoute.auth,
    authResolution: matchedRoute.authResolution ?? (matchedRoute.auth === 'protected' ? 'verified' : 'optimistic'),
    permissions: matchedRoute.permissions ?? [],
  };
};

export const hasDeclaredRoute = (pathname: string) => {
  return appRoutes.some(route => matchRoutePattern(route.path, pathname));
};

export const getDeclaredRouteAccess = (path: string): RouteAccessMeta | undefined => {
  const route = appRoutes.find(item => item.path === path);

  if (!route) {
    return undefined;
  }

  return {
    auth: route.auth,
    authResolution: route.authResolution ?? (route.auth === 'protected' ? 'verified' : 'optimistic'),
    permissions: route.permissions ?? [],
  };
};
