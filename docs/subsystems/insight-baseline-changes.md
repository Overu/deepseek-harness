# Insight baseline integration record

English | [中文](insight-baseline-changes.zh.md)

## Scope

This record identifies existing DSH files changed for the private Insight source intake and Desktop integration. It excludes unchanged upstream source and implementation files owned by new private packages. The official Desktop remains the default product and retains its startup, profile, account, window, and update behavior; the Insight path is selected explicitly before Electron reads product state.

## Existing file changes

| Files | Purpose | Retention condition |
| --- | --- | --- |
| `apps/desktop-host/package.json`, `apps/desktop/package.json` | Include the four private Insight packages in the existing recursive runtime and Main-process dependency closures | Required while Insight components ship with the desktop runtime |
| `apps/desktop/src/main.ts` and its tests | Select the product before `userData`, require Insight login before Host startup, bind one account Home and credential callback to the Host, expose renderer-safe account actions, apply branding, and relaunch only after account shutdown | Keep Insight lifecycle branches explicit while leaving the official path unchanged |
| `apps/desktop/src/product.ts`, `insight-startup.ts`, `insight-account-exit.ts`, `insight-native-brand.ts` and their tests | Own validated product/runtime identity, isolated authentication, native Home admission, ordered account teardown, and product-specific native labels outside the upstream Main flow | Retain as product modules rather than distributing Insight state through generic Desktop services |
| `apps/desktop/src/host-process.ts` and its tests | Carry bounded, validated, cancellable account-token requests only between the current Host child and Desktop Main | Preserve token isolation, current-child checks, and teardown cancellation for every Host consumer |
| `apps/desktop/src/preload-app.ts`, `preload-insight-login.ts`, `client/insight-login.tsx`, their tests, and `tsdown.config.ts` | Build a login renderer bridge and expose account summary/sign-out only to the authenticated top-level Insight workspace | Keep tokens and unrestricted Main IPC out of both renderer contexts |
| `apps/desktop/src/project-manager.ts`, `fatal-recovery.ts` and their tests | Preserve the four product-required bundles during profile creation, existing-profile preparation, and plugin recovery; install account-scoped recovery only after login | Never let pre-authentication recovery open the official or a different account Home |
| `apps/desktop/scripts/dev.ts`, `development-app.ts`, `electron-builder-config.mjs`, its declaration, and their tests | Apply the Insight application id, names, icons, isolated development data, package metadata, and product/runtime version split; copy the root bundled skills directory as an Insight-only resource | Keep build identity and resource copying conditional so official artifacts and signing inputs remain unchanged |
| `apps/desktop/scripts/package-target.ts` and its tests | Pack the exact private components before Desktop closure selection and record the Insight product version separately from the DSH runtime version | Keep private desktop packing and release identity independent of public release-family membership |
| `apps/desktop/electron-builder.config.d.mts`, `apps/desktop/scripts/smoke-packaged-runtime.ts`, their tests, and `scripts/run-gates.ts` | Validate the product-specific package metadata and run the Integration real-Loader test in the built-smoke inventory | Keep packaged checks aligned with the Insight product artifact and private bundle runtime entry |
| `apps/desktop/tsconfig.host.json`, `tsconfig.client.json` | Reference the portable Integration Host and Client compiler faces from the Desktop build | Keep Electron imports in Desktop-owned adapters and portable package faces explicit |
| `apps/desktop/src/insight-permissions.ts`, `main.ts`, `product.ts` and their tests | Apply the approved Insight-only clipboard, fullscreen, and primary-audio permission matrix; provide native restart/log/zoom/fullscreen menu actions; inject the fixed required-bundle policy, bundled Node path, and existing bundled skill directory after login-shell resolution | Preserve the official product path; recheck both permission callbacks, native frame ownership, OS audio authorization, primary-runtime layout, and product asset paths after every baseline update |
| `packages/boot/plugin-manager/src/{index,types,tools,diagnostic,product-policy}.ts`, tests, and package metadata | Merge default-empty required-bundle configuration with trusted product policy and reject component disable, removal, update, or replacement, including install aliases and archives | Keep operation-level enforcement, transactional manifest restoration, bounded archive parsing, and user registry settings; remove the local policy only when the baseline supplies equivalent protection |
| `packages/client/ui-plugin-manager/src/client/{presentation,locales}.ts` and its component tests | Explain the existing read-only state for product-required components | Keep the display derived from Host policy and preserve internal component feature switches |
| `packages/client/ui-conversation/src/client/contract/input.ts`, `input/facade.ts`, `input/selected-skills.ts`, its README, and typed Client test consumers | Restore the approved `toggleSkill` action over live editor text and derive `selectedSkills` without scanning reference, Quote, or command contents | Keep visible draft semantics, per-Session ownership, busy/disposed protection, and the local edit regression tests; review editor projection and action signatures after baseline updates |
| `packages/llm/llm-pi-ai/src/index.ts` and `tests/adapter.spec.ts` | Publicly export the existing `resolveProfiles`, `credentialStoreFrom`, and `authContextFrom` helpers used to construct the managed Gateway adapter | User-authorized additive exports only; preserve their upstream implementations and remove the local export diff when the baseline provides them |
| `pnpm-workspace.yaml`, `pnpm-lock.yaml` | Resolve the iframe and its retained Motion dependency edges under one root lock and build policy | Keep until the iframe has another explicit supported build owner |
| `tsconfig.base.json`, `tsconfig.host.json`, `tsconfig.client.json` | Resolve retained external plugin names, including Integration entry points, to source and compile each face explicitly | Keep while those identities remain outside the generated DSH aliases |
| `scripts/check-workspace-constraints.ts` and its tests | Enforce exact private identity, root version, publication metadata, and unique ownership | Replace only with an equally restrictive upstream product-input rule |
| `scripts/package-dependency-policy.ts` and its tests | Classify exact Host values, retain the shared tool peer, and reject unreviewed exports | Preserve shared-service peers; never expand this to whole-package safety |
| `scripts/npm-baseline-packages.ts` and its tests | Exclude the exact private inputs from public npm baseline publication | Keep the publication denial when discovery changes |
| `scripts/product-package-policy.ts`, `scripts/verify-product-use.ts` and its tests | Identify Insight-required components without mounting them in the official default profile | Remove the declaration only when actual product reachability supersedes it |
| `.gitattributes` | Preserve synchronized skill bytes and two upstream Canvas HTML assets across Git staging and checkout | Keep source replay independent of line-ending conversion |
| `package.json`, `.gitignore` | Expose skill-label generation and source replay; retain public Canvas route config, include the iframe's real `legacy/src/lib` sources, and ignore generated outputs | Keep while the client consumes synchronized root skill labels |
| `scripts/translation-pairing.ts` and its tests, `docs/i18n/README.md` and its pair | Keep externally synchronized root skills outside local documentation rewriting | Required while the source repository owns this directory |
| `scripts/rescope-vendor.ts` and its tests | Preserve synchronized root skills and accommodate the larger tracked file inventory | Keep external skill assets outside repository-owned rewriting |
| `scripts/verify-application-entrypoints.ts` | Classify the retained Memory data-sync worker and skill helper by their existing owners | Remove classifications only when the corresponding helpers retire |
| `scripts/persistence-schema.ts` and its tests | Keep TypeScript declaration roots from referenced Host programs without treating allowed JavaScript as TypeScript roots | Required while referenced packages may contain JavaScript Host inputs |
| `docs/config-catalog*`, `docs/event-producer-consumer*`, the Client slot catalog and the composition-reference package list | Regenerate declarations and references for the new private inputs | Regenerate from source; never hand-edit generated content |
| `docs/persistence-catalog*`, `docs/persistence-schema.json` | Describe the two attribution-only Canvas message-source additions | Keep the new acknowledgement; preserve accepted history and the writer version |
| `packages/README.md` and its pair, `docs/subsystems/README.md` and its pair | Link the new group and state its private product role | Maintain with the package group |

