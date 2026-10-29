---
name: canvas-workflow-builder
description: 把用户的生成需求变成一张真实可执行画布工作流时使用（电商主图/海报/套图/详情页/带货视频/漫剧分镜成片/多平台文案/TTS 配音）；负责需求拆解、结构选型、节点与参数配置、素材入图、连线与执行顺序、交付验收。
---

# Canvas Workflow Builder（画布工作流智能构建）

把「用户一句需求」变成「一张真实、参数合法、可端到端执行、能出片」的画布工作流。

**与官方 guidance 的分工（必读）**：本机画布插件自带 `desktop-canvas-workflow` 技能，管的是**行为与交互规范**
（该不该建画布、问几个问题、成品请求不许停在骨架、回复简洁、异常恢复纪律）。**行为层一律服从它。**
本技能只在需要「把需求变成正确可执行的图」时加载，管的是**工程知识**：结构选型、节点搭建、参数配置、
提示词工程、素材入图、连线合法性、执行顺序、计划校验。两者不重复。

> ## ⛔ 运行闸门（最高优先级，覆盖官方 guidance 的「成品请求直接生成」条款）
>
> **建完工作流 ≠ 可以运行。** 节点搭好、边连好、参数配好后，必须停下来给用户一份"待运行清单"并问一句
> **「是否运行？」**；**只有用户明确说"运行 / 跑吧 / 开始 / 生成吧"才调用 `canvas_run`。**
>
> - 用户说"帮我做一张海报 / 做条视频"= 描述目标，**不是**运行授权；"先搭个流程"更不是。
> - 每次运行都花钱：确认前先给量（几张图 / 几条视频 / 几条 TTS）、模型档位、预计时长，让用户看清成本再决定。
> - 用户没回 = 不运行；用户只提了修改意见 = 改完**再问一次**，不要顺手跑。
> - 改结构、加数量、换模型（尤其上调分辨率/时长）后**重新确认**，不沿用上一次授权。
> - 本机实测过的反面案例：建完漫画视频工作流后直接连跑 4 图 + 4 视频 + 4 段配音，用户随后指出"画布里的配音没有下游"——
>   结构问题本该在运行前由用户看出，钱已经花了。
> - 这条优先于本技能所有"执行 / runs / 把流程跑完"的表述；官方 guidance 里"成品请求不能停在骨架"，
>   在本机按"骨架 + 待运行清单 + 等确认"执行。

**本技能不做**：单张即兴出图（用户明确要这张图并让你生成时，直接 `canvas_node_edit` 的 add + `canvas_run`，也不要为此新建画布）、纯文档写作、
音乐/翻唱生成与音色克隆（不在公开能力内）。

> **证据口径（2026-10-23 核验，插件 0.3.0-alpha.31）**：工具契约以当前工具目录、插件的
> `lib/index.js` / `lib/client.js` 与真实回执为准；画布前端模式校验取自当前包的
> `canvas-app/dist/assets/workflowTabOwnership-*.js`。旧文档里的 alpha.20 字段（`action:"add"`、
> `delete`、`reconnect`、单 `nodeId` 的 run、图片专用 import）已全部过期，不要再照抄。
>
> **alpha.31 不要求先打开画布侧栏，但仍依赖前端 Client 通信桥和当前会话登记。**
> `CLIENT_UNAVAILABLE` 在该版本仍会发生；一直停在同一会话也可能发生。没有连接层证据时，只报告
> 「当前会话尚无可用的画布 Client」，不判定为旧版问题、网络抖动或用户切页导致。
>
> 人工查看、手改节点或点运行文本节点时，提示用户打开画布；Agent 侧操作无需以此为前提。
>
> **连接失败时先读 [连接与未知结果恢复](references/connection-recovery.md)。** 核心规则：
> - `summary` 只证明 Host 摘要可读，不证明 Client 就绪，也不提供 confirmed 写入版本；`nodes` / `graph` 才经过 Client 桥。
> - 用原画布的 `canvas_get(view:"nodes", refresh:false)` 只读检查；不为探活创建、编辑、运行或打开画布。
> - 同一故障默认最多 3 次只读探测、累计 60 秒（含已耗时），最多恢复重试 1 次明确未生效的业务操作；不因换节点/工具重置预算。
> - `nodes` 读通只证明读取恢复。继续前核对最新 confirmed 版本、用户改动、未完成项和原授权；编辑/运行能力另看真实回执。
> - 未知或矛盾回执先核验原请求；有 `jobId` 只追踪原 Job。没有新 Job、旧 outputs 未变，不能证明未提交。
> - 预算耗尽就保存断点并说明事实；不自动刷新/重启、不修改插件、不把这些恢复动作当作已执行。

