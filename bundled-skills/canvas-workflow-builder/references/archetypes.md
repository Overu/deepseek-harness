# 结构原型决策表（A1–A11 + A8+）

**解决什么问题**：把用户一句需求，翻译成"搭哪种拓扑、几个节点、怎么连、参数填什么"。
**什么时候读**：写 `plan.json` **之前**必读；写完 plan 再用本表反向自查"我选的原型有没有真实模板撑腰"。
**不写什么**：工具调用细节看 `graph-dsl.md` / `tool-contract.md`；端口合法性与成环禁忌看 `connection-rules.md`；模型枚举与计费看 `model-matrix.md` / `models-and-params.md`；提示词写法和 T1/T2 双模式看 `prompt-craft.md` / `text-node-prompting.md`。

**数据口径**：11 种原型由 `recon/archetype_catalog.md` 对 **81 条可解析官方模板**按拓扑自动归纳（判定顺序：multiViewTool → 含视频输入 → 含视频生成 → 纯 LLM → 图生成链路），每条模板只归一个原型，合计 81/81。下文所有节点数、边数、参数取值都是脚本对 `tpl_*.json` 的实际解析结果，不是估算。

> **语料说明**：本文引用的 `recon/archetype_catalog.md`、`recon/tpl_*.json` 是构建期语料，**本机技能目录未附带**；结论可用，但不要指望能打开这些文件复核。
>
> **运行前提**：本文所有"执行 / run / runs[]"都以**用户明确确认运行**为前提（见 `SKILL.md` 运行闸门与 `qa-checklist.md` A0）。搭完就交付待运行清单，不要顺手跑。

---

## 0. 选型前必须知道的 4 条全局常量

| 常量 | 事实（实测） | 对选型的影响 |
|---|---|---|
| `gen_count` | 官方模板库 **133 个图生成节点 + 47 个视频生成节点，`gen_count` 恒为 1** | 要 N 张就建 **N 个生成节点**（fan-out）。模型目录里 `gen_count` 可以是 1/2/4，那是可选放大手段，不是模板库的做法，**不要用它替代多节点** |
| `modelType` | 图片：133 个图生成节点里只有 **22 个显式写**，且全部是 `reference_image_to_image`，其余 111 个留空由原生按入边素材判定（**有 image 入边 → 图生图；无 image 入边 → 文生图**）。视频：**47/47 全部显式写** | 图节点默认**省略** `modelType`，用连线表达语义；只有入边语义与默认推断不一致时才显式写。视频节点**显式写**，按入边选值（见 §A5/§A10/§A11） |

> `modelType` 推断规则的权威出处（不要在别处找）：`canvas-app/dist/assets/workflowTabOwnership-BescLYeW.js`——
> `vl(imageCount) = imageCount>0 ? "reference_image_to_image" : "text_to_image"`；
> `yl(imageCount, hasVideoOrAudio) = hasVideoOrAudio ? "reference_image_to_video" : imageCount==0 ? "text_to_video" : imageCount==1 ? "image_to_video" : imageCount==2 ? "first_last_frame_to_video" : "reference_image_to_video"`。
> 同文件还有各模式的入边约束文案（`text_to_video`=仅支持文本输入、`image_to_video`=仅支持连入 1 张图像、
> `first_last_frame_to_video`=仅支持连入 2 张图像、`reference_image_to_video`=需要连入图像、`reference_image_to_image`=需要连入图像），
> 可用来预判"这么连会不会被原生拒绝"。音频：有文本 → `tts`；`music_cover` 需要且仅支持 1 个音频（不在公开运行范围）。
> **注意**：推断只是默认值，单图入边合法地既可用 `image_to_video`（首帧驱动）
> 也可用 `reference_image_to_video`（参考一致性）——按语义选，别死套入边数量。
| 图模型三档 | `gemini-3-pro-image-preview` 66（`3:4`×53、`2K`×36）｜`gpt-image-2` 42（**模板库三个图模型里唯一带 `quality`**：high 25 / medium 17；目录里 `gpt-image-2.5-flare` / `gpt-image-2.5-sunburst` 也支持 `quality`，但模板库无样本）｜`gemini-3.1-flash-image-preview` 25（`16:9`×9、`2K`×17） | 要**场景/质感** → `gemini-3-pro-image-preview`；要**画面里有字**（海报/头图/价格）→ `gpt-image-2` + `quality`；要**横版/更快更省** → `gemini-3.1-flash-image-preview` |
| 视频模型四档 | `seedance-2.5-vip-r2v` 38（`reference_image_to_video` + `9:16`×35 + `480p`×35，15s 出现 16 次）｜`seedance-2.0` 6｜`wan3.0-r2v` 2（唯一用 `1080P`）｜`MiniMax-Hailuo-02` 1 | 默认档：`seedance-2.5-vip-r2v / reference_image_to_video / 9:16 / 480p / 10–20s`。只有明确要高清才上 `wan3.0-r2v` |

另有两条直接决定"能不能落地"的边界，选型时必须先扣掉：

1. **四类素材都可导入**：文本/图片/视频/音频都能通过 `canvas_asset_import`（`attachment` / `conversation_asset` / `canvas_node` / `workspace_file`）落成节点 → 以参考视频/音频为输入的原型（A10）不再天然含人工步骤；只有来源缺失（用户没给文件、也不在工作区/画布）时才要用户补。
2. **文本节点是 LLM 节点，agent 不能配模型、不能 `canvas_run`** → 拓扑里只要出现 LLM 节点就必须标 `manualStep`；或用 **T2 代笔模式**（agent 自己把那段文字写完，直接写进下游生成节点的 prompt）把它消掉。两种模式见 `text-node-prompting.md`。
3. **音频 TTS 可配置、可运行**（alpha.30 起）：`configure` 支持 `modelType:"tts"`、`model`、`voiceId`、`seniorParams`；`canvas_run` 支持 TTS audio 节点。音乐/翻唱、音色克隆仍不在公开能力内。

---

## 1. 决策表

### 1.1 三步选型

