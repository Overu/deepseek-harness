---
description: "Add prompt enhancement to the DSH composer without changing a base profile."
kind: "package-bundle"
---

# dsh-prompt-enhance

English | [中文](README.zh.md)

## Summary

Add an Enhance action to the DSH composer to rewrite a draft through the configured model, review the result, apply it, or undo it. Insight integration profiles can apply this bundle explicitly; it does not modify a shipped profile. The action uses the active session route unless the plugin configuration supplies a provider and model pair. The original draft remains available until the user applies the result.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

An Insight-owned profile applies [cordis.patch.yml](cordis.patch.yml) to add the `prompt-enhance` row; the package does not add itself to any DSH profile.

### What you get

The Host registers the enhancement request route and command, while the Web Client adds the composer action, result panel, and undo bar. The Client reads its settings through `configForms`, counts draft attachments through `attachmentIds`, and follows the DSH document theme attribute.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

[cordis.patch.yml](cordis.patch.yml) inserts one row named `prompt-enhance`. The Host validates configuration, resolves the route, and streams the model result. The Client owns draft interaction and does not alter the submitted conversation until the user selects Apply.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [DSH architecture](../../../docs/architecture.md) — profiles, bundles, and client plugins.
- [Web Client](../../../docs/subsystems/web-client.md) — Host and browser composition.
- [Conversation UI](../../client/ui-conversation/README.md) — composer slots and draft attachments.

<a id="model-experience"></a>
## Model Experience

### Draft enhancement request

#### What the model sees

The resolved model receives the configured enhancement instructions, the selected composer draft, and, when `contextAware` is enabled, the bounded recent Session context. This auxiliary request does not enter the active conversation history until the user applies the result and later submits the composer.

#### Token effect

Each enhancement is a separate model request containing the instructions, framed draft, and optional bounded context. It does not change the token count of an already assembled conversation request.

#### KV Cache effect

The separate enhancement request does not reuse the active conversation request cache.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The bundle requires an Insight-owned profile patch; no shipped DSH profile mounts it by default.
- The Host route needs a resolved model route before it can enhance a draft.

<a id="dev-note"></a>
### Dev Note

The imported source revision and reproducible local differences are recorded in [upstream.json](upstream.json) and [prompt-enhance.patch](../../../patches/insight/prompt-enhance.patch).