---

## 0. 硬规则（不可协商）

1. **实时目录优先**：任何 `model` / `modelType` / 参数枚举都来自**本次** `canvas_models`；音频还要读 `voiceSelection` 与 `seniorParamHints`。`references/model-matrix.md` 只是快照。
2. **参数用新名**：`gen_count / resolution / aspect_ratio / duration`；旧名（`times / image_size / size / ratio / seconds`）先过迁移映射，否则报「参数不在允许选项中」。
3. **先计划后施工**：先产出 `plan.json` 并通过 `scripts/validate_plan.py`（0 error），再动工具。
4. **版本纪律**：每次写用最新 `confirmed` 版本；`VERSION_CONFLICT` → 重读再写，绝不覆盖。**生成结束后的版本常被标成 `consistency:"unconfirmed"`**：实测 alpha.31 里 `canvas_get(refresh:false)` 连续两次仍是 unconfirmed，必须 `refresh:true` 才拿到 confirmed（2026-10-21，画布 103582，version 131）；`refresh:true` 会重载可见画布，只在写前/未知恢复时用。
5. **未知不重试**：`submission_unknown` / `upload_unknown` / `create_unknown` / `monitoring_unknown` 或任何 `SUBMISSION_UNKNOWN` / `ASSET_UPLOAD_UNKNOWN` 错误码，先保留原请求身份并核验；**有 `jobId` 就只用 `job_output` 收**。即使顶层为 `rejected/effect:none`，只要错误码表示未知，也先按矛盾回执处理。无新 Job、无 `jobId`、旧 outputs 未变均不构成未提交证明；未消除不确定性前不自动重提、不重建。详见 `references/connection-recovery.md`。
6. **不越权**：不建 `group` / 工具节点，不调模板、不做整图调度、不复制节点、不伪造 outputs、不把素材 URL 当连线。
7. **素材先落地再连线**：连线只能用节点上真实的 OSS URL（`outputs[]` / `data.value` / `data.product[].value`）；附件 ID、`assetRef`、本地路径、文件名都不是连线依据（见 `references/media-intake.md`）。**素材还没到手，也要先把入口建出来**：输入槽节点 + 预连下游一起搭好（规则 20），文件到了只填内容、不动结构。
8. **生成节点自包含**：即使上游连了文本节点，提示词也必须能独立跑通（文本节点 agent 跑不了，可能一直为空）。
9. **写操作按 ops 批处理、读回再继续**：`canvas_node_edit` / `canvas_edges` 都收 `ops[]`；每项独立保存、版本顺传，失败即停（`completed[]` + `nextIndex`），不回滚。不要为「一次操作」反复读版本。
10. **数量与成本闸门**：同一真实需求累计 >30 图或 >6 视频必须先经官方确认（TTS 音频单独计数，不占图/视频阈值）；**小样试跑同样要拿到运行确认**（见运行闸门），跑完小样再问是否放大。
11. **画布只放"参与生成/交付"的节点**：自检清单、合规检查、交付话术、参数说明等属于内部逻辑，一律留在技能里。
12. **"执行" ＝ 用户确认后把 `runs[]` 跑完**：**先过运行闸门（用户明确说运行）**，再逐批提交、逐批收 `job_output`、上游产物确认后再跑下游；被登录态/客户端打断时按连接恢复规范保存断点，就绪并核对原授权后继续未完成项。
13. **交付前过完整性门**：`scripts/check_complete.py` 检查画布本身（产物、占位、内部逻辑节点、孤立节点、卡片重叠、下游文本未运行、画布名节点数）。有一项不过就不算完成——补齐或在交付里逐条说明缺口。
14. **排版一次到位**：新增节点时用 `placement`（`absolute`）一次排好，坐标来自 `layout_plan.py`（序列类用 `--lanes`，见规则 21）；建完可用 `canvas_layout` 整体 `grid`/`horizontal`/`vertical` 重排，但它会打散泳道、只适合小图。工具层**没有**自由拖拽/移动单节点的能力。
15. **音画必须在图里表达**：配音节点不能只做成"独立产物"再在画布外混音冒充成片——要么把旁白接到视频节点的 `audio_target`（会切到 `reference_image_to_video`），要么在交付里明确写"旁白是独立音轨，画布未合成"。**一条音轨只配一个镜头**：整片旁白要按句拆成 N 个 TTS 节点（**台词直接写在各节点 `prompt`，不用为放台词单独建 text 节点**），逐镜挂接；视频 `duration` 必须 ≥ 该句 TTS 时长（实测中文一句 4.2–5.3s，取 6s 起步）。
16. **孤立节点零容忍**：每个节点必须至少参与一条边。输入节点要有出边、产物节点要有入边；建完发现"没连任何东西"的节点（备用素材、写了一半的说明、被替换掉的旧旁白）一律删掉，不要留在画布上。`validate_plan.py` R22 + `check_complete.py` K8 都会拦。
17. **节点卡片不得重叠、且要读得懂**：坐标只由 `python3 scripts/layout_plan.py plan.json --lanes --in-place`（序列类）或 `--in-place`（小图）生成，不手拍；建完用 `canvas_get(view:"nodes")` 回执里的 `position`+`size` 复核矩形不相交（`check_complete.py` K9）。发现重叠/看不出流程 = 布局失败，只能删了按新坐标重建（工具层**没有**单节点拖拽）。
18. **文本节点必须跑到**：只要 text 节点**有上游入边**（它是 LLM 下游节点），就必须把它跑出内容再跑下游。agent 不能运行文本节点（`canvas_run` 只收 image/video/TTS audio），所以：① 计划里把它登记进 `manualSteps`（R24 会拦漏登记）；② 跑下游生成前确认它的正文非空（K10），为空就停下来请用户在画布内运行；③ 能代笔就代笔（把内容直接写进下游 prompt）把这个节点消掉。**TTS 不需要文本节点**：台词直接写 audio 节点的 `prompt` 就是待朗读文本（2026-10-21 实测：零入边 audio 节点写 prompt 可正常出音频）；只有"文字本身要由 LLM 生成/要作为交付物"时才建 text 节点。
19. **一次确认一次运行**：用户的运行授权只覆盖**当次**的节点集合与参数。跑完再想重跑、补跑、扩量（换更高分辨率、加时长、加条数）都要重新问；不要用"上次已经同意了"当默认。建完就交付清单、等确认，是默认动作，不是可选项。
20. **素材输入槽先建后填（全局思维）**：只要需求里有"用户提供 / 稍后提供 / 待确认"的素材（产品图、模特图、Logo、参考视频、品牌文案），**建图时就要把这个入口节点建出来并连好下游**，不能等素材到手再改结构。做法：
    - `add` 一个对应类型节点，标题写「产品图｜待上传」「参考视频｜待上传」，位置放在最左侧输入列（见规则 21）；
    - **预先连好它要喂的下游边**（如产品图 → 分镜3/4/5 的 `image_target`），下游按"将会有该素材入边"配置模式（有图入边 → `reference_image_to_image`），不要先配成无图模式再回头改；
    - 计划里登记 `manualSteps`（谁传、传什么、传到哪个节点），交付时明说「未上传前这几个下游节点跑不了」——这是**前置未满足**，不是故障；回执里的「需要连入图像」正是这个状态；
    - 文件到手后只做"填内容 / 改名"，**不重建节点、不改拓扑**。填之前先 `canvas_get` 确认槽位真实 ID 与版本。
    - 与规则 16 的关系：输入槽**必须有出边**（否则就是孤立节点，删掉）；槽位只是"空内容"，不是"空节点"。
