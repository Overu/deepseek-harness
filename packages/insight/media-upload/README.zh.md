---
description: "因赛 Desktop 上传附件至 OSS 并以当前登录态进行图像分层的工具。"
kind: "package-bundle"
---

# @insight-ai/desktop-media-upload-plugin

[English](README.md) | 中文

## 概述

因赛 Desktop 加载此组合，注册通用 OSS 上传工具及图像分层的来源、提交、查询和结果地址工具。通用上传仅接受当前轮次用户直接提供的附件：“完全权限”下免单独审批，其余权限预设保留各自审批行为。图像分层从最近三个含用户消息的轮次中选择图片，在提交时上传已存储的字节，并由会话 Job 跟踪企业任务。插件把结果 URL 保存为工作区 JSON 清单，按原图展示 PSD 与分层图片卡片；用户点击“下载”后直接获取该文件，不再二次确认。

## 目录

- [使用本包](#use-this-package)
- [实现](#implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

本包仅由因赛 Desktop 产品组合加载。普通图片消息保留供模型输入的归一化图片；选中图片上传时，本插件读取该已存储版本。文件附件仍保留原始字节。`serviceEnvironment` 选择固定的测试或生产上传中心；`requestTimeoutMs` 和 `ossTimeoutMs` 限制外部请求时间。`generationResultHosts` 为空时，测试环境使用固定的测试 OSS 结果主机；生产环境在插件启动时要求非空列表。随产品打包的生产配置允许 `game-ai-editor-videoassets-test.oss-cn-guangzhou.aliyuncs.com`，这是生产服务使用的结果主机。

本包携带[图像分层技能指令](guidance/image-layering/SKILL.md)、[展示元数据](guidance/image-layering/ui.json)及不参与当前交付链路的旧 PSD 辅助脚本。Host 启动时通过 Insight 技能中心注册该技能，使其可在会话和“专家技能 → 平台预置”中使用。同名账号安装版优先于插件版，旧目录副本的优先级更低。

模型可提供 `attachmentIndex`，即当前轮次用户直接提供的文件和图片附件中的 1 基序号；有多个候选项时必须指定。粘贴文本、本地路径、Canvas 素材、继承消息和旧轮次都不构成上传授权。图片使用已校验的归一化字节和与编码一致的扩展名；插件不会还原原始文件。上传中心收到文件名与路由类型，但不收到文件大小或 MIME；STS 成功响应不能证明其接受范围、写权限或大小上限。原企业附件策略不再参与本流程。

<a id="implementation"></a>
## 实现

`src/image-layering.ts` 通过已认证代理提交任务，收到任务句柄后启动 Session Job。插件不再持久记录任务预留或绑定；重复调用提交工具可能创建另一个付费任务。非超时查询错误在第一次读取后停止该图 Job；单次查询达到请求期限时才用同一句柄补查一次。远端明确失败或结果不完整时不自动复查或重建。`job_kill`、关闭或重启只停止本地跟踪，不取消远端任务；已知句柄在有效期内仍可查询。Job 结束后，`cache_image_layering_result` 重新查询同一句柄，由 `src/result-cache.ts` 通过 Session 沙箱文本文件系统把校验过的服务 URL 写入当前工作区 `generated/image-layering/`。创建清单时不下载 PSD 或图片字节。客户端从已记录的工具结果恢复分组卡片；`src/result-download.ts` 在下载时核对会话记录、当前账号范围、最新任务结果、允许的 OSS 主机、大小和文件签名，再流式返回文件。认证下载路由只接收会话定位信息和文件序号，不接收客户端传入的 URL。

`src/upload-source.ts` 将已提交 Session 事件分别折叠为通用上传的当前轮次附件列表，以及分层使用的最近三个用户轮次图片列表。工具需要上传时才读取并校验归一化图片，再把相同字节按实际编码的扩展名保存为文件，供既有 OSS 路径读取。`src/index.ts` 检查根 Agent；普通上传除有效“完全权限”预设外申请一次性审批，分层上传则依据用户对选定图片的处理请求执行。`src/upload-center.ts` 校验固定上传网关的 STS 响应，不暴露凭据。`src/oss-put.ts` 使用关闭 SDK 重试的流式写入。通用工具仅在 OSS HTTP 200 且已存储字节完整消费后返回 URL；结果不明时不自动重复 PUT。

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

`prepare_image_layering_source` 列出合格的已存储图片，多张不同图片时先选定。`submit_image_layering` 接收 `sourceRef`、可选 `prompt` 和非负 `numLayers`（默认 `0`），在 Host 内上传并提交，不再请求通用上传的单独审批。兼容路径仍接受同轮普通上传得到的 `imageUrl`。`get_image_layering` 使用 `taskHandle` 和可选 `watch` 查询；查询失败返回 `query_unavailable`，包含结构化原因、可选业务码与代理请求 ID，以及 `remoteOutcome: "unknown"`。代理创建返回 HTTP 5xx 时按结果未知处理，不自动重建。`cache_image_layering_result` 接收已知句柄和原图短标签，在当前工作区写入 URL 清单，并返回清单路径、完整标志、账号范围及供客户端卡片展示的 PSD/图片信息。用户点击卡片时才查询同一句柄的最新结果并下载选中的文件；不重新创建付费任务，也不弹二次确认。诊断指明无效字段与原因，不记录带签名的 URL。

#### Token 影响

加载后四个分层工具定义增加固定请求 token；任务 ID、状态、清单路径、URL 和 Job 通知产生时增加保留 token。

#### KV Cache 影响

结果与 Job 消息追加到对话，不改写此前请求前缀。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 私有桶可能拒绝直接读取所返回的 URL。正式上线前仍需在隔离环境核验 STS 写权限、对象键唯一性、桶版本控制及无企业登记对象的清理。
- 图片归一化可能缩小尺寸或重新编码；OSS 对象和返回大小对应已存储的归一化图片。只有选中图片实际进入上传工具时，插件才另存供上传使用的文件副本。
- 代理任务句柄约 24 小时后过期。目标 Gateway 必须部署 `call-insight-api` 连接；本地服务仓库代码不能证明目标环境已经部署。上游可能仅返回 PNG，任务成功不保证取得 PSD。卡片只证明已记录结果 URL；远端文件过期或拒绝访问时下载仍会失败。JSON 清单包含完整 URL，包括可能存在的签名查询参数，工作区的读取者可查看。生产环境结果 OSS 主机须配置到 `generationResultHosts`。

<a id="dev-note"></a>
### 开发备注

无。
