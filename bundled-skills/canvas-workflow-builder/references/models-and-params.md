# 模型与参数选择

这份文档解决「这个节点该选什么模式、什么模型、什么参数、要花多少」的问题。**规划阶段**读它做选型与会话前预估；**动手配置前**必须改用 `canvas_models` 读实时目录。枚举值一律以实时返回为准，本文与 `references/model-matrix.md`（同一批数据的快照）都只是参照。

> 数据来源：`recon/model_params.json`（远端模型目录快照，252 KB）+ 81 条模板实测参数统计。计费点用 `point` 字段原值，不做换算。

---

## 1. 运行期纪律（先看这一节）

| # | 规则 | 违反后果 |
|---|---|---|
| 1 | 任何 `configure` / `params` 写入前，先 `canvas_models(canvasId, nodeType)` 读**当前账号**可用模式与模型 | 账号可用性、上下架会变；快照里的模型可能已不在你的账号内，写入即报参数校验失败 |
| 2 | `modelType` / `model` 用**真实 value**（如 `text_to_image`、`gemini-3-pro-image-preview`），不用中文展示名（如「文生图」「Nano Banana Pro」） | 报「参数 X 不在当前模型允许的选项中」 |
| 3 | `canvas_models` 续页（`modeOffset`/`modelOffset` > 0）必须回传第一页的 `expectedCatalogVersion` | `CATALOG_VERSION_CONFLICT` |
| 4 | `paramHints` 是**默认父参数组合**，不等于已有节点的当前值；不要拿它当「这个节点现在是什么」 | 规划会与现场不符 |
| 5 | `canvas_models` 的 `nodeType` 枚举是 **`image` / `video` / `audio`**；文本模型仍不在目录里（只能用户在画布 UI 选，见 §7） | 把音频当"不可配"会漏掉 TTS 能力 |
| 6 | 用**新参数名**：`gen_count` / `resolution` / `aspect_ratio` / `duration`。旧名 `times` / `image_size` / `size` / `ratio` / `duration_seconds` / `seconds` 一律不用 | 报「参数 X 不在当前模型允许的选项中」 |
| 7 | 旧模型名要换新：`gemini-3-pro-preview` → `gemini-3.1-pro-preview`（81 条模板里 31 个 LLM 节点有 23 个还是旧名，那是历史数据，不是可用值） | 同上 |
| 8 | 只写**标量**参数；`params` 里不能出现 `model` / `modelType` / `prompt`；TTS 的 `voiceId` / `seniorParams` 走 `configure` 顶层字段 | `INVALID_ARGUMENT` |
| 9 | `canvas_run` 可**批量**提交依赖已就绪的 image/video/TTS audio 节点（≤20/批，并发 8） | 超出 `paused` + `nextIndex`；不要拆成整图调度 |

**读目录的最小调用形状**（`modelType`/`model` 省略即取原生默认，但显式给更省往返）：

```
canvas_models(canvasId="<真实ID>", nodeType="image")
  → 返回 modes[]{ modelType(真实value), name(中文名), models[]{ model, name, params, paramHints, point, maxPrompt } }
canvas_models(canvasId="<真实ID>", nodeType="video", modelType="reference_image_to_video")
  → 该模式下的模型与标量参数枚举
canvas_models(canvasId="<真实ID>", nodeType="audio")
  → TTS 模式/模型 + seniorParamHints + voiceSelection
canvas_models(canvasId="<真实ID>", nodeType="audio", view="voices", language="Chinese")
  → 公共音色列表（voiceSource:"my" 查个人音色）
```

---

## 2. 模式怎么选（判据是**入边素材**，不是用途）

规则：模式由「这个生成节点实际收到几路、什么素材」决定。连线先定，模式后配。

| 节点 | 入边素材 | 选 `modelType` |
|---|---|---|
| image | 有任意 `image_source` 入边 | `reference_image_to_image` |
| image | 无图片入边（纯提示词／只有文本入边） | `text_to_image` |
| video | 0 图（可带文本） | `text_to_video` |
| video | 1 图 | `image_to_video` |
| video | 2 图（首帧 + 尾帧） | `first_last_frame_to_video` |
| video | 多图 / 有参考图语义 | `reference_image_to_video` |
| video | 有视频/音频入边 | `reference_image_to_video`（按素材语义） |
| audio | 有文本入边 | `tts`（默认；需 `voiceId`） |
| audio | **无入边、台词写在节点 `prompt`** | `tts`（2026-10-21 实测可用，不必为台词建 text 节点） |
| audio | 1 个音频入边 | `music_cover`（不在公开运行范围） |

