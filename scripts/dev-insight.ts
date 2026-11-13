/** Start Insight Desktop development with the internal RC developer controls. */

export {}

process.env.DSH_DESKTOP_PRODUCT = 'insight'
process.env.DSH_INSIGHT_RC_BUILD = '1'
process.env.INSIGHT_DESKTOP_VERSION ??= '1.0.14-rc.2'
await import('../apps/desktop/scripts/dev.ts')
