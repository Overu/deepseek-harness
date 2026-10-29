---
description: "Memory Evolve adds layered local memory, skill and task management, and their workspace UI to an Insight DSH composition."
kind: "package-bundle"
---

# dsh-memory-evolve

English | [中文](README.zh.md)

## Summary

This package carries the fixed Memory Evolve source snapshot for Insight. Its host half stores layered local memory and exposes the existing management routes; its browser half adds the corresponding workspace views. The package is not activated by a shipped DSH profile in this migration step.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The bundle patch inserts the retained `dsh-memory-evolve` plugin identifier. Profile composition and product activation are owned by the Insight integration package.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The upstream Host was distributed only as JavaScript, so its fixed snapshot lives in [`src/host/`](src/host/) instead of generated `lib/`. The build copies that module tree without bundling it, preserving its package-relative runtime resources. Every browser route applies DSH connection rejection before reading or changing local state. The Client uses DSH workspace navigation for session jumps. Memory Evolve updates only with the Insight client; it never reads or changes a DSH Git checkout.

</details>

-----

<a id="model-experience"></a>
## Model Experience

### Layered memory context

#### What the model sees

When memory injection is enabled, the Host registers its rendered memory snapshot through `ctx.systemPrompt.context`; its `memory` and `memory_suggest` tools remain available according to the plugin runtime configuration.

#### Token effect

The snapshot contributes only when rendered memory is non-empty; registered tools contribute their schemas when their runtime switches enable them.

#### KV Cache effect

The Host recomputes the rendered snapshot from local memory state, so a changed snapshot can replace that context while an unchanged value preserves the surrounding request prefix.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- **Composition ownership** — This package does not activate itself; the Insight integration profile must decide its required row and defaults.
- **Upstream compatibility** — The fixed source snapshot retains its broader legacy API use; P1 verifies packaging and the retained client/auth adaptations, not paid cloud workflows.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The [source record](upstream.json) pins the upstream commit and archive digest. Apply [the Memory Evolve patch](../../../patches/insight/memory-evolve.patch) when refreshing this snapshot.

</details>