补充事实：

- 81 条模板里 133 个图生成节点，只有 22 个显式写了 `modelType`，**全部是 `reference_image_to_image`**；其余靠「有图入边」由原生自动判定。**照抄模板时不要以为不写 `modelType` 是遗漏**——但技能自己写节点时建议显式写，便于自查。
- 视频侧反过来：47 个视频生成节点里 `modelType` 与模型强绑定，`seedance-2.5-vip-r2v`(38) / `wan3.0-r2v`(2) 全是 `reference_image_to_video`；`seedance-2.0`(6) 三种都用过（r2v 3 / i2v 2 / fl2v 1）。**换模式常常必须换模型**：同一模型不一定在四个视频模式里都可用，见 §3 的 `doubao-seedance-1-5-pro-251215`。
- 模式选错的典型症状：给了 3 张参考图却选了 `image_to_video` → 只有 1 张起作用；0 图却选 `reference_image_to_video` → 依赖不满足。

---

## 3. 实时目录的形状与可用性差异（快照 2026-10-16）

| 模式 | 模型数 | 说明 |
|---|---|---|
| image / `text_to_image` | 20 | 全量 |
| image / `reference_image_to_image` | 14 | `mj-v8.2`/`mj-v7`/`niji-v7`/`insight/z-image-turbo`/`insight/qwen-2512` 等**只在 t2i**，图生图不可用 |
| video / `text_to_video` | 30 | — |
| video / `reference_image_to_video` | 22 | `doubao-seedance-1-5-pro-251215`、`kling-v3`、`veo-3.1*`、`MiniMax-Hailuo-2.3*`、`viduq3-pro-i2v`、`insight/*` 等**不在 r2v** |
| video / `image_to_video` | 33 | 最全的一档 |
| video / `first_last_frame_to_video` | 24 | 比 i2v 少 9 个（如 `grok-imagine-video`、`happyhorse-*`、`viduq4-preview`、`insight/miniMax-*`） |
| audio / `tts` | 3（2026-10-20 实测） | `speech-2.8-turbo` / `speech-2.8-hd` / `insight/indexTTS-2`；`voiceSelection.required=true` |

**拿不准就查，不要跨模式套用模型名。** 三个高频坑：

1. `kling-v3` 有 t2v/i2v/fl2v，但**没有 r2v**；r2v 位置上是 `kling-v3-omni`。
2. `doubao-seedance-1-5-pro-251215` 没有 r2v；它也是少数带 `enableAudio` 的模型。
3. `wan3.0*` 在 i2v/fl2v 里**没有 `aspect_ratio`** 参数（只有 resolution/duration/enableAudio/gen_count），宽高比由参考图决定。

---

## 4. 选型建议表（按用途给候选 + 理由 + 快照计费点）

**图（image）**

| 用途 | 首选 | 备选 | 理由 / 参数要点 |
|---|---|---|---|
| 带字海报、促销图、头图 | `gpt-image-2` | `gpt-image-2.5-flare` / `gpt-image-2.5-sunburst` | 只有 `gpt-image-2*` 有 `quality`；要出正确文字宁可 `quality=high` + 1K，模板里 25/42 个 `gpt-image-2` 节点用 high |
| 写实商品图 / 高级质感 | `gemini-3-pro-image-preview`（Nano Banana Pro） | `gemini-3.1-flash-image-preview`（Nano Banana 2） | 快照计费 95-164 vs 52-199；Pro 在 133 个图生成节点里占 66（49%），是模板主力 |
| 场景套图 / 批量出图（成本敏感） | `gemini-3.1-flash-image-preview` | `doubao-seedream-5-0-260128` / `doubao-seedream-4-5-251128` | Flash 档；即梦两个是快照里最便宜的一档（22 / 24 点），但 `maxPrompt` 只有 1000 字 |
| 多角度 / 多视图一致性 | `gemini-3-pro-image-preview` | `banana2.1-i2i` | 模板 A9/多角度族几乎全用 Pro；注意 `cameraControl` 工具层不开放 |
| 矢量 / 设计稿 / 线稿风 | `recraftv4_1_pro_vector-i2i` / `recraftv4_1_pro_vector-t2i` | `recraftv4_1-i2i` / `recraftv4_1-t2i` | 只有 Recraft 是矢量向；Pro Vector 计费 270，普通版 35，差 7.7 倍 |
| 艺术风格 / 无文字需求 | `mj-v8.2` / `niji-v7` | `flux-2-klein-9b` | MJ 系 `gen_count` **只有 4**（默认 4），不能设 1；无 `resolution` |
| 极低成本试稿 | `insight/z-image-turbo` / `insight/qwen-2512` | `doubao-seedream-5-0-260128` | 计费 10-35，但 `gen_count` 只有 1 |

