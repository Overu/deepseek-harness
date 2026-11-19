/** Mount the Insight upload tool in the keyless Insight tool-schema snapshot. */
import type { Context } from '@deepseek-ai/cordis'
import * as MediaUpload from '../../src/index.ts'

export const name = 'insight-media-upload-snapshot-fixture'
export const inject = ['tools', 'attachments', 'agents', 'sessionProjections']

/** Register production tools with inert account, skill and route providers for tool discovery only. */
export async function apply(ctx: Context): Promise<void> {
  ctx.provide('insightAccount', { async getAccessToken() { throw new Error('Snapshot does not transfer files.') } } as never)
  ctx.provide('insightPlatformSkills', { async registerPackagedSkillRoot() { return () => {} } } as never)
  ctx.provide('connection', { fetch: { register: () => () => {} } } as never)
  await ctx.plugin(MediaUpload, { serviceEnvironment: 'test', requestTimeoutMs: 15_000, ossTimeoutMs: 180_000,
    generationRequestTimeoutMs: 15_000, generationPollIntervalMs: 10_000, generationWatchTimeoutMs: 3_900_000 }).await()
}
