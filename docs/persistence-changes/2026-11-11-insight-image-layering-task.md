---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-11-11-insight-image-layering-task

English | [中文](2026-11-11-insight-image-layering-task.zh.md)

## Summary

Adds a Session event that reserves and binds an Insight image-layering task to its original attachment, parameters, account scope, and delivery directory.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-11-11-insight-image-layering-task
baseline: false
changes:
  - root: "event:insight/image-layering/task"
    previous: null
    after: "0daa9aecdd7c2dd04fe926bf8cbb1a969ab91db4b1901eb755b2a8b6066f47dd"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Existing Session records without this event remain readable and continue using the previous query-only recovery path. The new event has its own discriminator; older readers refuse an unknown required event before using a newer Session, rather than interpreting it as an older task state. The new reader requires a bound record before paid retry or local caching, so absence does not imply authorization to recreate a task.

<a id="verification"></a>
## Verification

node node_modules/vitest/vitest.mjs run packages/insight/media-upload/tests/image-layering.spec.ts: 9 tests passed, including durable reservation and one confirmed retry. node node_modules/typescript/bin/tsc -b packages/insight/media-upload/tsconfig.json --pretty false: passed.

<a id="dev-note"></a>
## Dev Note

None.
