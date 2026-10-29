# 端到端实测记录

技能的每次真实跑通都记在这里——它是「这套流程真的能出片」的证据，也是回归基线。

> 本篇保存历史观察，不把单个样本推广为连接/提交保证。连接、未知回执和续跑规则以
> [connection-recovery.md](../references/connection-recovery.md) 为准；历史成功不授权重跑或绕过运行确认。

---

## E2E-1　超跑商品图 → 1 张 1:1 电商主图（2026-10-16）

**目的**：验证「计划 → 校验 → 建图 → 连线 → 生成 → 收产物」全链路在真实画布上可执行（B3 低量试跑）。
**投入**：1 张图，1024×1024，1K / quality=medium（最小量级）。

| 项 | 值 |
|---|---|
| 计划文件 | `canvas-skill-build/e2e/e2e-supercar-1k.plan.json`（`validate_plan.py` 0 error / 0 warning） |
| 画布 | `103432`（临时画布，可删） |
| 原型 | A2（素材图 + 文案 → 图） |
| 素材 | 会话中的超跑实拍图（`.webp`，808×632，152KB），走 `attachment` 自动导入 |
| 模型 | `gpt-image-2` / `reference_image_to_image` / `1:1` / `1K` / `medium` / `gen_count=1` |
| 产物 | 1 张，1024×1024 JPG |

**实际步骤与回执**（按技能标准时序）：

| 步 | 工具调用 | 回执要点 |
|---|---|---|
| 1 | `canvas_create` | `created`，canvasId 103432，version 0 |
| 2 | `canvas_asset_import`(attachment) | `saved` v1，`asset.url` 为 OSS 链接，`assetRegistration: registered` |
| 3 | `canvas_node_edit(add, text)` | `saved` v2（代笔文本节点，写正文即可，无需运行） |
| 4 | `canvas_node_edit(add, image)` + 标量 params | `saved` v3 |
| 5 | `canvas_models`(image / r2i / gpt-image-2) | 实时目录确认模型与参数枚举（13 个 r2i 模型，`1K/2K/4K`、11 种画幅） |
| 6 | `canvas_node_edit(configure)` | `saved` v4（warning「需要连入图像」属正常） |
| 7–8 | `canvas_edges(add)` ×2 | `saved` v5 / v6，端口 `image_source→image_target`、`text_source→text_target` |
| 9 | `canvas_get(view:graph)` | 3 节点 / 2 边，端口与方向全部符合计划 |
| 10 | `canvas_run` | 回执 `submission_unknown` **但带 `jobId=canvas-1`** → 按纪律不重试，`job_output` 收 |
| 11 | `job_output(wait)` | `completed`，1/1 产物写入节点 |

**产物核验（按 qa-checklist B 段）**：

| 检查 | 结果 |
|---|---|
| B1 主体一致性 | ✅ 车身造型、银灰车漆、黑轮毂、红色灯带、四环 logo 与参考图一致；按提示词移除了赛车手 |
| B2 文字正确 | ✅ 标题「奥迪超级跑车」、卖点「超跑｜0-100km/h 1.2s（官方数据）｜199 万」无错字无乱码 |
| B3 版面 | ✅ 文字未被裁切，主体居中 |
| B5 尺寸 | ✅ 1024×1024 = 1:1 |
| B6 归属 | ✅ 本次 run 的真实 outputs，非节点旧产物 |

**本轮发现（已回写进 references）**：

1. **`auto` 与 `after` 混用会重叠**：素材节点 `auto` → (0,0)；文本节点 `auto` 与生成节点 `after(素材)` 双双落到 (631,0)。
   功能无损，但观感差。已写入 `references/graph-dsl.md` §8。**结论：同一次建图只用一种放置策略。**
2. **历史样本中的未知回执后续已完成**：两次实测（画布 103414、103432）都返回 `submission_unknown` 且都带 `jobId`，
   后续产物正常落节点。该样本不能把未知状态概括成正常成功。**有 jobId 就走原 `job_output`，不重提**。
3. **`configure` 后仍提示「需要连入图像」**：只要还没连线就会提示，连完线即消失，不影响后续 run。
4. **文本节点在本次链路里完全不需要运行**：T2 代笔模式下它只是给生成节点喂上下文的静态节点，
   整条链路由 agent 100% 自动跑完（这是 T2 相对于官方 A3 结构的最大优势：不会卡在人工点生成）。

