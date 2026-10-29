# 工具契约与错误恢复

这份文档解决「13 个工具各自怎么调、回执怎么读、报错之后下一步做什么」的问题：给每工具契约、版本纪律、
回执类型表、`error.retry` 六值语义、错误码决策树和标准调用时序。
读到它的时候，你应该是**准备发起画布写入/生成/处理**，或者**刚收到一个非 `saved` 的回执**。

证据口径：`[源码]` = `@insight-ai/desktop-canvas-plugin@0.3.0-alpha.31` 的 `lib/index.js`（工具注册表与 DTO 校验器，
2026-10-21 本机安装版本）；`[实测]` = 本机画布 103432/103460/103577/103582 的真实回执。旧版 alpha.20 的
`action` 单操作接口、`delete`/`reconnect`、单 `nodeId` 的 run、图片专用 import **均已过期**。
**alpha.31 起不要求先打开画布视图，但 Client 桥与会话登记仍是相关工具的前提**；`CLIENT_UNAVAILABLE`
在该版本仍会发生，同一会话不切页也可能发生。`summary` 直接读 Host 摘要；`nodes` / `graph` 经 Client 桥。
连接不可用、超时、未知/矛盾回执及断点续跑，统一按 [connection-recovery.md](connection-recovery.md) 处理。

---

## 0. 逐工具参数白名单（调用前核对，别凭记忆）

DTO 校验器对**未知字段是硬拒绝**：多带一个不支持的字段，整次调用返回
`INVALID_ARGUMENT: 工具参数含不支持的字段`，不会"忽略多余字段"。2026-10-22 真实踩过两次：
`canvas_get(view:"nodes")` 带了 `limit`、`canvas_get(view:"graph")` 带了 `nodeIds`。

| 工具 | 合法字段 | 常见误用 |
|---|---|---|
| `canvas_get` | `canvasId`；`view`；**`nodeIds`（仅 nodes，1–20）**；**`refresh`（仅 nodes/graph）**；`limit / nodeOffset / edgeOffset / expectedVersion`（**仅 graph**；offset>0 时 `expectedVersion` 必填） | nodes 带 `limit`；graph 带 `nodeIds`；summary 带 `refresh` |
| `canvas_models` | `canvasId`、`nodeType`、`modelType`、`model`、`view`、`page`、`limit`、`modelOffset`、`modeOffset`、`expectedCatalogVersion`；`view:"voices"` 另收 `voiceSource / voiceId / name / language / gender` | `view:"voices"` 带 `modelType / modeOffset / modelOffset`；续页漏 `expectedCatalogVersion` |
| `canvas_node_edit` | `canvasId`、`expectedVersion`、`ops[]`（add/edit/remove/configure） | `params` 里塞 `model / modelType / prompt`；`add` 用 `position` 而不是 `placement` |
| `canvas_edges` | `canvasId`、`expectedVersion`、`ops[]`（add/edit/remove/reorder） | 用节点标题/URL 代替真实 `sourceNodeId` |
| `canvas_run` | `canvasId`、`nodeIds[]`（≤20、不重复）、`expectedVersion` | `expectedVersion` 用旧版本或 `null`；把 text 节点放进 `nodeIds` |
| `canvas_layout` | `canvasId`、`expectedVersion`、`nodeIds`、`mode` | 想用它做"逐节点拖拽"（只能整体重排） |
| `canvas_asset_import` | `canvasId`、`expectedVersion`、`source`、`title`、`placement` | 用本地路径/文件名当连线依据 |
| `canvas_process` | `canvasId`、`expectedVersion`、`kind`、`sourceNodeId`、`outputIndex`、`params` | 对非画布素材做处理 |
| `canvas_create` / `canvas_list` / `canvas_open` / `canvas_capabilities` / `canvas_assets` | `name`；`name/page/limit`；`canvasId/nodeId`；`canvasId/kind/model`；`mediaType/sourceType` | 拿 `canvas_create` 做连通性探活（画布删不掉） |

规则：**报 `INVALID_ARGUMENT` 时先读工具定义再调用**，不要换着字段试探；字段来自实时 schema 与本文，不来自记忆。

