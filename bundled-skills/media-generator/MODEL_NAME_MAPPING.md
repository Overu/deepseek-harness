# 模型名称映射表（用户自然语言 → Model ID）

**用途：** 用户输入自然语言模型名称时，映射到正确的 media_id 用于 API 调用  
**更新时间：** 2026-09-03（v3.0 - 仅保留媒体网关实测可用模型）

> ⚠️ 本表只列**媒体网关(52667)实测可用**的模型。属于 API Manager(52867) 专属的模型（Seedance-VIP、MiniMax-H3、Vidu Q3、MiniMax-Hailuo-2.3-Fast、HappyHorse-1.0、Recraft Pro Vector、Insight z-image-turbo、indexTTS-2 等）已移除，本技能不支持；请与用户确认可用的替代模型，不切换为厂商直连。

---

## 📸 图像模型映射

| 常用口语 | 其他叫法 | 标准 model_id | 备注 |
|---------|----------|---------------|------|
| **香蕉 2** | 纳米香蕉 2、谷歌香蕉、Gemini 生图、NB2 | `gemini-3.1-flash-image-preview` | ⭐ 通用首选 |
| **香蕉 Pro** | 纳米香蕉 Pro、最强香蕉、NBP | `gemini-3-pro-image-preview` | ⭐ 最强 |
| **香蕉** | 纳米香蕉、香蕉一代、NB | `gemini-2.5-flash-image` | 改图修图 |
| **GPT 图 2** | GPT 生图 2、OpenAI 生图、ChatGPT 生图 | `gpt-image-2` | 新一代旗舰 |
| **即梦 5.0 Pro** | 即梦 Pro、豆包即梦 Pro | `doubao-seedream-5-0-pro-260628` | ✅ 实测可用 |
| **即梦 5.0** | 即梦、豆包即梦、DM5 | `doubao-seedream-5-0-260128` | ⭐ 默认 |
| **即梦 4.5** | 即梦旧版、即梦经典、DM4.5 | `doubao-seedream-4-5-251128` | 中文超懂 |
| **MJ8** | MJ v8、Midjourney 8、MJP | `mj-v7` | 经典审美 |
| **Niji** | Niji7、二次元 MJ、日系 MJ | `niji-v7` | 二次元专属 |
| **Flux** | FLUX2、黑森林 2、Flux Pro | `flux-2-klein-9b` | 质感高级 |
| **Recraft** | Recraft v4.1、印刷定稿图 | `recraftv4_1-t2i` | ✅ 实测可用，商业定稿 |
| **Insight Qwen图** | Qwen 生图、通义生图、阿里生图 | `insight/qwen-2512` | 国产之光（原名 qwen-image-2512） |

---

## 🎬 视频模型映射

### 文生视频 / 图生视频 / 参考生视频 / 首尾帧

| 常用口语 | 其他叫法 | 标准 model_id | 备注 |
|---------|----------|---------------|------|
| **可灵 omni** | 可灵全能、可灵旗舰、可灵音画 | `kling-v3-omni` | ⭐ 音画同步（默认） |
| **可灵** | 可灵 3.0、快手可灵、KL3 | `kling-v3` | 质感一流 |
| **即梦视频 2** | 即梦 2、SD2、即梦最强、字节 2.0 | `seedance-2.0` | ⭐ 默认视频 |
| **即梦 1.5** | 即梦视频 1.5、SD1.5、即梦中文版 | `doubao-seedance-1-5-pro-251215` | ✅ 实测可用，中文听话 |
| **Grok 视频** | Grok Video、grok-imagine | `grok-imagine-video` | ✅ 实测可用，电影级 |
| **HappyHorse** | 快马、运镜神器、happy-horse 1.1 | `happyhorse-1.1-t2v` | ✅ 实测可用 |
| **万 2.7** | 阿里 2.7、万相 2.7、W2.7 | `wan2.7-t2v-2026-04-25` | ✅ 实测可用，影视广告 |
| **万 2.6** | 阿里 2.6、万相 2.6、阿里 15 秒 | `wan2.6-t2v` | 15 秒长叙事 |
| **Veo** | 谷歌 Veo、Veo3、GV3 | `veo-3.1-generate-preview` | 多语言大片 |
| **Veo 快版** | Veo 极速、VeoF | `veo-3.1-fast-generate-preview` | 极速出片 |
| **海螺 2.3** | 海螺、HL2.3、海螺丝滑 | `MiniMax-Hailuo-2.3` | 动作丝滑 |
| **海螺 02** | 海螺二代、海螺首尾帧、HL02 | `MiniMax-Hailuo-02` | ⭐ 首尾帧明星 |
| **海螺 01** | S2V、海螺 IP 版、HL01 | `S2V-01` | ⭐ 系列 IP（参考生视频） |
| **Vidu Q2** | Vidu、Vidu 标准版 | `viduq2` | 参考主体稳 |
| **Vidu Q2 Pro** | Vidu Pro、Vidu 专业版 | `viduq2-pro` | 电影感 |
| **Vidu Q2 Turbo** | Vidu 快版、Vidu 加速版 | `viduq2-turbo` | 性价比 |
| **LTX** | LTX 视频、LTX4K、长视频神器 | `ltx-2.3` | ⭐ 唯一 4K |

