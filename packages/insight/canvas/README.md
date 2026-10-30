---
description: "Canvas tools and its embedded business page for an Insight-authenticated desktop profile."
kind: "package-bundle"
---

# @insight-ai/desktop-canvas-plugin

English | [中文](README.zh.md)

## Summary

This package provides Canvas tools, conversation references, result cards, and an embedded Canvas page. It preserves the existing package identity and keeps the page's private browser dependencies separate from DSH's shared Client modules. The official Desktop profile does not activate this private component. Cloud actions use the signed-in Insight desktop account.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The package's [bundle patch](cordis.patch.yml) contributes the existing Host plugin. Its Client manifest declares the dynamic browser entry. Desktop build dependencies deliver the package without adding it to the official default profile.

The iframe builds from `canvas-app`; guidance remains package-owned rather than part of the root `bundled-skills` synchronization directory. [upstream.json](upstream.json) records the source input and retained identity.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals</summary>

The Host owns tools, local routes, bridge ownership, and result persistence. The Client owns Canvas navigation, references, and the resident page service. The existing page shares its Canvas context with the visible iframe. Both plugin halves use the official workspace compiler and Client bundler; the iframe retains its own Vite build under the root dependency lock. Shared upload names use DSH’s UUID helper, which remains available on plain-HTTP browser pages. The Host obtains credentials from `ctx.insightAccount`; it does not own another Desktop token IPC client. Main selects the matching service environment.

Authenticated bridge requests admit the exact `dsh-app://app` origin alongside existing Web origins. Connection authentication and Canvas ownership checks still apply. Shutdown stops admission, cancels consumers, waits for dispatch and result writes, then drains OSS uploads before closing bridge and storage resources. Stopping local tracking does not promise cancellation of an accepted cloud operation.

</details>

<a id="model-experience"></a>
## Model Experience

### Canvas tools and guidance

#### What the model sees

The mounted plugin contributes `canvas_get` and the other schemas in [canvas-tool-contracts.ts](src/shared/canvas-tool-contracts.ts) and package-owned Canvas guidance. Returned tool data describes the requested Canvas operation and its observed result.

#### Token effect

Tool schemas and enabled guidance contribute request tokens; operation results add retained conversation tokens.

#### KV Cache effect

An unchanged tool set and guidance preserve a stable request prefix. Changed schemas, guidance, or configuration can change that prefix; provider cache availability remains external.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Cloud generation, media processing, clipboard, and fullscreen need native desktop verification against their configured services; isolated tests do not establish backend or platform acceptance.

<a id="dev-note"></a>
### Dev Note

None.
