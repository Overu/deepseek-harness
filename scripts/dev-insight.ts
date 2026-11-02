/** Start the existing Desktop development launcher with Insight product identity. */

export {}

process.env.DSH_DESKTOP_PRODUCT = 'insight'
process.env.INSIGHT_DESKTOP_VERSION ??= '1.0.10'
await import('../apps/desktop/scripts/dev.ts')
