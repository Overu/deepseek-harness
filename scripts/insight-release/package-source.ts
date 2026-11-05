/** Branch admission for Insight desktop package versions. */
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Reject non-branch refs and versions outside the Insight branch's RC exception.
 * @param version - Product version; other branches accept only canonical 1.x.y-rc.N versions.
 * @param ref - Complete GitHub ref of the package workflow.
 * @throws Before packaging or publication when the source is not permitted.
 */
export function assertInsightPackageSource(version: string, ref: string): void {
  if (!ref.startsWith('refs/heads/') || ref === 'refs/heads/') {
    throw new Error('Insight packages must originate from a branch, not a tag.')
  }
  if (ref === 'refs/heads/insight') return
  const rc = /^1\.(0|[1-9]\d*)\.(0|[1-9]\d*)-rc\.(0|[1-9]\d*)$/u.exec(version)
  if (rc === null || version.length > 256 || !Number.isSafeInteger(Number(rc[1])) || !Number.isSafeInteger(Number(rc[2]))) {
    throw new Error('Only canonical 1.x.y-rc.N versions may originate outside insight; use the insight branch for other versions.')
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assertInsightPackageSource(process.env.INSIGHT_DESKTOP_VERSION ?? '', process.env.GITHUB_REF ?? '')
}
