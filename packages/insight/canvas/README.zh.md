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

文本节点支持分别编辑：`changes.prompt` 更新生成要求，`changes.text` 写入原生 `data.value` 正文。`canvas_run` 通过原生工作流生成文本，并在 Job 的 `outputs` 中返回正文；媒体结果卡仍只处理媒体。

画布根据已连线的媒体节点判断生成模式，空节点也参与判断。提示词引用和实际生成输入需要已有内容的素材。

iframe 从 `canvas-app` 构建；guidance 归本包拥有。[upstream.json](upstream.json) 记录源码输入和保留的标识。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节</summary>

Host 拥有工具、本地路由、桥接所有权和结果持久化，Client 拥有画布导航、引用及常驻页面服务。已有页面与可见 iframe 共享 Canvas context。插件两面使用官方工作区编译器与 Client bundler，iframe 在根依赖锁下保留独立 Vite 构建。共享上传文件名使用 DSH 的 UUID helper，兼容普通 HTTP 浏览器页面。Host 从 `ctx.insightAccount` 获取凭证，不再单独拥有 Desktop token IPC 客户端。

Canvas 使用 [Desktop Integration 的网关配置](../desktop-integration/README.zh.md#understand-the-implementation)，并负责自己的 Web、抠图和模型参数 CDN 地址。

已认证的桥接请求在已有 Web 来源外接受精确的 `dsh-app://app` 来源，仍执行 Connection 认证和 Canvas 所有权检查。关闭时先停止接入、取消消费者并等待分发与结果写入，再等待 OSS 上传结束，最后关闭桥接和存储资源。停止本地跟踪不承诺取消已被云端接受的操作。

Client 分别报告 UI 请求的 Session，Host 维护实际绑定。UI 切换会话后，只要该 Session 的 Agent、inbox、Canvas Job 或已提交运行仍可能继续访问画布，Host 就保留原 Client；Session 空闲后，Host 再发送带修订号的绑定快照。attach 握手要求匹配的 Host Session capability，因此旧页面必须重新加载，不会接收其无法解释的保留事件。

历史 user 与 steering 消息沿用 `<node-refs version="1">` 协议渲染节点缩略图、预览与定位。Client 将剩余显示内容交给 Chat 的完整 `conversation.chat.user.message` Factory，保留原生消息操作及来源装饰，不改写记录内容。无效或未知标签仍按原文显示。简短的助手画布 ID 回答在现有回复末尾扩展位增加可点击的画布链接。插件由 Chat 原生渲染助手消息，保留正文、思考内容、图片和展示设置。

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
