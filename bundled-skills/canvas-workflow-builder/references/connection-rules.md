# 连线规则

这份文档解决「两个节点到底能不能连、端口填什么、报 `INVALID_CONNECTION` 时错在哪」的问题：给允许矩阵、端口全表、判定顺序、可用连法的模板证据和 `canvas_edges` 四个 action 的字段契约。
读到它的时候，你应该是**准备 `canvas_edges` 写边、或刚被原生拒绝在排查端口**。

证据口径：`[源码]` = `@insight-ai/desktop-canvas-plugin@0.3.0-alpha.31/package/lib/index.js`；`[原生]` = 画布前端 bundle `canvas-app/dist/assets/workflowTabOwnership-BescLYeW.js`（`targetTypeMap` / `sourceTypeMap` / `handlersMap` / `edge.add|edit|remove|reorder` 的真实实现）；`[模板]` = 81 个 `tpl_*.json` 的 413 条边实测（alpha.20 快照）；`[目录]` = `recon/archetype_catalog.md`。

---

## 1. 允许矩阵（4×4）

连线允许 ⇔ **源媒体前缀 = 目标媒体前缀**（原生直接放行），**或**源媒体在**目标节点允许集**内（两条满足其一即可，不是"且"）。四类标准节点的矩阵：

| 源＼目标 | text | image | video | audio |
|---|---|---|---|---|
| text | ✅ | ✅ | ✅ | ✅ |
| image | ✅ | ✅ | ✅ | ❌ |
| video | ✅ | ❌ | ✅ | ❌ |
| audio | ❌ | ❌ | ✅ | ✅ |

同一张表换个读法（**目标允许集**，与上表等价）：

| 目标节点 | 允许的入边媒体 | 原生 `targetTypeMap` |
|---|---|---|
| `text` | text / image / video | `["text","image","video"]` |
| `image` | text / image | `["text","image"]` |
| `video` | text / image / video / audio | `["text","image","video","audio"]` |
| `audio` | text / audio | `["text","audio"]` |

**源侧能力**（原生 `sourceTypeMap`，agent 只会用到前两行）：

| 源节点 | 可作为源送出的媒体 |
|---|---|
| `text` | text / image / video / audio（**多**） |
| `image` | text / image / video |
| `video` | text / video |
| `audio` | audio |

易错点：`image` 节点**不能**把图送给 `image` 吗？能（image ∈ image 允许集）。`image → audio` 呢？**不能**——audio 只收 text/audio。`image → text` 呢？**能**，源媒体 image ∈ text 允许集，且目标端口是 `image_target`。

---

## 2. 四类节点的输入/输出端口表

原生 `handlersMap` 实测定义 `[原生]`。端口名 = `<媒体>_source` / `<媒体>_target`。

| 节点类型 | 输入端口（target） | 输出端口（source） | 端口限流 |
|---|---|---|---|
| `text` | `text_target`、`image_target`、`video_target` | `text_source` | 无 limit |
| `image` | `text_target`、`image_target` | `image_source` | 无 limit |
| `video` | `text_target`、`image_target`、`video_target`、`audio_target` | `video_source` | 无 limit |
| `audio` | `text_target`、`audio_target` | `audio_source` | 无 limit |

工具节点（agent 建不了，但会在既有画布上遇到）端口固定且**多数 limit=1**：

| 工具节点 | 输入 | 输出 |
|---|---|---|
| `multiViewTool` / `poseTool` / `highDefinitionTool` / `imageLayoutTool` / `textRedrawTool` / `imageEditorTool` / `sizeAdaptTool` / `imageInpaintTool` | `image_target`（limit 1） | `image_source` |
| `highDefinitionVideoTool` / `videoClipTool` | `video_target`（limit 1） | `video_source` |
| `audioClipTool` | `audio_target`（limit 1） | `audio_source` |
| `imageLipSyncTool` | `image_target` + `audio_target` | `video_source` |
| `poseTransVideoTool` | `image_target` + `video_target` | `video_source` |
| `storyboardTool` | 随 `data.params.mode` 变：`gen_script`→`text_target`；`video_understand`→`video_target`；其他→`text_target`+`image_target`+`video_target` | `image_source` |
| `panoramaTool` | `image_target` | `image_source` |