1. **定产物族**：要图 → A1–A4 / A9；要视频 → A5 / A6 / A10 / A11；只要文字 → A7；要人声 → A8。
2. **定输入层**：有产品图/模特图 → A1–A5；有参考视频 → A10；只有一句 brief → A2（让用户补文案）或 A3 + A1 组合（先把画面写出来）。
3. **定"画面要不要先推理"**：
   - 一张图 → N 张**内容不同**（场景/卖点/分镜）→ 需要推理 → **A3**；
   - 一张图 → N 张**内容相同、画幅/版式不同** → 不需要推理 → **A1**；
   - 先要一张底图/结构图 → 再基于它延展 → **A4**；
   - 文案必须进画面 → **A2**。

### 1.2 需求特征 → 原型（主表）

| 用户需求特征（怎么识别） | 原型 | 产物 | 关键参数默认值 |
|---|---|---|---|
| 已有产品图，要 N 张统一风格套图 / 多版式 / 换色 / 试衣替换；画面内容不需要推理 | **A1** | 图 ×N | `gpt-image-2`(要字) 或 `gemini-3-pro-image-preview`(要质感)，`3:4`/`9:16`，`2K` |
| 促销海报 / 头图 / 卖点海报：**图 + 文案一起进画面**（含价格、机制、活动时间） | **A2** | 图 ×2–5 | `gpt-image-2` + `3:4`(主) / `1:1`(头图) + `1K` + `quality:high` |
| 一张产品图要裂变出 N 个**不同场景/卖点**画面；或要先出 N 条画面描述 | **A3** | 图 ×2–4 | `gemini-3-pro-image-preview` + `3:4` + `2K`；LLM 节点标 `manualStep` 或改 T2 |
| 先出一张底图 → 再延展成套图 / 精修后再升级 / 平铺转 3D / 2D 转 3D | **A4** | 图 ×4–7 | 一批 `gpt-image-2` 打底（`1K`）+ 二批 `gemini-3-pro-image-preview`（`2K`） |
| 一图一视频：产品图/模特图 → 一条竖屏带货短视频 | **A5** | 视频 ×1 | `seedance-2.5-vip-r2v` + `reference_image_to_video` + `9:16` + `480p` + `10–20s` |
| 先写脚本/口播稿，再生成视频（台词进片子） | **A6** | 视频 ×1 | 视频同上；脚本侧 T2 直接写进视频 prompt（tpl_100 的做法） |
| 纯文案：多平台多风格标题/卖点/引流文案 | **A7** | 文本 ×N | LLM 节点；建不建画布由 `requirement-intake.md` 判，建则标 `manualStep`（见 §A7） |
| 文案 → 配音（TTS 人声） | **A8** | 音频 ×1 | `speech-2.8-turbo` + `tts`；音色用 `voiceId`、高级参数用 `seniorParams`（以 `seniorParamHints` 为准），可全自动 |
| 同一产品要多角度 / 六视图 | **A9 不可建** → 用 A1 + 机位提示词替代 | 图 ×3–5 | `gemini-3-pro-image-preview` + `3:2` + `2K`（tpl_65 路线） |
| 以**参考视频**做换装 / 动作模仿 / 爆款复刻 | **A10** | 视频 ×1–2 | `wan3.0-r2v`(`1080P`) 或 `seedance-2.5-vip-r2v`(`480p`)，`9:16`，`15s`；参考视频走 `canvas_asset_import` 导入 |
| 先出图，再让这张图动起来（产品解构/试色/开箱） | **A11** | 图 + 视频 | 图 `2K`(`9:16`) → 视频 `480p`/`720p`；两段串行，必须等产物 |

**兜底规则**：拿不准就选 **A1 + T2 代笔**（自己把每个节点的 prompt 写全）——**在素材是图片的前提下**，它是唯一能 100% 自动跑完的通用形态；只有当"画面内容确实需要先推理一版"时才升级到 A3。

---

## 2. 各原型详解

统一读法：**适用场景 / 节点骨架 / 边构成 / 真实模板证据 / 参数配置要点 / 最小可用节点清单 / 落地注意**。
骨架里的 `图`=image 节点、`文`=text 节点、`视`=video 节点、`音`=audio 节点；`▶`=一条边。完整成员清单见 `recon/archetype_catalog.md` B 节，此处只列代表模板与已核验节点。

**参数写法约定**（下文简称 `model+params{}`）：`modelType` 与 `model` 是 `configure` 的**顶层字段**，技术参数放 `params` 里，例如
`configure` → `model:"gpt-image-2"`, `modelType:"reference_image_to_image"`, `params:{aspect_ratio:"3:4", resolution:"2K", quality:"medium"}`。
下文为了紧凑写成 `gpt-image-2 / reference_image_to_image / 3:4 / 2K / medium`，落到工具调用时按上面的层级展开。

### A1 单层图生图直出（图输入 → 图生成 fan-out）｜9 条模板

- **适用场景**：产品/模特图已就位，只需**按固定画幅批量出图**：电商主图、外观展示、换色、试衣/替换、多件穿搭。不需要"先想一遍画面"。
- **节点骨架**：
  ```
  图(上传)×1–5 ──image_source→image_target──▶ 图生成×1–4
  ```
  一个生成节点可以同时吃多张参考图（分工靠 prompt 里写死的「图1=模特、图2=服装」）。
- **边构成**：`image_source→image_target` 51 条，**无文本边、无链式边**。
- **真实模板证据**：tpl_29 外观设计图（2 图 → 4 张 `gpt-image-2/3:4/1K/high`）｜tpl_31 珠宝精修（4 图 → 4 张 `1:1/1K/medium`，最简结构）｜tpl_43 服装取款（1 图 → 2 张）｜tpl_45 服装换色（5 图 → 2 张）｜tpl_65 外观展示图（多角度）（4 图 → 5 张 `gemini-3-pro-image-preview/3:2/2K`，20 条边，全库 fan-out 最整齐）｜同结构另有 tpl_116 模特试衣、tpl_117 模特替换、tpl_119 多件穿搭（`gpt-image-2/reference_image_to_image/9:16/2K/medium`）。
- **参数配置要点**：模型分布 `gpt-image-2` 12 / `gemini-3-pro-image-preview` 9 / `gemini-3.1-flash-image-preview` 5；画幅以 `3:4`、`9:16` 为主；分辨率 `2K` 占 18/26；**这一族里只有 `gpt-image-2` 带 `quality`**（medium 偏多，gemini 两个模型不要给 `quality`）；`gen_count` 全为 1。
- **最小可用节点清单**（1 张产品图 → 3 张主图）：
  1. `canvas_asset_import`（用户图用 `attachment`+`attachmentId`；本会话 AI 图用 `conversation_asset`+`assetRef`）→ 得到 image/upload 节点「产品图」。
  2. `canvas_node_edit(ops:[{op:"add", node:{type:"image", changes:{title:"主图1"}}}, …×3])`，三条一次提交。
  3. `canvas_node_edit(ops:[{op:"configure"}×3])`：`model:"gpt-image-2"`、`params:{aspect_ratio:"3:4", resolution:"2K", quality:"medium"}`（要质感就换 `gemini-3-pro-image-preview` 且**不要**给 `quality`）。
  4. `canvas_edges(ops:[{op:"add", connection:{sourceNodeId, targetNodeId}} ×3])`：「产品图」→ 每个主图节点（端口自动解析为 `image_source→image_target`）。
  5. 每个生成节点写自包含 prompt（含"保持图1产品外观、logo、文字细节一致"）；`canvas_run` 一次一个节点。