## New integration owners

The exact private package roster lives in [insight-package-policy.ts](../../scripts/insight-package-policy.ts). [Insight product integration](insight.md) describes runtime ownership, source snapshots, and synchronized skills. The [Desktop Integration package](../../packages/insight/desktop-integration/README.md) owns authentication and account process behavior. Each fixed business package's `upstream.json` and the replayable differences under `patches/insight` identify imported code and local adaptation.

`bundled-skills` keeps its source repository's internal structure. The imported label generator preserves the previous directory-to-client metadata flow. Its test uses synthetic files; it does not assess built-in skill content or business results.

[The Canvas source acknowledgement](../persistence-changes/2026-10-28-insight-canvas-attribution.md) records reader compatibility without changing the Session writer or migrating user data.

## Baseline synchronization

Review every row against an incoming baseline. Remove local changes only after the replacement preserves the listed product selection, login ordering, account isolation, credential containment, release identity, and publication guarantees. Update this record when an existing official file changes; private package edits remain tracked by their package documentation, source record, and Git history.

## Host value dependency classification

`createUserMessage`, `BlockAssembler`, and `domainTable` are exact safe Host exports. They return structural values or retain caller-owned state; they do not require consumers to share a service constructor or module-level state. Canvas and Prompt declare their corresponding runtime dependency edges. `defineTool` remains a shared peer because its argument failures must retain the Host pipeline’s error-class identity. Other exports from these provider packages retain their existing classifications. A pull request carrying these additions must disclose them under a prominent Host dependency classification heading as required by `scripts/package-dependency-policy.ts`.

The managed Gateway imports `LlmAdapter`, `LlmError`, and `resolveImageAttachmentAccess` from `dsh-llm`, `resolveAdapterOptions` from `dsh-llm-deepseek`, and `PiAiAdapter`, `resolveProfiles`, `credentialStoreFrom`, and `authContextFrom` from `dsh-llm-pi-ai`. These eight exact exports are peer-required: the private bundle uses the Host's adapter, error, profile, and auth implementations rather than installing another provider copy. They add no duplicate-safe exceptions.

## Dev Note

None.
