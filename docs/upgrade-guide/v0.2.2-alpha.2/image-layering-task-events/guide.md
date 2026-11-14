---
kind: upgrade-guide
description: "Image-layering task events are no longer written or accepted when reopening older Sessions."
---

# Image-layering task events

English | [中文](guide.zh.md)

## Change

The Insight media plugin no longer writes `insight/image-layering/task` events or registers its task projection. Repeating `submit_image_layering` may create another paid task. This build refuses to reopen a Session containing an older required task event without `ignorable: true`; it does not remove or rewrite the stored log. `retry_image_layering` is removed. A known `taskHandle` can still be queried and its results cached in the current workspace.

## Migration

1. Before upgrading, finish image-layering work in Sessions containing `insight/image-layering/task`, or retain the previous client build to inspect those Sessions. Record any needed `taskHandle` outside the affected Session.
2. After upgrading, start a new Session for image layering. Use `get_image_layering` with a known handle to check an existing remote task and `cache_image_layering_result({taskHandle,imageLabel})` to save result URLs in the current workspace and display download cards; do not repeat `submit_image_layering` to check status.
3. Confirm that the new Session opens and a single submission returns a `taskHandle`. See the [persistence change](../../../persistence-changes/2026-11-13-insight-image-layering-task-retired.md) for the reader behavior.
