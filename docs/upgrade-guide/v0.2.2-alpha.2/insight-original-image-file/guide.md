---
kind: upgrade-guide
description: "Insight image messages no longer expose the optional originalFile reference."
---

# Insight original image file

English | [中文](guide.zh.md)

## Change

`ImageBlock.originalFile` is removed. Insight uploads the stored normalized image bytes for ordinary image messages; file attachments retain their exact bytes. Existing queued Agent Teams messages containing `originalFile` may fail to recover because their image content is strictly parsed. See the [persistence change](../../../persistence-changes/2026-11-13-insight-original-image-file-retired.md).

## Migration

1. Stop reading or writing `ImageBlock.originalFile`; use `ImageBlock.attachment` for normalized images.
2. If the exact original bytes are required, ask the user to upload the image as a file attachment in a new conversation.
3. Start a new conversation for any older Agent Teams session that fails to recover, then confirm a newly uploaded image can be selected by `prepare_image_layering_source`.
