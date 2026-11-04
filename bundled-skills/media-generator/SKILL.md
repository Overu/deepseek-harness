---
name: media-generator
description: 多媒体内容生成技能：文生图、图生图、图像编辑、文生视频、图生视频、首尾帧/参考图生视频、文生音频(TTS)、音色克隆、文生音乐、音频参考、文本对话、文档/图片/视频解析、文生PPT、文档生PPT。当用户需要生成图片、生成视频、做PPT、生成音乐、文字转语音、克隆音色、或解析图片/视频/文档内容时使用。
---

# Media Generator 技能

基于内部多模型聚合网关（Media Generator API），统一接入即梦/Seedance、可灵 Kling、Nano Banana、GPT-Image、MJ、Flux、Qwen、MiniMax、Veo、Vidu、Wan、LTX、HappyHorse、Grok、Recraft、Suno 等十余家模型，通过一个签名鉴权接口完成生图、生视频、生音频、生音乐、生 PPT 等 18 种任务。

> ## ⚠️ 网关区分（2026-09-03 实测，务必遵守）
> 本技能通过后台代理访问 **Media Generator 网关 `http://59.37.128.50:52667/v1/proxy`**。它与 **Insight API Manager 网关（52867）是两个不同的服务**，模型目录不通用。
> - 本手册/技能**仅收录媒体网关(52667)实测可用的模型**；属于 API Manager(52867) 专属的模型（Seedance-VIP、Seedance-2.0-VIP、MiniMax-H3、Vidu Q3、MiniMax-Hailuo-2.3-Fast、HappyHorse-1.0、Wan-2.6 参考等）已从媒体网关文档中剔除。不能通过本技能调用这些模型，也不要切换为厂商直连；请说明当前不支持，并与用户确认可用的替代模型。
> - 媒体网关(52667) 实测可用的新增模型：即梦5.0 Pro、Recraft v4.1(文生图)、Grok Video、HappyHorse-1.1、Wan-2.7、Insight LTX-2.3、Suno 音乐。

## 企业版网络边界

`<skill>` 是技能加载时返回的实际目录。所有模型请求通过 `scripts/enterprise_proxy.mjs` 的本地插件桥接和后台 `media-generator` 连接执行；不直接请求下面提到的上游地址。`DSH_HOME` 和 `DSH_SKILL_PROXY_NODE`（内置 Node.js 绝对路径）由插件提供，用户需先登录；不得读取 Token 或厂商凭据。后台生成真实用户的 biz_info。旧网关目录差异仍保留。

代理请求本身不需要 Python。`generate.py` 的业务参数组装仍需要 Python，`scripts/enterprise_proxy.py` 仅是调用 JavaScript 的兼容层，不自行发 HTTP。运行环境缺少 Python 时，可按本文的 JSON 协议用 `"$DSH_SKILL_PROXY_NODE" "<skill>/scripts/enterprise_proxy.mjs" media-generator POST /v1/proxy --body-file request.json`；无需读取任何 Key。

## 调用方式

通过 shell 执行 `generate.py`（或 `run.sh`），传入 task_type + prompt，可选参数用 `--xxx`：

```bash
python3 <skill>/generate.py <task_type> "<prompt>" [options]
```

返回 JSON：`code=0` 且 `status=success` 为成功，结果 URL 在 `data.image_list` / `data.video_list` / `data.audio_list` / `data.file_list`（当前脚本等待同步响应；服务端返回 running 时不要当作成功，也不要重复生成）。

## 支持的 task_type

