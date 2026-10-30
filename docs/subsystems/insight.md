# Insight desktop product integration

English | [中文](insight.zh.md)

## Summary

Insight Desktop keeps the DSH runtime and native workspace layout while owning product identity, authentication, account storage, credentials, and workspace branding. Product selection happens before Electron reads product-scoped state. A successful login and a safe account Home are prerequisites for starting the business Host. The official Desktop product follows its existing startup and profile behavior.

## Product and runtime identity

The Insight application uses the display name `因赛AI`, application id `com.insight-aigc.desktop`, and packaged Electron `userData` name `insight-desktop`. Development uses `insight-desktop-dev`. Native window, menu, Dock, tray, About, and installer resources use the Insight brand while the title-bar strategy and workspace layout remain the DSH Desktop implementation.

The Insight product version and DSH runtime version are independent. Packaging requires an explicit Insight `1.x` semantic version, leaves workspace package versions at the DSH runtime version, and records the runtime in `dshDesktopRuntimeVersion`. Main reports both values in safe product metadata so support can distinguish product rollout from baseline runtime changes.

Insight product UI is Chinese-only. Product selection forces the existing native Desktop message roles to Chinese and supplies Chinese login and account copy; it does not add a locale selector or Insight translation dictionaries. The official product keeps its existing locale behavior.

## Startup and account ownership

Insight opens an isolated native login window before it creates the account profile or starts a Host. The Main process validates login input, uses a dedicated Electron session partition for account requests, and stores packaged credentials under `<userData>/insight/auth/<environment>.json` through `safeStorage`. Development does not persist credentials. Closing the login window before admission exits without starting a Host.

One Desktop process owns one immutable authenticated account. The account scope is the first 32 hexadecimal characters of SHA-256 over the service environment and stable user id. The new DSH Home is `<userData>/insight/accounts/<scope>/harness-native`; a marker binds that directory to its scope, environment, and marker version.

Home preparation fails closed. A legacy `<scope>/harness` path, a checked Insight account path that is a symbolic link, a non-empty native Home without the expected marker, or a mismatched marker prevents Host startup and reports `migration-required`. The current startup path never reads or rewrites legacy Home contents. Historical conversations, workspaces, plugins, and configuration therefore remain untouched until the separate P4 migration path handles them.

## Process data flow

The login renderer receives a narrow preload API for session state, SMS/password commands, agreement windows, and local sign-out. After admission, Desktop Main starts the Host with the fixed account Home in `DSH_HOME`, keeps the access token in Main-owned authentication state, and activates the four product-required bundles: Integration, Canvas, Memory, and Prompt.

The Host bundle mounts `ctx.insightAccount`. A trusted Host consumer requests an access token over the private child-process channel with a branded request id. Both peers validate exact message fields, bound concurrent requests, support cancellation and deadlines, and ignore duplicate or late responses. Desktop Main answers only the current live Host child; tokens are not logged, retained in Host diagnostics, exposed through Remote, or sent to a renderer.

The authenticated workspace preload exposes only an account summary, product/runtime information, subscription, and sign-out. It requires the Insight launch argument, the top-level `dsh-app://app` document, and Main's owning-window check. The Client bundle fills the existing DSH brand slots and sidebar footer with the Insight mark, display name, masked phone, avatar, and account menu. Its Settings action opens the shared DSH settings shell, whose Insight section shows the account, product version, service environment, and platform.

The product fixes the default model to `yinsai-gateway/deepseek-flash` and hides model credential settings. Main supplies `DSH_INSIGHT_SERVICE_ENVIRONMENT` from the admitted authentication environment; the required `serviceEnvironment` config selects the paired Gateway URL. The Host adapter obtains a Main-validated token for each request through `ctx.insightAccount`, then delegates protocol conversion and streaming to the public DSH `PiAiAdapter`; no account token enters user settings or the renderer.

Sign-out and account expiry close admission before resource teardown. Main removes renderer access, clears Host URL, cookie, and injection state, hides the workspace, waits for the platform view, file drag service, and Host backend to stop, clears authentication and session storage, and then relaunches into the login gate. A shutdown failure opens native fatal recovery instead of starting another account in the same process.

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

## Source and release ownership

[packages/insight](../../packages/insight/README.md) owns the private Desktop integration and the three fixed business-source packages. Canvas, Memory, and Prompt retain their source identities and activate in the Insight profile. Desktop Main supplies the fixed required-bundle policy after login-shell environment resolution; Plugin Manager merges it with ordinary profile configuration without replacing the user registry. Component disable, removal, update, and replacement operations enforce this policy; internal feature switches remain package-owned.

The [Integration bundle README](../../packages/insight/desktop-integration/README.md) owns the bundle-local Host entry and runtime package-resolution maintenance rule.

Each fixed business package records its upstream repository, commit, and version in `upstream.json`; its workspace version follows the DSH root version. Source changes are committed to the parent repository, and `patches/insight` records replayable differences against the fixed input. Normal builds do not patch installed files. The exact identities in [the product roster](../../scripts/insight-package-policy.ts) remain private and outside the public npm baseline.

`bundled-skills` remains an externally synchronized root directory with its original internal structure. The runtime discovers skills from this directory and reads optional `ui.json` presentation beside each installed instruction. Insight Desktop supplies `DSH_BUNDLED_SKILL_DIR`, and its packaging copies the directory as an independent resource; the [Desktop Host environment](../../apps/desktop/README.md#insight-bundled-skills) owns the development and installed paths. Skill content, scripts, and business correctness belong to the source repository, not this migration.

The Insight build currently excludes DSH automatic and mandatory update flows. Manual update checks report that checking is unavailable. The current integration does not connect the existing OSS/CDN release channel, test-channel discovery, signing, or installed-update qualification; those release mechanics remain P5 work rather than a capability of the authentication package.

## Source development

On macOS, with Node 24.9 or newer and the repository-pinned pnpm available, run the official source launcher from the repository root:

```sh
DSH_DESKTOP_PRODUCT=insight INSIGHT_DESKTOP_VERSION=1.0.9-dev.0 pnpm run dev:desktop
```

The launcher builds the current artifacts and then starts Insight with isolated development data. It does not watch source changes automatically. After rebuilding changed source, use Reload Page or Restart App and Host as appropriate; `pnpm run start:desktop` launches existing artifacts without rebuilding. Keep the Insight product and version variables on both commands.

## Dev Note

None.
