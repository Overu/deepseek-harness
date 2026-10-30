---
kind: upgrade-guide
description: "Insight Desktop 开发启动现在默认使用与 Shell 兼容的 Electron 用户数据目录。"
---

# Insight 开发用户数据位置

English | [中文](guide.md)

## 变更

Insight 开发启动原先使用 `apps/desktop/.desktop-build` 下的一次性 Electron `userData` 目录。现在改为使用操作系统应用数据位置中名为 `insight-desktop-dev` 的目录，与 Insight Shell 保持一致。该变更只影响 `DSH_DESKTOP_PRODUCT=insight` 的开发启动；已打包的 Insight 与官方 Desktop 默认值不变。

## 迁移

1. 正常启动 Insight 开发环境，即可使用既有 Shell 开发账号数据及其账号 `harness` 目录。正常 DSH 写入仍会发生在被选择的 Home 中。
2. 若需要隔离的开发状态，请在启动前将 `DSH_DESKTOP_USER_DATA_DIR` 设为明确的空目录。
3. 登录或修改账号数据前，确认启动器报告的 Electron `userData` 路径符合预期。若启动报告 `pre-release-data`，请联系产品维护人员；不要自行重命名、合并或删除 `harness-native`。
