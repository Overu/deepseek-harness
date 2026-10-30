import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { CanvasAgentError } from '../shared/canvas-agent-protocol.ts'
import type { CanvasRuntimeHandle, CanvasServiceRuntimeBase, CanvasViewRegistration } from '../shared/canvas-service-runtime.ts'

interface RuntimeHost {
  location: { origin: string }
  __INSIGHT_CANVAS_RUNTIME_V1__?: CanvasRuntimeHandle
}
interface ServiceModule { createCanvasServiceRuntime(): CanvasServiceRuntimeBase }
type ModuleLoader = (url: string) => Promise<ServiceModule>
const loadServiceModule: ModuleLoader = url => import(/* @vite-ignore */ url)
const unavailable = () => new CanvasAgentError('CLIENT_UNAVAILABLE', '画布插件服务不可用，请检查插件加载状态')

/** Client workspace owns this handle; canvas tabs and conversation slots do not. */
export function installCanvasRuntime(host: RuntimeHost = window, loadModule: ModuleLoader = loadServiceModule): () => void {
  if (host.__INSIGHT_CANVAS_RUNTIME_V1__) throw new CanvasAgentError('CLIENT_AMBIGUOUS', '画布插件服务已有生命周期所有者')
  let disposed = false
  let ready: Promise<CanvasServiceRuntimeBase> | undefined
  let runtime: CanvasServiceRuntimeBase | undefined
  let cancelLoading: (() => void) | undefined
  const views = new Map<string, { input: CanvasViewRegistration
    release?: () => void }>()
  const releaseViews = () => {
    for (const entry of views.values()) {
      try { entry.release?.() } catch (error) { console.error('Canvas view cleanup failed:', error) }
      finally { entry.release = undefined }
    }
  }
  const handle: CanvasRuntimeHandle = {
    registerView(input) {
      if (disposed || views.has(input.viewId)) throw unavailable()
      const entry = { input, release: runtime?.registerView(input) }
      views.set(input.viewId, entry)
      return () => { if (views.get(input.viewId) === entry) { try { entry.release?.() } finally { views.delete(input.viewId) } } }
    },
    get ready() {
      if (disposed) return Promise.reject(unavailable())
      if (ready) return ready
      const url = new URL('/desktop-canvas/canvas-service.js', host.location.origin)
      // A rejected import is cached by the browser too. Only a failed installation gets a new URL.
      url.searchParams.set('runtime', randomUUID())
      const loading = new Promise<CanvasServiceRuntimeBase>((resolve, reject) => {
        cancelLoading = () =>{  reject(unavailable()) }
        Promise.resolve().then(() => {
          if (disposed) throw unavailable()
          return loadModule(url.href)
        }).then((module) => {
          if (disposed) throw unavailable()
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Dynamic assets need validation before activation.
          if (typeof module?.createCanvasServiceRuntime !== 'function') throw unavailable()
          const loaded = module.createCanvasServiceRuntime()
          const methods = ['ensureContext', 'getContextInfo', 'subscribeReadiness', 'subscribeRun', 'reloadContext',
            'closeContext', 'execute', 'registerView', 'attachView', 'detachView', 'dispose'] as const
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Dynamic assets need validation before activation.
          if (!loaded || methods.some(method => typeof loaded[method] !== 'function')) {
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Dynamic assets need validation before activation.
            loaded?.dispose?.()
            throw unavailable()
          }
          runtime = loaded
          try { views.forEach((entry) => { entry.release = loaded.registerView(entry.input) }) }
          catch (error) { releaseViews(); runtime = undefined; loaded.dispose(); throw error }
          resolve(loaded)
        }).catch((error: unknown) =>{  reject(error instanceof CanvasAgentError ? error : Object.assign(unavailable(),
          { cause: error })) })
      }).catch((error: unknown) => { if (!disposed && !runtime) ready = undefined; throw error })
        .finally(() => { cancelLoading = undefined })
      ready = loading
      return loading
    },
  }
  Object.defineProperty(host, '__INSIGHT_CANVAS_RUNTIME_V1__', { value: handle, configurable: true })
  return () => {
    if (disposed) return
    disposed = true
    cancelLoading?.()
    try { releaseViews(); views.clear(); runtime?.dispose() }
    finally { if (host.__INSIGHT_CANVAS_RUNTIME_V1__ === handle) delete host.__INSIGHT_CANVAS_RUNTIME_V1__ }
  }
}