**视频（video）**

| 用途 | 首选 | 备选 | 理由 / 参数要点 |
|---|---|---|---|
| 带货短视频 / 种草（图生视频） | `seedance-2.5-vip-r2v` | `seedance-2.0`（画质优先） | 模板绝对主力 38/47，固定 `reference_image_to_video + 9:16 + 480p`；480p 是省钱档，720p 明显更贵 |
| 有配音/口播需求 | `wan3.0-r2v` | `kling-v3-omni-r2v`、`doubao-seedance-1-5-pro-251215` | `enableAudio` 默认 True（Wan 系）；`kling`/`doubao-1.5` 默认 False，需显式开 |
| 首尾帧过渡 | `seedance-2.0` / `wan2.7-i2v-2026-04-25` | `MiniMax-H3-fl2v` | fl2v 档位，注意 `veo-3.1*` 在 fl2v 下 `duration` 只有 8s 一个取值 |
| 高分辨率成片 | `wan3.0-r2v`（1080P） | `MiniMax-H3-r2v`（2K） | 模板里唯一用 1080P 的就是 `wan3.0-r2v`（A10 原型） |
| 便宜快出草稿 | `viduq3-turbo-r2v` / `viduq2-turbo` | `MiniMax-H3-Fast-*` | 计费 29-332 / 30-463；`maxPrompt` 只有 2000 字 |
| 长文本分镜脚本 | `wan3.0-r2v`（20000 字） | `viduq4-preview-r2v`（20000）/ `MiniMax-H3-*`（7000） | 视频 prompt 中位就 482 字，分镜脚本轻易破 2000，注意 `veo-3.1*` 上限仅 1000 字 |

**音频（audio，alpha.30 起可配置、可运行）**

| 用途 | 候选 | 要点 |
|---|---|---|
| 口播配音 TTS | `speech-2.8-turbo` | `modelType:"tts"`；必须给 `voiceId`（`canvas_models(view:"voices")` 查）；`seniorParams` 支持 `language_boost/emotion/speed/vol/pitch` |
| 高保真配音 | `speech-2.8-hd` | 同 `voiceId`；语速/情绪字段以 `seniorParamHints` 为准 |
| 个人/定制音色 | `insight/indexTTS-2` | 音色兼容性看 `compatibility:model_declared`；未声明时不要承诺全兼容 |
| 音乐/配乐 | — | `music_cover` 模式存在，但**不在公开运行范围**；不要建这类节点 |

**TTS 高级参数的硬约束（2026-10-21 实测，`speech-2.8-turbo`）**

| 字段 | 取值 | 坑 |
|---|---|---|
| `speed` | 0.5–2，**step 0.1** | 写 `0.95` → `INVALID_ARGUMENT`「TTS高级参数 speed 不符合选项、范围或步长」；只能 0.9 / 1.0 |
| `vol` | 1–10，step 1 | 写小数会被拒 |
| `pitch` | −12–12，step 1 | 同上 |
| `emotion` | `auto/happy/sad/angry/fearful/disgusted/surprised/calm` | 枚举，别自造 |
| `language_boost` | `auto/Chinese/Chinese,Yue/English/…`（41 项） | 中文用 `Chinese` |

音色查询：`canvas_models(view:"voices")` **不要带 `language:"Chinese"`**——实测返回 `total:0`；不带过滤是 327 条，音色对象里的 `language` 字段值是 `"中文"`。`compatibility:"not_declared"` 表示服务未声明模型映射，不能承诺全部可用。

