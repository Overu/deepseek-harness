import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet } from '@tanstack/react-router'
import Canvas from './desktop-canvas'

const rootRoute = createRootRoute({ component: Outlet })
const canvasRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/canvas/$id',
  component: Canvas,
})

const id = new URLSearchParams(window.location.search).get('id') ?? ''
export const router = createRouter({
  routeTree: rootRoute.addChildren([canvasRoute]),
  history: createMemoryHistory({ initialEntries: [`/canvas/${id}`] }),
})
