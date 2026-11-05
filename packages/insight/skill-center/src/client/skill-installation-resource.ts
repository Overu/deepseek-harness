/** Resource adapter for the current account's committed platform skills. */
import type { ResourceProvider } from '@deepseek-ai/dsh-client-resources/client'
import { RemoteError, type RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { PlatformSkillSnapshot } from '../shared/skill-installation.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface ResourceProtocolMap {
    /** Account-local platform skill records committed by the Host. */
    'insight-platform-skills': PlatformSkillSnapshot
  }
}

/** Operations required to obtain committed installation state. */
export interface PlatformSkillInstallationReader {
  listInstalled(): Promise<RemoteResult<PlatformSkillSnapshot>>
}

/**
 * Build the current-account snapshot resource address.
 * @param attempt - User-requested installation-state read attempt.
 * @returns the installation snapshot resource address.
 */
export function platformSkillInstallationAddress(attempt: number): string {
  return `dsh-resource://insight-platform-skills/installed?attempt=${attempt}`
}

/**
 * Adapt a Host Remote call to the standard client resource lifecycle.
 * @param reader - Current mounted Host remote namespace.
 * @returns a provider for one installation snapshot per requested address.
 */
export function platformSkillInstallationResourceProvider(
  reader: PlatformSkillInstallationReader,
): ResourceProvider<'insight-platform-skills'> {
  return {
    protocol: 'insight-platform-skills',
    async *open(address, { signal }): AsyncIterable<RemoteResult<PlatformSkillSnapshot>> {
      if (!validAddress(address)) {
        yield { ok: false, error: new RemoteError('gateway/bad-request', 'Invalid platform skill resource address.', {}) }
        return
      }
      const result = await reader.listInstalled()
      if (!signal.aborted) yield result
    },
  }
}

/** Accept only addresses created by this module. */
function validAddress(address: string): boolean {
  try {
    const value = new URL(address)
    return value.protocol === 'dsh-resource:' && value.hostname === 'insight-platform-skills' && value.pathname === '/installed'
  } catch { return false }
}