**台词从哪来（2026-10-21 实测）**：audio 节点的 **`prompt` 就是待朗读文本**。零入边、只写 prompt 的 audio 节点 `configure` 后 `canvas_run` 可正常产出（实测 6.3s 音频、非静音，回读 `inputs:[]`、`prompt` 与 `params.prompt` 均为台词）。所以：
- **不需要为放台词专门建 text 节点**（少一个节点、少一条边，也避免"文本节点没运行"的空输入风险）；
- 只有需要复用同一段文案给多音色/多语言、或文字本身要交付时，才用 `文案节点 --text_target--> audio`，并**清空 audio 的 prompt**；
- TTS 计费字符 = 文本入边字符 + prompt 字符（前端 `costPoint` 逻辑 `[原生]`），两边都写等于读两遍、算两遍。

**音频进视频**：`audio_source → audio_target` 是合法边；有音频入边时视频模式按原生推断走 `reference_image_to_video`（原 `image_to_video` 会报"仅支持连入 1 张图像"）。r2v 目录里才有 `seedance-2.5-vip-r2v`；音频是否真被写进输出音轨，本机尚未验证到终态，不要对外承诺。

---

## 5. 参数与成本

### 5.1 五个标量参数的取舍

| 参数 | 取值（快照，须以实时为准） | 取舍规则 |
|---|---|---|
| `resolution` | 图 `1K/2K/4K`（部分模型如 `doubao-seedream-5-0-260128` 只有 `2K/3K`、`doubao-seedream-4-5-251128` 只有 `2K/4K`）；视频 `480p/720p/1080p`（部分含 `768P`、`2K`） | 图：带字海报保 1K + `quality=high`；纯质感图 2K。视频：480p 是草稿/竖屏带货档，1080p 只给成片。**没这个参数的模型不要传**（如 `gemini-2.5-flash-image` 无 `resolution`） |
| `aspect_ratio` | 图常见 `1:1/16:9/9:16/2:3/3:2/3:4/4:3/4:5/5:4/21:9`（`banana2.1-*` 另有 `4:1/1:4/8:1/1:8`）；视频 `16:9/4:3/1:1/3:4/9:16/21:9/adaptive` | 模板实测：图 `3:4`(82) > `9:16`(23) > `1:1`(14) > `16:9`(9) > `3:2`(5)；视频 `9:16`(35/46)。电商详情图用 3:4，短视频用 9:16 |
| `quality` | 仅 `gpt-image-2 / gpt-image-2.5-flare / gpt-image-2.5-sunburst` 有：`low/medium/high`，默认 `medium` | **两个 gemini 图模型和 mj 系完全没有 `quality`**，写进去即报错。带文字/logo 的图用 `high` |
| `gen_count` | 图 `1/2/4`（MJ 系仅 `4`；`insight/z-image-turbo`、`insight/qwen-2512` 仅 `1`）；视频多为 `1/2`；`seedance-2.5-vip-*`、`MiniMax-H3-*`、`wan3.0-*` 为 `1` | **官方模板库 `gen_count` 恒为 1**：多图靠多节点 fan-out（还便于单张重跑）。放大 `gen_count` 只在「同一提示词要抽卡」时用，会让成本与不可控同步放大 |
| `duration` | 视频秒数：`seedance-2.0` 4–15；`seedance-2.5-vip` 4–24+；`veo-3.1*` 仅 `4/6/8`（fl2v 只有 8）；`MiniMax-Hailuo-*` 仅 `6/10`；`wan2.7` 仅 `5/10/15` | 先定模式再定模型再定时长：**时长是模型特有的离散枚举，不是自由数字**。模板实测：15s(18)、20s(8)、10s(7)、5s(5) 最常见 |

### 5.2 计费点用成本预估

计费点来自目录 `point` 字段（区间值），只做**量级预估**，不承诺实扣。