---

## 1. 版本纪律

| 纪律 | 具体 |
|---|---|
| **写前用最新 `confirmed`** | `canvas_get(view:"nodes"\|"graph")` 回执里的 `version` 且 `consistency:"confirmed"` 才能用于下一次写入；`summary` 视图不提供写入版本 |
| **只有 `saved` 才算持久化** | `submitted` 是「任务已接受」；预检不代表执行；普通 `rejected/effect:none` 仅说明对应操作未生效；未知码或部分成功需单独核验 |
| **`refresh:true` 只用于权威同步** | 普通写前/写后读取用 `refresh:false`（默认）。`refresh:true` 会触发可见画布重载，只在①显式权威同步 ②冲突 ③未知回执恢复 时用 |
| **生成结束后的版本不可信** | `job_output` 回执里的 `version` 与画布当前版本常常不一致；下一次写之前必须 `canvas_get`（必要时 `refresh:true`）重新取 confirmed 版本 `[实测]` |
| **`unconfirmed` 只能靠 `refresh:true` 解** | 2026-10-21 实测：生成/TTS 结束后连续两次 `canvas_get(refresh:false)` 仍返回 `consistency:"unconfirmed"`；`refresh:true` 一次即 confirmed（画布 103582，version 131）。写前看到 unconfirmed 不要硬写 |

版本错误：`VERSION_UNAVAILABLE`（`version === null`）、`VERSION_CONFLICT`（传入版本 ≠ 当前版本，不自动替换）。
目录分页：`CATALOG_VERSION_CONFLICT`（`canvas_models` 续页 `expectedCatalogVersion` 不符，重读第一页）。

---

## 2. 工具速查

| 工具 | 读/写 | 用途 | 回执 status |
|---|---|---|---|
| `canvas_create` | 写 | 建空画布 | `created` / `create_unknown` / `rejected` |
| `canvas_get` | 读 | summary / nodes / graph | `read` / `graph` / `rejected` |
| `canvas_list` | 读 | 按名称找画布 | `listed` / `rejected` |
| `canvas_open` | 读（导航） | 侧栏打开/定位 | `opened` / `rejected` |
| `canvas_models` | 读 | image/video/audio 模型与参数；`view:voices` | `models` / `voices` / `rejected` |
| `canvas_assets` | 读 | 会话素材来源（text/image/video/audio） | `available` / `needs_input` / `rejected` |
| `canvas_asset_import` | 写 | 文本/图片/视频/音频入画布 | `saved` / `needs_input` / `upload_unknown` / `submission_unknown` / `rejected` |
| `canvas_node_edit` | 写 | ops：add/edit/remove/configure | `saved` / `submission_unknown` / `rejected` |
| `canvas_edges` | 写 | ops：add/edit/remove/reorder | 同上 |
| `canvas_layout` | 写 | grid/horizontal/vertical 排版 | `saved` / `submission_unknown` / `rejected` |
| `canvas_capabilities` | 读 | 专用处理可用性/参数、排版模式 | `capabilities` / `rejected` |
| `canvas_process` | 写 | 高清/分层/抠图 | `process_ready` → `process_submitted` / `process_partial` / `rejected` |
| `canvas_run` | 写 | 批量生成 image/video/TTS audio | `submitted` / `paused` / `submission_unknown` / `rejected` |

所有写入工具入参：`canvasId` + `expectedVersion`（最新 confirmed 版本原样传入，字符串）。
**所有工具回执都是 JSON 字符串**，字段名以下表为准。

---

## 3. 各工具契约

### 3.1 `canvas_create`
- 入参：`name?`（1–100 字符）。
- 回执：`created` 含真实 `canvasId`、`address`（`dsh-resource://canvas/<id>`）、`version`（初始 `"0"`）、`runtime`（`ready`/`not_ready`）。
- `runtime:"not_ready"` **不撤销创建**：画布已存在，继续 `canvas_get`。`create_unknown` → 核对 `canvas_list`，**不重建**。

