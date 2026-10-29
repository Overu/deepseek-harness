---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-28-insight-canvas-attribution

English | [中文](2026-10-28-insight-canvas-attribution.zh.md)

## Summary

Declares canvas-run and canvas-process as informational producer attribution for Canvas completion messages.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-28-insight-canvas-attribution
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-13-liveshare-share-viewer-principal"
    after: "a20547272f8b6ad27a58866ed36b62770a0afcb63d67f8de211880be1b3ddcb4"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-13-liveshare-share-viewer-principal"
    after: "16b0c54d30a26bcc8a08071b14d38640e175ccf0716e48cc816f24e78a4cfff0"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-13-liveshare-share-viewer-principal"
    after: "52710cace6e8e49a67fb69b59f762772932e0cb92d74629da429670caa606453"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-13-liveshare-share-viewer-principal"
    after: "e1c99ce1ed85572999116212c492760ff0584d5ef4facbce476dd9b30f24aa46"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

The additions retain every existing source alternative and the current Session writer version. Released V4 readers accept nonempty producer-owned kind strings other than the retired plugin wrapper, preserve their JSON metadata, and derive the recorded content without the producer. The new tags grant no validation, execution, replay, or authorization capability. New readers continue to accept historical tags. This also applies when messages are nested in the inbox, developer message, or title-request records.

<a id="verification"></a>
## Verification

Node24 Vitest: packages/session/session-format-v3-to-v4/tests/attribution.spec.ts and packages/session/session-persistence-jsonl/tests/native-source-admission.spec.ts, 34 tests passed; Canvas regression, 417 tests passed.

<a id="dev-note"></a>
## Dev Note

None.