| 档位 | 模型（快照计费点） |
|---|---|
| 图 · 极低 | `insight/z-image-turbo` 10-35、`insight/qwen-2512` 10-35、`gpt-image-2` 13-895（低段）、`gpt-image-2.5-*` 17-1315（低段） |
| 图 · 中 | `doubao-seedream-5-0-260128` 22、`doubao-seedream-4-5-251128` 24、`gemini-2.5-flash-image` 27、`recraftv4_1-*` 35、`gemini-3.1-flash-image-preview` 52-199、`doubao-seedream-5-0-pro-260628` 71、`gemini-3-pro-image-preview` 95-164 |
| 图 · 高 | `mj-v7`/`niji-v7` 148、`mj-v8.2` 175、`recraftv4_1_pro_vector-*` 270 |
| 视频 · 低 | `viduq2-pro` 27-539、`viduq3-turbo-*` 29-332、`viduq3` 48-604、`doubao-seedance-1-5-pro-251215` 51-836、`viduq2-turbo` 30-463、`wan3.0-r2v` 60-3600（低段） |
| 视频 · 中 | `MiniMax-Hailuo-2.3-Fast` 113-192、`MiniMax-H3-Fast-*` 132-495、`MiniMax-Hailuo-2.3`/`-02` 170-340、`MiniMax-H3-Max-*` 165-750、`kling-v3-omni` 240-1500、`Hailuo-01` 500 |
| 视频 · 高 | `wan2.7-*` 350-1650、`kling-v3` 300-1800、`seedance-2.0*` 500-1500、`veo-3.1-fast` 422-844、`veo-3.1` 1125-2250、`seedance-2.5-vip-*` 336-13500 |

**估算写法**（写进计划的 `estimate.points`）：取「首选模型区间 × 节点数」。例：3 张 `gemini-3-pro-image-preview` 3:4 2K ≈ 3 × 95-164 = 285-492 点；1 条 `seedance-2.5-vip-r2v` 9:16 480p 15s 走低段 ≈ 336-500 点。**区间大的模型（如 gpt-image-2 13-895）不要给单点值**。

### 5.3 数量闸门

| 闸门 | 阈值 | 触发行为 |
|---|---|---|
| 图片 | 同一真实需求累计 **> 30 张** | 必须经官方确认，否则 `CONFIRMATION_UNAVAILABLE`；**不能靠拆批绕过** |
| 视频 | 同一真实需求累计 **> 6 条** | 同上 |

计划里 `estimate.needsConfirmation` 在 `images>30` 或 `videos>6` 时必须为 `true`。注意统计口径是「同一真实需求累计」，不是「单次调用」——分批多次提交也照累计算。

---

## 6. 不开放项（不要尝试，也不要承诺）

| 项 | 状态 | 依据 |
|---|---|---|
| `cameraControl`（`camera` / `shot` / `aperture` / `focalLength`） | **高级嵌套参数，工具层不开放**；模板里 63 个节点写着同一组值（Sony Venice / Zeiss Ultra Prime / f/4 / 50mm），那是画布 UI 侧的历史数据 | `parameterValues` 明确「不支持高级嵌套参数」；只能用户在画布 UI 设置 |
| 文本节点模型（9 个 LLM） | agent **不能配**：`changes.params.model` → `INVALID_ARGUMENT`；`configure` → `UNSUPPORTED_NODE` | 模型选择只能用户在画布 UI 完成，技能把选型建议作为交付物给用户（见 §8 与 `references/text-node-prompting.md`） |
| 文本节点运行 | **不能**：`canvas_run` → `UNSUPPORTED_NODE`（公开生成只支持普通 image/video/TTS audio） | 文本节点的生成必须用户在画布点击；写成 `manualSteps` |
| 音乐/翻唱（`music_cover`）与音色克隆 | **不在公开运行范围**：`canvas_run` 只支持 TTS 音频节点；克隆无工具入口 | 需要时如实说明边界，不建无法运行的节点 |
| 工具节点（`multiViewTool`、`highDefinitionTool`、`storyboardTool` 等 16 种） | **建不了**；模板 A9 的 `qwen-image-edit-2511-multiple-angles`（`horizontalAngle/verticalAngle/zoom`）无法复现 | agent 只能 `add` text / image / video / audio |
| `group` 节点 | 建不了；template 里 11/81 用 group，其余靠坐标成列 | 同上 |
| 模板实例化、整图调度、复制节点、画布重命名 | 桥接层没有这些接口 | 只能 ops add + 逐边 add + 批量 run；排版用 `canvas_layout` |

---

## 7. 文本模型选型（交付给用户，agent 不能配）