21. **布局即阅读顺序（可读性硬标准）**：用户看画布，看到的应该是一条从左往右的流水线，不是一堆散卡片。
    - **列 = 阶段，而且列序 = 人读生产线的顺序，不是依赖深度**（2026-10-21 第 5 次返工后定稿）：
      `① 输入 → ② 画面（分镜/底图） → ③ 声音（旁白/配音） → ④ 成片（视频）`。
      关键差异：**TTS 旁白虽然零入边、依赖深度是 0，但它服务的是成片，必须排在分镜之后、成片之前**——
      把旁白塞进第一列（和输入挤在一起）是错的，那是"依赖顺序"，不是"生产顺序"。
    - **标题带阶段序号**：`① 输入` / `② 分镜` / `③ 旁白` / `④ 镜头`，让"先做什么"在文字上也成立，用户不用看连线就能读出顺序。
    - **行 = 序列**：同一镜 / 同一套图 / 同一变体的各阶段节点**同一行对齐**（旁白3、分镜3、镜头3 一条水平线），横着读一行就是"这一镜怎么走完"。
    - **间距是硬指标**（2026-10-21 用户判"挤到一块"后定的）：列间距 ≥ 400 px（按列内最宽卡片算，16:9 卡片 711 宽），行间距 ≥ 300 px（400 高卡片 → 行距 700）；输入区（Brief / 待上传素材）单独占顶部几行，不要和旁白挤在同一段。
    - 坐标**只能**由 `python3 scripts/layout_plan.py plan.json --lanes --in-place` 生成：**节点 ≥12 或含 ≥3 条序列（镜头/套图/变体）时必须用 `--lanes`**；小图可用默认模式。
    - 交付前复核两条：① 任意两张卡片矩形不相交（`position`+`size` 算，`check_complete.py` K9）；② 每条边 `target.x > source.x`（`verify_canvas.py` 会拦反向边）。`--lanes` 自带 N1–N8 单测（`tests/test_layout_lanes.py`，18 项）。
    - **坐标在建图前定死**：工具层没有单节点拖拽，`canvas_layout` 只能整体重排（`grid/horizontal/vertical` 会打散泳道）。所以布局错 = 只能删了重建，不要指望建完再摆。
    - 大图（>20 节点）只允许在同一阶段列内加行，**不得把不同阶段并成一列**（尤其旁白不能回到输入列）。