**回归方式**：重跑 `python3 scripts/validate_plan.py examples/../../e2e/e2e-supercar-1k.plan.json`（或直接复制该计划改模型），
按上表步骤执行；重点观察第 10 步是否仍返回带 `jobId` 的 `submission_unknown`。

---

## E2E-2　超跑电商海报工作流·6 节点（2026-10-16，进行中）

**目的**：用技能完整走一遍 S0→S6，并暴露流程缺陷（本轮暴露了 3 个，已全部修进技能）。

| 项 | 值 |
|---|---|
| 画布 | `103442`「超跑电商海报工作流」 |
| 原型 | A2（素材图 + 文案 → 3 版式并行） |
| 最终节点 | ① 商品实拍图（input）② 产品信息 Brief（text）③ 画面文案（text）④⑤⑥ 三个生成节点 |
| 产物 | ④ 主图·暗色展厅 ✅ 2496×3312　⑤ 促销海报·价格角标 ✅ 2496×3312　⑥ 主图·极简棚拍 ⏸ 未提交 |
| 模型 | `gpt-image-2` / `reference_image_to_image` / 3:4 / 4K / high |

### 本轮暴露并修复的技能缺陷

1. **把"自检清单"建成了画布节点** → 违反新硬规则 11（画布只放参与生成/交付的节点）。
   修复：删除该节点；`validate_plan.py` 新增 **R19**（标题含 自检/清单/旁注/说明/话术 → ERROR）；`qa-checklist` 新增 A13。
2. **布局靠手拍坐标** → ②③ 挤在输入列、依赖关系看不出来。
   修复：新增 `scripts/layout_plan.py`（分层→列坐标→列内按父节点重心排序→垂直居中→归一化），
   `graph-dsl.md` 改为算法驱动，`qa-checklist` 新增 A14；示例改用脚本排布。
3. **"执行"只跑了一个节点就停下** → 违反新硬规则 12（执行＝跑完 `runs[]` 全部节点）。
   修复：SKILL.md S6 重写为执行闭环（进度表 + 逐节点提交/收结果 + 断点恢复），`qa-checklist` 新增 E1/E2。

### 本轮遇到的运行时异常（已写进 tool-contract 决策树的实践依据）

| 现象 | 判定 | 处置 |
|---|---|---|
| `canvas_run` 返回 `submission_unknown` **且带 jobId** | 本地已登记 Job，后台受理/完成仍需原任务核验 | 只走原 `job_output`，不重提 |
| `canvas_get(view:nodes)` → `CLIENT_UNAVAILABLE` | Client 路径未就绪，掉线/登记丢失等具体原因未确认 | 按 `references/connection-recovery.md` 有界探测原画布；summary 仅辅助看摘要 |
| `canvas_node_edit(delete)` → `submission_unknown` + `never_auto` | 该次删除结果未知 | 沿原请求核验；读回未见删除或拿到可信版本，均不能单独证明原请求未在途 |
| `canvas_get` → `AUTH_REQUIRED` | 桌面登录态失效 | 停止并请用户重新登录；恢复后从断点续跑 |

### 遗留

- ⑥ 主图·极简棚拍：因 `AUTH_REQUIRED` 未提交（`effect:"none"`，无 jobId，确定未提交）。重新登录后从 ⑥ 继续即可。

---

## 完整性门（v0.3 新增，2026-10-19）

用户要求「构建出来的画布必须是完整的」，据此新增 **硬规则 13 + `scripts/check_complete.py`（K1–K7）**。

用真实快照 `examples/canvas-nodes.sample.json`（画布 103442 的未完成状态）验证，判定结果与事实一致：

```
画布完整性：超跑电商海报工作流（7 节点）　（6 个节点）
  ✗ [K1] 「⑥ 主图·极简棚拍」 是生成节点，声明要产出 1 个但 outputs 为空 —— 未执行或未完成
  ! [K6] 画布名写「7 节点」，实际 6 个 —— 建议改名以免误导
结论：不完整 ❌
```

**这次实测暴露的完整性教训（都已进规则）**：
1. 交付前不能只看"节点建齐了"，要看"每个生成节点是否真有产物"；
2. 画布名会残留旧信息（删节点后仍写"7 节点"）——名字也是交付物的一部分；
3. 未执行完的节点必须在交付里点名说明（⑥ 因 `AUTH_REQUIRED` 未提交），不能含糊成"基本完成"。