**硬约束**：文本节点模型只能在画布 UI 选（`changes.params.model` → `INVALID_ARGUMENT`；`configure` → `UNSUPPORTED_NODE`），文本节点也不能被 `canvas_run`。所以技能必须把「建议模型 + 理由 + 备选」写进交付说明。

目录共 9 个文本模型（按目录 `sort` 排序）：

| 模型 value | 展示名 | 目录自带描述 | 可用参数 |
|---|---|---|---|
| `gemini-3.1-pro-preview` | Gemini-3.1-Pro | 顶流大模型，多模态全能王 | `search_resource`（联网检索，开关，默认 False） |
| `gemini-3.1-flash-lite-preview` | Gemini-3.1-Flash | 顶流大模型，多模态全能王 | `search_resource` |
| `gemini-2.5-pro` | Gemini-2.5-Pro | 顶流大模型，多模态全能王 | `search_resource` |
| `gemini-2.5-flash` | Gemini-2.5-Flash | 顶流大模型，多模态全能王 | `search_resource` |
| `doubao-seed-2-0-pro-260215` | Doubao-2.0 | 日常创作、文案灵感秒上手 | `search_resource` |
| `qwen3.5-plus` | Qwen-3.5 | 长文本稳，内容生成不跑偏 | `search_resource` |
| `qwen3.7-max` | Qwen-3.7 Max | 长文本稳，内容生成不跑偏 | `search_resource` |
| `deepseek-v3.2` | DeepSeek-3.2 | 代码 & 推理双强，专业向高手 | —（无额外参数） |
| `deepseek-v4` | DeepSeek-V4 | 代码 & 推理双强，专业向高手 | —（无额外参数） |

| 任务类型 | 建议模型 | 备选 | 理由 |
|---|---|---|---|
| 看图后写画面描述（裂变套图、多角度、按参考图发散） | `gemini-3.1-pro-preview` | `gemini-2.5-pro` | 需要「看参考图1」再视觉推理；它既是原生默认，也是新代模板的统一选择（8/8） |
| 强结构化输出（固定锚点分段、JSON 分镜） | `gemini-3.1-pro-preview` | `deepseek-v4` | 锚点契约靠格式服从度；`tpl_82`（3×3 宫格 JSON 分镜，指令 4398 字）属此类 |
| 长文案 / 卖点长文 / 详情页 | `qwen3.7-max` | `qwen3.5-plus` | 目录描述即「长文本稳，内容生成不跑偏」 |
| 多风格文案 fan-out | `doubao-seed-2-0-pro-260215` | `qwen3.5-plus` | 「日常创作、文案灵感秒上手」；`tpl_11` 是 5 个文案节点并行 |
| 口播脚本 / 分镜脚本（产出再喂视频节点） | `gemini-3.1-pro-preview` | `qwen3.7-max` | 要兼顾镜头语言与节奏；下游视频 prompt 上限紧（`veo-3.1*` 仅 1000 字） |
| 图→文反推（风格/调性/卖点识别） | `gemini-3.1-pro-preview` | `gemini-2.5-pro` | `tpl_20`/`tpl_23`/`tpl_32` 的「反推设计调性」都需读图 |
| 更快更省（只做格式转换） | `gemini-3.1-flash-lite-preview` | `gemini-2.5-flash` | Flash 档 |
| 要联网检索 | Gemini/Qwen/Doubao 系 + 打开 `search_resource` | — | 7 个模型有此开关；81 条模板里 2 个写到该字段的节点全是 `false`，无先例，首次用要主动提示用户 |

**交付话术**（三句，写进最终说明，不要贴技术表格）：

> ① 画布里的「灵感生成」是文本节点，模型需要你在画布上选一次；
> ② 建议选 **Gemini-3.1-Pro**（要读参考图再写 4 段画面描述，多模态最稳）；如果只是把已有文案改写成 4 个版本，选 **Doubao-2.0** 更快；长文案建议 **Qwen-3.7 Max**；
> ③ 选好后点一次「生成」，产物落在这个节点的正文里，再运行下游出图节点。

---

## 8. 常见配置错误对照表（写错→写对）

