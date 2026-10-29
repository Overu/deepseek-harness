# Insight baseline integration record

English | [中文](insight-baseline-changes.zh.md)

## Scope

This record identifies the existing DSH files changed for the private Insight source intake. It excludes unchanged upstream source and new package implementation files. The official Desktop startup, authentication, profile activation, window policy, and updater are unchanged.

## Existing file changes

| Files | Purpose | Retention condition |
| --- | --- | --- |
| `apps/desktop-host/package.json` | Include the three private source packages in the existing recursive desktop dependency closure | Required while Insight components ship with the desktop runtime |
| `apps/desktop/scripts/package-target.ts` and its tests | Pack the exact private components before Desktop closure selection | Keep private desktop packing independent of public release-family membership |
| `pnpm-workspace.yaml`, `pnpm-lock.yaml` | Resolve the iframe and its retained Motion dependency edges under one root lock and build policy | Keep until the iframe has another explicit supported build owner |
| `tsconfig.base.json`, `tsconfig.host.json`, `tsconfig.client.json` | Resolve retained external plugin names to source and compile each face explicitly | Keep while those identities remain outside the generated DSH aliases |
| `scripts/check-workspace-constraints.ts` and its tests | Enforce exact private identity, root version, publication metadata, and unique ownership | Replace only with an equally restrictive upstream product-input rule |
| `scripts/package-dependency-policy.ts` and its tests | Classify exact Host values, retain the shared tool peer, and reject unreviewed exports | Preserve shared-service peers; never expand this to whole-package safety |
| `scripts/npm-baseline-packages.ts` and its tests | Exclude the exact private inputs from public npm baseline publication | Keep the publication denial when discovery changes |
| `scripts/product-package-policy.ts`, `scripts/verify-product-use.ts` and its tests | Identify Insight-required components without mounting them in the official default profile | Remove the declaration only when actual product reachability supersedes it |
| `.gitattributes` | Preserve synchronized skill bytes and two upstream Canvas HTML assets across Git staging and checkout | Keep source replay independent of line-ending conversion |
| `package.json`, `.gitignore` | Expose skill-label generation and source replay; retain public Canvas route config and ignore generated outputs | Keep while the client consumes synchronized root skill labels |
| `scripts/translation-pairing.ts` and its tests, `docs/i18n/README.md` and its pair | Keep externally synchronized root skills outside local documentation rewriting | Required while the source repository owns this directory |
| `scripts/rescope-vendor.ts` and its tests | Preserve synchronized root skills and accommodate the larger tracked file inventory | Keep external skill assets outside repository-owned rewriting |
| `scripts/verify-application-entrypoints.ts` | Classify the retained Memory data-sync worker and skill helper by their existing owners | Remove classifications only when the corresponding helpers retire |
| `scripts/persistence-schema.ts` and its tests | Keep TypeScript declaration roots from referenced Host programs without treating allowed JavaScript as TypeScript roots | Required while referenced packages may contain JavaScript Host inputs |
| `docs/config-catalog*`, `docs/event-producer-consumer*`, the Client slot catalog and the composition-reference package list | Regenerate declarations and references for the new private inputs | Regenerate from source; never hand-edit generated content |
| `docs/persistence-catalog*`, `docs/persistence-schema.json` | Describe the two attribution-only Canvas message-source additions | Keep the new acknowledgement; preserve accepted history and the writer version |
| `packages/README.md` and its pair, `docs/subsystems/README.md` and its pair | Link the new group and state its private product role | Maintain with the package group |

## New integration owners

The exact private package roster lives in [insight-package-policy.ts](../../scripts/insight-package-policy.ts). [Insight source ownership](insight.md) describes source snapshots and synchronized skills. Each package's `upstream.json` and the replayable differences under `patches/insight` identify imported code and local adaptation.

`bundled-skills` keeps its source repository's internal structure. The imported label generator preserves the previous directory-to-client metadata flow. Its test uses synthetic files; it does not assess built-in skill content or business results.

[The Canvas source acknowledgement](../persistence-changes/2026-10-28-insight-canvas-attribution.md) records reader compatibility without changing the Session writer or migrating user data.

## Baseline synchronization

Review every row against an incoming baseline. Remove local changes only after the replacement preserves the listed ownership and publication guarantees. Update this record when an existing official file changes; private package edits remain tracked by their source record and Git history.

## Host value dependency classification

`createUserMessage`, `BlockAssembler`, and `domainTable` are exact safe Host exports. They return structural values or retain caller-owned state; they do not require consumers to share a service constructor or module-level state. Canvas and Prompt declare their corresponding runtime dependency edges. `defineTool` remains a shared peer because its argument failures must retain the Host pipeline’s error-class identity. Other exports from these provider packages retain their existing classifications. A pull request carrying these additions must disclose them under a prominent Host dependency classification heading as required by `scripts/package-dependency-policy.ts`.

## Dev Note

None.
