# Media Generator 模型参数全览

**数据来源：** 媒体网关（`59.37.128.50:52667/v1/proxy`）+ 实测校准  
**更新时间：** 2026-09-03（v3.0，仅保留媒体网关实测可用模型）  
**用途：** Media Generator Skill 模型选择参考。

> **✅ 本手册只列媒体网关(52667)实测可用的模型。** 媒体网关与 Insight API Manager 网关（52867）是**两个不同服务**；属于 API Manager 专属的模型（Seedance-VIP、Seedance-2.0-VIP、MiniMax-H3、Vidu Q3、MiniMax-Hailuo-2.3-Fast 等）已从本手册剔除。本技能不支持这些模型，请与用户确认可用的替代模型，不切换为厂商直连。

**参数名约定：** CLI 用 `--resolution/--aspect-ratio/--duration/--gen-count/--enable-audio/--voice-id/--param K=V`；脚本内部转成媒体网关契约名。**注意：** 媒体网关 TTS 字段名是 `voice_id`/`language`/`emotion`/`volume`/`intonation`/`speed`（**非** API Manager 的 `language_boost`/`vol`/`pitch`）。`--param` 可传任意模型参数写入 `image_params`/`video_params`/`audio_params`/`chat_params`。

---

## 📸 图像模型（文生图 text_to_image / 图生图 reference_image_to_image）

| 模型 ID | 名称 | 分辨率 | 宽高比 | 其它参数 | 备注 |
|---|---|---|---|---|---|
| `gpt-image-2` | GPT Image 2 | 1K/2K/4K (默认1K) | 1:1/16:9/9:16/2:3/3:2/3:4/4:3/4:5/5:4/21:9/9:21 (默认16:9) | quality(low/medium/high 默认medium)、gen_count(1/2/4) | 新一代旗舰 |
| `gemini-3.1-flash-image-preview` | Nano Banana 2 | 1K/2K/4K (默认1K) | 1:1(默认)/16:9/9:16/4:1/1:4/8:1/1:8/2:3/3:2/3:4/4:3/4:5/5:4/21:9 | cameraControl(set)、gen_count(1/2/4) | ⭐ 通用首选 |
| `gemini-3-pro-image-preview` | Nano Banana Pro | 1K/2K/4K (默认1K) | 16:9(默认)/1:1/9:16/2:3/3:2/3:4/4:3/4:5/5:4/21:9 | cameraControl、gen_count | ⭐ 最强 |
| `gemini-2.5-flash-image` | Nano Banana | 无分辨率 | 16:9(默认)/1:1/9:16/2:3/3:2/3:4/4:3/4:5/5:4/21:9 | cameraControl、gen_count | 改图修图 |
| `doubao-seedream-5-0-pro-260628` | 即梦5.0 Pro | 1K/2K (默认2K) | 16:9(默认)/1:1/9:16/2:3/3:2/3:4/4:3/4:5/5:4/21:9 | cameraControl、gen_count | ✅ 实测可用 |
| `doubao-seedream-5-0-260128` | 即梦 5.0 | 2K/3K (默认2K) | 16:9(默认)/1:1/9:16/2:3/3:2/3:4/4:3/4:5/5:4/21:9 | cameraControl、gen_count | 默认图像模型 |
| `doubao-seedream-4-5-251128` | 即梦 4.5 | 2K/4K (默认2K) | 16:9(默认)/1:1/9:16/2:3/3:2/3:4/4:3/4:5/5:4/21:9 | cameraControl、gen_count | 中文超懂 |
| `mj-v7` | MJ v8 | 无 | 16:9(默认)/1:1/9:16/2:3/3:2/3:4/4:3/4:5/5:4/21:9 | gen_count(固定4) | 经典审美 |
| `niji-v7` | MJ-Niji v7 | 无 | 同上 | gen_count(固定4) | 二次元专属 |
| `flux-2-klein-9b` | Flux 2 | 1K/2K/4K (默认1K) | 16:9(默认)/1:1/9:16/2:3/3:2/3:4/4:3/4:5/5:4/21:9 | gen_count | 质感高级 |
| `recraftv4_1-t2i` | Recraft v4.1 | 1K (默认1K) | 1:1(默认)/10:14/14:10/16:9/1:2/2:1/2:3/3:2/3:4/4:3/4:5/5:4/6:10/9:16 | gen_count | ✅ 实测可用，印刷/商业定稿 |
| `insight/qwen-2512` | Insight Qwen Image | 1K/2K/4K (默认1K) | 16:9(默认)/1:1/9:16/2:3/3:2/3:4/4:3/4:5/5:4/21:9 | gen_count(固定1) | 原名 qwen-image-2512，国产之光 |

