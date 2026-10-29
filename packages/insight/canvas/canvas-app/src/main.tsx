import { bindCanvasView, type CanvasViewBinding } from './canvas-service-binding'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { createRoot } from 'react-dom/client'
import { Toaster } from 'sonner'
import { GlobalDialogProvider } from '../legacy/src/components/globalDialog'
import { ToastProvider } from '../legacy/src/contexts/ToastContext'
import { AuthProvider } from './auth-context'
import { router } from './canvas-router'
import './iconfont.css'
import '../legacy/src/assets/style/App.css'
import '../legacy/src/assets/style/index.css'
import '../legacy/src/assets/style/reactFlow.css'
import '../legacy/src/assets/style/ProseMirror.css'

const root = document.getElementById('root')
if (!root) throw new Error('Canvas root element is missing')

async function bootstrap() {
  const viewId = new URLSearchParams(location.search).get('viewId')
  if (viewId) {
    if (window.parent === window || window.parent.location.origin !== location.origin) throw new Error('Canvas view has no trusted Client parent')
    const handle = window.parent.__INSIGHT_CANVAS_RUNTIME_V1__
    if (!handle) throw new Error('Canvas Client service is unavailable')
    const runtime = await handle.ready
    const binding = await runtime.attachView({ canvasId: new URLSearchParams(location.search).get('id') ?? '', viewId, viewWindow: window, viewDocument: document }) as CanvasViewBinding
    const release = bindCanvasView(binding)
    window.addEventListener('pagehide', () => release(true), { once: true })
  }
  createRoot(root!).render(
  <QueryClientProvider client={new QueryClient()}>
    <AuthProvider>
      <ToastProvider>
        <RouterProvider router={router} />
        <GlobalDialogProvider />
        <Toaster richColors position="top-center" />
      </ToastProvider>
    </AuthProvider>
  </QueryClientProvider>,
)
}
void bootstrap().catch(error => { root.textContent = error instanceof Error ? error.message : '画布加载失败'; console.error('Canvas bootstrap failed:', error) })