| task_type | 说明 | 默认模型 |
|---|---|---|
| `text_to_image` | 文生图 | doubao-seedream-5-0-260128（即梦5.0） |
| `reference_image_to_image` | 参考图生图 | 同上 |
| `image_to_image` | 图生图 | 同上 |
| `image_editing` | 图像编辑 | 同上 |
| `text_to_video` | 文生视频 | seedance-2.0（即梦视频2.0） |
| `image_to_video` | 图生视频 | 同上 |
| `reference_image_to_video` | 参考图生视频 | 同上 |
| `first_last_frame_to_video` | 首尾帧生视频 | 同上 |
| `text_to_speech` | 文生音频 TTS | speech-2.8-hd |
| `voice_cloning` | 音色克隆 | speech-2.8-hd |
| `text_to_audio` | 文生音乐 | suno-music-v5_5 |
| `audio_to_audio` | 音频参考（风格迁移） | suno-music-v5_5 |
| `text_chat` | 文本对话 | gemini-3.1-pro-preview |
| `text_parsing` | 文档解析 | 同上 |
| `video_parsing` | 视频内容解析 | 同上 |
| `image_parsing` | 图片内容解析 | 同上 |
| `text_to_ppt` | 文生 PPT | 同上 |
| `file_to_ppt` | 文档生 PPT | 同上 |

## CLI 选项

| 选项 | 说明 |
|---|---|
| `--model <id>` | 指定模型 ID（默认按任务类型自动选） |
| `--resolution <值>` | 图片 `1K/2K/4K`；视频 `720p/1080p/2K/4K`（按模型） |
| `--aspect-ratio <值>` | `1:1` / `16:9` / `9:16` / `3:4` / `4:3` / `21:9` 等 |
| `--duration <秒>` | 视频时长（按模型，默认 4~5） |
| `--mime-type <值>` | 图片格式 `JPEG`/`PNG`（默认 PNG） |
| `--quality <值>` | 图片质量档 `low/medium/high`（默认 medium） |
| `--gen-count <n>` | 生成数量 `1/2/4`（按模型支持） |
| `--enable-audio` | 视频/音乐开启音频（布尔，映射 `enableAudio`） |
| `--image-url <url>` | 参考图 URL（图生图/图生视频/首尾帧，可逗号分隔多张） |
| `--video-url <url>` | 源视频 URL（音频参考/视频处理） |
| `--audio-url <url>` | 源音频 URL（音频参考） |
| `--voice-url <url>` | 音色参考 URL（音色克隆） |
| `--voice-id <id>` | TTS 音色 ID（如 `Chinese (Mandarin)_Warm_Girl`） |
| `--param K=V` | 直接写入对应 params 对象（image/video/audio/chat_params）的任意参数，可重复 |
| `--timeout <秒>` | 本地等待上限（默认 1250 秒） |

`--param` 能传任意模型参数，例如 `--param cameraControl='{"enable":true,"camera":"Sony Venice"}'`、`--param emotion=happy`、`--param instrumental=false`。

## 模型选择要点

常用模型 ID（完整映射见 `MODEL_NAME_MAPPING.md`，参数见 `MODEL_PARAMS.md`）：

- **快速日常生图**：`gemini-3.1-flash-image-preview`（Nano Banana 2，风格广、快）
- **最强生图**：`gemini-3-pro-image-preview`（Nano Banana Pro）
- **中文理解好**：`doubao-seedream-5-0-260128`（即梦5.0，默认）
- **印刷/商业定稿**：`recraftv4_1-t2i`（✅ 实测可用）
- **视频（音画同步）**：`kling-v3-omni`（可灵 3.0 omni）
- **视频（中文指令）**：`doubao-seedance-1-5-pro-251215`（✅ 实测可用）
- **长视频/4K**：`ltx-2.3`（唯一支持 4K，prompt 最长 5000 字符；`insight/ltx-2.3-t2v` ✅ 实测可用）
- **推理/运镜视频**：`happyhorse-1.1-t2v`、`grok-imagine-video`、`wan2.7-t2v-2026-04-25`（✅ 实测可用）
- **TTS**：`speech-2.8-hd`（高质）/ `speech-2.8-turbo`（快速）（✅ 实测可用）
- **音乐**：`suno-music-v5_5`（文生音乐/音频参考，✅ 实测可用）

> ⚠️ API Manager(52867) 专属模型（Seedance-VIP、MiniMax-H3、Vidu Q3 等）不属于本技能的可用模型，请勿跨网关套用模型目录。

## 关键约束（必须遵守）

