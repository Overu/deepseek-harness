# 画布图 DSL 规范

这份文档解决「画布图里到底有哪些字段、哪些能写、写错了会怎样」的问题：给字段全表、角色判定式、新旧字段迁移表和工具层可写边界。
读到它的时候，你应该是准备**建节点、配参数、连线或校验一张画布的结构**，而不是只想看画布有什么。

证据口径：`[源码]` = `@insight-ai/desktop-canvas-plugin@0.3.0-alpha.31/package/lib/index.js`（工具注册表与 DTO 校验器）；`[原生]` = 画布前端 bundle `canvas-app/dist/assets/workflowTabOwnership-BescLYeW.js`（原生校验与迁移的真实实现）；`[模板]` = `recon/tpl_*.json` 81 个可解析模板实测统计（alpha.20 时期快照，仅看结构规律）；`[目录]` = `recon/archetype_catalog.md`。

---

## 1. 图对象顶层结构

```jsonc
{
  "nodes": [ /* 节点数组，含 group */ ],
  "edges": [ /* 边数组 */ ]
}
```

| 事实 | 值 |
|---|---|
| 可解析模板 | 81 个，合计节点 **467**、边 **413** `[目录]` |
| 节点类型分布 | image 325、text 65、video 52、group 21、multiViewTool 3、audio 1 `[模板]` |
| 原生节点类型 | 20 种；工具节点 `poseTool/highDefinitionTool/imageLayoutTool/textRedrawTool/imageEditorTool/highDefinitionVideoTool/multiViewTool/audioClipTool/videoClipTool/imageLipSyncTool/poseTransVideoTool/sizeAdaptTool/imageInpaintTool/storyboardTool/panoramaTool` + `group` **agent 一律建不了**（`canvas_node_edit` 的 `node.type` 只收 `text/image/video/audio`）`[源码]` |
| 边端口分布 | `image_source→image_target` 325、`text_source→text_target` 83、`video_source→video_target` 5 `[模板]` |

> 图里 `nodes` **包含 group**。tpl_12 索引 nodes=11 其中 2 个是 group。做节点计数时要么排除 group，要么显式说明口径。

---

## 2. 节点对象全字段

### 2.1 原生存储字段（模板 JSON 实测）

| 字段 | 出现次数 / 467 | 类型 | 语义与陷阱 |
|---|---|---|---|
| `id` | 467 | string | 节点唯一 ID。`[源码]` 工具层要求 1–100 字符且 `trim()` 非空 |
| `type` | 467 | string | `text/image/video/audio/group/multiViewTool/...` |
| `position` | 467 | `{x:number,y:number}` | 世界坐标。**有 `parentId` 时是相对 group 左上角的坐标**，不是世界坐标 `[目录]` |
| `measured` | 439 | `{width,height}` | **上一次渲染的缓存尺寸，不是真值**。83/376 个节点的 `measured` 与当前 `aspect_ratio` 不吻合；改画幅后不会立即更新，**不要用它反推画幅** `[目录]` |
| `parentId` | 311 | string | 所属 group；非空时配合 `extent:"parent"` |
| `extent` | 131 | `"parent"` | 唯一取值，出现在带 `parentId` 的子节点上 |
| `style` | 21 | `{width,height}` | 只出现在 group 节点上（21 个 group = 21 个 `style`） |
| `data` | 467 | object | 见 2.2 |

### 2.2 `data` 子字段（模板 JSON 实测）