> `insight/ltx-2.3-*` 为 Insight 侧封装版，口语名沿用 `LTX`。

### 参考生视频（reference_image_to_video）专有
| 口语 | 标准 model_id |
|------|---------------|
| 万 2.7 参考 | `wan2.7-r2v` |
| 万 2.6 参考 | `wan2.6-r2v-flash` |

---

## 🎵 音频模型映射

| 口语 | 标准 model_id | 备注 |
|------|---------------|------|
| speech-2.8-hd | `speech-2.8-hd` | ✅ 实测可用，人声级质感 |
| speech-2.8-turbo | `speech-2.8-turbo` | 快速版 |
| Suno | Suno 音乐、文生音乐 | `suno-music-v5_5` | ✅ 实测可用 |

---

## 🧠 转换逻辑（伪代码）

```python
def parse_model_name(user_input):
    MODEL_MAPPING = {
        # ===== 图像 =====
        "香蕉 2": "gemini-3.1-flash-image-preview",
        "nano banana 2": "gemini-3.1-flash-image-preview",
        "香蕉 pro": "gemini-3-pro-image-preview",
        "nano banana pro": "gemini-3-pro-image-preview",
        "香蕉": "gemini-2.5-flash-image",
        "nano banana": "gemini-2.5-flash-image",
        "gpt 图 2": "gpt-image-2",
        "即梦 5.0": "doubao-seedream-5-0-260128",
        "即梦 5.0 pro": "doubao-seedream-5-0-pro-260628",   # ✅
        "即梦 4.5": "doubao-seedream-4-5-251128",
        "mj8": "mj-v7",
        "niji": "niji-v7",
        "flux": "flux-2-klein-9b",
        "recraft": "recraftv4_1-t2i",                       # ✅
        "insight qwen图": "insight/qwen-2512",
        # ===== 视频 =====
        "可灵": "kling-v3",
        "可灵 omni": "kling-v3-omni",
        "即梦视频 2": "seedance-2.0",
        "即梦 1.5": "doubao-seedance-1-5-pro-251215",         # ✅
        "grok视频": "grok-imagine-video",                     # ✅
        "happyhorse": "happyhorse-1.1-t2v",                   # ✅
        "万 2.7": "wan2.7-t2v-2026-04-25",                    # ✅
        "万 2.6": "wan2.6-t2v",
        "veo": "veo-3.1-generate-preview",
        "veo 快版": "veo-3.1-fast-generate-preview",
        "海螺 2.3": "MiniMax-Hailuo-2.3",
        "海螺 02": "MiniMax-Hailuo-02",
        "海螺 01": "S2V-01",
        "vidu": "viduq2",
        "vidu pro": "viduq2-pro",
        "vidu 快版": "viduq2-turbo",
        "ltx": "ltx-2.3",
        # ===== 音频 =====
        "speech-2.8-hd": "speech-2.8-hd",
        "speech-2.8-turbo": "speech-2.8-turbo",
        "suno": "suno-music-v5_5",                            # ✅
    }
    normalized = user_input.lower().strip()
    if normalized in MODEL_MAPPING:
        return MODEL_MAPPING[normalized]
    if normalized in ALL_MODEL_IDS:
        return normalized
    return "doubao-seedream-5-0-260128"  # 默认图像模型
```

---

**适用范围：** Media Generator Skill 所有模型调用场景  
**生效时间：** 2026-09-03