1. **model_id 必须用模型 ID**，不能用自然语言名——"香蕉2"要写 `gemini-3.1-flash-image-preview`，"可灵omni"要写 `kling-v3-omni`。拿不准就查 `MODEL_NAME_MAPPING.md`。
2. **图片尺寸下限**：即梦/豆包系生图要求至少 1920×1920 像素，用 `--resolution 2K`（不要用 1024 之类的过小值）。
3. **视频耗时**：较重视频或排队可能耗时数分钟。脚本默认等待 1250 秒，企业代理通过心跳保持等待；可按宿主能力后台执行。超时后不要重复生成或自动切换模型，先确认上游任务状态。
4. **网络代理**：本地桥接客户端已禁用系统代理，只连接 127.0.0.1；不需要修改系统网络配置。
5. **text_chat 已知问题**：该网关的文本对话模型转发 Google 时服务端有 aiohttp 版本 bug（返回 `ClientConnectorDNSError`），对话类需求不要走这里，用 DSH 自带模型。
6. **签名与 biz_info**：统一由后台生成，本地脚本不保存 AK/SK。
7. **失败处理**：不自动重试付费请求；超时/断连可能已被上游接受。联系管理员排查，不切换为厂商直连。
8. **首尾帧/图生图需要源图 URL**：`first_last_frame_to_video` 需两个 `--image-url`（首帧+末帧，按序）；`image_to_video`/`reference_image_to_video`/`image_to_image` 至少一个 `--image-url`。
9. **媒体网关参数契约（2026-09-03 实测）+ 脚本已内置默认**：
   - **TTS**（`speech-2.8-*`）需显式给出 `voice_id`、`language`、`emotion`、`volume`、`intonation`、`speed`；字段名是 `language`/`volume`/`intonation`（**不是** API Manager 的 `language_boost`/`vol`/`pitch`）。脚本已注入默认值，无需手动传。
   - **音乐**（`suno-music-v5_5`）需显式 `customMode`，脚本已注入（默认 True）。`--param` 传 `instrumental`/`vocalGender`/`styleWeight` 可直接覆盖。
   - 这些默认值已内置在 `generate.py`，直接跑即可（`text_to_speech`/`text_to_audio` 无需手动带参）。

## 示例

```bash
# 文生图（2K，方形）
python3 <skill>/generate.py text_to_image "一只戴领结的柴犬，白色背景，卡通风格" --resolution 2K --aspect-ratio 1:1 --mime-type JPEG

# 文生图（指定模型 + 摄影参数 + 生成2张）
python3 <skill>/generate.py text_to_image "城堡日落" --model gemini-3.1-flash-image-preview --gen-count 2 --param cameraControl='{"enable":true,"camera":"Sony Venice","shot":"Zeiss Ultra Prime"}'

# 文生视频（720p，5 秒，开启音频）
python3 <skill>/generate.py text_to_video "一朵花在微风中轻轻摇曳，特写镜头，柔和光线" --duration 5 --enable-audio

# 图生视频（用参考图 URL）
python3 <skill>/generate.py image_to_video "镜头缓慢推进，主体保持不动" --image-url "<图片URL>" --duration 5

# 首尾帧生视频（两个图 URL）
python3 <skill>/generate.py first_last_frame_to_video "静物转场" --image-url "<首帧URL>,<末帧URL>"

# 文生音频 TTS（指定音色 + 情绪 + 语速）
python3 <skill>/generate.py text_to_speech "欢迎收听本次分享" --model speech-2.8-hd --voice-id "Chinese (Mandarin)_Warm_Girl" --param emotion=happy --param speed=1.2

# 文生音乐
python3 <skill>/generate.py text_to_audio "轻快民谣，木吉他" --model suno-music-v5_5 --param instrumental=false --param vocalGender=m

# 文生 PPT
python3 <skill>/generate.py text_to_ppt "人工智能发展趋势报告"

# 图片内容解析
python3 <skill>/generate.py image_parsing "" --image-url "<图片URL>"
```

生成结果 URL 到手后，用 web 能力或 curl 下载到本地供后续使用。