---

## E2E-3　整张重建（2026-10-19，画布 103460）—— 首次「完整性门」全过

**背景**：用户要求「保证构建出来的画布是完整的」，且上一张画布（103442）残留 2 处缺口（⑥ 无产物、名字写 7 节点），决定整张重建。

| 项 | 值 |
|---|---|
| 画布 | `103460`「超跑电商海报工作流（6 节点）」 |
| 结构 | ① 商品实拍图（upload）② Brief（text）③ 画面文案（text）④⑤⑥ 三个生成节点；7 条边 |
| 布局 | `layout_plan.py` 生成：列 0「①②」、列 1「③」（与父节点对齐）、列 2「④⑤⑥」居中辐射 |
| 产物 | 3 张，全部 2496×3312（3:4），`status:success` |
| 完整性门 | `check_complete.py` → **K1–K7 全过，退出码 0** |
| 结构复核 | `verify_canvas.py` → 节点 6→6、边 7→7、无坐标重叠 |

**本轮新增的运行时经验（已写进 `tool-contract.md`）**：

1. **`job_output` 的 `version` 不可信**：用它提交下一个节点会被拒（「缺少可信版本」）；必须读回 confirmed 版本（必要时 `refresh:true`）。
2. **`monitoring_unknown` 不是失败**：它只表示结果尚未关联，节点仍在 `running`；轮询节点 `status` 即可，1–2 分钟后转 success，**绝不重提**。
3. **`effect:"none"` + 无 `jobId`** = 确定未提交 → 读回拿可信版本后重新提交是合法的。
4. **`check_complete.py` 的 K5 需要图才能精确判定源节点**：传 `--graph` 后，② 这类"只有出边"的源节点不会被误报为孤立。

**遗留**：旧画布 `103442`（6 节点、⑥ 空、名为"7 节点"）仍存在，工具层无删画布能力，需用户在画布列表里手动删除。

---

## E2E-4　多平台海报（2026-10-20，画布 103577）—— alpha.30 新工具实测

**目的**：验证 alpha.30 的 ops 批量写、图片/视频/音频素材导入、批量 `canvas_run`、`canvas_layout` 与 TTS 能力，
并回归「产品图 + Brief + LLM 文案 → 3:4/1:1/9:16/16:9 四平台海报」。

| 项 | 值 |
|---|---|
| 画布 | `103577`「多平台宣传海报工作流（6 节点，实际 7 节点）」 |
| 结构 | ⓪ 产品图（upload）① Brief（text）② 文案适配（text/llm）③④⑤⑥ 四平台图生成；9 条边 |
| 模型 | `gpt-image-2` / `reference_image_to_image` / `2K` / `high` |
| 产物 | 4 张：1776×2368（3:4）、2048×2048（1:1）、1536×2736（9:16）、2048×1152（16:9） |

**alpha.30 实测要点（当时门禁为 K1–K7，现行已扩到 K10）（已写进 `tool-contract.md` / `graph-dsl.md`）**：

1. **ops 批量**：`canvas_node_edit(ops:[add×6])`、`ops:[configure×4]`、`canvas_edges(ops:[add×5])` 均一次 saved；
   回执 `completed[].receipt.version` 逐项递增。
2. **模式门 warning**：节点仍是 `text_to_image` 时加图片边，边保存成功但 `warnings:["仅支持文本输入"]`；
   把 `modelType` 改为 `reference_image_to_image` 后正常出图。
3. **`canvas_get(view:"nodes")` 不接受 `limit`**（`INVALID_ARGUMENT`：工具参数含不支持的字段）。
4. **`canvas_run` 批量**：一次提交 3 个节点返回一个 jobId；该样本的 `submission_unknown` 后由原 `job_output` 确认 3/3 产物，不据此把未知回执认定为成功。
5. **生成后版本不可信**：下一次写前需 `canvas_get(refresh:true)` 拿 confirmed 版本，否则 `SUBMISSION_UNKNOWN`。
6. **9:16 按 560 行距会重叠**：400×711 的节点 y=1120 时压到 y=1680 的下一个节点；`layout_plan.py` 已改为按画幅高度累加。
7. **`canvas_run` 支持 TTS audio**（本次未实跑）：`configure` 可写 `voiceId/seniorParams`；`canvas_models(nodeType:"audio")` 返回 3 个 TTS 模型与 `voiceSelection`。

