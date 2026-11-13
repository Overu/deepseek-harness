---
kind: upgrade-guide
description: "Insight Desktop production requests move to a new gateway host, which requires a new refresh cookie."
---

# Insight production gateway host

English | [中文](guide.zh.md)

## Change

Packaged Insight Desktop uses `gapi-dsh.idealead.com` for production sign-in, Canvas API requests, model and search requests, and the skill proxy. The previous gateway host was `gapi.insight-aigc.com`. The refresh cookie issued for the old host cannot refresh a session on the new host.

## Migration

1. Update any network allowlist for Insight Desktop to permit HTTPS to `gapi-dsh.idealead.com`.
2. If Insight Desktop asks you to sign in after the upgrade, sign in with the same account to obtain a refresh cookie for the new host.
3. Verify that the workspace opens and that a model conversation and a saved Canvas can load.