- **落地注意**：agent 可全程自动（前提素材是图片）。不要为了"3 张"去设 `gen_count:4`。多角度需求走 §A9 的替代方案，而不是自己造工具节点。

### A2 图 + 文混合输入 → 图生成（带字海报）｜3 条模板

- **适用场景**：**促销/头图/卖点海报**——产品和文案都必须落在画面里。
- **节点骨架**：
  ```
  图(上传)×3–6 ──┐
                  ├─▶ 图生成×2–5
  文(输入)×2–3 ──┘   （图生成节点同时有 image_target 与 text_target 两个入口）
  ```
- **边构成**：`image_source→image_target` 12 条 + `text_source→text_target` 9 条。
- **真实模板证据**：tpl_12 促销氛围（5 图 + 2 文 → 2 张 `gpt-image-2/3:4/1K/high`，实测是「产品图 + 促销文案 + 视觉参考」各一套喂一张海报）｜tpl_14 化妆品头图（6 图 + 3 文 → 3 张 `1:1/1K/medium`，文案字段级拆分：logo/标题/副标题/卖点/价格）｜tpl_19 化妆品卖点功能演示（4 图 + 3 文 → 5 张 `3:4`，含 1 张 `2K/high`）。
- **参数配置要点**：**10/10 生成节点全部 `gpt-image-2`**；画幅 `3:4` 为主、`1:1` 次之；分辨率偏 `1K`；`quality:high` 占 7/10 —— 要出带文字的图，**宁可降分辨率也要拉高 quality**。
- **最小可用节点清单**（1 张产品图 + 促销机制 → 1 张促销海报）：
  1. `canvas_asset_import` → image/upload「产品图」。
  2. `canvas_node_edit`(`add`,`type:"text"`)，标题「促销文案」，`changes.text` 写成结构化字段（照 tpl_12 的 `【字段】` 式）：`【主题】…【促销机制】…【活动时间】…`；**字段值必须由用户提供，缺就留空，不得编造数字**。
  3. `canvas_node_edit`(`add`,`type:"image"`)，标题「促销海报」；`configure` → `model:"gpt-image-2"`、`params:{aspect_ratio:"3:4", resolution:"1K", quality:"high"}`。
  4. `canvas_edges`(`add`)：「产品图」→「促销海报」（`image_target`）；「促销文案」→「促销海报」（`text_target`）。
  5. 海报节点 prompt 写全（含画幅要求、留白区、文字内容排布），不能只写"参考文案"；再 `canvas_run`。
- **落地注意**：文字进画面的唯一通路是上面这条 text 边——文案节点不连边、或生成节点 prompt 里没有文字排布要求，产出的图就不会带字。文案合规红线见 `ecommerce-patterns.md` §3。

### A3 LLM 提示词编排 → 图 fan-out｜8 条模板

- **适用场景**：需求里**"画什么"本身需要先想一遍**：裂变套图、卖点拆解、9 宫格分镜、爆款复刻。
- **节点骨架**：
  ```
  图(上传)×1–3 + 文(输入)×1–2 ─▶ 文(LLM)×1–2 ─▶ 图生成×2–4
                                                （LLM 输出被多个生成节点共享：一次推理、多次出图）
  ```
- **边构成**：`image_source→image_target` 56 条 + `text_source→text_target` 31 条（含 `图→文` 26 条，即 LLM 也吃参考图）。
- **真实模板证据**：tpl_10 裂变套图生成（1 图 → 灵感生成 → 4 张 `gemini-3-pro-image-preview/3:4/1K`；已核验：LLM 输出 4 段，每条 text 边各喂一个生成节点）｜tpl_20 化妆品模特手持展示（模特图+产品图+LLM → 4 张 `3:4`）｜tpl_23 化妆品包装组合展示（20 条边）｜tpl_33 珠宝设计概念图（图+文 → LLM → 3 张 `3:4/2K`）｜tpl_60 测试模板勿用（与 tpl_10 同构）。
- **参数配置要点**：图生成模型以 `gemini-3-pro-image-preview` 为主（19/24）；画幅 `3:4` 占 23/24（这一族最统一）；LLM 侧模板用的是 `gemini-3-pro-preview`，**注意当前模型目录的文本模型里已没有这个值**（现为 `gemini-3.1-pro-preview` 等 9 个），且 agent 本来就不能给文本节点配模型。
- **N 路切片靠"文本锚点"**：LLM 指令里强制分段输出 `【套图1描述】…【套图4描述】`，下游每个生成节点 prompt 写「结合【套图1描述】生成…」——上下游靠**同名方括号标记**传值（tpl_10 / tpl_15 / tpl_60 / tpl_68；tpl_127 用「模特N」）。
- **最小可用节点清单（T2 代笔版，1 图 → 4 张场景套图，全自动）**：
  1. `canvas_asset_import` → image/upload「产品图」。
  2. （可选）`canvas_node_edit`(`add`,`type:"text"`)「套图灵感」写用户的产品/风格信息，供人查看。
  3. `canvas_node_edit`(`add`,`type:"image"`) ×4：「套图1…套图4」；`configure` → `model:"gemini-3-pro-image-preview"`、`params:{aspect_ratio:"3:4", resolution:"2K"}`。
  4. 每个节点 prompt **由 agent 自己写完整场景描述**（T2 模式），并统一带"保持图1产品外观/文字细节/比例不变"。
  5. `canvas_edges`(`add`)：「产品图」→ 4 个生成节点（4 条）。
  6. `canvas_run` 逐个提交。