22. **工具参数严格照 schema，不凭记忆**（2026-10-22 用户指出）：每次调用前对照工具定义核字段——**不是所有字段在每种 view 下都合法**。踩过的两次 `INVALID_ARGUMENT: 工具参数含不支持的字段`：`canvas_get(view:"nodes")` 不接受 `limit`；`canvas_get(view:"graph")` 不接受 `nodeIds`（graph 只认 `limit / nodeOffset / edgeOffset / expectedVersion`）。被 schema 拦下时**先读工具定义再调**，不要试探性换参数重发；`canvas_models(view:"voices")` 也不接受 `modelType / modeOffset / modelOffset`。逐工具白名单见 `references/tool-contract.md` §0。
23. **视频节点要用上游音频，必须写进 prompt**（2026-10-22 用户实测指出）：`audio_source→audio_target` 只保证**边合法**，模型用不用这条音轨由视频节点 prompt 决定。prompt 第一段必须显式写「使用连入的图片1和音频1生成这条视频：图片1是画面底本，音频1是音轨（原样使用、逐字对齐），不要重新配音、不要改写或省略台词、不要用环境声或背景音乐盖过人声」，然后才写时间轴；**禁止**写「环境声垫底」「不添加音效」「只用一声闷响」这类句子——它们会让模型理解成“音轨我自己生成”，结果下游视频静音、配音节点空转。台词归属要写明（“音频1是医生的台词”）。Seedance 2.0 原生支持 `@Audio1` 引用（≤3 段、总时长 ≤15s），可作为加强句。`validate_plan.py` R25 会拦漏写。
24. **按依赖推进、按分支并行**（2026-10-22 用户指出）：执行不是“一批一批等齐”，而是“谁的入边全就绪谁就能跑”。每个节点单独判 `ready`（每条入边的来源都有非空 `outputs`；text 入边还要求正文非空）；**不同分支互不等待**——a 分支跑到第 4 个节点时，b 分支可以还在第 2 个节点，绝不能用全局栅栏把所有分支拉齐。做法：**一条分支一个 `canvas_run`、各自一个 jobId**，分别 `job_output` 收终态；某条分支一拿到产物就立刻提交它的下一个节点，不等其他分支。**同一分支内部仍然严格串行**（上游没产物绝不提交下游）。`runs[]` 顺序由 `validate_plan.py` R26 校验，但它只是必要条件，实际推进按 per-node readiness。
25. **换模型/换模式必须整份重写 `params`，并按该组合的实时 `paramHints` 校验**（2026-10-23 实测）：
    - `configure` 提交的是**整份参数集**，而参数集随「模型 × 模式」变化：`gpt-image-2` 有 `quality`、
      `doubao-seedream-5-0-pro-260628` 没有；`seedance-2.5-vip-r2v` 有 `aspect_ratio`（含 `adaptive`）、
      `kling-v3` 的 `image_to_video` **没有** `aspect_ratio`（传入即 `INVALID_ARGUMENT: 本期不开放参数 aspect_ratio`）。
    - 正确顺序：`canvas_models(nodeType, modelType, model)` 取**该组合**的 `paramHints` → 把 `params` 重写成
      "只含 hints 里出现的键" → `configure` → 立刻回读 `params`，确认键集合与 hints 一致。
      **不要**沿用上一个模型/模式留下的键，也不要凭记忆写参数名。
    - 被参数类 `INVALID_ARGUMENT` 拒绝时：按报错点名删掉那个键、原样重发一次，**不要**保留旧参数试探，
      **也不要**因为参数被拒就换模型、重建节点或改结构。
    - 同一张画布上批量换模型时，四个节点分别用各自的 `aspect_ratio`（3:4 / 1:1 / 9:16 / 16:9），
      但 `resolution` / `duration` 这类键必须落在该模型枚举内（`720p` vs `720P`、`1K` vs `2K` 不要混）。

---

