import { registerCanvasProcessTools } from './canvas-process-tools.ts'
import { registerMattingRoute } from './matting-route.ts'
import type { Context } from '@deepseek-ai/cordis'
import { registerCanvasManagementTools } from './canvas-management-tools.ts'
import { registerCanvasGuidance } from './canvas-guidance.ts'
import { registerCanvasAssetTools } from './canvas-asset-tools.ts'
import { registerCanvasRunTools } from './canvas-run-tools.ts'
import { createCanvasResultStore } from './canvas-result-store.ts'
import { registerCanvasResultRoute } from './canvas-result-route.ts'
import { registerCanvasTools } from './canvas-tools.ts'
import { registerCanvasGraphTools } from './canvas-graph-tools.ts'
import { registerGatewayRoute } from './gateway-route.ts'
import { registerDownloadRoute } from './download-route.ts'
import { registerModelParamsRoute } from './model-params-route.ts'
import { registerPageRoute } from './page-route.ts'
import { registerSnapshotRoute } from './snapshot-route.ts'
import { createCanvasHostBridge } from './canvas-bridge.ts'
import { registerBridgeRoute } from './bridge-route.ts'
import { registerCanvasReferenceMessages } from './canvas-reference-message.ts'

export const inject = ['webServer', 'connection', 'tools', 'attachments', 'storageDomain', 'sessionQuery', 'skills', 'systemPrompt']

export function apply(ctx: Context): void {
  registerCanvasGuidance(ctx)
  const bridge = createCanvasHostBridge()
  const results = createCanvasResultStore(ctx)
  ctx.effect(() => () => results.close(), 'desktop-canvas: result source store')
  registerCanvasResultRoute(ctx, results)
  ctx.effect(() => () => bridge.dispose(), 'desktop-canvas: bridge runtime')
  registerBridgeRoute(ctx, bridge)
  registerCanvasReferenceMessages(ctx, bridge)
  registerPageRoute(ctx)
  registerModelParamsRoute(ctx)
  registerSnapshotRoute(ctx)
  registerMattingRoute(ctx)
  registerGatewayRoute(ctx)
  registerDownloadRoute(ctx)
  registerCanvasManagementTools(ctx, bridge)
  registerCanvasTools(ctx, bridge)
  registerCanvasRunTools(ctx, bridge, { results })
  registerCanvasProcessTools(ctx, bridge, results)
  registerCanvasGraphTools(ctx, bridge)
  registerCanvasAssetTools(ctx, bridge)
}