- **T1 版（保留 LLM 节点）**：把第 3 步的场景描述换成「结合【套图N描述】…」，另建 1 个 `text` 节点承载 LLM 指令（含输出格式契约）并连到 4 个生成节点；**必须标 `manualStep`：用户在画布 UI 里运行该文本节点**，agent 不能运行文本节点，也不能替它选模型。
- **落地注意**：不要在同一张图里既留 LLM 节点又指望自动跑完。T1 的价值是"用户以后能自己改灵感"，不是省事。
- **下游文本节点必须运行**：LLM 节点有上游入边时不会自己产出正文；**不运行就等于给下游喂一段空文本**（图和视频会跑偏且难排查）。计划里登记 `manualSteps`（R24 会拦漏登），跑下游前用 `check_complete` K10 确认正文非空，为空就停下请用户点运行。

### A4 链式二次编辑 / 套图延展（图生成 → 图生成）｜12 条模板

- **适用场景**：需要**两代画面**：先出底图/结构图，再基于底图延展成套图（套图延展、平铺转 3D、2D 转 3D、单品拆解、试衣多套输出）。
- **节点骨架**：
  ```
  图(上传)×1–8 ─▶ 图生成(第一批)×1–4 ─▶ 图生成(第二批)×1–7
                                        （第二批入边同时含"上传图"保产品一致 + "第一批产物"保风格/结构一致）
  ```
- **边构成**：`image_source→image_target` 82 条 + `text_source→text_target` 17 条。
- **真实模板证据**：tpl_118 套图延展（已核验：上传产品图 →「生成｜套图四宫格」→ 4 个「最终输出｜套图1–4」，5 条边，全部 `gpt-image-2/reference_image_to_image/9:16/2K/medium`）｜tpl_90 平铺转3D效果（3 图 → `gpt-image-2/3:4/1K/high` 精修 ×3 → `gemini-3-pro-image-preview/3:4/2K` 3D ×3）｜tpl_89 单品拆解海报（已核验：`图片5→图片6`、`图片11+图片14→图片9(9:16)→图片6`）｜tpl_15 化妆品场景套图、tpl_17 妆容对比、tpl_25 3C场景套图、tpl_32 场景搭配、tpl_35 人物生活场景。
- **参数配置要点**：分辨率 `2K` 占 37/54，是全部原型里最高的；模型 `gemini-3-pro-image-preview` 31 > `gpt-image-2` 17 > `gemini-3.1-flash-image-preview` 14；画幅 `3:4` 为主，`9:16`/`16:9` 视套图用途而定。
- **最小可用节点清单**（1 图 → 底图 → 4 张延展）：
  1. `canvas_asset_import` → image/upload「产品图」。
  2. `canvas_node_edit`(`add`,`type:"image"`)「底图｜四宫格」；`configure` `gpt-image-2` / `3:4` / `1K` / `quality:"high"`。
  3. `canvas_edges`(`add`)：「产品图」→「底图｜四宫格」。
  4. `canvas_run`「底图｜四宫格」，用 `job_output` 收到终态与产物。
  5. `canvas_node_edit`(`add`,`type:"image"`) ×4「延展1…延展4」；`configure` `gemini-3-pro-image-preview` / `9:16`(或与底图同幅) / `2K`。
  6. `canvas_edges`(`add`)：「底图｜四宫格」→ 4 个延展节点。
  7. 逐个 `canvas_run`。
- **落地注意**：**必须串行**——`canvas_run` 要求上游已有产物，第二批在第一批发回结果前不能提交；写 plan 时把"第二批"排在"第一批 job 终态之后"。属于最慢最贵的一族，先 `1K` 低量试跑。

### A5 图输入 → 视频直出（`reference_image_to_video` 单跳）｜35 条模板（最大族，43.2%）

- **适用场景**：**图生视频**的绝大多数带货/广告模板：产品图 + 模特图 → 一条竖屏短视频，镜头、台词、节奏写在 prompt 里。
- **节点骨架**：
  ```
  图(上传)×1–7 ──image_source→image_target──▶ 视生成×1        （无中间节点）
  ```
- **边构成**：`image_source → image_target`（落在 video 节点上）84 条 + `text_source→text_target` 3 条。
- **真实模板证据**：tpl_91 夸张动作定格（2 图 → 12s）｜tpl_93 创意互动装置体验（1 图）｜tpl_95 街头采访带货（3 图 → 15s）｜tpl_96 鱼眼镜头时尚换装（5 图）｜tpl_100 雨伞种草带货（人物图+产品图，数字人台词直接写在视频 prompt 里）｜tpl_109 奢华钻戒展示（1 图 → 15s）｜tpl_113 手机壳新品发布会风格（1 图 → `16:9/720p/10s`）。
- **参数配置要点**：`seedance-2.5-vip-r2v` 32/35；**`modelType` 100% 写 `reference_image_to_video`**；`9:16` 31/35；`480p` 29/35；时长 15s 最常见（12 次），10s/20s 次之。视频 prompt 中位 **482 字**（是整篇分镜，不是一句话）；引用素材用 `{{@图片N}}` 语法（只在视频侧出现，11 个模板 32 次，如 tpl_123/130/133）或旧式「参考图N/图N」。
- **最小可用节点清单**（产品图 + 模特图 → 1 条 15s 竖屏）：
  1. `canvas_asset_import` ×2 → image/upload「产品图」「模特图」。
  2. `canvas_node_edit`(`add`,`type:"video"`)「输出视频」；`configure` → `model:"seedance-2.5-vip-r2v"`、`modelType:"reference_image_to_video"`、`params:{aspect_ratio:"9:16", resolution:"480p", duration:15}`。
  3. `canvas_edges`(`add`)：两张输入图 →「输出视频」（2 条 `image_source→image_target`）。
  4. 视频 prompt 写完整分镜：`【产品】: 参考图2，保持产品外观一致` + `【人物】: 参考图1` + 台词 + `全程画面不出现字幕` + 时长节奏（照 tpl_100 的写法）。
  5. `canvas_run` 提交，`job_output` 收终态。
