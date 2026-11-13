---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-11-12-delivery-group-title

English | [中文](2026-11-12-delivery-group-title.zh.md)

## Summary

Adds an optional groupTitle to the deliverables/presented event so clients can separate files by source image.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-11-12-delivery-group-title
baseline: false
changes:
  - root: "event:deliverables/presented"
    previous: "2026-09-11-initial"
    after: "feb57edc04d55e088816e46f52e4ccc3cad8e77fa51a012d61efe3ea75f292b6"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Existing events omit the field and retain the flat delivery layout. New readers validate nonblank titles and group only consecutive declarations with the same title. Existing readers ignore the additional optional field and continue to read the file list. The Session format remains unchanged.

<a id="verification"></a>
## Verification

The focused present tests passed for a stored title and blank-title rejection. All 73 ui-deliverables tests passed using a temporary Vitest alias to the installed React 18-compatible testing library; the default local alias resolves React DOM 19 with React 18. The authored Web Session snapshot passed in keyless Chromium replay, and the snapshot corpus check passed. build:artifacts and build:check passed.

<a id="dev-note"></a>
## Dev Note

None.