### cameraControl（仅部分生图模型支持）
`--param` 传入 dict，典型：`cameraControl={"enable":true,"camera":"Sony Venice","shot":"Zeiss Ultra Prime","aperture":"f/4","focalLength":"50mm"}`
- **camera**：Sony Venice / Arri Alexa 35 / Arri Alexa 65 / Red V-Raptor 猛禽 / Panavision DXL2 / Arricam LT / ArriFlex 435 / IMAX Keighley / IMAX Film Camera（默认 Sony Venice）
- **shot**：Zeiss Ultra Prime / Arri Signature Prime / Canon K-35 / Cooke S4 / Cooke Panchro / Cooke SF 1.8x / Helios / Panavision C-series / Panavision Primo / Hawk Class X（默认 Zeiss Ultra Prime）
- **aperture**：f/1.4 / f/4 / f/11（默认 f/4）
- **focalLength**：8/14/24/35/50/85/135mm（默认 50mm）

---

## 🎬 视频模型

### 文生视频（text_to_video）

| 模型 ID | 名称 | 分辨率 | 宽高比 | 时长(秒) | 其它 | 备注 |
|---|---|---|---|---|---|---|
| `seedance-2.0` | Seedance-2.0 | 720p(默认)/1080p | 16:9(默认)/1:1/9:16/21:9/3:4/4:3/adaptive | 4-15 (默认5) | gen_count(1) | ⭐ 默认视频模型 |
| `doubao-seedance-1-5-pro-251215` | Seedance-1.5 Pro | 720p/1080p | 同 seedance-2.0 | 4-12 (默认4) | enableAudio(默认false)、gen_count(1/2) | ✅ 实测可用，中文听话 |
| `grok-imagine-video` | Grok Video | 720p(默认) | 16:9/1:1/2:3/3:2/3:4/4:3/9:16 | 1-15 (默认5) | gen_count(1/2) | ✅ 实测可用，电影级 |
| `happyhorse-1.1-t2v` | Happy Horse-1.1 | 720P/1080P | 16:9/1:1/3:4/4:3/9:16 | 3-15 (默认5) | gen_count(1/2) | ✅ 实测可用，运镜/长叙事 |
| `wan2.7-t2v-2026-04-25` | Wan-2.7 | 720P/1080P | 16:9/1:1/3:4/4:3/9:16 | 5/10/15 (默认5) | gen_count(1/2) | ✅ 实测可用，影视广告 |
| `wan2.6-t2v` | Wan-2.6 | 720P/1080P | 同上 | 2-15 (默认5) | gen_count(1/2) | 15 秒长叙事 |
| `kling-v3` | kling 3.0 | 720p/1080p | 16:9/1:1/9:16 | 3-15 (默认5) | enableAudio、gen_count(1/2) | 质感一流 |
| `kling-v3-omni` | kling 3.0 omni | 720p/1080p | 同上 | 3-15 (默认5) | enableAudio、gen_count(1/2) | ⭐ 音画同步 |
| `veo-3.1-generate-preview` | Veo-3.1 | 720p/1080p | 16:9/9:16 | 4/6/8 (默认4) | gen_count(1/2) | 多语言大片 |
| `veo-3.1-fast-generate-preview` | Veo-3.1 Fast | 720p/1080p | 16:9/9:16 | 4/6/8 (默认4) | gen_count(1/2) | 极速出片 |
| `MiniMax-Hailuo-2.3` | Hailuo-2.3 | 768P(默认)/1080P | 无 | 6/10 (默认6) | gen_count(1/2) | 动作丝滑 |
| `MiniMax-Hailuo-02` | Hailuo-02 | 768P(默认)/1080P | 无 | 6/10 (默认6) | gen_count(1/2) | ⭐ 首尾帧 |
| `viduq2` | Vidu Q2 | 720p/1080p | 16:9/1:1/3:4/4:3/9:16 | 1-10 (默认5) | gen_count(1/2) | 参考主体稳 |
| `ltx-2.3` | LTX-2.3 | 1080p(默认)/1440p/2160p | 16:9/9:16 | 6/10 (默认6) | gen_count(1/2) | ⭐ 唯一 4K |
| `insight/ltx-2.3-t2v` | Insight LTX2.3 | 720p/1080p | 16:9/1:1/9:16/21:9/3:4/4:3 | 3-12 (默认4) | gen_count(1) | ✅ 实测可用，超清省 |