**端口名按素材种类而非节点类型命名** `[目录]`：`图→图/视频/文本` 都是 `image_source→image_target`；`文→图/视频/文本/配音` 都是 `text_source→text_target`；`视频→视频/文本` 是 `video_source→video_target`。
写 skill 时按「送进去的是图还是文」选端口，**不要按目标节点类型猜**。

---

## 3. 判定规则（原生 `edge.add` 的检查顺序）

对每条候选边 `{sourceNodeId, targetNodeId, sourceHandle?, targetHandle?}`，原生按下列顺序判定，**任一步失败即 `INVALID_CONNECTION`** `[原生]`：

| # | 检查 | 失败文案 |
|---|---|---|
| 1 | 源节点存在 | `连线节点不存在：<id>` |
| 2 | 目标节点存在 | 同上 |
| 3 | 源节点可作源：`!(type.includes("Tool") && sourceHandle 以 _source 结尾)` | `本期不编辑工具输出管理边或无输入端口的节点` |
| 4 | 目标节点有输入端口 | 同上 |
| 5 | 自环：`source !== target` | `节点不能连接自身` |
| 6 | **源端口解析**：省略 `sourceHandle` 时取该节点 handlers 里第一个 `type==="source"` 的端口 | `源节点没有指定的输出端口` |
| 7 | **目标端口解析**：省略 `targetHandle` 时取第一个 `mediaType === 源媒体` 的 target 端口 | `目标节点没有兼容的输入端口` |
| 8 | **类型兼容**：`源媒体 === 目标端口媒体` 且 `目标允许集包含源媒体` | `连线输入输出类型不兼容` |
| 9 | 原生 Store 校验 `validateConnection` | `连线未通过原生校验` |
| 10 | 同源同目标不得已有边 | `这两个节点之间已存在连线` |
| 11 | 目标端口未超 limit（四类标准节点无 limit，工具节点常为 1） | `目标输入端口已达到连线数量上限` |
| 12 | **不成环**（`target` 沿出边可达 `source` 即判环） | `此连线会产生循环依赖` |

> **「自环」与「成环」是两件事，别混（这是最常见的一处误读）**：
> - **自环**＝第 5 步，`source === target`，**一个节点连自己**，原生文案「节点不能连接自身」。这是最朴素的一道校验，原生在建边入口就拦掉。
> - **成环**＝第 12 步，`A → B → … → A`（长度 ≥2 的回路），**每个节点都不连自己**，原生文案「此连线会产生循环依赖」。它需要沿出边做可达性判断才能发现，成本更高，所以放在最后一步。
> - 两道校验**都只在原生层**；我们用 `validate_plan.py` 的 **R2（自环）+ R3（无环，DFS 检测）**在离线阶段先拦一遍，
>   目的是"别把已知错误的计划带到画布上"，而不是说这两件事经常发生。
> - **实测口径**：官方模板库 81 条完整模板的 **413 条边里自环 0 条、环 0 条**；本技能自建的三张实测画布（103414 / 103417 / 103432）
>   同样 0 自环。唯一观察到的真实脏数据是 **tpl_26 的 2 条悬空边**（`target` 指向已被删除的节点）——
>   那既不是自环也不是环，属模板作者删节点时留下的残边，**不要照抄**。
> - 技能里出现「节点不能连接自身」这句话时，它是在引用**原生的报错文案**（用于排错对号入座），不是"我们撞上过这个错"。

**目标端口自动回填式（第 7 步的实测形态）**：前端批量连线时按「源媒体前缀 + `_target`」构造目标端口——`targetHandle = 源媒体 + "_target"`；工具层省略端口时由原生按同一规则解析。所以：

```
源 image → 目标 video：targetHandle 自动 = "image_target"（不是 video_target）
源 text  → 目标 image：targetHandle 自动 = "text_target"
```

**照做**：普通四类节点之间的边，**省略 `sourceHandle`/`targetHandle` 让原生解析**是最稳的写法；只有当同媒体多端口、或目标已有多条同类入边需要区分时，才显式指定端口——且端口值必须原样取自 `canvas_get(view:"graph")` 的 `ports[].id`。

---

## 4. 六大可用连法与真实模板证据

