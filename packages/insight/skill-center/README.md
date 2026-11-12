---
description: "Open the Insight skill center from the sidebar."
kind: "package-bundle"
---

# @insight-ai/skill-center

English | [中文](README.zh.md)

## Summary

Open **Skill center** below **Plugins** in the Insight sidebar to browse official and custom skills. Search the active tab, view skill details, and install, update, or remove official skills for the signed-in account.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

**Official skills** opens by default and reads the [OSS catalog](https://insight-desktop-updates.oss-cn-guangzhou.aliyuncs.com/desktop/skills/skills.json). Each card shows **Install**, **Installed**, or **Update** based on the current account's installed version. The details dialog shows the skill version beside its name and places usage instructions in a separate panel. To uninstall an official skill, select **Remove** in its details and confirm in the dialog. Installation and updates show a blocking progress dialog with **Cancel**. Cancellation or failure before commit leaves no first installation and retains a previous installed version. A completed commit reports success even if cancellation arrives later.

**Custom skills** shows the same user installations as the Expert skills picker: skills in the account's `$DSH_HOME/skills` directory and the shared agent skills directory. Select **Details** on a card and choose **Delete skill** to remove its installed directory or standalone skill file after confirmation. Deleting a linked skill removes the link and leaves its target in place. Search filters the active tab by display name, technical name, or summary and keeps the search term when you switch tabs. A failed read displays **Retry**. The bundle supplies Chinese and English copy; other languages use the locale registry's fallback.

Directory requests time out after 15 seconds, including the JSON body. Set `catalogRequestTimeoutMs` in the plugin configuration in `cordis.yml` to change this positive millisecond budget; the page adopts it on reload.

The hands behind search light up along the pointer. With reduced motion enabled, the hands stay still and only the dots near the pointer light up.

The Host separately limits one skill archive's request duration, compressed bytes, archive entries, extracted bytes, and allowed download origins. Configure `packageRequestTimeoutMs`, `packageMaxDownloadBytes`, `packageMaxEntries`, `packageMaxExtractedBytes`, and `packageAllowedOrigins` as described by [config.ts](src/config.ts).

Removing a skill deletes its installation record and its skill-specific payload directory, including leftover releases. Startup also reclaims abandoned releases and empty skill directories. Shared account storage directories remain available for other installations. Cleanup failures are logged and retried at the next startup.

The same bundle owns the **Expert skills** input picker. An empty list offers a button inside the scroll area that closes the picker and opens Skill center. The platform tab includes installed platform skills and legacy bundled skills. Legacy entries are not assigned to the current account or modified by the skill center. Entries with the same callable technical name share one draft reference and selection state across both groups; loading follows the existing skill priority.

Configure `presetSkillIds` with technical skill names to install defaults after the account UI is ready. The Insight bundle selects sixteen skills in [cordis.patch.yml](cordis.patch.yml). Automatic installation keeps one blocking, cancellable progress overlay open through the queue and reports one final toast; manual operations retain their individual feedback. The Host admits this queue only once per account startup, so refreshing a page does not retry failures. A failed skill is skipped without retry while later installations continue. Cancellation or failure to read the pending list ends the queue; unfinished skills remain eligible at the next Host startup or can be installed manually in Skill center. Existing installations are not automatically upgraded. Successful installation and explicit removal are remembered in `$DSH_HOME/platform-skills/auto-install-history`, so removed presets are not installed again. Removing a selector from configuration does not uninstall it.

Configure `legacySkillDirs` for old directories that still exist. Desktop supplies its former `bundled-skills` location automatically. Account installations take precedence over the same legacy invocation name. These old files remain shared and can still be removed by an application update; copy user-maintained skills into `$DSH_HOME/skills` for account-owned storage.

Installation, update, removal, and preset matching use the technical name from the catalogue's `skill_id`, which must equal the archive's `SKILL.md.name`. The OSS `id` and display field `name` do not participate. Catalogue technical names must be unique; changing one identifies a new skill.

Installed records at `$DSH_HOME/platform-skills/installed/<technical-name>.json` contain `id` (the technical name), `version`, and a relative `payload` path. Removal history at `auto-install-history/<technical-name>.json` contains only `id`. Payloads remain isolated by version UUID under `payloads/<technical-name>/`. UUID-keyed development records are not migrated; back up and remove the old platform-skill directory before reinstalling.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The expert inventory runs as a Cordis child plugin with declared Session-query and working-directory dependencies; its Remote methods read the same account platform-skill service as the installer.

[The bundle patch](cordis.patch.yml) mounts the Host configuration and browser plugin. [The browser entry](src/client/index.ts) contributes the sidebar panel, keyed main panel, and Expert skills input picker, waiting for each slot declaration. The sidebar owns selection and collapsed navigation. The plugin registers an abortable Client resource provider for the OSS catalog. It validates the JSON, keeps enabled entries with unique technical names, and sorts them by `sort`. The Host records each account's committed platform-skill versions and prepares downloads outside the discovered skill directory. It only publishes a skill after all files and its installation record are ready; an update keeps the earlier committed version until the replacement commits. The page reads catalog and installation state through registered client services, keeps search and selection state locally, and waits for cancellation to settle before it dismisses operation progress. DSH primitives own inputs, buttons, modal behavior, and feedback; semantic theme tokens follow the application appearance, including body-portaled overlays. A shell overlay hosts transient feedback independently of the page. Unloading the plugin releases its contributions and dictionaries. The layout adapts to the main panel width and respects macOS titlebar clearance.

</details>

<a id="model-experience"></a>
## Model Experience

### Skill center page

#### What the model sees

In `@insight-ai/skill-center`, browsing or installing skills adds no tools, model requests, or Session events. An installed skill joins normal skill discovery and can load into a later model request when the user selects it.

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
