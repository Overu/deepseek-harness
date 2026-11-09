/** Mount the Insight upload tool in the keyless Insight tool-schema snapshot. */
import type { Context } from '@deepseek-ai/cordis'
import * as MediaUpload from '../../src/index.ts'

export const name = 'insight-media-upload-snapshot-fixture'
export const inject = ['tools', 'attachments', 'approval', 'agents', 'sessionProjections']

/** Register the production tool with an inert account provider; the snapshot exercises tool discovery only. */
export async function apply(ctx: Context): Promise<void> {
  ctx.provide('insightAccount', { async getAccessToken() { throw new Error('Snapshot does not transfer files.') } } as never)
  await ctx.plugin(MediaUpload, { serviceEnvironment: 'test', requestTimeoutMs: 15_000, ossTimeoutMs: 180_000 }).await()
}
