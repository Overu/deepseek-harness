import { createCanvasIntentBudget } from './canvas-intent-budget.ts'
import { CanvasActivities } from './activities.ts'
import type {} from '@insight-ai/desktop-integration/host'
import { createEmptyCanvas, requestCanvasJson } from './canvas-api.ts'
import { fetchCanvas } from './canvas-get.ts'
import { createCanvasAssetApi } from './canvas-assets.ts'
import { desktopServiceProfile } from './service-environment.ts'
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

export const inject = ['insightAccount', 'webServer', 'connection', 'tools', 'attachments', 'storageDomain',
  'sessionQuery', 'skills', 'systemPrompt']

/**
 * Mount the canvas consumers after validating the product environment.
 * @param ctx - Account-scoped Host context.
 * @returns when routes and tools are active.
 */
export async function apply(ctx: Context): Promise<void> {
  desktopServiceProfile()
  const tokenProvider = (signal?: AbortSignal) => ctx.insightAccount.getAccessToken(signal)
  let consumers!: ReturnType<Context['plugin']>
  const dispose = ctx.effect(function* () {
    const bridge = createCanvasHostBridge()
    const results = createCanvasResultStore(ctx)
    yield ctx.effect(() => () => results.close(), 'desktop-canvas: result source store')
    yield ctx.effect(() => () =>{  bridge.dispose() }, 'desktop-canvas: bridge runtime')
    const assets = createCanvasAssetApi({ tokenProvider })
    yield ctx.effect(() => () => assets.dispose(), 'desktop-canvas: outstanding OSS uploads')
    const activities = new CanvasActivities()
    yield ctx.effect(() => () => activities.drain(), 'desktop-canvas: admitted completion work')
    const budget = createCanvasIntentBudget()
    consumers = ctx.plugin((consumer) => {
      registerCanvasGuidance(consumer)
      registerCanvasResultRoute(consumer, results, activities)
      registerBridgeRoute(consumer, bridge, activities)
      registerCanvasReferenceMessages(consumer, bridge)
      registerPageRoute(consumer, activities)
      registerModelParamsRoute(consumer, activities)
      registerSnapshotRoute(consumer, tokenProvider, activities)
      registerMattingRoute(consumer, tokenProvider, activities)
      registerGatewayRoute(consumer, tokenProvider, activities)
      registerDownloadRoute(consumer, tokenProvider, activities)
      registerCanvasManagementTools(consumer, bridge,
        (operation, body, signal) => requestCanvasJson(operation, body, signal, { tokenProvider }), activities)
      registerCanvasTools(consumer, bridge, {
        createCanvas: (name, signal) => createEmptyCanvas(name, signal, { tokenProvider }),
        getCanvas: (id, signal) => fetchCanvas(id, tokenProvider, fetch, signal),
      }, activities)
      registerCanvasRunTools(consumer, bridge, { results, budget }, activities)
      registerCanvasProcessTools(consumer, bridge, results, activities, budget)
      registerCanvasGraphTools(consumer, bridge, activities)
      registerCanvasAssetTools(consumer, bridge, assets, {}, activities)
    })
    yield consumers.dispose
    yield ctx.effect(() => () => { activities.stop() }, 'desktop-canvas: stop admission')
  }, 'desktop-canvas: consumers and resources')
  try { await consumers } catch (error) { await dispose(); throw error }
}
