---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-11-13-insight-image-layering-task-retired

English | [中文](2026-11-13-insight-image-layering-task-retired.zh.md)

## Summary

Removes the persisted Insight image-layering task event after retiring creation reservations and task projection.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-11-13-insight-image-layering-task-retired
baseline: false
changes:
  - root: "event:insight/image-layering/task"
    previous: "2026-11-11-insight-image-layering-task"
    after: null
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Old readers can read new Sessions because the removed event is no longer written. New readers refuse older Sessions containing a required insight/image-layering/task event before adopting or mutating the log; those Sessions remain on disk but cannot be reopened in this build. This intentional loss of historical readability was accepted for the task removal. The event type is not reused for another meaning, and no automatic remote creation is performed during recovery.

<a id="verification"></a>
## Verification

The image-layering proxy test suite passed (15 tests). The storage-contract test covers refusal of unknown required events; the generated known-event list no longer includes insight/image-layering/task.

<a id="dev-note"></a>
## Dev Note

None.
