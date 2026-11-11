/** Resource adapter for account and shared custom skills. */
import type { ResourceProvider } from '@deepseek-ai/dsh-client-resources/client'
import { RemoteError, type RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { InsightCustomSkillSnapshot } from '../shared/skill-inventory.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface ResourceProtocolMap {
    /** Account and shared skills discovered by the Host. */
    'insight-custom-skills': InsightCustomSkillSnapshot
  }
}

/** Host operation used to read custom skill discovery results. */
export interface CustomSkillReader {
  listCustom(signal?: AbortSignal): Promise<RemoteResult<InsightCustomSkillSnapshot>>
}

/**
 * Build the account-level custom-skill resource address.
 * @param attempt - User-requested custom-skill read attempt.
 * @returns the custom-skill resource address.
 */
export function customSkillAddress(attempt: number): string {
  return `dsh-resource://insight-custom-skills/list?attempt=${attempt}`
}

/**
 * Adapt the custom-skill Remote method to the standard client resource lifecycle.
 * @param reader - Mounted Host remote namespace.
 * @returns a provider for the current custom-skill inventory.
 */
export function customSkillResourceProvider(reader: CustomSkillReader): ResourceProvider<'insight-custom-skills'> {
  return {
    protocol: 'insight-custom-skills',
    async *open(address, { signal }): AsyncIterable<RemoteResult<InsightCustomSkillSnapshot>> {
      if (!validAddress(address)) {
        yield { ok: false, error: new RemoteError('gateway/bad-request', 'Invalid custom skill resource address.', {}) }
        return
      }
      const result = await reader.listCustom(signal)
      if (!signal.aborted) yield result
    },
  }
}

/** Accept only addresses created by this module. */
function validAddress(address: string): boolean {
  try {
    const value = new URL(address)
    return value.protocol === 'dsh-resource:' && value.hostname === 'insight-custom-skills' && value.pathname === '/list'
  } catch { return false }
}
