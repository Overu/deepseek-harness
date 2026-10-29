/** Stable account directory keys and paths retained from the Insight desktop Shell. */
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type { AuthEnvironment } from '../shared/auth-contracts.ts'

const ACCOUNT_SCOPE_PATTERN = /^[a-f0-9]{32}$/u

/** Directories reserved for one authenticated Insight account. */
export interface AccountPaths {
  root: string
  shell: string
  harness: string
  harnessNative: string
  cache: string
  launchRoot: string
}

/** Derive the legacy opaque account key from a stable account identifier.
 *
 * @param environment Fixed desktop service environment.
 * @param userId Main-only stable account identifier.
 * @returns A 32-character account directory key.
 */
export function accountScopeKey(environment: AuthEnvironment, userId: string): string {
  return createHash('sha256')
    .update(`insight-account-v1\0${environment}\0${userId}`)
    .digest('hex')
    .slice(0, 32)
}

/** Resolve account-owned paths after validating the opaque scope key.
 *
 * @param insightRoot Product data root selected by the desktop main process.
 * @param scope Opaque account directory key.
 * @returns Directories owned by the selected account.
 */
export function accountPaths(insightRoot: string, scope: string): AccountPaths {
  if (!ACCOUNT_SCOPE_PATTERN.test(scope)) {
    throw new Error('The account scope is invalid.')
  }
  const root = join(insightRoot, 'accounts', scope)
  return {
    root,
    shell: join(root, 'shell'),
    harness: join(root, 'harness'),
    harnessNative: join(root, 'harness-native'),
    cache: join(root, 'cache'),
    launchRoot: join(root, 'launch-root'),
  }
}