### 图生视频（image_to_video）— 特有/差异模型
前面多数模型在 `image_to_video` 下同样可用（部分无 aspect_ratio，仅 resolution+duration，见目录）。特有模型：
- `viduq2-pro`、`viduq2-turbo`
- `wan2.7-i2v-2026-04-25`、`wan2.6-i2v`
- `veo-3.1-*`、`ltx-2.3`（aspect_ratio 默认 auto）
- `insight/ltx-2.3-i2v`

### 首尾帧视频（first_last_frame_to_video）
支持：`seedance-2.0`、`doubao-seedance-1-5-pro-251215`、`kling-v3`/`kling-v3-omni`、`veo-3.1-*`、`wan2.7-i2v-2026-04-25`、`MiniMax-Hailuo-02`、`viduq2-pro`/`viduq2-turbo`、`ltx-2.3`。需要两个 `--image-url`（首帧+末帧，按序）。

### 参考生视频（reference_image_to_video）
`seedance-2.0`、`grok-imagine-video`、`happyhorse-1.1-r2v`、`kling-v3-omni`、`wan2.7-r2v`/`wan2.6-r2v-flash`、`S2V-01`（Hailuo-01，720P/6s）、`viduq2`。

---

## 🎵 音频模型

### 文生音频 TTS（text_to_speech）/ 音色克隆（voice_cloning）

| 模型 ID | 名称 | 参数 |
|---|---|---|
| `speech-2.8-hd` | speech-2.8-hd | voice_id（默认 Chinese (Mandarin)_News_Anchor）、language(50+ 语种，默认 auto)、emotion(angry/auto/calm/disgusted/fearful/happy/sad/surprised 默认auto)、speed(0.5-2.0)、volume(1.0-10.0)、intonation(-12~12) |
| `speech-2.8-turbo` | speech-2.8-turbo | 同 speech-2.8-hd |

**voice_id 可选（17 种）：** Arabic_FriendlyGuy、Chinese (Mandarin)_Male_Announcer、Chinese (Mandarin)_News_Anchor、Chinese (Mandarin)_Reliable_Executive、Chinese (Mandarin)_Warm_Girl、English_Graceful_Lady、English_Trustworthy_Man、French_FemaleAnchor、German_FriendlyMan、Italian_BraveHeroine、Korean_CaringWoman、Portuguese_CharmingLady、Russian_ReliableMan、Spanish_ConfidentWoman、Spanish_ReliableMan、Spanish_SophisticatedLady、Turkish_Trustworthyman

### 文生音乐（text_to_audio）/ 音频参考（audio_to_audio）

| 模型 ID | 名称 | 参数 |
|---|---|---|
| `suno-music-v5_5` | suno-music-v5_5 | customMode(True/False 默认True)、instrumental(True/False 默认True)、vocalGender(m/f 默认m)、styleWeight(0-1 默认0.65)、weirdnessConstraint(0-1 默认0.65)；audio_to_audio 另有 audioWeight(0-1 默认0.65) ✅ 实测可用 |

---

## 💡 推荐组合

| 需求 | 模型 | 理由 |
|---|---|---|
| 日常快速出图 | `gemini-3.1-flash-image-preview` | 风格广、快 |
| 高质量图像 | `gemini-3-pro-image-preview` | 最强图像 |
| 中文生图 | `doubao-seedream-5-0-260128` | 默认、中文理解好 |
| 印刷/商业定稿 | `recraftv4_1-t2i` | ✅ 实测可用 |
| 日常视频 | `kling-v3-omni` | 音画同步 |
| 中文视频 | `doubao-seedance-1-5-pro-251215` | ✅ 实测可用 |
| 运镜/推理视频 | `happyhorse-1.1-t2v`、`grok-imagine-video`、`wan2.7-t2v` | ✅ 实测可用 |
| 长视频 (>10s) / 4K | `ltx-2.3`（`insight/ltx-2.3-t2v` ✅） | 唯一 4K |
| 首尾帧转场 | `MiniMax-Hailuo-02` | 首尾帧明星 |
| 音乐 | `suno-music-v5_5` | ✅ 实测可用 |

---

**备注：** 仅收录媒体网关(52667)实测可用模型。Insight API Manager 网关(52867)专属模型不在本技能支持范围内。
