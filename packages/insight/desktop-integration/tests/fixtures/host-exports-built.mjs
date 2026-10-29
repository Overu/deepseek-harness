import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { authContextFrom, credentialStoreFrom, resolveProfiles } from '@deepseek-ai/dsh-llm-pi-ai'
import * as plugin from '../../lib/index.js'
import { InsightAccount, InsightAccountAccessError } from '../../lib/host.js'

const previousSend = process.send
const previousConnected = process.connected
process.send = (_message, callback) => {
  callback?.(null)
  return true
}
process.connected = true

const ctx = new Context()
try {
  await ctx.plugin(LlmRuntime).await()
  const expectedRootExports = ['Config', 'apply', 'inject', 'name']
  if (JSON.stringify(Object.keys(plugin).sort()) !== JSON.stringify(expectedRootExports)) {
    throw new Error('Insight package root exposes Host service classes.')
  }
  if (resolveProfiles({}).size !== 0 || typeof credentialStoreFrom(ctx).read !== 'function'
    || typeof authContextFrom(ctx).env !== 'function') {
    throw new Error('The public pi-ai adapter construction helpers are unavailable.')
  }
  await plugin.apply(ctx, { requestTimeoutMs: 1, serviceEnvironment: 'test' })
  if (!(ctx.insightAccount instanceof InsightAccount)) {
    throw new Error('Insight root plugin and ./host do not share InsightAccount identity.')
  }
  if (!(new InsightAccountAccessError('failed') instanceof Error)) {
    throw new Error('InsightAccountAccessError is not an Error subclass.')
  }
  process.stdout.write('INSIGHT_HOST_EXPORTS_OK\n')
} finally {
  await ctx.fiber.dispose()
  if (previousSend === undefined) delete process.send
  else process.send = previousSend
  if (previousConnected === undefined) delete process.connected
  else process.connected = previousConnected
}
