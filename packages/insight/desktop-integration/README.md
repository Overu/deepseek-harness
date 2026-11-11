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

Before a Host exists, the native login window retains the Insight brand panel, interactive dot field, and SMS/password forms, with consent links, credential restoration, and account-scoped Home selection. The window stays hidden while saved credentials are restored; successful authentication and Home preparation enter the workspace directly, while unavailable credentials or Home admission failures show the existing login or recovery surface. Desktop Main keeps the credential in encrypted Electron storage for packaged builds and exposes only renderer-safe login state. Bundled service and privacy documents open inside the login window with fixed header and footer controls, a scrolling reading area, Escape dismissal, and focus restoration. Reading or closing a document does not accept it or submit authentication.

After the workspace opens, the bundle fills the sidebar and conversation hero brand occupants with Insight artwork, adds the avatar and account menu with handbook, settings, and sign-out actions to the sidebar footer, and mounts `ctx.insightAccount` in the Host. Trusted Host plugins can request the current access token through bounded, cancellable child-process IPC. The browser receives the display name, masked phone, avatar URL, product/runtime information, and sign-out operation; it never receives the access token.

The sidebar, conversation hero, login, and update windows share `src/client/assets/brand-mark.svg`: a white Insight mark on a rounded blue tile with fixed color and spacing in both themes. Desktop application icons in `resources/branding/` use the same artwork. The expert-skill control uses the Shell four-point outline mark. Account entries keep a provided avatar image; otherwise they show the first trimmed display-name character on a blue badge, falling back to “因”. The collapsed sidebar keeps the same account menu.

Settings opens only from the account menu. The `settings.launcher` occupant forwards requests to the existing settings shell without rendering a separate sidebar button.

The native update window uses the same regular checks as the background schedule: stable applications check signed stable releases; prerelease applications also check candidates when no stable update is available. Clicking its Insight mark five times within three seconds opens a native risk confirmation and, after approval, performs one explicit candidate check. Discovery does not download, and download does not authorize installation.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Desktop Main selects the Insight product before Electron reads `userData`, completes login, validates the account Home, and then starts one Host with an immutable account context. The standalone login surface is exported as `@insight-ai/desktop-integration/client/login`, and its stylesheet is exported under `@insight-ai/desktop-integration/client/*.css`; both stay on the Client compiler face. The bundle patch disables the upstream account route and official brand occupants only in the Insight profile. The official product starts with its existing profile and account composition.

This package is both the selected profile bundle and the owner of its Host plugin. Its `cordis.patch.yml` must mount that plugin as `./lib/index.js`; bundle patch parsing anchors the relative path beside the patch file. DSH runtime package lookup excludes a selected bundle package itself, so the row must never use the self-package name `@insight-ai/desktop-integration`. This is a package-resolution requirement, not a Loader ordering requirement.

The Host service validates request and response fields, limits concurrent token requests, applies a deadline, and cancels pending requests when the caller aborts or the IPC channel closes. Desktop Main accepts requests only from the current Host child and discards late responses after shutdown or replacement. Sign-out revokes new account access, hides the workspace, stops account-owned resources, clears authentication, and relaunches into the login gate only after shutdown completes.

Non-cancelled Gateway failures retain a redacted diagnostic in their existing Session-visible LLM failure message. It distinguishes Main account-token retrieval from model request or stream failures and includes only structured source, code, errno, syscall, or HTTP-status facts when available. It excludes credentials, headers, prompts, request and response bodies, URLs, and Session identifiers. PiAi may discard an upstream cause, so a generic transport failure cannot always be narrowed further.

Update discovery verifies an Ed25519-signed rollout, release or target manifest, updater metadata, target identity, version, size, and SHA-512 before the Desktop adapter creates an electron-updater custom provider. Desktop Main owns the only updater instance across login and workspace startup. The renderer receives status and fixed actions, but no feed URL, local path, signing key, or trusted artifact identity.

### Source map

| File | Role |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | Insight-only Host and Client composition changes |
| [`src/desktop.ts`](src/desktop.ts) | Main-process authentication, credential storage, account scope, and Home preparation exports |
| [`src/protocol.ts`](src/protocol.ts) | Renderer-safe Desktop APIs and validated parent/Host IPC messages |
| [`src/host/`](src/host/) | Host-only `ctx.insightAccount` provider and managed Gateway adapter |
| [`src/client/`](src/client/) | Workspace brand and account-footer occupants |
| [`src/desktop/update/`](src/desktop/update/) | Signed rollout verification, source resolution, durable local choices, and product update policy |
| [`src/client/update/`](src/client/update/) | Renderer-safe native update-window presentation |

</details>

-----

<a id="business-services"></a>
## Business services

The Host mounts an Insight enterprise search provider through DSH's public Web registry. Each search sends the current Insight account token as `Authorization: Bearer` and `x-api-key` to the enterprise Gateway's `/messages` endpoint. Each search creates an isolated upstream provider whose token request receives that search's cancellation signal. Shutdown unregisters the provider, aborts admitted work, and waits for it before the account service is released.