### 3.2 `canvas_get`
- 入参：`canvasId`；`view` ∈ `summary`(默认)/`nodes`/`graph`；`nodeIds`（仅 nodes，1–20 唯一）；`refresh`；`nodeOffset`/`edgeOffset`/`limit`/`expectedVersion`（仅 graph）。
- **`limit` 只对 graph 有效**；给 nodes 传 `limit` 会 `INVALID_ARGUMENT`（"工具参数含不支持的字段"）`[实测]`。
- `summary` 不经过 Client 桥，不提供 confirmed 写入版本；摘要成功不能证明连接已恢复。`nodes` / `graph` 经 `ensureContext` + `dispatch`，成功仅证明当时读取路径可用，编辑/运行能力另看回执。
- 连接探测用原画布的 `nodes`、`refresh:false`，有已知节点时只读该节点；不通过创建、编辑、运行、导入或 `canvas_open` 探活。
- `nodes` 每节点字段：`id/type/title/contentType/text/prompt/params/paramHints/status/inputs/outputs/generation/truncatedFields`，可选 `position/size/parentId`、**`seniorParams`/`seniorParamHints`**（TTS 高级参数，alpha.30 新增）。**audio 的 `prompt` 即待朗读台词**（2026-10-21 实测，零入边可出音频）。
- `graph` 每节点：`id/type/title/position/size/parentId/ports/allowedInputTypes/canConfigureGeneration`；边：`id/source/target/sourceHandle/targetHandle`。
- graph 分页固定版本：首页给 `expectedVersion`，`offset>0` 必须带同一个；`limit` 是节点/边各自页长（1–20）。
- `truncatedFields` 非空 → 该字段被截断，不要据此判断。

### 3.3 `canvas_models`
- 入参：`canvasId` + `nodeType` ∈ `image`/`video`/`audio`；`view` ∈ `models`(默认)/`voices`；`modelType`/`model`；分页 `modeOffset`/`modelOffset`/`limit`/`expectedCatalogVersion`。
- 回执 `models`：`catalogVersion`、`modes[]`、`modelType`、`models[]`、`paramHints[]`；音频另有 **`seniorParamHints[]`** 与 **`voiceSelection:{required, customizable}`**。
- `voices` 视图：`voiceSource`(public/my)、`name`/`language`/`gender`、`page`；`voiceId` 查详情；元素含 `voiceId/name/source/compatibility(model_declared|not_declared)`。
- `paramHints` 是**默认父参数组合**，不等于节点当前值；`catalogVersion` 变化后旧续页作废。

### 3.4 `canvas_assets`
- 入参：`mediaType?` ∈ `text/image/video/audio`；`sourceType?` ∈ `attachment/conversation_asset`。
- 回执：`assets[]`（`mediaType/name/source`）+ `totals` + `truncated`。`source` 可原样用于 import。
- 只读：不下载、不上传、不扫描工作区；`generatedSourceError` 表示生成来源未确认，不得用别的素材顶替。

### 3.5 `canvas_asset_import`
- 入参：`canvasId`、`expectedVersion`、`source`、`title?`、`placement?`；**顶层 `position` 被拒**。
- `source` 四分支（`additionalProperties:false`）：
  - `{type:"attachment", attachmentId}`（当前可见用户消息的附件，文本/图片/视频/音频）
  - `{type:"conversation_asset", assetRef}`（形如 `conversation-(image|video|audio)-<64hex>`）
  - `{type:"canvas_node", canvasId, nodeId, outputIndex?}`（源节点可为 text/image/video/audio；`outputIndex` 0–19；多产物省略 → `needs_input`）
  - `{type:"workspace_file", path}`（当前会话工作区内文件）
- 媒体上限 `[源码]`：文本 128 KiB（正文 ≤32768 字符）；图片 20 MiB；音频 20 MiB；视频 200 MiB（且 ≤300 秒）。
  支持 `txt/md`、`png/jpg/jpeg/gif/webp`、`mp4/mov/webm`、`mp3/wav/m4a/aac`，按内容嗅探。