| 字段 | 出现次数 / 467 | 备注 |
|---|---|---|
| `data.taskInfo` | 467 | `{status, taskId, errorMsg}`；`status` 实测取值 `success`/`running`/`failure` |
| `data.time` | 467 | 字符串毫秒时间戳（例 `"1788772852731"`）。原生复制节点时写 `原值_Date.now()`，故可能形如 `"1788..._1788..."` `[原生]` |
| `data.title` | 452 | **只有 group 的 15 个节点没有**。长度上限 100 `[源码]`；原生读取时 `data.title.trim()` 为空则回退节点类型中文名 `[原生]` |
| `data.value` | 446 | 主产物 URL（图/视频/音频/文本正文都放这里）。文本节点的 LLM 结果也落 `data.value` |
| `data.params` | 446 | 生成参数对象，见 §4 |
| `data.seniorParams` | — | **TTS 高级参数**（`language_boost/emotion/speed/vol/pitch`）；alpha.30 起 `canvas_get(view:"nodes")` 也会返回 `seniorParams` 与 `seniorParamHints` |
| `data.product` | 446 | **数组**，元素形如 `{type:"image"\|"video"\|"text"\|"audio", value:"<URL>"}`。多产物时每项一条；`product[].value` 与 `data.value` 可能并存（首个产物） |
| `data.type` | 122 | **只有 122 个节点有**：image 117 个 `"upload"` + video 5 个 `"upload"`。**这不是角色判定的可靠依据**，见 §3 |

> 连线只用 URL：`data.value` 与 `data.product[].value` 是唯一合法的 OSS URL 来源。字段为空的节点（如输入节点尚未上传）连上去等于连了个空引用。

---

## 3. 输入/生成角色判定：**必须按入度，不能看 `data.type`**

| 判定式 | 定义 |
|---|---|
| 输入节点（上传） | 该节点在 `edges` 中的**入度 = 0** |
| 生成/处理节点 | **入度 > 0** |
| 输入节点是否带 `data.type=="upload"` | **不保证** |

实测反例与覆盖率 `[模板]`：

| 口径 | 数字 |
|---|---|
| 全库 `data.type=="upload"` | **122 个**（image 117 + video 5） |
| 按入度算的 image 输入节点 | **191 个**（`[目录]` 的口径记作 192 个输入图节点，差不影响结论） |
| 其中带 `upload` 标记的 | **116 个**；其余 **75 个无任何标记** |
| 结论 | 输入图节点里 `upload` 标记只覆盖约 6 成，**漏标率约 4 成** |
| 典型反例 | tpl_14 的 6 个输入图**全部无** `upload` 标记 `[目录]` |
- 另有 14 个「上传或生成」双用途节点：入度 0 但 `params.prompt` 非空，语义是「用户传了就用传的图，没传就按 prompt 生成」（例 tpl_86「上传/生成模特」）`[目录]`。

**照做**：判断某节点是不是输入源，只跑

```
入度 = edges.filter(e => e.target === nodeId).length
输入源 ⇔ 入度 === 0
```

不要写「`data.type==="upload"` ⇒ 输入节点」，也不要由标题里带「上传」二字推断。

文本节点再分两类 `[目录]`：`params.prompt` 为空 = 文本**输入**（内容在 `data.value`）；非空 = **LLM 生成节点**。

---

## 4. 边对象全字段

| 字段 | 出现次数 / 413 | 类型 | 语义 |
|---|---|---|---|
| `id` | 413 | string | 边 ID。旧模板里可能是 `xy-edge__<源id><sourceHandle>-<目标id><targetHandle>` 形式，新边是 UUID `[模板]` |
| `source` | 413 | string | 源节点 ID |
| `target` | 413 | string | 目标节点 ID |
| `sourceHandle` | 413 | string | `image_source` / `text_source` / `video_source` / `audio_source` |
| `targetHandle` | 413 | string | `image_target` / `text_target` / `video_target` / `audio_target`。**按送进去的素材种类命名，不按目标节点类型**：image→text 的边目标端口是 `image_target`（tpl_10 实例 26 条）|
| `className` | 413 | string | 恒等于 `sourceHandle`；原生在写边与清洗边时都强制 `className = sourceHandle` `[原生]` |
| `type` | 363 | `"default"` | 唯一取值；缺省即 default |
| `selected` | 357 | boolean | UI 瞬态，**不是数据**，写边时不要带 |
| `style` | 105 | `{strokeWidth:1.5, stroke:"#RRGGBB"}` | 端口配色，由 `sourceHandle` 决定：`image_source` `#52C41A`、`text_source` `#4155F0`、`video_source` `#B37FEB`、`audio_source` `#FA8C16` `[原生]` |
| `data` | 9 | object | 极少出现；模板里仅 9 条边有，不含结构化语义，**工具层不写** |

