# Insight 账号服务 API

[English](insight.md) | 中文

产品架构、账号数据和源码归属由 [Insight Desktop 文档](../insight/README.zh.md)及其[架构参考](../insight/architecture.zh.md)维护。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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
