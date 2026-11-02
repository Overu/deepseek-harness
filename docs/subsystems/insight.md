# Insight account service API

English | [中文](insight.zh.md)

Product architecture, account data, and source ownership are maintained in [Insight Desktop documentation](../insight/README.md) and its [architecture reference](../insight/architecture.md).

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxinsightaccount--insightaccount"></a>

### `ctx.insightAccount` — `InsightAccount`

Same-process service consumed only by trusted Host plugins. It has no Remote or HTTP exposure.

```ts cordis-catalog
/**
 * Request the current Main-owned access token.
 * @param signal - cancellation for this request only.
 * @returns the token without persisting, logging, or exposing it through a remote service.
 */
getAccessToken(signal?: AbortSignal): Promise<string>
```

Source: [`packages/insight/desktop-integration/src/host/account-service.ts`](../../packages/insight/desktop-integration/src/host/account-service.ts)
<!-- END GENERATED cordis-surface -->