工具层写边时**只能给** `sourceNodeId / targetNodeId / sourceHandle? / targetHandle?`；`id` 由原生生成，`className`/`style`/`type`/`selected` 由原生回填 `[源码]`。

> 数据洁净度提醒：tpl_26 有 2 条脏边——1 条 `target` 指向不存在的节点，1 条 `source`/`target` 都是悬空 ID。解析模板时若发现引用了节点列表外的 ID，按无效边丢弃，不要据此推断连线规则。

---

## 5. 新旧字段迁移表

原生 `processNodesWithMigration` 的真实映射表 `[原生]`。**用左列写参数，原生会报「参数 X 不在当前模型允许的选项中」；用右列。**

| 旧名 | 新名 | 出现量（模板库残留） |
|---|---|---|
| `times` | `gen_count` | `times` 42 处（image 30、text 12）`[模板]` |
| `image_size` | `resolution` | 30 处（全在 image，与 `resolution` 并存的早期写法）`[模板]` |
| `size` | `resolution` | 本库 0 处，映射存在 `[原生]` |
| `ratio` | `aspect_ratio` | 本库 0 处，映射存在 `[原生]` |
| `duration_seconds` | `duration` | 本库 0 处，映射存在 `[原生]` |
| `seconds` | `duration` | 本库 0 处，映射存在 `[原生]` |
| 模型 `gemini-3-pro-preview` | `gemini-3.1-pro-preview` | 旧名仍出现在 31 个 text 节点与 101 个图节点（图节点是 `gemini-3-pro-image-preview`，**不属于此映射**） |

同一函数里还有两条附带规则，知道即可：

- 分辨率字面量换算（仅对 `doubao-seedream-4-5-251128` / `doubao-seedream-4-0-250828`）：`2048x2048 / 2304x1728 / 1728x2304 / 2560x1440 / 1440x2560 / 2496x1664 / 1664x2496 → 2K`，`3024x1296 → 4K`。
- 字符串 `"<resolution>p <seconds>"` 会被拆成 `resolution` + `duration` 两个字段。
- audio 节点：`configure` 的**顶层**写 `voiceId` + `seniorParams`（`language_boost/emotion/speed/vol/pitch`），**不是**塞进 `params`。alpha.30 起工具层已开放这两个字段（alpha.20 文档里"高级嵌套参数不开放"的说法已过期）。
- audio 节点的 **`prompt` 就是待朗读文本**（2026-10-21 实测，零入边可出音频）；`add`/`edit` 时直接写 `changes.prompt` 即可，不必为放台词建 text 节点。

**照做**：`params` 里只出现 `gen_count / resolution / aspect_ratio / duration / quality` 这五个标量名（`quality` 仅 `gpt-image-2` 系有）。写参数前用 `canvas_models` 拿当前模型的可选枚举。

---

## 6. 工具层可写字段边界

### 6.1 `changes` 白名单（`canvas_node_edit` 的 `add.changes` 与 `update.changes` 共用）

| 字段 | 约束 |
|---|---|
| `title` | string，≤100 字符，`trim()` 后非空 |
| `text` | string，≤32768 字符，**仅文本节点正文**，不触发生成 |
| `prompt` | string，≤32768 字符，普通生成节点提示词，**不触发生成** |
| `params` | 见 6.2 |

