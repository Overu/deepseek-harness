# 素材导入（文本 / 图片 / 视频 / 音频）

这份文档解决「用户给的文本、图、视频、音频，会话里生成的素材，画布上已有的产物，本地工作区文件，
怎么变成画布里能参与生成的节点」，以及「为什么不能拿本地路径、附件 ID 去连线」。
读到它的时候，你应该是**手里有素材但节点上没有 URL**，或者**准备把素材接进下游生成节点**。

证据口径：`[源码]` = `@insight-ai/desktop-canvas-plugin@0.3.0-alpha.31` 的 `lib/index.js`
（`canvas-asset-tools.ts` / `asset-resolver.ts` / `canvas-media.ts`）；`[实测]` = 本机画布 103577 / 103582。

---

## 1. 铁律：连线只能用节点上真实的 OSS URL

```
可作连线依据的 URL 只来自两处：
  canvas_get(view:"nodes") 的 outputs[]        （生成/上传产物）
  node.data.value / node.data.product[].value  （原生存储）
```

**一律不得作为连线依据**：

| 不是连线依据 | 为什么 |
|---|---|
| 本地路径 `/Users/.../a.png`、`./out.mp4` | 画布后端读不到你机器上的文件（要走 import 的 `workspace_file` 分支） |
| 附件 ID（`attachmentId`） | 只在 Harness 会话里有效，画布不认识 |
| `assetRef`（`conversation-image-<64hex>` 等） | 是**导入句柄**，只能喂给 `canvas_asset_import` |
| 文件名、标题 | 纯展示文本 |
| 自己拼的 URL / 猜测的 OSS 地址 | 直接失败且可能污染画布 |

正确顺序：**先让素材变成节点（`canvas_asset_import`），再用节点 `outputs` 连线**。

---

## 2. 四类来源 → 四类素材

公共前置：`canvasId`、`expectedVersion`（当前 confirmed 版本）；`canvas_assets` 先发现来源。

| 来源 | 适用素材 | `source` 形态 | 关键约束 |
|---|---|---|---|
| 用户附件 | text/image/video/audio | `{type:"attachment", attachmentId}` | 必须是当前可见用户消息的附件；否则 `ASSET_NOT_FOUND` |
| 会话生成 | image/video/audio | `{type:"conversation_asset", assetRef}` | `assetRef` 形如 `conversation-(image\|video\|audio)-<64hex>`；必须本会话可解析 |
| 画布节点 | text/image/video/audio | `{type:"canvas_node", canvasId, nodeId, outputIndex?}` | 源节点可为 text/image/video/audio；多产物必须给 `outputIndex`（0–19） |
| 工作区文件 | text/image/video/audio | `{type:"workspace_file", path}` | 必须是**当前会话工作区内**的普通文件；路径 ≤4096 字符 |

媒体限制 `[源码]`：

| 类型 | 上限 | 支持格式 |
|---|---|---|
| 文本 | 128 KiB、正文 ≤32768 字符 | `.txt` / `.md`（允许 BOM） |
| 图片 | 20 MiB | PNG / JPEG / GIF / WebP |
| 音频 | 20 MiB | MP3 / WAV / M4A / AAC |
| 视频 | 200 MiB、≤300 秒 | MP4 / MOV / WebM |

按**内容/轨道**校验，不是按扩展名；损坏、二进制文案、超限、变化中的文件会被拒绝（`ASSET_VALIDATION_REJECTED`），
不静默截断或转码。带配音视频保留原始音轨。四类导入都不依赖生成模型服务。

---

## 3. 操作链与回执

### 3.1 标准四步
```
1. canvas_assets(mediaType?, sourceType?)      ← 先发现；不要先问用户
2. 选唯一明确来源（多份无法判断才问，一次一问）
3. canvas_asset_import(source, placement?, title?)
4. canvas_get(view:"nodes", nodeIds:[新节点])   ← 读回真实 ID 与 outputs
```
- 文本导入 → **text 节点**（正文进 `text`，可直接作为下游文本输入）。
- 图片/视频/音频 → 对应类型的 **upload 节点**（`contentType:"upload"`）。
- 上传节点**只允许改标题或删除**；不能 `configure`、不能当生成目标 `canvas_run`。

