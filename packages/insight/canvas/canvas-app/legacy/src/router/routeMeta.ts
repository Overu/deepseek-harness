export type RouteAuth = 'public' | 'protected';
export type RouteAuthResolution = 'optimistic' | 'verified';

export interface RouteAccessMeta {
  auth: RouteAuth;
  authResolution?: RouteAuthResolution;
  permissions?: string[];
}
