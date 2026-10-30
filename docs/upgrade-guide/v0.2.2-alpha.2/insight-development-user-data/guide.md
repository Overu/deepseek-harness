---
kind: upgrade-guide
description: "Insight Desktop development launches now use the Shell-compatible Electron user-data directory by default."
---

# Insight development user data location

English | [中文](guide.zh.md)

## Change

Insight development launches previously used a disposable Electron `userData` directory beneath `apps/desktop/.desktop-build`. They now use the operating system application-data location named `insight-desktop-dev`, matching Insight Shell. This affects only `DSH_DESKTOP_PRODUCT=insight` development launches. Packaged Insight and the official Desktop defaults do not change.

## Migration

1. Start Insight development normally to use the existing Shell development account data and its account `harness` directories. Normal DSH writes continue in that selected Home.
2. Set `DSH_DESKTOP_USER_DATA_DIR` to an explicit empty directory before launching if isolated development state is required.
3. Confirm the launcher reports the expected Electron `userData` path before signing in or changing account data. If startup reports `pre-release-data`, contact product maintenance; do not rename, merge, or delete `harness-native` yourself.
