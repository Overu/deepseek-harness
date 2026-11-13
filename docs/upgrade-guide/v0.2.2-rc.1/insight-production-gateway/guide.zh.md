---
kind: upgrade-guide
description: "Insight Desktop 生产请求切换到新的网关域名，需要新的会话刷新 Cookie。"
---

# Insight 生产网关域名

[English](guide.md) | 中文

## 变更

打包版 Insight Desktop 的生产登录、Canvas API、模型和搜索请求及技能代理使用 `gapi-dsh.idealead.com`。原网关域名是 `gapi.insight-aigc.com`。旧域名签发的刷新 Cookie 无法在新域名上刷新会话。

## 迁移

1. 如果为 Insight Desktop 配置了网络允许列表，放行到 `gapi-dsh.idealead.com` 的 HTTPS 请求。
2. 如果升级后 Insight Desktop 提示登录，使用同一账号登录，获取新域名的刷新 Cookie。
3. 确认工作区可以打开、模型可以回复，并且可以加载已保存的 Canvas。