- 回执：`saved`（`affectedNodeIds[0]` = 新节点）+ `asset{url,status:uploaded|reused}` + `assetRegistration{status:registered|rejected|not_applicable}`。
  文本两者为 `not_applicable`；入库失败**不回滚节点**。
- 上传按「账号+会话+媒体+sha256」缓存复用；`upload_unknown` 不重传，节点是否已建以 `canvas_get` 为准。

### 3.6 `canvas_node_edit`（ops）
- 入参：`canvasId`、`expectedVersion`、`ops[]`（非空、有序、无条数上限但受消息/时间限制）。
- 四类 op：
  - `{"op":"add","node":{"type":"text|image|video|audio","placement?":{...},"changes?":{title,text,prompt,params}}}`
  - `{"op":"edit","nodeId":"...","changes":{...}}`（`changes` 至少一个字段）
  - `{"op":"remove","nodeId":"..."}`（同时移除关联边）
  - `{"op":"configure","nodeId":"...","configuration":{modelType,model,params,voiceId,seniorParams}}`
- `changes` 白名单：`title`(≤100) / `text`(≤32768，仅文本) / `prompt`(≤32768) / `params`（仅标量；禁 `model/modelType/prompt`）。
- `configure`：image/video 配模式与模型；audio（TTS）额外支持 `voiceId` 与 `seniorParams`（字段/范围见 `seniorParamHints`）。文本节点 → `UNSUPPORTED_NODE`。
- 回执：`saved`（整批）→ `completed[]` 每项带自己的 `receipt`（新 `version`、`affectedNodeIds`、可选 `warnings`）与 `nextIndex`；失败/未知停在当前项，**不回滚已成功项**。
- `warnings` 是重要信号：例如给 `text_to_image` 节点加图片边会返回「仅支持文本输入」`[实测]`。

### 3.7 `canvas_edges`（ops）
- 四类 op：`add{connection}`、`edit{edgeId,connection}`（改接保留边 ID）、`remove{edgeId}`、`reorder{targetNodeId,edgeIds}`。
- `connection`：`sourceNodeId/targetNodeId` + 可选 `sourceHandle`/`targetHandle`；省略端口时由原生按源媒体解析。
- `reorder` 必须给目标节点的**全部**入边（长度、唯一性、归属三项校验）。
- 回执同 node_edit：`saved` + `completed[]`（`affectedEdgeIds`）+ `nextIndex`；`unchanged:true` = 等价无事发生。

### 3.8 `canvas_layout`
- 入参：`canvasId`、`expectedVersion`、`nodeIds[]`、`mode` ∈ `grid/horizontal/vertical`。
- 回执：`saved` + `affectedNodeIds`；原生规则**可能扩展到同组成员**，回执列实际影响节点。
- 用途：建完整体重排、用户要求"整理画布"；**不是移动单个节点的通用接口**。

### 3.9 `canvas_capabilities`
- 入参：`canvasId`；`kind?` ∈ `image_upscale/video_upscale/image_layering/auto_matting`；`model?`（分层参数）。
- 回执：`capabilities`：`layout[]`（可用排版模式）+ `processes[]`（`kind/label/input/available/reason/params[{field,choices,default}]`）。
- `available:false` 时**不要调用** `canvas_process`；如实说明"该处理当前账号不可用"。

### 3.10 `canvas_process`
- 入参：`canvasId`、`expectedVersion`、`kind`、`sourceNodeId`、`outputIndex?`（0–19）、`params?`（`resolution`/`model`/`num_layers`，按能力查询）。
- 回执：`process_ready`（预检：`planId/outputNodeIds/generation/quote`）→ `process_submitted`（`operationId/taskId`）；`process_partial` 表示已发生部分动作。
- **`submitted` 不是完成**：用同一 `jobId` 的 `job_output` 收终态；终态 `products`/`outputs` 是结果节点与 URL。
- 结果节点是新的关联节点；后续生成要连**结果节点**，不能继续用原图冒充。处理会占用图/视频数量额度。