| 连法 | 边数 `[模板]` | 代表模板 | 端口 |
|---|---|---|---|
| 图 → 图 | 190（`image_source→image_target` 总 325 条含跨类） | tpl_10 裂变套图、tpl_116 模特试衣、tpl_118 套图延展 | `image_source` → `image_target` |
| 文 → 图 | 50 | tpl_12 促销氛围、tpl_14 化妆品头图、tpl_19 卖点功能演示 | `text_source` → `text_target` |
| 图 → 视频 | 105 | tpl_100 雨伞种草带货、tpl_109 奢华钻戒展示、tpl_114 博主试穿合集 | `image_source` → `image_target` |
| 视频 → 文 | 1 | tpl_127 爆款视频换衣/换模特 | `video_source` → `video_target` |
| 文 → 音频 | 1 | tpl_22 短视频口播 | `text_source` → `text_target` |
| 文 → 文 | 22 | tpl_11 引流文案、tpl_22 口播（LLM 串联） | `text_source` → `text_target` |

补充实测分布（同一批 413 条边）：

| 端口对 | 条数 | 说明 |
|---|---|---|
| `image_source→image_target` | **325** | = 图→图 190 + 图→视频 105 + 图→文本 26 + 图→工具 3 + 1 条脏边 |
| `text_source→text_target` | **83** | = 文→图 50 + 文→文 22 + 文→视频 9 + 文→音频 1 + 1 条脏边 |
| `video_source→video_target` | **5** | = 视频→视频 4 + 视频→文本 1 |

`[目录]` 里的 190/105/50/26/22/9 是**按源节点类型→目标节点类型**统计的口径，与上表一致；引用数字时注明口径，别把 325 当成「图→图」的条数。

**照做**：
- 「上传图 + 文案 → 出海报」= 两条边进同一个 image 节点：`image_source→image_target` 与 `text_source→text_target`（image 节点同时具备这两个入口）。
- 「图 → 视频」不需要中间 image 节点，直接 `image_source→image_target` 打进 video 节点（A5 原型 35/81 模板都这么干）。
- 「LLM 出文案给图节点」= `text_source→text_target`；图节点也有 `text_target` 入口，**不要**写成 `image_target`。

---

## 5. 禁止项与报错码

| 禁止项 | 报错码 | 原生文案 / 说明 |
|---|---|---|
| 自环（源=目标） | `INVALID_CONNECTION` | `节点不能连接自身` |
| 工具节点作来源 | `INVALID_CONNECTION` | `本期不编辑工具输出管理边或无输入端口的节点`；且工具节点 agent 根本建不了（`node.type` 白名单只有 text/image/video/audio）`[源码]` |
| group 作目标 | `INVALID_CONNECTION` | group 无任何 handlers（无输入端口）→ 第 4 步即失败 |
| 成环 | `INVALID_CONNECTION` | `此连线会产生循环依赖`；执行侧另有总闸：`当前存在环形结构不允许执行，请删去成环连线` |
| 类型不兼容 | `INVALID_CONNECTION` | `连线输入输出类型不兼容`（如 image→audio、video→image、audio→text） |
| 同源同目标重复连 | `INVALID_CONNECTION` | `这两个节点之间已存在连线`（**同一对节点之间只能有一条边**，多路输入要靠不同源节点） |
| 目标端口超 limit | `INVALID_CONNECTION` | `目标输入端口已达到连线数量上限`（工具节点 input limit=1） |
| 端口 ID 不存在 | `INVALID_CONNECTION` | `源节点没有指定的输出端口` / `目标节点没有兼容的输入端口` |
| 边 ID 不存在 | `EDGE_NOT_FOUND` | `连线不存在或ID不唯一：<id>` |
| 节点 ID 不存在 | `NODE_NOT_FOUND` | `连线节点不存在：<id>` |
| 端口字段格式非法（空串、超 200 字符） | `INVALID_ARGUMENT` | 工具层校验在发往原生之前 |
| 目标节点无入边却做 reorder / edgeIds 不合法 | `INVALID_ARGUMENT` | `排序必须包含目标节点的全部入边，且不得包含其他连线` |

> `INVALID_CONNECTION` 的六种成因里，**只有端口写错和类型不兼容**是你构造参数的问题；**成环、重复边、超 limit** 是结构问题，改法是换源节点或删旧边，不是重试。

---

## 6. `canvas_edges` 四个 op（ops[]）