`changes` 必须**至少含一个字段**；空对象不合法 `[源码]`。alpha.30 起 `canvas_node_edit` 用 `ops[]` 批量提交，
`add.changes` / `edit.changes` 共用上表白名单。`configure` 是另一套：`modelType / model / params`（image/video），
audio(TTS) 另加 **`voiceId`** 与 **`seniorParams`**，同样至少一个字段。

### 6.2 `params` 硬约束

| 约束 | 具体 |
|---|---|
| 禁写字段 | `model`、`modelType`、`prompt`、`__proto__`、`constructor`、`prototype` |
| 值类型 | 必须 **scalar**：`null` / `boolean` / string（≤32768）/ 有限 number（`Number.isFinite`）。数组、对象一律不合法 |
| 键名 | 1–100 字符、`trim()` 非空 |
| 非空 | `params` 至少要有一个键 |
| 不支持 | `params` 只收标量；高级嵌套参数（`cameraControl` 等）不开放。**TTS 的 `seniorParams` 不是 params**，走 `configure.seniorParams` 独立字段 |

**怎么配模型**：模型只能走 `configure` 的 `configuration.modelType` / `configuration.model`（真实 value，不是中文展示名），**不能塞进 `params`**。

```
✅ canvas_node_edit(ops:[{op:"configure", nodeId:"<id>", configuration:{modelType:"reference_image_to_video", model:"seedance-2.5-vip-r2v", params:{aspect_ratio:"9:16", resolution:"480p", duration:15}}}])
✅ canvas_node_edit(ops:[{op:"configure", nodeId:"<audioId>", configuration:{modelType:"tts", model:"speech-2.8-turbo", voiceId:"<voiceId>", seniorParams:{speed:1.1, emotion:"calm"}}}])
❌ canvas_node_edit(ops:[{op:"configure", configuration:{params:{model:"seedance-2.5-vip-r2v"}}}])      → INVALID_ARGUMENT
❌ canvas_node_edit(ops:[{op:"configure", configuration:{params:{cameraControl:{camera:"Sony Venice"}}}}]) → INVALID_ARGUMENT（非 scalar）
```

### 6.3 上传/工具产物节点的写边界

`canvas_asset_import` 产生的 text/image/video/audio 节点属于「上传/导入节点」，**只允许改标题或删除**；不能 `configure`、不能当生成目标跑。标题为空字符串会直接 `INVALID_ARGUMENT`（`assets标题不能为空`）`[源码]`。
导入节点上常带一份原生默认 `params`（例如 `model:"gpt-image-2.5-sunburst"`、`aspect_ratio:"16:9"`）——那是默认占位，**不代表**该节点可生成；判断是否生成节点看 `contentType` 与 `generation`（导入节点 `generation:null`）。

---

## 7. `placement` 三种模式与「position/placement 互斥」

| 模式 | 形态 | 行为 |
|---|---|---|
| `auto` | `{mode:"auto"}` | 追加且**不移动旧节点** |
| `absolute` | `{mode:"absolute", position:{x,y}}` | 世界坐标；`x`/`y` 必须有限数值 |
| `after` | `{mode:"after", anchorNodeId:"<真实节点ID>"}` | 在锚节点**右侧**放置；**不建立连线**；**不保证消除附近重叠** |

**互斥结论（实测）**：`canvas_node_edit` 与 `canvas_asset_import` 里 `position` 与 `placement` **不能同时出现**——原生校验 `exclusivePlacement` 即 `!(has("position") && has("placement"))`，并且工具层在 `node` 根上直接拒收 `position`：

```
canvas_node_edit(node:{type:"image", position:{x:0,y:0}})  → INVALID_ARGUMENT「请使用node.placement指定放置规则；精确坐标使用absolute模式」
canvas_asset_import(position:{x:0,y:0})                     → INVALID_ARGUMENT（同上文案）
```

