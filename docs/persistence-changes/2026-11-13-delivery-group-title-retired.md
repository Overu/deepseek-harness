---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-11-13-delivery-group-title-retired

English | [中文](2026-11-13-delivery-group-title-retired.zh.md)

## Summary

Removes the optional groupTitle from new deliverables/presented events after image-layering cards moved into the media-upload plugin.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-11-13-delivery-group-title-retired
baseline: false
changes:
  - root: "event:deliverables/presented"
    previous: "2026-11-12-delivery-group-title"
    after: "13d3d180f977bf78081d487ffa0ecb75857349bcab29a5a3fb48189fca2a6176"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

New readers retain old deliverables/presented events containing groupTitle because Session admission does not reject this extra payload field; the current client reads the files and ignores the retired title. Older readers accept newly written events without the optional field. No event discriminator is reused and the Session format version stays unchanged.

<a id="verification"></a>
## Verification

Inspected Session event admission and the current deliverables consumer. The media-upload test suite passed; eight focused present tests passed. Two present symlink fixture tests could not create links on this Windows host (EPERM). Generated persistence catalog and known-event list were refreshed.

<a id="dev-note"></a>
## Dev Note

None.