### 3.11 `canvas_run`
- 入参：`canvasId`、`nodeIds[]`（非空、不重复、≤20；image/video/仅 TTS 的 audio）、`expectedVersion`。
- 回执：`submitted`（`jobId` + 每节点 `taskId/generation`）或 `paused`（`nextIndex`：只受理前缀，其余未提交）或 `submission_unknown`（有 `jobId` 也照常用 `job_output` 收）或 `rejected`。
- 并发：在途上限 8（`MAX_BRIDGE_INFLIGHT`）；超出 → `paused` 或 `BRIDGE_OVERLOADED`。
- 单节点与多节点走不同原生 action（`node.run` / `workflow.run`），但工具回执结构一致。
- 数量闸门：同一真实需求累计 **>30 图或 >6 视频** 触发官方确认；**音频不占图/视频阈值**。拒绝/无确认界面 = `CONFIRMATION_DECLINED`/`CONFIRMATION_UNAVAILABLE`，**尚未提交**。
- 跟踪超时：图/音频 30 分钟、视频 60 分钟；超时给 `monitoring_unknown`，**不等于后台失败**，读画布核对。
- `jobId` 是 Core Jobs 跟踪号，`taskId` 是云端任务号；`job_kill` 只停止跟踪，不取消云端生成。

### 3.12 `canvas_open`
- 入参：`canvasId`、`nodeId?`；只导航。
- 回执 `opened`：`content:loading|ready`、`focus:not_requested|focused|node_missing|view_unavailable`。`loading` 表示侧栏已开、内容未确认。

### 3.13 `canvas_list`
- 入参：`name?`、`page?`、`limit?`（1–20）。回执 `listed`：`canvases[{canvasId,name,address}]`、`total`、`nextPage`。

---

## 4. ops 批量语义（alpha.30 核心变化）

```jsonc
// 一次改多个节点
{"canvasId":"...","expectedVersion":"32","ops":[
  {"op":"edit","nodeId":"...","changes":{"text":"..."}},
  {"op":"edit","nodeId":"...","changes":{"prompt":"..."}}
]}
// 回执：completed[].receipt.version 逐项递增；nextIndex 是停止位置
```

- **每项独立保存、版本逐项递增**；失败或未知会停在该项，`nextIndex` 是继续位置，**不回滚已成功项**。
- 一个 `expectedVersion` 贯穿整批；中途被外部改动 → 冲突停在当前项。
- 建图推荐：`add × N` 一次调用 → `configure × N` 一次调用 → 素材导入 → `add × 边` 一次调用。
- `add` 的 `changes` 不触发生成；`remove` 连带删除关联边；`edit` 不清空其他字段。

---

## 5. 回执类型表

| `status` | 工具 | 含义 | 下一步 |
|---|---|---|---|
| `created` | create | 已建；看 `runtime` | 带 `canvasId` 继续读 |
| `create_unknown` | create | 未确认 | 查列表，**不重建** |
| `read` / `graph` | get | 读取成功；看 `consistency` | `confirmed` 可写 |
| `models` / `voices` | models | 目录/音色读取成功 | 可配置 |
| `available` | assets | 素材来源可用 | 选唯一明确来源 |
| `opened` | open | 侧栏已开 | `focused` 才算定位成功 |
| `listed` | list | 画布列表 | — |
| `capabilities` | capabilities | 处理可用性 + 排版模式 | 不可用就别提交 |
| `saved` | node_edit/edges/layout/import | **已持久化** | 用回执新版本继续 |
| `needs_input` | import/assets | 缺 `outputIndex`/来源 | 补齐参数重调 |
| `preflight` | run（内部） | 预检通过（quote） | 继续提交 |
| `submitted` | run | 已提交 | `job_output` 收终态 |
| `paused` | run | 只受理前缀 | 收完本 Job，读版本续跑 |
| `process_ready` | process | 处理预检通过 | 工具会继续提交 |
| `process_submitted` | process | 已进入处理链路 | `job_output` |
| `process_partial` | process | 部分动作已发生 | 保留身份，读回核对 |
| `submission_unknown` | 写/run/process | 结果未确认；`phase` | 读回或 `job_output`，**绝不自动重试** |
| `upload_unknown` | import | 上传未确认 | 读回核对，同来源会复用 |
| `rejected` | 全部 | 普通 `effect:"none"` 表示对应操作未生效；若错误码为未知或存在已成功前缀，不能据此判定整批未提交 | 按 `error.code`/`retry` 及实际副作用核验 |

