---
description: "Open the Insight skill center from the sidebar."
kind: "package-bundle"
---

# @insight-ai/skill-center

English | [中文](README.zh.md)

## Summary

Open **Skill center** below **Plugins** in the Insight sidebar to browse the published OSS skill catalog. Search by name, ID, or summary, open skill details, and copy a demonstration installation request. Insight Desktop includes this bundle by default; downloads and installation remain demonstrations.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Select **Skill center** to browse the cards in the main column. Opening the page reads the [OSS catalog](https://insight-desktop-updates.oss-cn-guangzhou.aliyuncs.com/desktop/skills/skills.json). Search filters the downloaded catalog as you type or submit the search form. A failed read displays **Retry**; an empty published catalog has a separate empty state. **View details** opens the full description. **Copy installation instructions** writes a demonstration request to the clipboard and reports success or failure. **Download ZIP** displays a demonstration notice without downloading a file. Select **Plugins** or a conversation to leave the page. The bundle supplies Chinese and English copy; other languages use the locale registry's fallback.

Directory requests time out after 15 seconds, including the JSON body. Set `catalogRequestTimeoutMs` in the plugin configuration in `cordis.yml` to change this positive millisecond budget; the page adopts it on reload.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

[The bundle patch](cordis.patch.yml) mounts the Host configuration and browser plugin. [The browser entry](src/client/index.ts) contributes to the existing sidebar panel list and keyed main panel, waiting for each slot declaration. The sidebar owns selection and collapsed navigation. The plugin registers an abortable Client resource provider for the OSS catalog. It validates the JSON, keeps enabled entries with skill IDs, and sorts them by `sort`. The page reads through `useResource` and keeps search and selection state locally; manual retries open a new request, and leaving the page cancels an unfinished request. DSH primitives own inputs, buttons, modal behavior, and feedback; semantic theme tokens follow the application appearance, including body-portaled overlays. A shell overlay hosts transient feedback independently of the page. Unloading the plugin releases its contributions and dictionaries. The layout adapts to the main panel width and respects macOS titlebar clearance.

</details>

<a id="model-experience"></a>
## Model Experience

### Skill center page

#### What the model sees

The `@insight-ai/skill-center` bundle displays a published skill catalog; it adds no tools, model requests, or Session events. Copying a request only writes to the clipboard and does not send it to a model.

#### Token effect

Opening the page adds no model input tokens.

#### KV Cache effect

Opening the page does not change any model request or cached prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Catalog reads require network access and OSS CORS permission for the application origin. Skill names and descriptions use the catalog's language; changing the application language translates controls only.
- Downloading, installing, and managing skills are not connected. Copied requests describe a demonstration and cannot install a package.
- This private bundle is distributed with Insight Desktop; the standard DSH Web profile does not enable it.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

No additional maintainer constraints.

</details>