## 1. 能力边界（alpha.31，先认清再规划）

| 能做 | 不能做 |
|---|---|
| `add` 四类节点：`text` / `image` / `video` / `audio`；`edit` 标题/正文/提示词/标量参数；`remove`；`configure` | 建 `group`、16 种工具节点（多视角/高清/重绘/分镜…）；重命名画布 |
| 配置 image/video 的 `modelType`/`model`/标量参数；配置 audio 的 TTS 模型、`voiceId`、`seniorParams` | 配置文本节点模型（`configure` → `UNSUPPORTED_NODE`）；运行文本节点 |
| 导入**文本/图片/视频/音频**：`attachment` / `conversation_asset` / `canvas_node` / `workspace_file` | 导入任意 URL；用 URL 直接连线；修改上传节点的生成参数 |
| 连线 `add` / `edit`（改接保留边 ID）/ `remove` / `reorder` | 同源同目标重复连、自环、成环、类型不兼容 |
| `canvas_layout`：`grid` / `horizontal` / `vertical` 原生排版 | 自由拖拽单个节点到任意坐标 |
| `canvas_process`：高清图片、高清视频、图像分层、自动抠图（需 `canvas_capabilities` 判定 `available`） | 把处理当创意生成；处理任意 URL；承诺 PSD/可编辑文字层 |
| 视频节点可接音频输入：`audio_source→audio_target`（原生 `video` 允许输入 `text/image/video/audio`；有音频入边时模式按 `yl()` 推断为 `reference_image_to_video`） | 保证音频一定被"烘进"输出成片（边与配置可保存；音频是否真进输出音轨由视频节点 prompt 是否声明使用连入音频决定，见规则 23；只能用 ffprobe 抽音轨验证） |
| `canvas_run`：批量运行 image/video/TTS audio 节点（≤20 个/次，并发上限 8，超出返回 `paused`+`nextIndex`） | 一次调度整条 DAG；运行音乐/翻唱/音色克隆节点 |
| 读 `canvas_models`（image/video/audio + `view:voices`）、`canvas_assets`、`canvas_list`、`canvas_capabilities` | 读文本模型目录；读高级嵌套参数（`cameraControl`） |

---

## 2. 主流程 S0–S8

### S0 需求解析 → `brief`
抽齐七要素：**交付物 / 平台与尺寸 / 数量 / 风格调性 / 素材 / 文字内容 / 合规约束**。
- 素材清点必须同时定分工：文本/图片/视频/音频都可由 agent 导入（`attachment` / `conversation_asset` / `canvas_node` / `workspace_file`）；导入失败再交办用户。
- **素材清点必须落到节点上**：用户"已提供但还没发 / 稍后提供"的素材，也要在建图时就建输入槽并预连下游（规则 20）。画布上缺入口 = 工作流逻辑不完整，不是"等素材来了再补"。
- 缺失项**一次性集中反问（≤5 问）**；能从对话或工具拿到的不要再问；非阻塞项给合理默认并标注假设。
- 事实不得默认：产品参数、功效、认证、价格、品牌，不得编造。
详见 `references/requirement-intake.md`。

### S1 结构选型 → 原型
按需求特征从 `references/archetypes.md` 的决策表选 **1 主原型 + 0–2 备选**，并确定输入形态（用户图 / agent 生成底图 / 文本 brief / 已有视频音频）。
电商类需求同时读 `references/ecommerce-patterns.md` 的按需求反查表；口播/配音需求读 `§A8`；**漫剧/漫画视频/分镜成片读 `references/archetypes.md` 的 `§A8+`**（逐镜旁白入片）。

### S2 图规划 → `plan.json`
写出计划（schema 见 `scripts/plan.schema.json`）：`goal / archetype / brief / nodes[] / edges[] / runs[] / manualSteps[] / estimate / acceptance`。
- `nodes[]` 每个节点必须有 `localId / role / type / title`；生成节点还要 `prompt` 与 `config`（音频加 `voiceId` / `seniorParams`）。
- `runs[]` 是**可批量提交**的拓扑序列表，可含 `image` / `video` / 只含 TTS 的 `audio` 节点。
- 文本 LLM 节点不进 `runs`，登记到 `manualSteps`；音乐/翻唱、音色克隆同样登记人工。
- **坐标别手拍**：序列类（镜头/分镜/套图/漫剧）用 `python3 scripts/layout_plan.py plan.json --lanes --in-place`，得到"行=序列、列=阶段"的泳道图；单图/小图用 `--in-place`。**建完不得出现卡片重叠**（R23/K9），也不得出现下游在左、上游在右（规则 21）。
- 有上游入边的 `text` 节点必须登记 `manualSteps`（R24）：它是 LLM 下游节点，内容要跑出来才能给下游用。
- 需要专用处理时，在计划里把处理结果节点当作后续输入；处理本身不进 `runs`（用 `canvas_process` 单步执行）。