错误对象：`error:{code,message,retry}`；`code` 为固定枚举（见 §7），`message` ≤2048，`retry` 六值。

---

## 6. `error.retry` 六值

| `retry` | 含义 | 动作 |
|---|---|---|
| `read_first` | 先读再决定（默认） | `canvas_get` 核对现状 |
| `after_input` | 改参数后可再试 | 按 message 精确改参数，不原样重发 |
| `after_ready` | 等环境就绪 | 客户端问题按连接恢复文档有界只读检查；登录/用户编辑阻塞先交接；不直接重复业务写入 |
| `developer_fix` | 配置需修 | 修配置本身，不重试 |
| `user_decision` | 需用户拍板 | 已发出后被拒，换不换素材由用户定 |
| `never_auto` | 绝不自动重试 | 未知结果：读回核对 |

映射（源码）：`SUBMISSION_UNKNOWN`/`ASSET_UPLOAD_UNKNOWN` → `never_auto`；`INVALID_ARGUMENT` → `after_input`；
`CONFIGURATION_ERROR` → `developer_fix`；`CLIENT_UNAVAILABLE`/`CONTEXT_NOT_READY`/`AUTH_REQUIRED`/`EDITOR_BUSY` → `after_ready`；其余 `read_first`。
工具层会强制把 `submission_unknown` 的 `retry` 改写为 `never_auto`。

---

## 7. 错误码 → 动作

| 错误码 | 场景 | 动作 |
|---|---|---|
| `VERSION_CONFLICT` / `VERSION_UNAVAILABLE` | 版本过期/不可用 | 重读拿 confirmed；必要时 `refresh:true`；不覆盖用户改动 |
| `CATALOG_VERSION_CONFLICT` | 目录续页版本不符 | 重读第一页 |
| `INVALID_ARGUMENT` | 字段组合/类型/上限错 | 按 message 改参数；如 nodes 传 `limit`、顶层 `position`、`params` 含 `model` |
| `UNSUPPORTED_NODE` | 文本节点 configure / 运行文本或上传节点 / 工具节点 | 换 image/video/TTS audio 生成节点；文本节点交给用户 |
| `INVALID_CONNECTION` | 自环/成环/重复/类型不兼容/端口超限 | 读 graph 真实端口，改结构 |
| `NODE_BUSY` | 节点已有在途生成/处理 | 等 `job_output`，不重复提交 |
| `EDITOR_BUSY` | 用户正在编辑 | 等用户结束，不绕过 |
| `BRIDGE_OVERLOADED` | 在途/回执/单条消息 >2 MiB | 拆小批次、缩短 prompt |
| `CLIENT_UNAVAILABLE` / `CONTEXT_NOT_READY` | Client 连接、会话登记或上下文/能力未确认；具体原因尚需证据 | 按 `connection-recovery.md`：原画布 nodes 只读探测，默认累计60秒/最多3次；就绪并核对版本、现状及原授权后，仅明确未生效的剩余操作可恢复重试1次；不强制开侧栏/刷新/重启 |
| `CLIENT_AMBIGUOUS` | 多个 Client 的归属不唯一 | 保存断点并说明归属冲突；不随意选 Client 或通过换会话绕过 |
| `SUBMISSION_UNKNOWN` | 写入/生成/处理未确认，含 `rejected/effect:none` 与未知码矛盾的形态 | 保留原请求/任务身份；有 jobId 追原 Job，无 jobId 则权威核验受理情况。无新 Job、旧 outputs 或 confirmed 版本均不足以证明未提交；不自动重提 |
| `ASSET_NOT_FOUND` | 附件不可见/assetRef 不属于本会话/源节点无产物 | 先区分来源缺失；不顶替、不重生成 |
| `ASSET_VALIDATION_REJECTED` | 格式/轨道/大小/时长不合规 | 换素材或压缩；不重试同一文件 |
| `ASSET_UPLOAD_REJECTED` / `ASSET_REGISTRATION_REJECTED` | 上传/入库被拒 | 节点保留；如实说明，不重加 |
| `ASSET_UPLOAD_UNKNOWN` | 上传未确认 | 不重传；同来源复用已确认上传 |
| `COUNT_CHANGED` | 用户又发了新话 | 按新需求重新规划 |
| `CONFIRMATION_DECLINED` / `CONFIRMATION_UNAVAILABLE` | 数量闸门 | 停止，不拆批绕过 |
| `AUTH_REQUIRED` | 登录失效/账号变化 | 请用户重新登录 |
| `AGENT_CONTEXT_REQUIRED` | 不在 Agent 会话上下文 | 从当前会话重试 |
| `READ_TIMEOUT` / `READ_REJECTED` | 读取超时/被拒 | 读取可安全重读；写入先核对 |
| `NODE_NOT_FOUND` / `EDGE_NOT_FOUND` | ID 不存在 | 重读 graph 拿真实 ID |
| `DUPLICATE_REQUEST_MISMATCH` | 同调用位参数不同 | 重新发起正常调用 |
| `CANCELLED_BEFORE_DISPATCH` | 提交前取消 | 无副作用，可重新发起 |
| `SAVE_REJECTED` / `RUN_REJECTED` | 原生保存/运行被拒 | 读 message 与画布现状 |

