---
description: "Insight Desktop authentication, account-isolated DSH Home selection, safe Main-to-Host credentials, workspace branding, and sign-out lifecycle for maintainers of the private desktop distribution."
kind: "package-bundle"
---

# @insight-ai/desktop-integration

English | [中文](README.zh.md)

## Summary

Insight Desktop uses this private bundle for product branding, authentication before Host startup, one account-scoped DSH Home, a Host-only credential service, a managed model gateway, signed-in account settings, and signed update policy. The Insight profile adds it during startup and profile upgrade, and restores it during plugin recovery. The official Desktop profile does not include it. The Insight application owns this private bundle's version and initial activation.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Business services](#business-services)
- [Desktop updates](#desktop-updates)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

### Product-owned activation

The Insight application adds `@insight-ai/desktop-integration` to its account profile after authentication selects a safe Home. Profile preparation adds a missing declaration to an existing account profile, and plugin recovery retains the bundle while disabling other third-party bundles. The package is private and has no standalone installation path; the official Desktop composition remains unchanged.

### What you get

Before a Host exists, the native login window retains the Insight brand panel, interactive dot field, and SMS/password forms, with consent links, credential restoration, and account-scoped Home selection. Desktop Main keeps the credential in encrypted Electron storage for packaged builds and exposes only renderer-safe login state. Bundled service and privacy documents open inside the login window with fixed header and footer controls, a scrolling reading area, Escape dismissal, and focus restoration. Reading or closing a document does not accept it or submit authentication.

After the workspace opens, the bundle fills the sidebar and conversation hero brand occupants with Insight artwork, adds the avatar and account menu with handbook, settings, and sign-out actions to the sidebar footer, and mounts `ctx.insightAccount` in the Host. Trusted Host plugins can request the current access token through bounded, cancellable child-process IPC. The browser receives the display name, masked phone, avatar URL, product/runtime information, and sign-out operation; it never receives the access token.

Settings opens only from the account menu. The `settings.launcher` occupant forwards requests to the existing settings shell without rendering a separate sidebar button.

The native update window checks signed stable releases on request and through the existing background schedule. Clicking its Insight mark five times within three seconds opens a native risk confirmation and, after approval, performs one candidate check; candidate releases are never checked automatically. Discovery does not download, and download does not authorize installation.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Desktop Main selects the Insight product before Electron reads `userData`, completes login, validates the account Home, and then starts one Host with an immutable account context. The standalone login surface is exported as `@insight-ai/desktop-integration/client/login`, and its stylesheet is exported under `@insight-ai/desktop-integration/client/*.css`; both stay on the Client compiler face. The bundle patch disables the upstream account route and official brand occupants only in the Insight profile. The official product starts with its existing profile and account composition.

This package is both the selected profile bundle and the owner of its Host plugin. Its `cordis.patch.yml` must mount that plugin as `./lib/index.js`; bundle patch parsing anchors the relative path beside the patch file. DSH runtime package lookup excludes a selected bundle package itself, so the row must never use the self-package name `@insight-ai/desktop-integration`. This is a package-resolution requirement, not a Loader ordering requirement.

Client activation mounts this package's generated Remote contribution before installing the product slots. The skill namespace is created by that mount and retires with the Client plugin.

The Host service validates request and response fields, limits concurrent token requests, applies a deadline, and cancels pending requests when the caller aborts or the IPC channel closes. Desktop Main accepts requests only from the current Host child and discards late responses after shutdown or replacement. Sign-out revokes new account access, hides the workspace, stops account-owned resources, clears authentication, and relaunches into the login gate only after shutdown completes.

Update discovery verifies an Ed25519-signed rollout, release or target manifest, updater metadata, target identity, version, size, and SHA-512 before the Desktop adapter creates an electron-updater custom provider. Desktop Main owns the only updater instance across login and workspace startup. The renderer receives status and fixed actions, but no feed URL, local path, signing key, or trusted artifact identity.

### Source map

| File | Role |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | Insight-only Host and Client composition changes |
| [`src/desktop.ts`](src/desktop.ts) | Main-process authentication, credential storage, account scope, and Home preparation exports |
| [`src/protocol.ts`](src/protocol.ts) | Renderer-safe Desktop APIs and validated parent/Host IPC messages |
| [`src/host/`](src/host/) | Host-only `ctx.insightAccount` provider and managed Gateway adapter |
| [`src/client/`](src/client/) | Workspace brand, account-footer occupants, and categorized skill picker |
| [`src/desktop/update/`](src/desktop/update/) | Signed rollout verification, source resolution, durable local choices, and product update policy |
| [`src/client/update/`](src/client/update/) | Renderer-safe native update-window presentation |

</details>

-----

<a id="business-services"></a>
## Business services

The Host mounts an Insight enterprise search provider through DSH's public Web registry. Each search creates an isolated upstream provider whose token request receives that search's cancellation signal. Shutdown unregisters the provider, aborts admitted work, and waits for it before the account service is released.

Bundled skills call a loopback proxy through an account-local descriptor at `$DSH_HOME/skill-proxy/connection.json`. The descriptor has a one-launch capability and contains no account token. The proxy accepts only capability-authenticated JSON POST requests, forwards only the fixed Insight skill service route, streams NDJSON with backpressure, and removes only the descriptor it owns during shutdown. It uses the bundled primary-runtime Node binary selected by Desktop Main. Admission bounds are eight active requests, 16 MiB buffered request bodies, and a 1,250-second request deadline. A transport or stream failure after forwarding is reported as an unknown outcome and is never retried automatically.

The Insight skill picker reads the three supported skill locations: the bundled directory, `$DSH_HOME/skills`, and `$DSH_AGENTS_HOME/skills`. It delegates precedence to DSH's active Session skill registry, so shadowed, disabled, unavailable, and temporarily invalid entries remain visible but cannot be selected. It refreshes while open and after browser focus, retains only its current Session's last successful directory after a refresh failure, and marks retained entries unconfirmed and unselectable. Selection calls the native input action, which writes or removes a visible `/name` token without replacing reference, quote, command, or attachment state; it never creates hidden prompt context. The regular DSH slash picker remains available for project-local skills.

The picker groups bundled skills under Platform presets and account/shared skills under User custom skills. Its compact trigger opens a search field, two source tabs, and a separately scrolling list with skill titles, short descriptions, and selection marks. Optional `ui.json` beside each installed instruction supplies `displayName` and `shortDescription`; missing or unreadable presentation falls back to the native name and description without changing invocation identity or instruction content.

The inventory Remote is generated from the decorated `InsightSkillInventory` service and is consumed through the package's `./remote` entry. Do not replace it with a hand-maintained Typert descriptor.

-----

<a id="desktop-updates"></a>
## Desktop updates

Insight uses product version `1.0.9` as its migration baseline; the first candidate version is `1.0.10-rc.1`. Product versions remain independent from the embedded DSH runtime version. Stable V2 rollout documents accept final versions and retain compatibility with the released Shell reader. Candidate V3 documents accept prerelease versions for new clients because the released Shell V2 reader rejects rc versions.

The packaged application contains a fixed HTTPS distribution origin and an Ed25519 public key. Stable discovery verifies one signed index containing all three targets. Candidate discovery verifies one target-specific manifest. Both paths bind updater metadata to one payload filename, byte size, and SHA-512 digest before the native coordinator checks or downloads it. The first native delivery disables differential download so blockmap naming cannot redirect the authenticated full payload.

Automatic checks use only the stable track. The five-click candidate action stores the user's opt-in after native confirmation but performs only that one manual check. A skipped optional version is suppressed during later automatic checks. A required stable release prevents candidate checks. Installation reuses DSH task inspection, shutdown, and restart coordination rather than a second product updater.

Rollout history, candidate opt-in, and skipped-version choices are installation-level Desktop state. They are available before account login and do not belong to an account Home or Session history.

Release construction and OSS publication are separate operations documented by the [Insight release scripts](../../../scripts/insight-release/README.md). The package does not read publishing credentials, Apple signing material, or the update signing private key.

-----

<a id="further-exploration"></a>
## Further Exploration

- [Insight subsystem](../../../docs/subsystems/insight.md) — product identity, startup ordering, account storage, process data flow, and stage boundaries.
- [Insight baseline integration record](../../../docs/subsystems/insight-baseline-changes.md) — official DSH files changed for the private distribution.
- [Insight package map](../README.md) — adjacent private product components and their activation status.
- [Desktop application architecture](../../../docs/architecture.md) — upstream Desktop profile, Host, and Client composition.

-----

<a id="model-experience"></a>
## Model Experience

### Account credential

#### What the model sees

Nothing directly. The `insightAccount` service supplies an access token only to trusted Host consumers and adds no prompt section, tool schema, message, or Session event.

#### Token effect

The fixed `yinsai-gateway/deepseek-flash` provider uses normal Agent request tokens; the account service adds no prompt text. Users do not configure model credentials, and the product composition disables the Models settings page.

#### KV Cache effect

No direct effect. Account presentation and authentication state stay outside model requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Account Homes are reused, not transformed by selection** — Insight starts the Host from the account's existing `harness` directory, where normal DSH profile, storage, and Session writes continue. A `harness-native` directory without `harness` reports `pre-release-data`, does not create an empty fallback Home, and requires product maintenance to decide recovery.
- **Insight product UI is Chinese-only** — the login, account footer, update window, and Insight native labels do not provide locale selection or translations.
- **Online update delivery is not yet qualified for production** — a local macOS arm64 package passed Developer ID signing, App and DMG notarization, staple, and independent system assessment, but it came from a dirty worktree rather than CI. macOS x64, native production-feed installation, old-client upgrade, the three-target CI run, and OSS/CDN publication still require recorded execution. Insight Windows packages intentionally omit Authenticode under the product decision; their update documents and payload identity still require Ed25519 verification, size, and SHA-512 checks.
- **The Host credential service has no browser or Remote API** — only same-process Host plugins can consume it, and they receive structured failure reasons rather than Main-process diagnostics.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