| 错误写法 | 报错/后果 | 正确写法 |
|---|---|---|
| `params: {"model": "gemini-3-pro-image-preview"}` | `INVALID_ARGUMENT`（params 不能含 model） | 用 `configuration: {"modelType": "...", "model": "..."}` |
| `changes: {"params": {"times": 4}}` | 「参数 times 不在当前模型允许的选项中」 | `{"gen_count": 4}`（但优先多节点 fan-out） |
| `{"image_size": "2K"}` / `{"ratio": "3:4"}` | 旧名报错 | `{"resolution": "2K"}` / `{"aspect_ratio": "3:4"}` |
| 给 `gemini-3-pro-image-preview` 写 `quality: "high"` | 该模型无 `quality` 参数 | 去掉；只有 `gpt-image-2*` 有 `quality` |
| 给 `wan3.0-r2v` 写 `aspect_ratio` | i2v/fl2v 位次无此参数（r2v 有） | 先 `canvas_models` 确认；i2v 由参考图定比例 |
| 给 `mj-v8.2` 写 `gen_count: 1` | 枚举只有 `4` | 去掉该参数（用默认 4），或换模型 |
| 给文本节点写 `params.model` | `INVALID_ARGUMENT`，或对文本节点 `configure` → `UNSUPPORTED_NODE` | 不写；把选型建议交给用户（§7） |
| 把文本节点放进 `runs` | `UNSUPPORTED_NODE` | `runs` 只放 image/video/TTS audio；文本节点写 `manualSteps` |
| 把上传/导入节点当作生成目标 `canvas_run` | 「不是上传原图或工具产物」 | 只 run 普通 image/video/TTS audio 生成节点 |
| 0 图入边却配 `reference_image_to_image` / `reference_image_to_video` | 依赖不满足/门禁 warning | 按 §2 表选模式，或先补图入边 |
| 给 audio 节点写 `params.voiceId` | `INVALID_ARGUMENT`（voiceId 不在标量参数里） | 用 `configure.voiceId` 与 `configure.seniorParams` |
| 不选音色就 run TTS | 预检失败/音色缺失 | 先 `canvas_models(view:"voices")` 拿真实 `voiceId` |
| `cameraControl: {...}` | 高级嵌套参数不开放 | 不写；需要时让用户在画布 UI 设置 |

---

## 9. 参数合法性自查清单（与 `scripts/validate_plan.py` 对齐）

配置前逐条过一遍；任何一条不过就不要写：

1. `modelType` / `model` / 每个 `params` 键值，**都来自同一次 `canvas_models` 返回**（同一 `catalogVersion`），不是来自记忆或本文快照。
2. 参数名是新名：`gen_count` / `resolution` / `aspect_ratio` / `duration`；没有 `times` / `image_size` / `size` / `ratio` / `seconds`。
3. `params` 里没有 `model` / `modelType` / `prompt`。
4. 没有嵌套对象参数（`cameraControl`、`seniorParams` 一律不写）。
5. 值的**类型**正确：`gen_count` / `duration` / 开关是数字或布尔，不是字符串 `"4"`。
6. 值在该模型该模式的枚举内：例如 `quality` 只给 `gpt-image-2*`；`aspect_ratio` 不给 `wan3.0-i2v`；`resolution` 不给 `gemini-2.5-flash-image`；`gen_count=1` 不给 `mj-v8.2`。
7. 提示词长度 ≤ 该模型 `maxPrompt`（快照里 `doubao-seedream-5-0-260128` / `-4-5-251128` 是 1000 字、`veo-3.1*` 是 1000 字、`suno-music-v5_5` 是 500 字，是最容易踩的几个）。
8. `modelType` 与入边素材一致（§2 表）。
9. 节点类型属于可 `add` 的四种（text/image/video/audio），没有试图创建 group 或工具节点。
10. 每条边端口与素材种类匹配：图 → `image_source`，文本 → `text_source`，视频 → `video_source`；目标 `text_target` / `image_target` / `video_target` / `audio_target` 按「送进去的是什么」选（image 与 video 节点同时有 `image_target` 和 `text_target`）。
11. `estimate.images` / `estimate.videos` 按真实产物数填，> 阈值时 `needsConfirmation: true`。
12. `runs` 只含 image/video/**TTS audio** 生成节点，顺序为拓扑序，且每个节点上游已有产物；纯文本 LLM 节点不在 `runs` 里，写进 `manualSteps`。
13. TTS 节点已给 `voiceId`（`voiceSelection.required`），`seniorParams` 字段/范围来自 `seniorParamHints`；导入音频当素材，不当生成节点。
