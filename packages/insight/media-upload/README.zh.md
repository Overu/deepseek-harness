---
description: "因赛 Desktop 上传附件至 OSS 并以当前登录态进行图像分层的工具。"
kind: "package-bundle"
---

# @insight-ai/desktop-media-upload-plugin

[English](README.md) | 中文

## 概述

因赛 Desktop 加载此组合，注册通用 OSS 上传工具及图像分层的来源、提交、查询、重建和缓存工具。通用上传仅接受当前轮次用户直接提供的附件：“完全权限”下免单独审批，其余权限预设保留各自审批行为。图像分层从最近三个含用户消息的轮次中选择原图，在提交时上传，并由会话 Job 跟踪企业任务。完成后须下载、验证 PSD 与分层图像，再以本地文件卡片交付。

## 目录

- [使用本包](#use-this-package)
- [实现](#implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

本包仅由因赛 Desktop 产品组合加载。其补丁也仅为该产品启用 `file-upload.retainOriginalImage`，使图片提示词同时保留私有原图文件引用与归一化的模型图片。其他产品组合沿用默认值 `false`。`serviceEnvironment` 选择固定的测试或生产上传中心；`requestTimeoutMs` 和 `ossTimeoutMs` 限制外部请求时间。`generationResultHosts` 为空时，测试环境使用固定的测试 OSS 结果主机，生产环境拒绝下载结果；非空列表明确指定允许的主机。

模型可提供 `attachmentIndex`，即当前轮次用户直接提供的文件和图片附件中的 1 基序号；有多个候选项时必须指定。粘贴文本、本地路径、Canvas 素材、继承消息和旧轮次都不构成上传授权。缺失原图引用的图片无法上传。上传中心收到文件名与路由类型，但不收到文件大小或 MIME；STS 成功响应不能证明其接受范围、写权限或大小上限。原企业附件策略不再参与本流程。

<a id="implementation"></a>
## 实现

`src/image-layering.ts` 在已认证代理创建请求前将每次创建名额写入 Session，取得句柄后绑定任务并启动 Job。确定失败或结果不完整时用同一句柄再查一次；只有首个任务可以使用保存的原图和参数再创建一次。创建或查询状态不明时不重新创建付费任务。任务绑定账号范围及初始交付目录。`job_kill`、关闭或重启只停止本地跟踪，不取消远端任务；句柄有效时可恢复查询。`src/result-cache.ts` 下载合法的 PSD 和图片，校验字节并通过 Session 沙箱文件系统写入。后续切换目录时先把已验证的整组文件复制到当前工作区；搬迁失败则保留原目录文件。

`src/upload-source.ts` 将已提交 Session 事件分别折叠为通用上传的当前轮次附件列表，以及分层使用的最近三个用户轮次图片列表。`src/index.ts` 检查根 Agent；普通上传除有效“完全权限”预设外申请一次性审批，分层上传则依据用户对选定图片的处理请求执行。`src/upload-center.ts` 校验固定上传网关的 STS 响应，不暴露凭据。`src/oss-put.ts` 使用关闭 SDK 重试的流式写入。通用工具仅在 OSS HTTP 200 且原始字节完整消费后返回 URL；结果不明时不自动重复 PUT。

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

`prepare_image_layering_source` 列出合格原图，多张不同图片时先选定。`submit_image_layering` 接收 `sourceRef`、可选 `prompt` 和非负 `numLayers`（默认 `0`），在 Host 内上传并提交，不再请求通用上传的单独审批。兼容路径仍接受同轮普通上传得到的 `imageUrl`。`get_image_layering` 使用绑定的 `taskHandle` 和可选 `watch` 查询；初次任务两次确认的不完整结果报告 `retry_eligible`，第二次任务失败即停止。代理创建返回 HTTP 5xx 时按结果未知处理，不自动重建。`retry_image_layering` 最多使用原图与原参数再创建一次。Job 在成功查询后缓存结果；`cache_image_layering_result` 用于恢复，返回已校验的本地路径、完整性和目录搬迁状态，供技能调用 `present`。结果地址失效时只按同一句柄刷新一次，并复用对象路径相同的已验证文件。诊断指明无效字段与原因，不记录带签名的 URL。

#### Token 影响

加载后五个分层工具定义增加固定请求 token；任务 ID、状态、本地路径、URL 和 Job 通知产生时增加保留 token。

#### KV Cache 影响

结果与 Job 消息追加到对话，不改写此前请求前缀。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 私有桶可能拒绝直接读取所返回的 URL。正式上线前仍需在隔离环境核验 STS 写权限、对象键唯一性、桶版本控制及无企业登记对象的清理。
- 原图在本地按内容寻址存储，即使暂存提示词后来被丢弃，已保存的原图仍存在。
- 代理任务句柄约 24 小时后过期。目标 Gateway 必须部署 `call-insight-api` 连接；本地服务仓库代码不能证明目标环境已经部署。上游可能仅返回 PNG，任务成功不保证取得 PSD。技能仅对已验证本地文件调用 `present`。生产环境结果 OSS 主机须配置到 `generationResultHosts`。

<a id="dev-note"></a>
### 开发备注

无。