- **落地注意**：agent 可全程自动（素材是图片即可）。视频节点可批量提交（≤20/批、并发 8）；同一需求累计 >6 条视频必须先走官方确认。`enableAudio` 这类参数只在少数模板出现（tpl_110/113），不要默认加。

### A6 文案/脚本 → 视频（LLM 驱动视频）｜2 条模板

- **适用场景**：**先写脚本/口播稿再出片**：口播、图生视频解说。
- **节点骨架**：
  ```
  图(上传)×多 + 文(输入)×多 ─▶ 文(LLM) ─▶ 视生成×1–2
  图(上传)×多 ──────────────┘   （视频节点同时吃 text 与 image 入边；tpl_129 是两个视频节点串联）
  ```
- **边构成**：`image_source→image_target` 9 条 + `text_source→text_target` 6 条。
- **真实模板证据**：tpl_62 图生视频（1 图 → `gemini-3.1-pro-preview` → `seedance-2.0/image_to_video/3:4/720p/10s`）｜tpl_129 口播介绍（6 图 + 4 文 → LLM + 2 个 `seedance-2.5-vip-r2v/9:16/480p/20s`，文本输入用 `**品牌：**` 键值式）。
- **参数配置要点**：样本仅 2+1 条，LLM 用 `gemini-3.1-pro-preview`；视频侧 `seedance-2.5-vip-r2v`（9:16/480p/20s）与 `seedance-2.0`（3:4/720p/10s）各一。
- **最小可用节点清单（T2 版，推荐）**：等同 A5 的最小清单，只是第 4 步的 prompt 由 agent 直接写成"脚本 + 台词 + 分镜"，**不建 LLM 节点**。
- **落地注意**：模板把台词直接写进视频 prompt 的写法（tpl_100）比接一个 LLM 节点更可控，且能自动跑完；T1（保留 LLM 节点）必须标 `manualStep`。

### A7 纯文案生成（文本/图 → 文本 fan-out）｜2 条模板

- **适用场景**：只出文不出图：引流文案、卖点介绍、平台文案、多风格标题。
- **节点骨架**：
  ```
  文(输入)×1 或 图(上传)×1 ─▶ 文(LLM)×1–5（并行）
  ```
- **边构成**：`text_source→text_target` 5 条、`image_source→image_target` 1 条（tpl_46 是"1 张产品图 → 1 个 LLM"）。
- **真实模板证据**：tpl_11 引流文案（1 个结构化文本输入 → **5 个 LLM 节点并行**，5 段式完整表单）｜tpl_46 服装卖点介绍（2 节点、1 条边，全库最简）。
- **参数配置要点**：LLM 模板值全是 `gemini-3-pro-preview`（当前目录已无此值）；`gen_count` 恒 1，多路靠"一个输入连 N 个 LLM 节点"；prompt 自带字数上限（如"字数不超过 300 字"）。
- **最小可用节点清单**：是否建画布由 `requirement-intake.md` 的结论定；**若确要建**：`add` 1 个 `text` 输入节点（写产品/风格信息）+ N 个 `text` 节点（指令）+ `text_source→text_target` 边，并在 plan 里标 `manualStep`（LLM 节点需用户在画布 UI 运行）。
- **落地注意**：A7 的产物是"文本落进节点"，而 agent 跑不了 LLM 节点 → 纯文案需求若不必做成可编辑画布，直接按正文交付更省一步人工。**只要建了 LLM 文本节点就必须跑到**：有入边的 text 节点不运行就没有正文，下游只能拿到空输入；登记 `manualSteps`，交付时明确写"需用户运行这几个文本节点"。

### A8 文案 → 配音（TTS）｜官方模板 1 条 + alpha.31 全链路可执行

- **适用场景**：**口播配音**——文案/台词 → TTS 人声；也可作为视频配音的独立产物。
- **节点骨架（两种，按需选）**：
  ```
  A. 台词直写（推荐，最省）：音(audio, TTS)×1        ← 台词写在该节点 prompt 里，无入边
  B. 文案节点驱动：文(输入)×1 ──text_source→text_target──▶ 音(audio, TTS)×1
  ```
  如需多语言/多情绪版本：同一段文案 → N 个 audio 节点（各自不同 `voiceId`/`seniorParams`），批量 run。
- **台词写在哪儿（2026-10-21 实测，画布 103582）**：**audio 节点的 `prompt` 就是待朗读文本**。建一个只有 prompt、零入边的 audio 节点，`configure` 后 `canvas_run` → `completed`，产出 6.3s 真实音频（`volumedetect` 均值 −25.3 dB，非静音）；回读该节点，`prompt` 与 `params.prompt` 都是那段台词，`inputs:[]`。**所以不需要为了放台词专门建一个 text 节点**。
  - 选 A（prompt 直写）：少一个节点、少一条边，也不会踩"文本节点没运行导致下游拿到空文本"的坑；单句/单条配音、按句拆的漫剧旁白都用这个。
  - 选 B（text 节点驱动）：同一段文案要喂多个音色/多语言版本、需要人反复改稿、或这段文字本身要作为交付物时。
  - **不要两边都写**：前端计费字符是「文本入边字符 + prompt 字符」合计（`[原生]` `costPoint` 逻辑），重复写等于读两遍、算两遍钱。
- **边构成**：A 式无入边；B 式 `text_source→text_target`（目标节点是 audio）；audio 也可作为 video 的音频输入（`audio_source→audio_target`，用于带音频的视频模型）。
- **参数配置**（alpha.30 起开放）：`canvas_models(canvasId, nodeType:"audio")` 读当前 TTS 模式/模型；
  `configure` 用 `modelType:"tts"` + `model`（当前目录常见 `speech-2.8-turbo` / `speech-2.8-hd` / `insight/indexTTS-2`）+
  `voiceId` + `seniorParams`（`language_boost`/`emotion`/`speed`/`vol`/`pitch`，字段与范围以 `seniorParamHints` 为准）。
  `voiceSelection:{required:true}` 表示**必须选音色**；用 `canvas_models(view:"voices")` 查公共/我的音色，未指定时优先 `model_declared` 的中文自然音色。
