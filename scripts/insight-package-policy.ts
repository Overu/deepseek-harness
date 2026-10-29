/** Private Insight product inputs delivered by Desktop rather than the public npm release. */

/** Exact source directories and retained loader identities for the Insight distribution. */
export const INSIGHT_PRODUCT_PACKAGES: Readonly<Record<string, string>> = {
  'packages/insight/canvas': '@insight-ai/desktop-canvas-plugin',
  'packages/insight/memory-evolve': 'dsh-memory-evolve',
  'packages/insight/prompt-enhance': 'dsh-prompt-enhance',
}