**照做**：要精确坐标就写 `placement:{mode:"absolute",position:{x,y}}`，**不要**在 `node` / 顶层写 `position` 字段。省略 `placement` 时按原生默认追加规则落位。
建完之后可以用 `canvas_layout(nodeIds, mode)` 做 `grid/horizontal/vertical` 整体重排（原生可能联动同组成员）；它**不能**把单个节点放到指定坐标。

---

## 8. 布局规律（照抄模板库的观感）

| 项 | 实测 `[目录]` | 照做 |
|---|---|---|
| 流向 | 410/411 条边满足 target 在 source 右侧（99.8%） | **一律左→右**，不要做回流布局 |
| 列间距（相邻列中心距） | n=111，中位 **472 px**；常见 450/350/600/550/500 | 同列 `x` 相同，列间距取 **450–550 px** |
| 行间距（同列相邻节点） | n=78，中位 **478 px**；常见 475/500/450/550 | 同列纵向间距取 **450–500 px**，fan-out 产物纵向等距排开 |
| 节点尺寸 | 生成/上传图节点宽度基准 **400 px**，高按画幅换算 | 长边恒 400：`3:4→299×400`、`1:1→400×400`、`9:16→225×400`（竖）/`400×713`（横）、`16:9→400×224`、`3:2→400×269` |
| 文本节点 | 多为 `400×400` | 文本节点按 400 方形预留 |
| group | 只 11/81（13.6%）模板使用，共 21 个 | **agent 建不了 group**（`node.type` 白名单不含 `group`）；不要在设计里依赖分组 |

**写坐标的实操（别手拍，用算法）**：跑 `python3 scripts/layout_plan.py plan.json --in-place`，它会：

1. **分层**：`depth = max(父节点 depth) + 1`（最长路径分层，无入边者为 0）；
2. **列坐标**：`x = depth × 520`；
3. **列内排序**：按父节点在本列的**重心 y** 排序（无父节点者排最前），减少连线交叉；
4. **按画幅真实高度落位**：节点高 = 400 × 短边/长边（`3:4→533`、`1:1→400`、`9:16→711`、`16:9→225`），
   `y` 依次累加「上一节点高 + 最小行距」，再整列垂直居中到父节点中心；**不要再用固定 560 行距**（9:16 会压到下一个节点）；
5. **归一化**：整体平移到最小 x/y = 0，无负坐标。

可验证的性质（`tests/test_layout_plan.py` 逐条守护）：确定性、不重叠、边一律左→右、同层同列、列内不重叠、fan-out 同列。
**为什么必须自动化**：`canvas_layout` 只能做 grid/horizontal/vertical 整体重排，**不能把单个节点放到指定坐标**；
坐标写错只能删掉重建——所以坐标要在建图**之前**算好。

```jsonc
// 一列 3 个目标节点（列间距 520；3:4 高 533、1:1 高 400、9:16 高 711）
{ "mode":"absolute", "position": { "x": 1040, "y": 0   } }
{ "mode":"absolute", "position": { "x": 1040, "y": 560 } }
{ "mode":"absolute", "position": { "x": 1040, "y": 1120 } }
{ "mode":"absolute", "position": { "x": 1040, "y": 1960 } }   // 9:16 之后至少 +840
```

> **⚠️ 实测坑（2026-10-20，画布 103577）：按 560 行距排 9:16 会重叠。**
> 9:16 节点尺寸是 `400×711`，y=1120 时底部到 1831，而下一个节点排在 1680 → 压 151 px。
> 本技能已让 `layout_plan.py` 按画幅高度累加；手写坐标时也必须按真实高度留行距，或建完用 `canvas_layout` 重排。
> `auto` 与 `after` **不要混用**（2026-10-16 画布 103432 实测：两者会落在同一坐标）。

---

## 9. 从图 DSL 到工具入参的映射速查

