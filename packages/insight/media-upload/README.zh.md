---
description: "因赛 Desktop 经审批上传附件至 OSS 并以当前登录态进行图像分层的工具。"
kind: "package-bundle"
---

# @insight-ai/desktop-media-upload-plugin

[English](README.md) | 中文

## 概述

因赛 Desktop 加载此组合，注册 `upload_attachment`、`submit_image_layering` 和 `get_image_layering`。上传需要当前轮次的一项用户附件及审批，随后从上传中心获取临时凭据，将原始字节写入 OSS；返回 URL 的读取权限未经验证。图像分层仅接收本轮成功上传的图片 URL，通过 `POST /api/skill-proxy/call-insight-api` 提交，返回绑定用户的任务句柄，并由会话 Job 跟踪状态。可凭句柄再次查询而不重复提交；只有上游 `image_list` 中出现 PSD URL，才取得所需 PSD。

## 目录

- [使用本包](#use-this-package)
- [实现](#implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

本包仅由因赛 Desktop 产品组合加载。其补丁也仅为该产品启用 `file-upload.retainOriginalImage`，使图片提示词同时保留私有原图文件引用与归一化的模型图片。其他产品组合沿用默认值 `false`。`serviceEnvironment` 选择固定的测试或生产上传中心；`requestTimeoutMs` 和 `ossTimeoutMs` 限制外部请求时间。

模型可提供 `attachmentIndex`，即当前轮次用户直接提供的文件和图片附件中的 1 基序号；有多个候选项时必须指定。粘贴文本、本地路径、Canvas 素材、继承消息和旧轮次都不构成上传授权。缺失原图引用的图片无法上传。上传中心收到文件名与路由类型，但不收到文件大小或 MIME；STS 成功响应不能证明其接受范围、写权限或大小上限。原企业附件策略不再参与本流程。

<a id="implementation"></a>
## 实现

`src/image-layering.ts` 通过已认证代理发送一次创建请求，读取 NDJSON 终结事件，再注册会话 Job 经同一代理查询。`job_kill`、插件关闭或客户端重启只停止本地跟踪，不取消远端生成。工具结果保留 `taskHandle`，在服务句柄有效期内可用 `get_image_layering({ taskHandle, watch: true })` 恢复。提交传输失败可能使远端状态不明；POST 不会自动重试。请求、轮询和跟踪时限均为已校验的插件配置。

`src/upload-source.ts` 将已提交 Session 事件折叠为仅在 Host 使用的当前轮次附件列表。`src/index.ts` 注册上传工具、检查根 Agent 并申请一次性外传审批。`src/upload-center.ts` 调用固定的上传中心网关路径，校验临时凭据、返回的对象名与 HTTPS OSS 目标，不向模型暴露登录令牌或临时凭据。STS 拒绝时报告 HTTP 状态和经过校验的服务错误码（如有），不返回响应消息。`src/oss-put.ts` 通过 `ali-oss` 流式传送附件，并关闭 SDK 自动重试。只有 OSS 明确返回 HTTP 200 且源流完整消费，工具才返回 URL；结果不明时不会自动再次 PUT，并在 Host 中记录仅含调用 ID 和错误码的诊断。

<a id="model-experience"></a>
## 模型体验

### 附件上传工具

#### 模型看到的内容

插件注册 `upload_attachment`，接受可选的 1 基 `attachmentIndex`。工具说明限定为当前轮次的用户附件，并说明所返回的 OSS 地址未验证读取权限。

#### Token 影响

插件加载时，工具 schema 为每次请求带来固定 token 开销。每个成功的四字段结果或错误都会增加保留在对话中的 token。

#### KV Cache 影响

工具定义不变时，已有请求前缀保持稳定。加载或卸载插件会改变工具集合，可能从变动的 schema token 起影响缓存复用。

### 上传结果

#### 模型看到的内容

OSS PUT 明确成功后返回 `url`、`urlAccess: "unverified"`、`filename` 和 `sizeBytes`。它不登记企业附件或画布素材。审批拒绝、授权失败或传输结果不明会返回不含凭据和成功 URL 的错误结果。

#### Token 影响

结果 token 数随文件名和 URL 长度变化。

#### KV Cache 影响

结果追加到对话，不改写先前请求前缀。

### 图像分层工具

#### 模型看到的内容

`submit_image_layering` 接收本轮成功上传图片的 `imageUrl`、可选 `prompt` 和可选非负整数 `numLayers`；省略时分别使用空提示词和零层。结果包含 `taskHandle`、当前状态，以及跟踪已启动时的 `jobId`。`get_image_layering` 接收 `taskHandle` 和可选 `watch`；成功时返回已验证的 `psdUrls` 与 `imageUrls`。任务完成但没有 PSD 时报告 `missing_psd`。若 Job 不可用，`monitoring: "unavailable"` 仍保留句柄。账号令牌与上游凭据不会进入工具结果。

#### Token 影响

加载后两个工具定义增加固定请求 token；任务 ID、状态、URL 和 Job 通知产生时增加保留 token。

#### KV Cache 影响

结果与 Job 消息追加到对话，不改写此前请求前缀。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 私有桶可能拒绝直接读取所返回的 URL。正式上线前仍需在隔离环境核验 STS 写权限、对象键唯一性、桶版本控制及无企业登记对象的清理。
- 原图在本地按内容寻址存储，即使暂存提示词后来被丢弃，已保存的原图仍存在。
- 代理任务句柄约 24 小时后过期。目标 Gateway 必须部署 `call-insight-api` 连接；本地服务仓库代码不能证明目标环境已经部署。真实上游既有仅返回 PNG 的结果，也有返回 PSD 的结果，因此任务成功不保证得到 PSD。技能包负责下载 PSD 并调用 `present`；生产环境结果 OSS 主机需要部署配置。

<a id="dev-note"></a>
### 开发备注

无。
