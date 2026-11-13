---
kind: upgrade-guide
description: "Insight Desktop's upload_attachment tool now uploads directly to OSS and no longer returns an enterprise attachment ID."
---

# Insight attachment uploads use OSS directly

English | [中文](guide.zh.md)

## Change

The Insight Desktop `upload_attachment` tool now requests temporary credentials from `/game-ai-editor-center/upload/sts/token` and writes the selected original file to OSS. It no longer calls `/insight-harness-service/api/files/sts` or `/api/files/oss-complete`. Its successful result contains `url`, `urlAccess`, `filename`, and `sizeBytes`; `attachmentId` is removed. The object is not registered in the enterprise attachment list, and the URL's read access is unverified.

## Migration

1. Update consumers of the `upload_attachment` result to use `url` as an OSS object address. Remove reads of `attachmentId` and any assumption that the result appears in `/insight-harness-service/api/files`.
2. If a workflow requires an enterprise attachment ID, keep using the enterprise STS and completion APIs as a separate integration. A direct upload-center STS response cannot supply the enterprise `uploadTicket` needed for completion.
3. Verify a test upload returns the four fields, that OSS confirms the write, and that no enterprise attachment registration is expected.