| 图 DSL 概念 | 工具层入口 | 备注 |
|---|---|---|
| 新增节点 | `canvas_node_edit(ops:[{op:"add", node:{type, placement?, changes?}}])` | `type` ∈ text/image/video/audio；一次可多项 |
| 改标题/正文/提示词/标量参数 | `...{op:"edit", nodeId, changes}` | 不清空其他字段 |
| 配模型/音色 | `...{op:"configure", nodeId, configuration}` | 文本节点 → `UNSUPPORTED_NODE`；TTS 用 `voiceId/seniorParams` |
| 删节点 | `...{op:"remove", nodeId}` | 同时移除关联边 |
| 加边 | `canvas_edges(ops:[{op:"add", connection:{...}}])` | 端口规则见 `connection-rules.md` |
| 改接 | `...{op:"edit", edgeId, connection}` | 保留原边 ID |
| 删边 | `...{op:"remove", edgeId}` | — |
| 输入排序 | `...{op:"reorder", targetNodeId, edgeIds}` | **必须包含目标全部入边** |
| 素材导入 | `canvas_asset_import(source:{type,...})` | 文本/图片/视频/音频，见 `media-intake.md` |
| 整体排版 | `canvas_layout(nodeIds, mode)` | grid/horizontal/vertical，可能联动同组 |
| 专用处理 | `canvas_process(kind, sourceNodeId, ...)` | 高清/分层/抠图，先查 `canvas_capabilities` |
| 批量生成 | `canvas_run(nodeIds[])` | 依赖就绪、≤20/批、并发 8 |
| 读回核对 | `canvas_get(view:"nodes"\|"graph")` | 写前取 `confirmed` 版本 |

`canvas_get(view:"nodes")` 返回的节点详情字段是 `id/type/title/contentType/text/prompt/params/paramHints/status/inputs/outputs/generation/truncatedFields` + 可选 `position/size/parentId` + **`seniorParams/seniorParamHints`**；`graph` 视图返回 `id/type/title/position/size/parentId/ports/allowedInputTypes/canConfigureGeneration`。
两张表**都没有** `measured`、`extent`、`style`、`data.type`——这些只存在于原生模板 JSON 与前端状态里 `[源码]`。要判角色用 `graph` 的边集合算入度。

---

## 10. 模式门（alpha.31 前端原生校验）

`[原生]`（`workflowTabOwnership-BescLYeW.js`）的模式推断与门禁文案：

| 节点 | 推断规则 | 门禁文案 |
|---|---|---|
| image | 有图入边 → `reference_image_to_image`；0 图 → `text_to_image` | `text_to_image` 收到图片 → 「仅支持文本输入」；`reference_image_to_image` 0 图 → 「需要连入图像」 |
| video | 0 图 → `text_to_video`；1 图 → `image_to_video`；2 图 → `first_last_frame_to_video`；多图/有视频/有音频 → `reference_image_to_video` | 同上，另有「仅支持连入1/2张图像」 |
| audio | 有文本 → `tts`；`music_cover` 需要且仅支持 1 个音频 | 音乐/翻唱不在公开运行范围 |

**落点**：连线本身可能保存成功，但回执 `warnings` 会带门禁文案 `[实测]`。正确顺序是
**先 `configure` 把模式设成实际需要的值，再加对应素材边**；反过来出现 warning 时，补 configure 即可，不必删边重建。

---

## 11. 上传节点 vs 生成节点（别把素材当生成目标）

| 判据 | 上传/导入节点 | 生成节点 |
|---|---|---|
| `contentType` | `"upload"` | `null` |
| `generation` | `null` | `{images,videos,audios}` |
| `params.model` | 原生默认占位（如 gpt-image-2.5-sunburst） | 真实配置 |
| 可 configure | ❌ | ✅（image/video/TTS audio） |
| 可 `canvas_run` | ❌ `UNSUPPORTED_NODE` | ✅ |

视频/音频导入节点同理：导入的音频是素材，不是 TTS 生成节点。