### 3.2 回执三层
| 层 | 字段 | 含义 |
|---|---|---|
| 节点保存 | `status:"saved"` + `affectedNodeIds[0]` | 节点已进画布（正常长度 1） |
| 素材上传 | `asset.status` = `uploaded`/`reused` + `asset.url` | 本次真上传 / 同账号同会话同内容缓存复用 |
| 素材入库 | `assetRegistration.status` = `registered`/`rejected`/`not_applicable`（文本） | 入库失败**不回滚节点** |

- `needs_input`：源节点多产物且未给 `outputIndex`，`missing:["source.outputIndex"]`、`outputCount:N`。补参数重调，不是失败。
- `upload_unknown`：不重传；节点是否已建以 `canvas_get` 为准；同来源重导会复用已确认上传。
- `submission_unknown`（phase `save`）：读回核对，不重复新增。

### 3.3 `workspace_file` 的边界
- 只读**当前会话工作区**内的文件；工作区外的文件先用文件工具复制进来再导入。
- 不要为发现素材去全盘扫描、隐式下载或探测 Host 路径；插件使用公开文件接口。
- 本机已安装文件（如生成的成片/文案）用它最省事：`{type:"workspace_file", path:"out/poster.jpg"}`。

---

## 4. 「用刚才那张图 / 那段视频」的标准动作

```
1. canvas_assets() / canvas_assets(mediaType:"video")
2. 判断：
   - 唯一明确的最近生成素材 → 取 assetRef，`conversation_asset` 导入
   - 用户附件           → 取 attachmentId，`attachment` 导入
   - 画布已有产物       → `canvas_node` 复用（跨画布也可，源画布只读）
   - 工作区文件         → `workspace_file` 导入
   - 都没有             → 如实说明"当前对话未找到可确认的素材来源"，不编造
3. canvas_asset_import(...)
4. canvas_get(view:"nodes") 读回真实 node id 与 outputs
5. canvas_edges(add, connection:{sourceNodeId, targetNodeId})
```

多份素材无法判断时必须问，不要猜；用户选了之后直接导入，不要让用户重传、重生成。

**绝不做的三件事**：编造 URL/assetRef；拿别的素材顶替用户指代的素材；看到 `generatedSourceError` 就换来源交差。

---

## 5. 视频 / 音频：已可直接导入

alpha.30 起 `canvas_asset_import` 支持视频与音频（附件、会话生成、画布节点、工作区文件四种来源），
不再需要"用户在画布 UI 手动上传"。

| 场景 | 做法 |
|---|---|
| 用户发来参考视频/音频 | `canvas_assets(mediaType:"video"/"audio")` → `attachment` 导入 → 读回 → 连 `video_source→video_target` / `audio_source→...` |
| 会话里生成的视频/音频 | `conversation_asset` + `assetRef`（`conversation-video-...` / `conversation-audio-...`） |
| 画布已有视频/音频 | 同画布可直接连线复用；要变成独立输入节点才 `canvas_node` 导入 |
| 本地成片 | `workspace_file`（≤200 MiB、≤300 秒） |
| 把文案念出来（TTS） | **不是导入**：建 `audio` 节点 → `configure` TTS → `canvas_run`（见 `archetypes.md` §A8） |

导入的音频是**素材**，不能当 TTS 生成节点运行；`canvas_run` 只运行普通 image/video/TTS audio 节点。

---

## 6. 一页速查

| 我手上有什么 | 走哪条路 | 第一步 |
|---|---|---|
| 用户刚发的图/视频/音频/文本 | `attachment` | `canvas_assets()` → 取 `source` |
| 会话里刚生成的图/视频/音频 | `conversation_asset` | `canvas_assets()` → 取 `assetRef` |
| 画布上某节点的产物 | `canvas_node` | `canvas_get(view:"nodes")` → `id` + `outputs` |
| 工作区里的文件 | `workspace_file` | 确认 path 在工作区内 |
| 外部 URL | **不可用** | 先落到工作区/会话附件，再导入 |
| 待朗读的文案 | 建 audio 节点（TTS） | `canvas_models(nodeType:"audio")` |

导入后固定收尾：`canvas_get` 读回真实节点 ID 与 `outputs` → `canvas_edges` → 依赖就绪后 `canvas_run`。