### S3 静态自检 → 校验报告
`python3 scripts/validate_plan.py plan.json`，**必须 0 error**；预演工具序列用 `scripts/render_plan.py`（dry-run）。

### S4 建图（ops 批量 + 读回）
```
canvas_create（或用户指定画布）
  → canvas_get(view:nodes) 取 confirmed 版本
  → canvas_node_edit(ops:[{op:"add", node:{type,placement,changes}}...])   # 一次可加多个节点（输入槽一起加）
  → canvas_models 读实时目录（image/video/audio 各读一次）
  → canvas_node_edit(ops:[{op:"configure",...}])                          # 模型/参数/音色（含"将有素材入边"的模式）
  → canvas_asset_import 素材入图（文本/图片/视频/音频）→ 读回核对        # 文件没到就先空着，槽位已在
  → canvas_edges(ops:[{op:"add", connection:{...}}...])                    # 一条一条或批量（输入槽的边一起连）
  → canvas_layout（仅小图，可选；泳道图不要用，会打散布局）
  → canvas_get(view:graph) 结构复核
```
- **先立输入槽，再配生成节点**：待上传素材的节点在第一批 `add` 里就位（标题带「待上传」），它的下游边在第一批 `edges` 里连好。文件到位后只补内容，不重建。
- `configure` 要在加图片边**之前**把 `modelType` 设成 `reference_image_to_image`；顺序反了边仍会保存，但回执带 `warnings:["仅支持文本输入"]`。
- **画布名不要写死节点数**：工具层不能改名，后续一增删节点名字就失真（`check_complete` K6 会一直报）。用「题材 + 用途」命名，例如「漫画视频·逐镜旁白」，不要写「12 节点」。踩过：`103582` 建时叫「（12 节点）」，改造后 18 节点，名字永远对不上。
- 素材：`canvas_assets` → `canvas_asset_import`（四类来源见 `references/media-intake.md`）。文本导入建文本节点；图片/视频/音频建 upload 节点。
- 上传节点只允许改标题或删除，不能 configure、不能当生成目标。

### S5 结构复核
`canvas_get(view:graph)` 原样存 `graph.json`，跑 `scripts/verify_canvas.py plan.json graph.json`：
节点/边/端口/坐标重叠逐项对照；差异必须修正或记录。`unconfirmed` 或截断时不得声称已完整确认。
再 `canvas_get(view:"nodes")` 存 `nodes.json`，跑 `check_complete.py nodes.json --graph graph.json`：
**K8 孤立节点 / K9 卡片重叠 / K10 下游文本节点未运行** 三项必须在进执行前清零（别等交付才发现）。
**布局可读性复核（规则 21）**：列必须是阶段顺序、同一序列的节点同一 y、无卡片重叠；不合格就按新坐标删了重建——这一步在交付前做，不要等用户提。

