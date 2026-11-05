---
description: "Open the Insight skill center from the sidebar."
kind: "package-bundle"
---

# @insight-ai/skill-center

English | [中文](README.zh.md)

## Summary

Open **Skill center** below **Plugins** in the Insight sidebar to browse and manage published platform skills. Search by name, ID, or summary, inspect skill details, then install, update, or remove a skill for the signed-in account.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Select **Skill center** to browse the cards in the main column. Opening the page reads the [OSS catalog](https://insight-desktop-updates.oss-cn-guangzhou.aliyuncs.com/desktop/skills/skills.json). Search filters the downloaded catalog as you type or submit the search form. A failed read displays **Retry**; an empty published catalog has a separate empty state. **View details** opens the full description. Each card shows **Install**, **Installed**, or **Update** from the current account's installed version. Details for an installed skill also offer **Remove**. Installation and updates show a blocking progress dialog with **Cancel**. Cancellation or failure before commit leaves no first installation and retains a previous installed version. A completed commit reports success even if cancellation arrives too late. Select **Plugins** or a conversation to leave the page. The bundle supplies Chinese and English copy; other languages use the locale registry's fallback.

Directory requests time out after 15 seconds, including the JSON body. Set `catalogRequestTimeoutMs` in the plugin configuration in `cordis.yml` to change this positive millisecond budget; the page adopts it on reload.

The Host separately limits one skill archive's request duration, compressed bytes, archive entries, extracted bytes, and allowed download origins. Configure `packageRequestTimeoutMs`, `packageMaxDownloadBytes`, `packageMaxEntries`, `packageMaxExtractedBytes`, and `packageAllowedOrigins` as described by [config.ts](src/config.ts).

Removing a skill deletes its installation record and its skill-specific payload directory, including leftover releases. Startup also reclaims abandoned releases and empty skill directories. Shared account storage directories remain available for other installations. Cleanup failures are logged and retried at the next startup.

The same bundle owns the **Expert skills** input picker. An empty list offers a button inside the scroll area that closes the picker and opens Skill center. It groups platform installations separately from user skills and retains legacy shared skills as read-only entries under user skills; legacy entries are not assigned to the current account or modified by the skill center.

Configure `presetSkillIds` with OSS `id` values written as strings to install defaults after the account UI is ready. The Insight bundle selects IDs `1` through `15` in [cordis.patch.yml](cordis.patch.yml); entries without an OSS ID use their technical name as the selector. Automatic and manual installations share the blocking, cancellable progress overlay. Failed or cancelled automatic installation stops that startup's queue and remains eligible at the next startup. Existing installations are not automatically upgraded. Successful installation and explicit removal are remembered in `$DSH_HOME/platform-skills/auto-install-history`, so removed presets are not installed again. Removing a selector from configuration does not uninstall it.

Configure `legacySkillDirs` for old directories that still exist. Desktop supplies its former `bundled-skills` location automatically. Account installations take precedence over the same legacy invocation name. These old files remain shared and can still be removed by an application update; copy user-maintained skills into `$DSH_HOME/skills` for account-owned storage.

Skill matching first compares OSS `id`; numeric `1` and string `"1"` identify the same skill. When either side lacks an ID, an exact, unique technical-name match is used. The technical name comes from the catalogue's `skill_id` and must equal the installed archive's `SKILL.md.name`; the display field `name` does not participate. Different nonempty IDs never match by name, and conflicting identities cannot be installed automatically or used to update another installation.

Installed records distinguish the account-local `key` from the optional catalogue `id` and required technical `skillName`. Removal history retains the same identity fields so a removed preset is not installed again. Updating a name-only installation after its catalogue entry gains an ID keeps its local key and records the ID. This first-release format does not read older development record formats.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The expert inventory runs as a Cordis child plugin with declared Session-query and working-directory dependencies; its Remote methods read the same account platform-skill service as the installer.

[The bundle patch](cordis.patch.yml) mounts the Host configuration and browser plugin. [The browser entry](src/client/index.ts) contributes the sidebar panel, keyed main panel, and Expert skills input picker, waiting for each slot declaration. The sidebar owns selection and collapsed navigation. The plugin registers an abortable Client resource provider for the OSS catalog. It validates the JSON, keeps enabled entries with skill IDs, and sorts them by `sort`. The Host records each account's committed platform-skill versions and prepares downloads outside the discovered skill directory. It only publishes a skill after all files and its installation record are ready; an update keeps the earlier committed version until the replacement commits. The page reads catalog and installation state through registered client services, keeps search and selection state locally, and waits for cancellation to settle before it dismisses operation progress. DSH primitives own inputs, buttons, modal behavior, and feedback; semantic theme tokens follow the application appearance, including body-portaled overlays. A shell overlay hosts transient feedback independently of the page. Unloading the plugin releases its contributions and dictionaries. The layout adapts to the main panel width and respects macOS titlebar clearance.

</details>

<a id="model-experience"></a>
## Model Experience

### Skill center page

#### What the model sees

The `@insight-ai/skill-center` bundle displays and manages a published skill catalog; browsing and installation add no tools, model requests, or Session events. An installed skill joins normal skill discovery and can load into a later model request when the user selects it.

#### Token effect

Opening the page adds no model input tokens.

#### KV Cache effect

Opening the page does not change any model request or cached prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Catalog reads require network access and OSS CORS permission for the application origin. Skill names and descriptions use the catalog's language; changing the application language translates controls only. Previously installed skills remain removable by ID while the catalog is unavailable.
- The catalog identifies a skill and its available version; it does not provide cross-device installation synchronization. Each account installation remains local to this device.
- The installation record is atomically replaced for normal operation, but it does not guarantee durable replacement through a power loss because the shared atomic writer does not fsync. Interrupted staging is cleaned on the next start. Malformed installed metadata fails loud and requires manual repair.
- This private bundle is distributed with Insight Desktop; the standard DSH Web profile does not enable it.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

No additional maintainer constraints.

</details>
