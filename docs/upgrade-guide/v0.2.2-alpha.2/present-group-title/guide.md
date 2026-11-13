---
kind: upgrade-guide
description: "The optional present.groupTitle parameter and grouped generic delivery cards are removed."
---

# Present group title

English | [中文](guide.zh.md)

## Change

The generic `present` tool no longer accepts `groupTitle` or writes it to new `deliverables/presented` events. Generic delivered files use the existing flat card layout. Insight image-layering results use cards owned by the media-upload plugin and a separate click-to-download route. Earlier Session events containing a group title remain readable, but the current generic card ignores that title. See the [persistence change](../../../persistence-changes/2026-11-13-delivery-group-title-retired.md).

## Migration

1. Remove `groupTitle` from calls to `present`. Keep each local file in `files` and use ordinary response headings when a text explanation is enough.
2. For image-layering results, call `cache_image_layering_result({taskHandle,imageLabel})` after the task completes. Its result cards group files by original image and download a selected file when clicked; do not pass OSS URLs to `present`.
3. Confirm new generic file declarations display in a flat list and image-layering results show separate headings with Download buttons.