- **最小可用节点清单**（A 式：prompt 直写台词，最简）：
  1. `canvas_models(nodeType:"audio")` → 选 `speech-2.8-turbo`；`view:"voices"` 选一个中文音色。
  2. `add` 1 个 `audio` 节点「口播配音」，**`changes.prompt` 直接写要念的台词**（不需要建 text 节点、不建边）。
  3. `configure`：`modelType:"tts"`、`model:"speech-2.8-turbo"`、`voiceId`、`seniorParams:{speed:1.0, emotion:"calm"}`。
  4. `canvas_run(nodeIds:[audioId])` → `job_output` 收音频 `outputs`。
  5. （B 式）若已有文案节点，再补一条 `文案 → audio` 的 `text_target` 边，并**清空 audio 的 prompt**，避免读两遍。
- **落地注意**：`audio` 节点只有在配置了 TTS 模式后才是生成节点；**导入的音频是素材节点**，不能当 TTS 运行。
  音乐/翻唱（`music_cover`）与音色克隆不在公开运行范围，不要建；音频数量 `audios` 单独计数，不占图/视频阈值。
- **实测坑（2026-10-20/21，画布 103582）**：
  - `seniorParams.speed` 的 `step` 是 **0.1**：`0.95` 被 `INVALID_ARGUMENT`「TTS高级参数 speed 不符合选项、范围或步长」拒绝，`0.9` 通过。写之前按 `seniorParamHints` 的 min/max/step 取整。
  - `canvas_models(view:"voices", language:"Chinese")` 返回 **0 条**（音色返回的 `language` 值是 `"中文"`）；**不要带 language 过滤**，直接分页取再按返回字段筛。
  - 中文一句旁白实测 **4.2–5.3s**（`speech-2.8-turbo`、speed 0.9），据此定拆句粒度与视频时长。
  - 已有文案节点时，直接把该节点 `text_source→text_target` 接到 audio；**不要把待朗读正文再写进 prompt**，会读两遍。

### A8+ 逐镜旁白入片（漫剧/漫画视频）｜custom，2026-10-21 建图/连线已验证

- **适用场景**：漫画/漫剧/分镜式短视频——**旁白必须跟画面同镜**，而不是一条整轨最后在画布外混音。
- **为什么不能"一条整轨"**：画布没有拼接/混音节点，音频只能挂到视频节点的 `audio_target`；一条 18.4s 整轨配 5s 镜头，语义上就是错的，画布里的 TTS 会变成没有下游的死节点（2026-10-20 交付时真实踩过）。
- **节点骨架**（N=4 时 **14 节点**：2 总纲文本 + 4 图 + 4 视频 + 4 配音；配音台词直写 prompt，不建旁白文本节点）：
  ```
  剧本(T) ──┬─▶ 分镜1..4(图) ──image_source→image_target──▶ 镜头1..4(视频)
  分镜脚本(T)┘                                              ▲
  配音1..N(TTS，prompt=当句台词) ──audio_source→audio_target──┘
  ```
  如果同一句台词还要复用到别处（多音色/多语言/要出文字稿），才把台词拆成 text 节点再连 `text_target`（此时 N=4 共 18 节点，多 4 个文本节点与 4 条文本边）。
- **关键配置**：接音频后视频**不能**留 `image_to_video`（该模式"仅支持连入 1 张图像"）；改 `modelType:"reference_image_to_video"` + `model:"seedance-2.5-vip-r2v"`（r2v 模式下才有 `*-r2v` 模型）。`duration` ≥ 该句 TTS 时长（6s 起）。
- **prompt 必须声明用音频（2026-10-22 用户实测指出）**：`audio_source→audio_target` 只说明边合法，模型用不用由 prompt 决定。视频 prompt 第一段写死：
  ```
  使用连入的图片1和音频1生成这条视频：图片1是画面底本（人物/服装/场景/画风按图1），
  音频1是这条视频的音轨（旁白原样使用、逐字对齐）。
  不要重新配音、不要改写或省略台词、不要用环境声或背景音乐盖过人声、不要另生成旁白。
  ```
  再写 `[0-2s]/[2-4s]/[4-6s]` 时间轴。**反面写法**：只写「音频轨道使用连入的旁白音频」再加「环境声垫底」「不添加音效」——模型会自行生成音轨，输出静音视频、配音节点空转。
- **执行顺序（上游没产物不跑下游）**：`canvas_run(全部分镜图)` 与 `canvas_run(全部 TTS)` 可同批（互不依赖）并各自收终态 → `refresh:true` 拿 confirmed → 逐条确认图有 `outputs`、配音有产物 → 才 `canvas_run(全部视频)`。**TTS/图与视频不能同批**；视频内部可同批，但提交前必须逐条核对它的 image 入边与 audio 入边都已就绪；回执出现「需要连入图像」说明有上游还没产物。**镜头之间并行推进**：镜 1 的图与配音一齐，就立刻提交镜 1 的视频，不必等镜 6 的分镜出完；只有同一镜内部（图/配音 → 视频）严格串行。
- **已验证 / 未验证**：`audio_source→audio_target` 边可保存且回执无「不支持音频」警告（已验证）；音频是否真被烘进输出成片**取决于视频 prompt 是否声明使用它**（见上一条），并且必须用 `ffprobe -show_streams` 抽音轨、必要时 `ffmpeg -af volumedetect` 判非静音来验证——只凭回执不得声称「画布已合成音轨」。
- **交付口径**：N 段镜头按序拼接 = 成片；拼接若在画布外完成，必须写成"画布外最后一步"。

### A9 多视角工具扇出（multiViewTool）｜1 条模板 —— **agent 建不了，必须替代**

- **适用场景**：同一产品要**多个视角 / 六视图**（精确角度控制）。
- **节点骨架（官方模板，agent 建不了）**：
  ```
  图(上传)×1–2 ─▶ multiViewTool×3 ─▶ 图生成×4
  ```
