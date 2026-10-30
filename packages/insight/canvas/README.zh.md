---
description: "为已完成 Insight 桌面认证的 profile 提供画布工具和嵌入业务页面。"
kind: "package-bundle"
---

# @insight-ai/desktop-canvas-plugin

[English](README.md) | 中文

## 概述

本包提供画布工具、会话引用、结果卡和嵌入画布页面。它保留已有包标识，并使页面私有浏览器依赖与 DSH 共享 Client 模块分离。官方 Desktop profile 不启用这个私有组件，云操作使用已登录的 Insight 桌面账号。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与待完善事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

本包的 [bundle patch](cordis.patch.yml) 提供已有 Host 插件，Client manifest 声明动态浏览器入口。桌面构建依赖交付本包，但不把它加入官方默认 profile。

iframe 从 `canvas-app` 构建；guidance 归本包拥有，不属于根目录 `bundled-skills` 同步资产。[upstream.json](upstream.json) 记录源码输入和保留的标识。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节</summary>

Host 拥有工具、本地路由、桥接所有权和结果持久化，Client 拥有画布导航、引用及常驻页面服务。已有页面与可见 iframe 共享 Canvas context。插件两面使用官方工作区编译器与 Client bundler，iframe 在根依赖锁下保留独立 Vite 构建。共享上传文件名使用 DSH 的 UUID helper，兼容普通 HTTP 浏览器页面。Host 从 `ctx.insightAccount` 获取凭证，不再单独拥有 Desktop token IPC 客户端；Main 选择匹配的服务环境。

已认证的桥接请求在已有 Web 来源外接受精确的 `dsh-app://app` 来源，仍执行 Connection 认证和 Canvas 所有权检查。关闭时先停止接入、取消消费者并等待分发与结果写入，再等待 OSS 上传结束，最后关闭桥接和存储资源。停止本地跟踪不承诺取消已被云端接受的操作。

</details>

<a id="model-experience"></a>
## 模型体验

### 画布工具与指导

#### 模型可见内容

挂载后的插件提供 `canvas_get` 及 [canvas-tool-contracts.ts](src/shared/canvas-tool-contracts.ts) 中的 schema 与包内画布指导。工具返回值说明请求的画布操作及其观察结果。

#### Token 影响

工具 schema 与启用的指导增加请求 token，操作结果增加保留的会话 token。

#### KV Cache 影响

不变的工具集和指导保留稳定请求前缀。schema、指导或配置变化可能改变前缀，provider 缓存可用性由外部决定。

## 已知限制与待完善事项

<a id="known-limitations-and-deferred-work"></a>

- 云生成、媒体处理、剪贴板和全屏需要在原生桌面中连接对应服务验证；隔离测试不能替代后端或平台验收。

<a id="dev-note"></a>
### 开发备注

无。