Installed platform skills call a loopback proxy through an account-local descriptor at `$DSH_HOME/skill-proxy/connection.json`. The descriptor has a one-launch capability and contains no account token. The proxy accepts only capability-authenticated JSON POST requests, forwards only the fixed Insight skill service route, streams NDJSON with backpressure, and removes only the descriptor it owns during shutdown. It uses the bundled primary-runtime Node binary selected by Desktop Main. Admission bounds are eight active requests, 16 MiB buffered request bodies, and a 1,250-second request deadline. A transport or stream failure after forwarding is reported as an unknown outcome and is never retried automatically.


-----

<a id="desktop-updates"></a>
## Desktop updates

Insight uses product version `1.0.9` as its migration baseline. Product versions remain independent from the embedded DSH runtime version. Candidate and Stable are channels: both accept final versions through the Shell-compatible V2 format; Candidate additionally accepts prerelease versions through V3. The released Shell reader rejects rc versions.

The packaged application contains a fixed HTTPS distribution origin and an Ed25519 public key. Stable discovery verifies one signed index containing all three targets. Candidate discovery in the current source authenticates both V2 and V3 target pointers, selects the highest version, and verifies its target-specific manifest. Only HTTP 404 means a pointer is absent; an invalid pointer or a withdrawn highest version cannot trigger fallback to an older release. Both paths bind updater metadata to one payload filename, byte size, and SHA-512 digest before the native coordinator checks or downloads it. The first native delivery disables differential download so blockmap naming cannot redirect the authenticated full payload. The dual-protocol reader is included in `1.0.11-rc.1`; [operations](../../../docs/insight/operations.md#current-delivery-state) records the published client compatibility.

Desktop Main supplies an Electron fetch adapter that fills only a missing, nonredirected response URL under `redirect: error`. The resolver still rejects unexpected URLs, redirects, invalid signatures, and mismatched payload metadata.

Regular checks prefer a stable release. A prerelease application checks candidates only after the stable check reports no update; stable applications do not check candidates automatically. The five-click candidate action stores the user's opt-in after native confirmation but performs only that one manual check. A skipped optional version is suppressed during later automatic checks. A required stable release prevents candidate checks. Installation reuses DSH task inspection, shutdown, and restart coordination rather than a second product updater.

The update window keeps download progress and the explicit install-and-restart action in one place. That click approves only the selected target for the current installation attempt; approval clears on every completion or failure. With no active tasks, installation proceeds without a second ordinary confirmation. Active tasks still require approval to stop; direct coordinator entries, target changes, and mandatory policy retain their confirmations. Task inspection, locking, rejection of newly started tasks, and clean shutdown remain in force. On macOS, any required confirmation uses the same live update window, falling back to the workspace if it has closed. Windows retains the original confirmation owner while native-frame overlay adaptation is deferred. Download completion alone never authorizes installation.

Unpackaged source development does not check, download, or install client updates. Opening its update entry shows a native information prompt directing developers to an installed release; packaged applications retain update-source validation.

Rollout history, candidate opt-in, and skipped-version choices are installation-level Desktop state. Candidate protocols share the `candidate/<target>` history; the earlier `candidate-v3/<target>` history remains a read-only compatibility input. They are available before account login and do not belong to an account Home or Session history.

Release construction and OSS publication are separate operations documented by the [Insight release scripts](../../../scripts/insight-release/README.md). The package does not read publishing credentials, Apple signing material, or the update signing private key.

-----

<a id="further-exploration"></a>
## Further Exploration

- [Insight architecture](../../../docs/insight/architecture.md) — product identity, startup ordering, account storage, process data flow, and stage boundaries.
- [Insight baseline integration record](../../../docs/insight/baseline-changes.md) — official DSH files changed for the private distribution.
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

### Tool argument recovery

#### What the model sees

When the Gateway returns completed tool arguments that fail JSON parsing, the Host retries the model request once in the same Agent step. The Session records the retry context. A second parse failure ends the step before any tool from either failed attempt runs.

##### Retry prompt

```markdown
The previous tool call arguments could not be parsed as JSON. No tools ran in that attempt. Regenerate valid JSON. If the tool supports batching, submit a smaller batch.
```

#### Token effect

Recovery uses one additional model request with a short context message.

#### KV Cache effect

The retry appends runtime context after the existing request history.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Account Homes are reused, not transformed by selection** — Insight starts the Host from the account's existing `harness` directory, where normal DSH profile, storage, and Session writes continue. A `harness-native` directory without `harness` reports `pre-release-data`, does not create an empty fallback Home, and requires product maintenance to decide recovery.
- **Insight product UI is Chinese-only** — the login, account footer, update window, and Insight native labels do not provide locale selection or translations.
- **The bundled DSH CLI is outside the Insight product surface** — Insight does not support, adapt, or provide compatibility for bundled `dsh` installation or command entry points. This does not remove the Host, Agent shell, Memory external CLI, expert-skill scripts, or bundled Node runtime used by their existing product integrations.
- **Release and migration evidence has a limited scope** — `1.0.11-rc.1` completed three-platform CI, macOS signing/notarization, and Candidate publication. Both the published `1.0.10` reader and current reader verified its three CDN targets. Native upgrade and data-continuity feedback remains in [follow-ups](../../../docs/insight/follow-ups.md#user-and-platform-feedback). Insight Windows packages intentionally omit Authenticode; update documents and payload identity still require Ed25519 verification, size, and SHA-512 checks.
- **The Host credential service has no browser or Remote API** — only same-process Host plugins can consume it, and they receive structured failure reasons rather than Main-process diagnostics.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