- **边构成**：`image_source→image_target` 8 条 + `text_source→text_target` 1 条（另有 1 条悬空边，源节点已删除，统计时剔除）。
- **模板证据**：tpl_26 多角度产品展示：上传图 ×2 → **3 个 `multiViewTool` 节点**（模型 `qwen-image-edit-2511-multiple-angles`，参数为 `horizontalAngle/verticalAngle/zoom`，三条实例 `(-64,48,5)`、`(-90,0,5)`、`(60,5,2.5)`）→ 4 个图生成节点（`gemini-3-pro-image-preview/9:16/2K` ×3 + `gemini-3.1-flash-image-preview/9:16/2K` ×1）。该模板还残留 1 条**悬空边**（源节点已删除），统计其边数时要剔除。
- **为什么建不了**：agent 只能 `add` `text/image/video/audio` 四种普通节点，`multiViewTool` 属 16 种工具节点之一，**没有任何工具能创建它**；也无法用 `canvas_run` 触发工具节点。
- **替代方案（可执行，按优先级）**：
  1. **A1 + 机位提示词 N 路 fan-out**（首选，就是 tpl_65 的做法）：`gemini-3-pro-image-preview` + `3:2` + `2K`，每个节点 prompt 只写一个机位：
     `俯拍 / 前侧45度 / 后侧45度 / 低机位 / 广角 / 正视图 / 背面 / 侧面 / 顶部 / 平铺俯视 / 特写细节`。
  2. **用户已有多视角实拍图** → 直接当参考图走 A1（tpl_65 的 4 个输入图就是正面/侧面/背面/顶部）。
  3. 与用户明确边界：**"精确角度控制（水平角/垂直角/缩放）只有画布 UI 里手工添加多视角工具才能做到"**，提示词只能近似，不要承诺等价。
- **最小可用节点清单**（1 张产品图 → 4 机位）：`canvas_asset_import` → 1 个 image 输入；`add` 4 个 image 生成节点，configure `gemini-3-pro-image-preview/3:2/2K`；4 条 `image_source→image_target` 边；每个节点 prompt 写死一个机位 + "保持产品外观一致"。

### A10 视频输入驱动（视频换衣 / 动作模仿 / 爆款复刻）｜4 条模板

- **适用场景**：**以视频为参考**的换装/动作模仿/爆款复刻——参考视频提供动作与运镜，参考图提供人与产品。
- **节点骨架**：
  ```
  图(上传)×1–3 ─┐
                ├─▶ 视生成×1–2
  视(上传)×1–2 ─┘   （video_source→video_target；参考视频提供动作与运镜）
  ```
- **边构成**：`image_source→image_target` 7 条、`video_source→video_target` 5 条、`text_source→text_target` 1 条。
- **真实模板证据**：tpl_121 视频换衣/模特（2 图 + 2 视频 → `wan3.0-r2v/9:16/1080P/15s` ×2）｜tpl_127 爆款视频换衣/换模特（3 图 + 1 视频 → LLM → `seedance-2.5-vip-r2v/3:4/480p/15s`）｜tpl_128 动作模仿（1 图 + 1 视频）｜tpl_133 爆款复刻（1 图 + 1 视频 → `seedance-2.5-vip-r2v/9:16/480p/15s`）。
- **参数配置要点**：两条路线并存——`wan3.0-r2v`（`9:16`/`1080P`/`15s`，**全库唯一用 1080P**）与 `seedance-2.5-vip-r2v`（`9:16`/`480p`/`15s`）。
- **最小可用节点清单**（产品图 + 参考视频 → 复刻视频）：
  1. `canvas_asset_import` → image/upload「产品图多视图」。
  2. `canvas_node_edit(ops:[{op:"add", node:{type:"video", changes:{title:"最终输出"}}}])`；`configure` `seedance-2.5-vip-r2v` / `reference_image_to_video` / `9:16` / `480p` / `duration:15`。
  3. `canvas_edges`(`add`)：「产品图多视图」→「最终输出」。
  4. **参考视频导入**：`canvas_assets(mediaType:"video")` → `canvas_asset_import`（`attachment` / `conversation_asset` / `workspace_file` / `canvas_node` 均可）→ 读回真实 `id` 与 `outputs`；没有来源时才请用户补文件。
  5. `canvas_get(view:"graph")` 拿视频节点真实 ID，补 `video_source→video_target` 边；同时把 `modelType` 设为 `reference_image_to_video`。
  6. `canvas_run`「最终输出」。
- **落地注意**：视频导入已打通，**可以全自动**（前提是用户提供了视频或在会话/工作区里有）。参考视频 ≤200 MiB、≤300 秒；导入节点是素材，不能当生成节点运行。

### A11 多阶段串行（图/文 → 图 → 视频）｜4 条模板

- **适用场景**：需要**"先出图、再让图动起来"**的两段式：产品解构图、口红试色、节日礼盒开箱、文字生角色。
- **节点骨架**：
  ```
  图(上传)/文(输入) ─▶ 图生成×1–2 ─▶ 视生成×1        （视频入边来自"生成图"）
  ```
- **边构成**：`image_source→image_target` 15 条 + `text_source→text_target` 6 条。
- **真实模板证据**：tpl_27 产品解构图/视频（1 图 → `gemini-3.1-pro-preview` LLM → 2 张 `gemini-3-pro-image-preview/9:16/2K` → `seedance-2.0/first_last_frame_to_video/9:16/720p/5s`）｜tpl_16 口红试色（图→图→图 + `MiniMax-Hailuo-02/image_to_video/768P/6s`）｜tpl_72 文字生角色（文×3 → LLM → 图 → 图 → `seedance-2.0/image_to_video/16:9/720p/5s`）｜tpl_92 节日礼盒开箱（2 图 → `gpt-image-2/reference_image_to_image/3:4/2K/medium` → `seedance-2.5-vip-r2v/9:16/480p/15s`）。
- **参数配置要点**：显式写 `image_to_video` / `first_last_frame_to_video` 的模板都在这一族，且**只用 `seedance-2.0`（720p/5s）与 `MiniMax-Hailuo-02`（768P/6s）**；要 15s 竖版就换 `seedance-2.5-vip-r2v`。
- **首帧/首尾帧怎么定**：视频入边 1 张生成图 → `image_to_video`（首帧驱动）；入边 2 张生成图（分镜首/尾）→ `first_last_frame_to_video`（tpl_27 就是 2 条图入边）。**注意**：官方库里 1 张图入边也能用 `reference_image_to_video`（11 个节点如此），所以按"要首帧驱动还是要参考一致性"选，不要死套入边数量。
- **最小可用节点清单**（产品图 → 解构图 → 5s 视频）：`import` 产品图 → `add` image「解构图」（`gemini-3-pro-image-preview/9:16/2K`）→ `add` video「动画」（`seedance-2.0/first_last_frame_to_video/9:16/720p/5s`）→ 边：产品图→解构图、解构图→动画 → `canvas_run` 解构图，收终态后再 `canvas_run` 动画。
- **落地注意**：三段串行 = 三次等待，中途任一环失败都不能拿旧产物"顶上"。它是最贵的一族，先跑 `1K`/`5s` 版本验证链路，再放大参数。

