# Insight 服务 API

[English](insight.md) | 中文

产品架构、账号数据和源码归属由 [Insight Desktop 文档](../insight/README.zh.md)及其[架构参考](../insight/architecture.zh.md)维护。

## 平台技能安装类型

[技能子系统](skills.zh.md)定义通用发现和加载。以下账号本地安装类型定义于 [`skill-installation.ts`](../../packages/insight/skill-center/src/shared/skill-installation.ts)。

- `InsightSkillId` 是带品牌的 OSS 目录标识；`PlatformSkillKey` 是独立的账号本地存储键。
- `SkillIdentity` 包含可选的 `id` 和必填的技术名 `skillName`。双方均有 ID 时必须相同，否则要求唯一的精确技术名匹配。
- `InstalledPlatformSkill` 增加本地 `key` 和已提交的 `version`；`PlatformSkillSnapshot` 包含当前 `skills` 集合。
- `PlatformSkillOperationId` 标识一次安装或更新尝试。`PlatformSkillInstallRequest` 提供技能身份、版本、操作 ID、下载地址和可选目标键；`PlatformSkillRemovalRequest` 提供本地键和当前身份。
- `PlatformSkillInstallProgress` 会报告其 `operationId`。`download` 帧包含 `receivedBytes` 和可选的 `totalBytes`；`validate` 与 `commit` 帧分别标识相应阶段。
- `PlatformSkillOperationSettlement` 为终止状态：`complete` 包含已提交的 `skill`，而 `cancelled` 仅在取消已排空后包含操作 ID。若取消输给提交竞争，则会以 `complete` 结束。

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
 * Admit one automatic preset installation during this account Host lifetime.
 * @returns True only for the first caller, including when that attempt later fails.
 */
@Remote claimPresetInstallation(): boolean

/**
 * List configured platform skills eligible for this account's first automatic installation.
 * @param catalogue - Published identities used to resolve configured selectors.
 * @param signal - Optional cancellation of this eligibility read.
 * @returns Identities absent from both installed records and account installation history.
 */
@Remote listPendingPresets(catalogue: readonly SkillIdentity[], signal?: AbortSignal): Promise<readonly SkillIdentity[]>

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
 * @param request - Technical name of the installation to remove.
 * @param signal - Cancellation is honored before record removal commits.
 * @returns current committed installation state.
 */
@Remote('removeSkill') async remove(request: PlatformSkillRemovalRequest, signal: AbortSignal): Promise<PlatformSkillSnapshot>

/**
 * List committed account candidates followed by package-owned skills, omitting a package candidate with an installed name.
 * @param options - Lookup cancellation and working-directory context.
 * @returns Complete candidates, or an explicitly incomplete observation.
 */
async listCandidates(options: SkillLookupOptions): Promise<readonly SkillCandidate[] | SkillProviderObservation>

/** Register a trusted package's single root skill below account installations and above legacy roots.
 * @param root - Absolute package-owned skill directory containing SKILL.md.
 * @param skillName - Expected invocation name in the skill frontmatter.
 * @returns Disposer that removes this package's candidate and refreshes skill discovery.
 */
async registerPackagedSkillRoot(root: string, skillName: string): Promise<() => void>

/**
 * Load one candidate previously returned by {@link listCandidates}.
 * @param candidate - Candidate carrying the filesystem locator.
 * @param options - Lookup cancellation and working-directory context.
 * @returns The complete parsed skill, or undefined when its file was removed.
 */
getCandidate(candidate: SkillCandidate, options: SkillLookupOptions): Promise<SkillDefinition | undefined>
```

Types: [SkillCandidate](skills.zh.md) · [SkillDefinition](skills.zh.md) · [SkillLookupOptions](skills.zh.md) · [SkillProviderObservation](skills.zh.md)

Source: [`packages/insight/skill-center/src/host/platform-skills.ts`](../../packages/insight/skill-center/src/host/platform-skills.ts)
<!-- END GENERATED cordis-surface -->
