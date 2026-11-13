---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-11-13-insight-original-image-file-retired

English | [中文](2026-11-13-insight-original-image-file-retired.zh.md)

## Summary

Removes the optional originalFile reference from persisted image content after Insight image upload switched to normalized attachment bytes.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-11-13-insight-original-image-file-retired
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-11-06-insight-original-image-file"
    after: "a20547272f8b6ad27a58866ed36b62770a0afcb63d67f8de211880be1b3ddcb4"
    decision: same-version
  - root: "event:assistant/attempt"
    previous: "2026-11-06-insight-original-image-file"
    after: "15d5dfdd822aa35e115afd74a8982825a493880457774e6850bc1520b50875e4"
    decision: same-version
  - root: "event:assistant/message"
    previous: "2026-11-06-insight-original-image-file"
    after: "1033093edd0db80ff410e00830b523405e00bb0c7684948e531ff65095799625"
    decision: same-version
  - root: "event:compaction/summary"
    previous: "2026-11-06-insight-original-image-file"
    after: "e2f9a41e0989f54ed8cee80f8db2bcf9d60a5c810dc9d45b83fa050b9dce7602"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-11-06-insight-original-image-file"
    after: "16b0c54d30a26bcc8a08071b14d38640e175ccf0716e48cc816f24e78a4cfff0"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-11-06-insight-original-image-file"
    after: "52710cace6e8e49a67fb69b59f762772932e0cb92d74629da429670caa606453"
    decision: same-version
  - root: "event:system/message"
    previous: "2026-11-06-insight-original-image-file"
    after: "69081694be231d56fd9580ba14645fd5e35373202605d5c5c841a9435b5fa3b1"
    decision: same-version
  - root: "event:team/message/queued"
    previous: "2026-11-06-insight-original-image-file"
    after: "21fb6a90d5068f6a0003b7ab316ed2f56342477146a65c00db0f13c4d8df667d"
    decision: same-version
  - root: "event:tool/ptc-dispatch"
    previous: "2026-11-06-insight-original-image-file"
    after: "d66e11dddf5dfa3c71547e2cbd7b0608824cd8d6243fc16f532017ff28e8fba5"
    decision: same-version
  - root: "event:tool/result"
    previous: "2026-11-06-insight-original-image-file"
    after: "7c9f44e90a0058f4cc532ae20dad0c10afa6eba22e70a6c79fc79490bad64397"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-11-06-insight-original-image-file"
    after: "e1c99ce1ed85572999116212c492760ff0584d5ef4facbce476dd9b30f24aa46"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

New messages contain only the normalized image attachment, which older readers can read because originalFile was optional. Existing records with originalFile are not supported for this field: the strict Agent Teams queued-message projection rejects an image block carrying that extra property. Other Session readers may retain the JSON, but callers must not rely on original-file selection or historical Team recovery. The event discriminators and Session format version are unchanged.

<a id="verification"></a>
## Verification

The media-upload and Agent Teams projection tests pass with normalized image messages and no originalFile field. The media-upload projection state version is increased so cached states containing legacyOriginalId are rebuilt.

<a id="dev-note"></a>
## Dev Note

None.