---

## 8. 标准调用时序

```
1. canvas_create(name)                                    → created
2. canvas_get(canvasId, view:"nodes")                     → confirmed 版本
3. canvas_models(nodeType:"image"/"video"/"audio")        → 模式/模型/参数（audio 另读 voices）
4. canvas_node_edit(ops:[add × N])                        → saved + affectedNodeIds（真实节点 ID）
5. canvas_node_edit(ops:[configure × N])                  → saved（先定模式再加图边）
6. canvas_asset_import(...)                               → saved + asset/assetRegistration
7. canvas_get(view:"graph")                               → ports/allowedInputTypes/edges
8. canvas_edges(ops:[add × M])                            → saved
9. canvas_layout(nodeIds, mode)（可选）                    → saved + affectedNodeIds
10. canvas_run(nodeIds:[...], expectedVersion)            → submitted/paused（记 jobId）
11. job_output(jobId)                                     → completed + outputs
12. canvas_get(view:"nodes", refresh:true)（写前）         → confirmed 版本
```

约束：步骤 4/5/6 必须早于 8；步骤 9 不能替代依赖；步骤 10 只提交依赖已就绪的节点；
步骤 11 只对拿到 `jobId` 的批次收；步骤 12 是下一次写的版本来源。

---

## 9. 未知结果统一动作

| 回执 | 保留标识 | 恢复 |
|---|---|---|
| `create_unknown` | 无 | 查 `canvas_list` 同名/新画布，不重建 |
| `submission_unknown`（save） | `canvasId/requestId/affectedNodeIds?` | `canvas_get` 读回，看目标是否已变 |
| `submission_unknown`（run） | `canvasId/jobId/nodeIds/generation` | `job_output` / 读节点 products，不重提 |
| `process_partial` | `nodeId/outputNodeIds/taskId` | 读回结果节点，保留身份 |
| `upload_unknown` | `canvasId/requestId` | 核验原上传/节点状态；同来源复用能力不等于允许未知状态下自动重新导入 |
| `monitoring_unknown` | `taskId` | 读节点 status/outputs，1–2 分钟后可能已完成 |

三条原则：① 未知 ≠ 失败，也 ≠ 成功；② 沿原请求/任务身份进行权威核验；③ 仅在权威记录明确未派发/未受理、无在途或未知项且原授权仍有效时，才考虑重新发起一次。没有查询能力就保留断点并说明证据缺口；不能凭一次读回未见变化认定「没做成」。完整流程见 `connection-recovery.md`。
