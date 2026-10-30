---
description: "Private Insight product components and fixed community sources used by the Insight desktop distribution."
kind: "package-group"
---

# insight/ — Insight desktop components

English | [中文](README.zh.md)

## Summary

This group keeps the Insight Desktop integration together with fixed Canvas, memory, and prompt enhancement sources. These private components are delivered through the desktop distribution and are excluded from the public npm baseline. The Insight profile requires Integration, Canvas, Memory, and Prompt; component-internal feature switches remain available. The official Desktop profile activates none of them.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

The components belong to one Insight product distribution.

| Package | Role |
| --- | --- |
| [desktop-integration](desktop-integration/README.md) | Login, account-isolated Home, managed models, product settings, and workspace branding |
| [canvas](canvas/README.md) | Canvas tools, result presentation, and its embedded business page |
| [memory-evolve](memory-evolve/README.md) | Fixed memory, skills, and task-management source |
| [prompt-enhance](prompt-enhance/README.md) | Composer prompt enhancement |

<a id="related-documentation"></a>
## Related documentation

- [Insight subsystem](../../docs/subsystems/insight.md) — product ownership and source synchronization
- [Baseline integration record](../../docs/subsystems/insight-baseline-changes.md) — existing official file changes
- [Application architecture](../../docs/architecture.md) — profile and bundle composition

<a id="dev-note"></a>
## Dev Note

None.