---

## 3. 布局与命名（所有原型通用）

| 项 | 实测值 | 怎么用 |
|---|---|---|
| 连线方向 | 410/411 条边是 target 在 source 右侧（99.8%） | **一律左→右**，输入在左、产物在右 |
| 列间距 | 中位 472 px，常见 450/500/550/600 | 同列 `x` 相同，列间距取 **450–550 px** |
| 行间距 | 中位 478 px，常见 450/475/500/550 | 同列 fan-out 的多个产物纵向等距 **450–500 px** |
| 节点尺寸 | 长边恒 400 px，短边按画幅换算（`3:4`→299×400、`1:1`→400×400、`9:16`→400×711、`16:9`→400×224、`3:2`→400×269） | 不用手算，`placement` 交给工具即可；**不要用节点 `measured` 反推画幅**（83/376 与当前 `aspect_ratio` 不吻合，那是上次渲染缓存） |
| 分组 | 只有 11/81 模板用 `group`（86% 不用） | `group` agent 也建不了；建完可用 `canvas_layout` 做 grid/horizontal/vertical 整体重排（可能联动同组成员） |
| 画幅与行距 | 9:16 节点是 400×711，不是 400×400 | 手写坐标时按真实高度留行距（见 `graph-dsl.md` §8），或直接用 `layout_plan.py` / `canvas_layout` |

命名约定：输入节点用「上传｜xxx」，产物节点用「最终输出｜xxx」或直接写机位/段落名（tpl_116/118/119 的做法），并保证同一批 fan-out 的标题带序号（套图1/套图2…），便于下游 prompt 用「【套图N描述】」对齐。

### 3.1 序列类工作流用"泳道"（镜头/分镜/套图/漫剧）

节点一多（≥12，或含 ≥3 条镜头/套图序列），按"列 = 依赖深度"堆出来的图会变成一条长竖列：分镜1 在 y=0、镜头1 在 y=1440，人得来回跳着看。改用泳道：

| 轴 | 含义 | 落地 |
|---|---|---|
| 列（x） | **阶段**，从左到右 = 生产顺序（不是依赖深度） | `① 输入（Brief / 素材槽） → ② 画面（分镜/底图） → ③ 声音（旁白/配音） → ④ 成片（视频）` |
| 行（y） | **序列**，同一镜 / 同一套图 / 同一变体 | 分镜3、旁白3、镜头3 必须在同一条水平线上 |

> **为什么旁白在第三列、不是第一列**：TTS 台词直写、零入边，`depth=0`，按依赖深度它会和输入挤在第一列。
> 但人读的是生产线：先有画，再配音，最后合成——旁白排在分镜之后、镜头之前，才和"5 张分镜 → 配 5 段旁白 → 出 5 个镜头"的叙事一致。
> `layout_plan.py --lanes` 已按"阶段 = 节点类型（text/input→0、image→1、audio→2、video→3）+ 阶段内深度"分列。

```bash
python3 scripts/layout_plan.py plan.json --lanes --in-place
```

- 序号从标题取（`镜头3｜…` / `分镜3` / `旁白3` / `套图3`），取不到再看 localId 尾部数字（`img_sh3`）；标题带序号是**泳道布局的前提**，所以命名规范不是文风问题。
- 无序号节点（Brief、待上传素材槽）按计划顺序各占一行、排在最上方，作为"输入区"。
- 行距 `LANE_ROW_GAP = 160`（卡片高 400，间隙 160），读起来是"一行一条序列"；列宽按最长卡片 + 120 留白自动算，16:9 卡片 711 宽也不会压列。
- 自检：`tests/test_layout_lanes.py`（N1 确定性 / N2 同序列同行 / N3 左→右 / N4 不重叠 / N5 输入槽在最上 / N6 无负坐标）。
- **建完不能改**：工具层没有单节点拖拽，`canvas_layout` 只会整体重排并打散泳道——布局错了只能删了按新坐标重建，所以坐标在建图前就定死。


## 4. 选型自查（写完 plan 后逐条过）

1. 我选的原型在这份表里有**代表模板 id** 吗？没有就回到 §1.1 重选。
2. 我有没有用 `gen_count` 出多图？（有 → 拆成多节点）
3. 我有没有给 `gemini-3-pro-image-preview` / `gemini-3.1-flash-image-preview` 写 `quality`？（有 → 删掉；模板库三个图模型里只有 `gpt-image-2` 有这个字段）
4. 我有没有建 `group` / 工具节点 / 指望跑模板？（有 → 删掉，改 §A9 替代方案或手工步骤）
5. 拓扑里有 LLM 文本节点吗？有 → 标 `manualStep`，或改 T2 代笔。
6. 有参考视频/音频入边吗？有 → 先走 `canvas_asset_import` 导入；没有来源才登记人工补文件。
7. 同一需求累计 >30 图或 >6 视频吗？是 → 先走官方确认，不要拆批绕过。
8. 有 TTS 吗？→ 必须 `voiceId`（`voiceSelection.required`），音频单独计数。

---

## 5. 专用处理（不是原型，独立链路）

`canvas_process` 处理**已有画布素材**，不产生创意：`image_upscale` / `video_upscale` / `image_layering` / `auto_matting`。
先 `canvas_capabilities` 查 `available` 与参数（分辨率枚举、分层模型/层数）；不可用就如实说明。
结果节点是新的关联节点（`outputNodeIds`），后续生成要连结果节点，不能继续用原图。处理占图/视频额度，不占 `runs[]`。

典型组合：A1 出图 → `image_upscale` 到 4K → 交付；A4 底图 → `image_layering` → 分层结果；商品图 → `auto_matting` → 透明底再套模板。