公共入参：`canvasId`、`expectedVersion`（**当前 confirmed 版本原样传入**）、`ops[]`（非空有序）。每个 op 只带自己的字段，多传即 `INVALID_ARGUMENT` `[源码]`。

| op | 专属字段 | 必需 | 说明 |
|---|---|---|---|
| `add` | `connection` | `connection.sourceNodeId`、`connection.targetNodeId` | `sourceHandle` / `targetHandle` 可选；省略按原生规则解析 |
| `edit` | `edgeId` + `connection` | `edgeId` 为已有真实边 ID | **保留原边 ID** 改端点；新端点重跑完整 §3 校验（自环、类型、成环、重复边都重新判） |
| `remove` | `edgeId` | 真实边 ID | 删除单条边 |
| `reorder` | `targetNodeId` + `edgeIds` | — | 重排目标节点的**全部入边**顺序 |

一次调用可含多条 op；每项独立保存、`completed[].receipt.version` 逐项递增，失败/未知停在该项（`nextIndex`），不回滚已成功项。

### 6.1 `reorder` 的硬要求（最容易踩）

原生实现 `[原生]`：

```
入边 = edges.filter(e => e.target === targetNodeId)
必须满足：入边.length === edgeIds.length
       且 new Set(edgeIds).size === edgeIds.length（无重复）
       且 入边.every(e => edgeIds.includes(e.id))（不含其他节点的边）
否则 → INVALID_ARGUMENT「排序必须包含目标节点的全部入边，且不得包含其他连线」
```

**照做**：`reorder` 前先 `canvas_get(view:"graph")` 读目标节点的**全部**入边 ID，把完整有序数组传进去；只传一部分、混入别节点的边、或含重复 ID 都会被拒。入边顺序影响 prompt 里「图1/图2」「`{{@图片1}}`」的编号映射，所以重排是**语义操作**，不是美化操作。

### 6.2 回执语义

| 回执 | 含义 | 下一步 |
|---|---|---|
| `saved` | 已持久化；带 `affectedNodeIds`、可选 `affectedEdgeIds`、`unchanged`、`warnings` | 用回执里的新 `version` 做下一次写入 |
| `submission_unknown` | 结果未确认（`phase` 为 `save`） | 先 `canvas_get` 权威核对，**不自动重复写入** |
| `rejected` + `effect:"none"` | 本次未写入，`error.code`/`error.retry` 给出原因 | 按 `tool-contract.md` 的决策树处理 |

`unchanged:true` 表示这次操作等价于无事发生（例如 edit 到同端点）——**不是失败**，不要据此重试。

### 6.3 模式门：连线成功 ≠ 输入合法

`image` / `video` 节点的模式与入边必须匹配（详见 `graph-dsl.md` §10）：

| 节点模式 | 入边 | 结果 |
|---|---|---|
| `text_to_image` / `text_to_video` | 有图片/视频 | 边可能保存成功，但 `warnings` 带「仅支持文本输入」`[实测]` |
| `reference_image_to_image` | 无图片 | 「需要连入图像」 |
| `image_to_video` | 图片 ≠ 1 | 「仅支持连入1张图像」 |

**照做**：先 `configure` 定模式，再加素材边；出现 warning 时补 configure，不要删边重连。

---

## 7. 出问题时的核对顺序

```
1. canvas_get(canvasId, view:"graph")                       ← 拿真实 ports / allowedInputTypes / edges，并取 confirmed 版本
2. 读目标节点的 ports[]：id、type("source"|"target")、mediaType、limit
3. 读目标节点的 allowedInputTypes[]：这是 §1 允许集的运行时真值
4. 看回执 error.code：
   INVALID_CONNECTION → 按 §5 映射到具体成因，改端口或改结构
   EDGE_NOT_FOUND/NODE_NOT_FOUND → ID 抄错了，重读 graph 取真实 ID
   VERSION_CONFLICT   → 画布被改过，重读版本再写
5. 修好后可整批 add，或一条一条 add 定位被拒项               ← ops 每项独立回执
```

**照做**：把 §1 的矩阵当成**规划期**的预测，把 `canvas_get(view:"graph")` 的 `allowedInputTypes` 当成**运行时**真值——两者不一致时以后者为准（例如某个模型变体收紧了入口）。任何一次 `INVALID_CONNECTION` 之后，先读 graph 再改，不要盲改端口重复提交。