### S6 执行（仅当用户明确确认运行后才进入）
**进门条件**：用户在看过待运行清单后明确说"运行 / 跑吧 / 开始 / 生成吧"。没这句话就停在这里，把清单交给用户。
```
ready(n) = 该节点每条入边的来源节点都已有非空 outputs（text 入边还要求正文非空）
branches = 按分支切分 runs（漫剧里一条分支 = 一个镜头：分镜图 → 配音 → 视频）

# 阶段 A：同一层级的兄弟节点可以一起提（6 张分镜、6 段配音各自一批，≤20/批）
for b in branches: submit(b[0])            # 每个分支的首节点各自一个 canvas_run/jobId

# 阶段 B：分支各自往前推，谁就绪谁跑 —— 不要等齐
while 有分支未完成:
    for b in branches:
        job = b 的当前 job
        if job 已完成（phase:"completed" 且 outputs 非空）:
            标记该节点 done
            v = 最新 confirmed 版本（写前必读，必要时 refresh:true）
            if b 还有下一个节点 and ready(b.next): submit(b.next)     # 立刻推进这条分支
        else:
            继续（不阻塞其他分支）；必要时 job_output(wait:false) 轮询
    if 所有分支都在等且无人可提交: 报告卡在哪条入边、哪个节点、什么错误码

# 说明：只有“必须等结果才能决定下一步”时才 job_output(wait:true)；单条 wait 不要拖住其他分支
```
- `submitted` / `submission_unknown` 都不是完成；以 `job_output` 的 `phase:"completed"` 与 `outputs` 为准。
- 连接失败走 `references/connection-recovery.md`；无 `jobId` 的未知提交先核验原请求，不能进入无 Job 的轮询空转或再次 `submit`。
- **跑下游前先检查下游 text 节点**：有入边的 text 节点正文为空 = 它还没运行。agent 跑不了它，就停下请用户在画布内点运行，绝不能拿空文本当输入硬跑下游（那样图和视频都会跑偏，还查不出原因）。
- `paused` 不是失败：`nextIndex` 是尚未提交的起点，先收完当前 Job 再续。
- 上游产物确认后才跑下游（A4/A11 链式）；无依赖的 fan-out 可同批提交。
- **分支并行、分支内串行**：a 分支跑到第 4 个节点时，b 分支可以还停在第 2 个——只要各自入边就绪就推进，不要等齐所有分支；同一条链上（图→该镜视频）必须等上游收终态再提交，上下游不许同批。
- **批次按“同一层级”切**：6 张分镜、6 段配音这类互不依赖的兄弟节点可同批；一旦进入链式阶段（图→视频），改成按分支提交，避免一个慢节点拖住整批。
- 回执里出现「需要连入图像」/「依赖不满足」时，先回去查那条入边的上游 `outputs`，**不是**改 prompt 或换模型。
- 失败/未知不换模型、不重建节点绕过；但必须说明卡在哪个节点、什么错误码。
- 累计 >30 图 / >6 视频：Host 会弹确认；`CONFIRMATION_DECLINED` / `CONFIRMATION_UNAVAILABLE` 表示**尚未提交**。
- TTS：先 `canvas_models(nodeType:"audio")` + `view:voices` 选音色，`configure` 写 `voiceId`/`seniorParams`，再 `canvas_run`。

### S7 交付（先过完整性门）
```
python3 scripts/check_complete.py nodes.json --expect-node-count <计划节点数> [--graph graph.json]
```
K1–K10 全过才算完整（含 K8 孤立节点 / K9 卡片重叠 / K10 下游文本未运行）；任何一项不过 → 补齐或逐条说明缺口。
必须交代：人工步骤（文本节点生成、音色选择、音乐生成）、**待上传素材的入口节点与上传方式（哪些下游被它卡住）**、文本模型建议、用量与计费点估算、复现方式（画布 ID + 需重跑的节点）。
分享/存档用 `scripts/export_share.py` 导出单文件 HTML。

### S8 复盘
把本轮新事实（模型变更、模式门、回执坑、验证结论）写入记忆。

---

## 3. 三个最小示例

> 三个示例的**共同结尾**：S5 结构复核通过 → 交付「待运行清单」→ **等用户确认** → 才进入 S6 的 `canvas_run`。
> 示例里写的 `canvas_run` 都发生在用户说"运行"之后。

### 3.1 电商海报（A2：素材图 + 文案 → 图 fan-out）
1. S0：3 张 3:4 主图（4K），1 张商品图，标题/3 卖点/价格。
2. S2：`nodes` = 商品图 + T2 文案 + 3 个生成节点；`edges` = 图→3 图、文→3 图；`runs` = 3 图。
3. S4：`canvas_node_edit(ops:[add×5])` → `canvas_models` → `configure` 3 个（先设 `reference_image_to_image`）→ import 商品图 → 6 条边 → graph 复核。
4. S6：一批 `canvas_run` 3 个节点（若并发不足会 `paused`，收完再续）。
5. S7：check_complete + 交付。

### 3.2 多平台海报（A3：Brief → LLM 文案 → 四平台图）
1. `nodes` = Brief（text/copy）+ 文案适配（text/llm，登记 manualSteps）+ 4 个 image（3:4/1:1/9:16/16:9）。
2. 图片节点如果有产品图入边，必须是 `reference_image_to_image`；没有产品图则 `text_to_image`。
3. 文案节点由用户在画布点生成；下游 prompt 必须自含兜底文案。
4. 4 张图可同批 `canvas_run`；`runs` 顺序按用户期望的呈现顺序。

### 3.3 口播配音（A8：台词 → TTS）
1. `canvas_models(nodeType:"audio")` → 选 `speech-2.8-turbo`（或 hd）；`view:voices` 选中文自然音色。
2. `add` 1 个 `audio` 节点（TTS），**把台词写进 `changes.prompt`**——不需要额外建文本节点。
3. `configure`：`modelType:"tts"`、`model:"speech-2.8-turbo"`、`voiceId`、`seniorParams:{speed, emotion...}`（字段/范围以 `seniorParamHints` 为准）。
4. `canvas_run([audioId])` → `job_output` 收音频 outputs。
5. 音乐/翻唱与音色克隆不在公开能力内，不要建这类节点。

