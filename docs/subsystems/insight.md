# Insight service API

English | [中文](insight.zh.md)

Product architecture, account data, and source ownership are maintained in [Insight Desktop documentation](../insight/README.md) and its [architecture reference](../insight/architecture.md).

## Platform skill installation types

The [Skills subsystem](skills.md) defines generic discovery and loading. The following account-local installation types are defined in [`skill-installation.ts`](../../packages/insight/skill-center/src/shared/skill-installation.ts).

- `InsightSkillId` is the branded OSS catalogue identifier; `PlatformSkillKey` is the separate account-local storage key.
- `SkillIdentity` contains an optional `id` and required technical `skillName`. Both present IDs must match; otherwise a unique exact technical-name match is required.
- `InstalledPlatformSkill` adds its local `key` and committed `version`; `PlatformSkillSnapshot` contains the current `skills` collection.
- `PlatformSkillOperationId` identifies one install or update attempt. `PlatformSkillInstallRequest` supplies the skill identity, version, operation ID, download URL, and optional target key; `PlatformSkillRemovalRequest` supplies the local key and current identity.
- `PlatformSkillInstallProgress` reports its `operationId`. A `download` frame contains `receivedBytes` and optional `totalBytes`; `validate` and `commit` frames identify those stages.
- `PlatformSkillOperationSettlement` is terminal: `complete` contains the committed `skill`, while `cancelled` contains only the operation ID after cancellation has drained. A cancellation that loses the commit race settles as `complete`.

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

/** Return a noncredential identifier for the Main-selected account home.
 * @returns Stable account scope for task ownership checks across Host restarts.
 */
getAccountScope(): string
```

Source: [`packages/insight/desktop-integration/src/host/account-service.ts`](../../packages/insight/desktop-integration/src/host/account-service.ts)

<a id="ctxinsightplatformskills--insightplatformskills"></a>

### `ctx.insightPlatformSkills` — `InsightPlatformSkills`

Host service owning committed platform skills for the current account.

```ts cordis-catalog
/** Wait until interrupted staging and unreferenced payload recovery completes. */
initialize(): Promise<void>

/**
 * List installed versions selected by complete atomic records.
 * @returns Current account installation state.
 */
@Remote listInstalled(): Promise<PlatformSkillSnapshot>

/**
 * List configured platform skills eligible for this account's first automatic installation.
 * @param catalogue - Published identities used to resolve configured selectors.
 * @returns Identities absent from both installed records and account installation history.
 */
@Remote listPendingPresets(catalogue: readonly SkillIdentity[]): Promise<readonly SkillIdentity[]>

/**
 * Observe another client's admitted installation without cancelling its work.
 * @param identity - Skill identity whose admitted install or update must settle.
 * @param signal - Cancels only this observer's wait.
 * @returns Account installation state after the observed operations settle.
 */
@Remote async waitForInstallation(identity: SkillIdentity, signal: AbortSignal): Promise<PlatformSkillSnapshot>

/**
 * Discover previous application directories without modifying their files.
 * @param options - Lookup cancellation and working-directory context.
 * @returns Legacy candidates ranked after managed platform releases.
 */
async listLegacyCandidates(options: SkillLookupOptions): Promise<readonly SkillCandidate[] | SkillProviderObservation>

/**
 * Install or update one catalogue release and stream work through final settlement.
 * @param request - Published release and client-generated operation identity.
 * @param signal - Remote stream lifetime; disconnect requests cancellation and drains rollback.
 * @returns progress followed by exactly one committed or cancelled terminal frame.
 */
@Remote({ name: 'installSkill', mode: 'stream' }) async *install( request: PlatformSkillInstallRequest, signal: AbortSignal, ): AsyncIterable<PlatformSkillInstallProgress>

/**
 * Request cancellation without closing the progress stream and wait for rollback or commit.
 * @param operationId - Identity supplied when installation started.
 * @returns the actual terminal outcome; a commit that won the race remains successful.
 */
@Remote async cancel(operationId: PlatformSkillOperationId): Promise<PlatformSkillOperationSettlement>

/**
 * Remove one committed skill selection and then reclaim its immutable payload.
 * @param request - Local key and current catalogue identity of the installation to remove.
 * @param signal - Cancellation is honored before record removal commits.
 * @returns current committed installation state.
 */
@Remote('removeSkill') async remove(request: PlatformSkillRemovalRequest, signal: AbortSignal): Promise<PlatformSkillSnapshot>

/**
 * List effective candidates from only payloads selected by committed records.
 * @param options - Lookup cancellation and working-directory context.
 * @returns Complete candidates, or an explicitly incomplete observation.
 */
async listCandidates(options: SkillLookupOptions): Promise<readonly SkillCandidate[] | SkillProviderObservation>

/**
 * Load one candidate previously returned by {@link listCandidates}.
 * @param candidate - Candidate carrying the filesystem locator.
 * @param options - Lookup cancellation and working-directory context.
 * @returns The complete parsed skill, or undefined when its file was removed.
 */
getCandidate(candidate: SkillCandidate, options: SkillLookupOptions): Promise<SkillDefinition | undefined>
```

Types: [SkillCandidate](skills.md) · [SkillDefinition](skills.md) · [SkillLookupOptions](skills.md) · [SkillProviderObservation](skills.md)

Source: [`packages/insight/skill-center/src/host/platform-skills.ts`](../../packages/insight/skill-center/src/host/platform-skills.ts)
<!-- END GENERATED cordis-surface -->