---

## E2E-5　漫画视频逐镜旁白（2026-10-20/21，画布 103582）—— alpha.30→alpha.31 + A8+

**目的**：端到端做一条「剧本 → 4 格分镜 → 4 段图生视频 → 旁白 TTS」的漫剧工作流，并暴露"TTS 没有下游"的设计缺陷。

| 项 | 值 |
|---|---|
| 画布 | `103582`「漫画视频生成工作流（12 节点）」，改造后 18 节点、17 边 |
| 结构 | 剧本/分镜脚本(T) → 分镜1–4(图) → 镜头1–4(视频)；旁白1–4(T) → 配音1–4(TTS) → 各镜头 `audio_target` |
| 图 | `gemini-3-pro-image-preview` / `text_to_image` / `9:16` / `2K`；1536×2752 |
| 视频 | 第一轮 `seedance-2.5-vip-i2v` `image_to_video` 5s；改造后 `seedance-2.5-vip-r2v` `reference_image_to_video` 6s（因接音频） |
| TTS | `speech-2.8-turbo` / `male-qn-jingying` / `calm` / speed 0.9；四句 5.3 / 5.2 / 4.2 / 4.9 s |

**实测要点**：

1. **"分镜"这个词会把图变成四格漫画整页**：4 个节点各返回一整页四格 + 中文小标题（每格左上角）。改写为「单幅、整页只有一个场景、不分格、无任何文字」后 4 张才是单格。已写进 `prompt-craft.md` §8。
2. **TTS `speed` 步长 0.1**：`0.95` 直接 `INVALID_ARGUMENT`；`0.9` 通过。`vol`/`pitch` 也是整数步长。
3. **音色查询不能带 `language:"Chinese"`**：返回 `total:0`；不带过滤 327 条，`language` 字段值是 `"中文"`。
4. **一条整轨配一镜是错的**：18.4s 整轨 + 4 条 5s 镜头，画布无拼接节点 → TTS 无下游、成片只能画布外混音。正解是拆句 + `audio_target` 逐镜挂接（A8+）。
5. **`audio_source→audio_target` 可保存**，无"不支持音频"警告；接音频后视频必须从 `image_to_video` 改成 `reference_image_to_video`（否则模式门报"仅支持连入 1 张图像"）。
6. **alpha.31 可在画布侧栏未打开时操作**：这是当次成功观察，不代表免除 Client 桥/会话登记前提，也不能排除同会话仍出现 `CLIENT_UNAVAILABLE`。
7. **`unconfirmed` 卡写**：TTS 跑完后 `canvas_get(refresh:false)` 连续两次仍 `consistency:"unconfirmed"`，`refresh:true` 一次转 confirmed。
8. **运行回执矛盾的历史样本**：`status:"rejected"` + `effect:"none"` + `error.code:"SUBMISSION_UNKNOWN"` + 无 `jobId`/`results`，当时 `job_list` 无新任务、节点 `outputs` 未变。旧版据此判为未提交的推断已撤销：这些观察不足以排除后台受理；按当前连接恢复规范保留原身份核验，不自动重提。
9. **待补验证**：接音频后的视频终态（音频是否真进输出音轨）本轮没跑到，`A8+` 与 `models-and-params.md` 里都标成未验证。
10. **TTS 台词可以直接写 prompt，不需要 text 节点**（2026-10-21 补测）：新建零入边 audio 节点、只把台词写进 `changes.prompt`，`configure` 后 `canvas_run` → `completed`，产出 6.3s 音频（`volumedetect` 均值 −25.3 dB，非静音）；回读 `inputs:[]`，`prompt` 与 `params.prompt` 都是台词。因此 A8+ 可省掉每句一个旁白文本节点：N=4 从 18 节点降到 **14 节点**（2 总纲文本 + 4 图 + 4 视频 + 4 配音）。
11. **反例：建完直接跑，结构问题由用户在花钱后指出**。本工作流第一轮建完立刻跑了 4 图 + 4 视频 + 1 段配音（约 10 分钟、全部计费），用户随后发现"画布里的 TTS 没有下游、成片旁白是画布外混的"。若先交付待运行清单等确认，这个结构问题 0 成本就能改。**结论：建完必须停、给清单、等"运行"二字**（见 `SKILL.md` 运行闸门、`qa-checklist.md` A0、`requirement-intake.md` §7）。
