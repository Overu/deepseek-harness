/* eslint-disable react-refresh/only-export-components */
import { createRouter, createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { Route as rootRoute } from './routes/__root';
import { appRoutes, type AppRouteDefinition } from './router/routeConfig';

const R = (route: AppRouteDefinition) => {
  const { path, importFn, exportName, parseParams, stringifyParams, auth, authResolution, permissions } = route;

  return createRoute({
    getParentRoute: () => rootRoute,
    path,
    // 如果组件是 export default，exportName 必须是 undefined
    component: lazyRouteComponent(importFn, exportName),
    parseParams,
    stringifyParams,
    auth,
    authResolution,
    permissions,
  } as any);
};

const routeTree = rootRoute.addChildren(appRoutes.map(R));

export const router = createRouter({ routeTree, scrollRestoration: true });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