### 3.4 漫剧/漫画视频（A8+：剧本 → 分镜图 → 逐镜 TTS → 图生视频带旁白）
1. `nodes`：剧本(T) / 分镜脚本(T) + N 张分镜图 + N 个视频 + N 个 TTS（**台词直写 TTS 的 prompt，不建旁白文本节点**）。**N=4 时 14 个节点**（2 总纲文本 + 4 图 + 4 视频 + 4 配音）。
2. 分镜图 prompt **必须写"单幅、整张只有一个场景、不分格不排版、无文字"**：只写"分镜N"会让模型直接出四格漫画整页并带中文字幕（2026-10-20 实测，4 张图全是四格页）。
3. TTS：`add` 时把该句台词写进 `changes.prompt`；`configure` 用 `modelType:"tts"` + `model:"speech-2.8-turbo"` + `voiceId:"male-qn-jingying"`（或实时目录里的中文自然音色）+ `seniorParams:{language_boost:"Chinese", emotion:"calm", speed:0.9}`——**`speed` 步长 0.1，写 0.95 会被 `INVALID_ARGUMENT` 拒绝**。
4. 视频：每镜 `configure` 成 `reference_image_to_video` + `seedance-2.5-vip-r2v`（接音频后不能再留 `image_to_video`），`duration` ≥ 该句 TTS 实测时长（取 6s 稳妥）。
5. 连线：`配音i --audio_source→audio_target--> 镜头i`；`分镜i --image_source→image_target--> 镜头i`；总纲文本 → 各分镜图。
6. 视频 prompt 必须声明用音频（规则 23）：开头写「使用连入的图片1和音频1生成这条视频：图片1是画面底本，音频1是音轨，原样使用、逐字对齐，不要重新配音/改写台词/用环境声盖过人声」，时间轴放在后面。
7. 执行顺序（用户确认运行后）：**先跑全部 TTS 收终态 → 跑分镜图收终态 → 才跑视频**（每条视频的 image 入边与 audio 入边都必须已有产物）；视频之间可同批。
8. 交付：N 段镜头按时序拼接即 N×duration 的漫剧成片；若画布内没有拼接节点，拼接属**画布外的最后一步**，必须在交付里说清楚，不能把外部混音算作"画布已合成"。

---

## 4. 参考文档索引（按需读取，不要一次全读）

| 什么时候读 | 读哪篇 |
|---|---|
| 节点/边字段、参数新旧名、可写边界、模式门 | `references/graph-dsl.md` |
| 连线、改接、调输入顺序，或连线报错 | `references/connection-rules.md` |
| 导入文本/图片/视频/音频、workspace_file、素材回执 | `references/media-intake.md` |
| 调工具、看回执、错误码、未知恢复 | `references/tool-contract.md` |
| Client 不可用、读取/写入超时、预算耗尽、断点续跑、矛盾或未知回执 | `references/connection-recovery.md` |
| 选结构原型（决策表 + 骨架，含 A8 TTS） | `references/archetypes.md` |
| 电商场景结构 | `references/ecommerce-patterns.md` |
| 写文本节点提示词、选文本模型 | `references/text-node-prompting.md` |
| 写图像/视频节点提示词（含单幅分镜、多格漫画坑） | `references/prompt-craft.md` |
| 选模型、参数、成本、能力边界 | `references/models-and-params.md` + `references/model-matrix.md` |
| 需求拆解与反问 | `references/requirement-intake.md` |
| 交付前自检 | `references/qa-checklist.md` |
| 计划 vs 画布对照 | `scripts/verify_canvas.py` |
| 排坐标（序列类：行=镜头、列=阶段） | `python3 scripts/layout_plan.py plan.json --lanes --in-place` |
| 排坐标（单图/小图） | `python3 scripts/layout_plan.py plan.json --in-place` |
| 画布完整性 | `scripts/check_complete.py` |
| 分享/导出 | `scripts/export_share.py` |

---

## 5. 自检门（每次交付前必过）

跑 `references/qa-checklist.md`：运行闸门 3 条（A0）+ 建图 18 项（A）+ 出图 7 项（B）+ 执行 4 项（B'）+ TTS/处理 5 项（B''）+ 合规红线（C）+ 交付话术（D）。
最容易漏的四条：**参数是否来自实时目录**、**模型模式与入边是否匹配（模式门）**、**素材是否来自真实节点 URL**、
**配音有没有下游（P5）**。另加两条本机踩过的：**待上传素材有没有入口节点（规则 20）**、**泳道布局是否左→右、同镜同行（规则 21）**、**视频 prompt 有没有声明使用连入音频（规则 23）**。
