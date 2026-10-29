#!/usr/bin/env python3
"""
Media Generator - AI 多媒体内容生成工具（DSH skill 版本）

支持文生图、图生图、文生视频、图生视频、首尾帧生视频、参考图生视频、
文生音频(TTS)、音色克隆、文生音乐、音频参考、文本对话、文档/视频/图片解析、
文生 PPT、文档生 PPT 等 16+ 种任务类型。

v2.0（DSH 版，2026-09-03）改动：
- 参数对齐 call-insight-api 契约：chat_params / image_params / video_params /
  audio_params 四类对象透传，支持 gen_count / enableAudio / enable_audio /
  cameraControl / voiceId / customMode 等新模型参数
- 新增任务类型：text_to_audio（文生音乐）、audio_to_audio（音频参考）、
  image_to_image / image_editing（图生图/图像编辑）、reference_image_to_video、
  first_last_frame_to_video
- CLI 增加 --gen-count / --enable-audio / --voice-url / --video-url / --audio-url /
  --param（key=value 直接写入对应 params 对象）等选项
- 请求统一通过本地企业插件代理，技能不包含厂商凭据
- 本地等待默认 1250 秒；付费请求超时后不自动重试
"""

import json
import os
import sys
from pathlib import Path

# 添加 skill 目录到 path 以便导入 auth_signer
SCRIPT_DIR = Path(__file__).parent
sys.path.insert(0, str(SCRIPT_DIR / "scripts"))

from enterprise_proxy import request as proxy_request, ProxyError

# ============================================================
# 本地参数（鉴权和上游地址由后台管理）
# ============================================================
API_TIMEOUT = 1250

# 模型默认值（对齐 call-insight-api 目录）
DEFAULT_IMAGE_MODEL = "doubao-seedream-5-0-260128"  # 即梦5.0（国产，默认）
DEFAULT_VIDEO_MODEL = "seedance-2.0"  # 即梦视频2.0
DEFAULT_CHAT_MODEL = "gemini-3.1-pro-preview"
DEFAULT_TTS_MODEL = "speech-2.8-hd"
DEFAULT_MUSIC_MODEL = "suno-music-v5_5"

TASK_MODEL_MAP = {
    "text_to_image": DEFAULT_IMAGE_MODEL,
    "reference_image_to_image": DEFAULT_IMAGE_MODEL,
    "image_to_image": DEFAULT_IMAGE_MODEL,
    "image_editing": DEFAULT_IMAGE_MODEL,
    "text_to_video": DEFAULT_VIDEO_MODEL,
    "image_to_video": DEFAULT_VIDEO_MODEL,
    "reference_image_to_video": DEFAULT_VIDEO_MODEL,
    "first_last_frame_to_video": DEFAULT_VIDEO_MODEL,
    "text_to_speech": DEFAULT_TTS_MODEL,
    "voice_cloning": DEFAULT_TTS_MODEL,
    "text_to_audio": DEFAULT_MUSIC_MODEL,
    "audio_to_audio": DEFAULT_MUSIC_MODEL,
    "text_chat": DEFAULT_CHAT_MODEL,
    "text_parsing": DEFAULT_CHAT_MODEL,
    "video_parsing": DEFAULT_CHAT_MODEL,
    "image_parsing": DEFAULT_CHAT_MODEL,
    "text_to_ppt": DEFAULT_CHAT_MODEL,
    "file_to_ppt": DEFAULT_CHAT_MODEL,
}

# 任务类型 -> 参数对象名（对齐 API 契约）
IMAGE_TASKS = ("text_to_image", "reference_image_to_image", "image_to_image", "image_editing")
VIDEO_TASKS = ("text_to_video", "image_to_video", "reference_image_to_video", "first_last_frame_to_video")
AUDIO_TASKS = ("text_to_speech", "voice_cloning", "text_to_audio", "audio_to_audio")
TEXT_TASKS = ("text_chat", "text_parsing", "video_parsing", "image_parsing", "text_to_ppt", "file_to_ppt")


def _normalize_key(key):
    """把 CLI 侧命名的参数转成 API 契约参数名。"""
    mapping = {
        "aspect-ratio": "aspect_ratio",
        "mime-type": "mime_type",
        "gen-count": "gen_count",
        "enable-audio": "enable_audio",
        "image-url": "image_url",
        "video-url": "video_url",
        "audio-url": "audio_url",
        "voice-url": "voice_url",
        "voice-id": "voice_id",
        # 媒体网关(52667) minimax TTS 分支用 language/volume/intonation，保持原样不映射
        "enable_real_person": "enableRealPerson",
        "enable_audio": "enableAudio",
    }
    return mapping.get(key, key)


def generate_media(task_type, prompt=None, model_id=None, **kwargs):
    """
    生成多媒体内容。

    Args:
        task_type: 任务类型 (text_to_image, text_to_video, text_to_speech 等)
        prompt: 提示词
        model_id: 模型 ID (可选，默认根据任务类型自动选择)
        **kwargs:
            - image_url_list / video_url_list / audio_url_list / voice_url_list
            - resolution, aspect_ratio, duration, mime_type, quality
            - gen_count, enable_audio/ enableAudio, voice_id/ voiceId
            - cameraControl (dict), params (dict): 直接写入对应 params 对象的任意参数
            - data (dict): 写入 data 块顶层的额外字段

    Returns:
        dict: API 响应结果（code=0 且 status=success 为成功）
    """
    if model_id is None:
        model_id = TASK_MODEL_MAP.get(task_type, DEFAULT_CHAT_MODEL)

    data_block = {
        "prompt": prompt or "",
        "image_url_list": kwargs.get('image_url_list', []),
        "video_url_list": kwargs.get('video_url_list', []),
        "audio_url_list": kwargs.get('audio_url_list', []),
    }
    if kwargs.get('voice_url_list'):
        data_block["voice_url_list"] = kwargs['voice_url_list']

    # data 块顶层额外字段（--data）
    data_block.update(kwargs.get('data', {}))

    # 收集要写入 params 对象的参数字典
    params = dict(kwargs.get('params', {}))

    def _put(name, cli_value):
        """把 CLI 值（未名化）写入 params，用契约名。"""
        if cli_value is not None:
            params[_normalize_key(name)] = cli_value

    _put("resolution", kwargs.get('image_resolution', kwargs.get('resolution')))
    _put("aspect_ratio", kwargs.get('aspect_ratio'))
    _put("duration", kwargs.get('duration'))
    _put("mime_type", kwargs.get('mime_type'))
    _put("quality", kwargs.get('quality'))
    _put("gen_count", kwargs.get('gen_count'))
    _put("enable_audio", kwargs.get('enable_audio', kwargs.get('enableAudio')))
    _put("voice_id", kwargs.get('voice_id', kwargs.get('voiceId')))

    # cameraControl 直接透传（已是 dict 结构）
    if kwargs.get('cameraControl'):
        params['cameraControl'] = kwargs['cameraControl']

    if task_type in IMAGE_TASKS:
        params.setdefault("resolution", "2K")
        params.setdefault("aspect_ratio", "16:9")
        params.setdefault("mime_type", "PNG")
        params.setdefault("quality", "medium")
        data_block["image_params"] = params
    elif task_type in VIDEO_TASKS:
        params.setdefault("resolution", "720p")
        params.setdefault("aspect_ratio", "16:9")
        params.setdefault("duration", 4)
        params.setdefault("mode", "std")
        # 视频 params 中 duration 转为整数
        if "duration" in params and isinstance(params["duration"], str):
            try:
                params["duration"] = int(params["duration"])
            except ValueError:
                pass
        data_block["video_params"] = params
    elif task_type in AUDIO_TASKS:
        # TTS（text_to_speech/voice_cloning）默认音色；音乐（text_to_audio/audio_to_audio）无需 voice_id
        if task_type in ("text_to_speech", "voice_cloning"):
            # 媒体网关(52667) minimax TTS 分支要求下列字段全部显式给出（不自动填默认）
            params.setdefault("voice_id", "Chinese (Mandarin)_News_Anchor")
            params.setdefault("language", "auto")
            params.setdefault("emotion", "auto")
            params.setdefault("volume", 1.0)
            params.setdefault("intonation", 0)
            params.setdefault("speed", 1.0)
        else:
            # Suno 音乐默认参数（对齐 call-insight-api 目录，媒体网关要求显式带上 customMode）
            params.setdefault("customMode", True)
            params.setdefault("instrumental", True)
            params.setdefault("vocalGender", "m")
            params.setdefault("styleWeight", 0.65)
            params.setdefault("weirdnessConstraint", 0.65)
        data_block["audio_params"] = params
    elif task_type in TEXT_TASKS:
        params.setdefault("search_resource", True)
        data_block["chat_params"] = params

    payload = {
        "model_id": model_id,
        "task_type": task_type,
        "data": data_block,
    }

    try:
        return proxy_request("media-generator", "POST", "/v1/proxy", body=payload, timeout=API_TIMEOUT)
    except ProxyError as e:
        return {"code": -1, "message": str(e), "status": "failed"}


def _arg_after(args, flag, default=None):
    """读取 CLI 中 flag 后面的值；不存在则返回 default。"""
    if flag in args:
        i = args.index(flag)
        if i + 1 < len(args):
            return args[i + 1]
    return default


def _arg_flag(args, flag):
    """是否存在该布尔 flag（--enable-audio）。"""
    return flag in args


def main():
    if len(sys.argv) < 2:
        print("用法：python generate.py <task_type> [prompt] [options]")
        print()
        print("任务类型：")
        print("  text_to_image, reference_image_to_image, image_to_image, image_editing")
        print("  text_to_video, image_to_video, reference_image_to_video, first_last_frame_to_video")
        print("  text_to_speech, voice_cloning, text_to_audio, audio_to_audio")
        print("  text_chat, text_parsing, video_parsing, image_parsing, text_to_ppt, file_to_ppt")
        print()
        print("常用选项：")
        print("  --model <id>          指定模型 ID（默认按任务类型自动选择）")
        print("  --timeout <秒>        本地等待上限（默认 1250）")
        print("  --resolution <值>     图片: 1K/2K/4K；视频: 720p/1080p/2K 等")
        print("  --aspect-ratio <值>   1:1 / 16:9 / 9:16 等")
        print("  --duration <秒>       视频时长（默认 4）")
        print("  --mime-type <值>      图片格式 JPEG/PNG")
        print("  --quality <值>        图片质量档（默认 medium，可选 low/medium/high）")
        print("  --gen-count <n>       生成数量（1/2/4，按模型支持）")
        print("  --enable-audio        视频/音乐开启音频（布尔）")
        print("  --image-url <url>     参考图 URL（图生图/图生视频/首尾帧用，可逗号分隔多张）")
        print("  --video-url <url>     源视频 URL（音频参考等用）")
        print("  --audio-url <url>     源音频 URL（音频参考用）")
        print("  --voice-url <url>     音色参考 URL（音色克隆用）")
        print("  --voice-id <id>       TTS 音色 ID（如 Chinese (Mandarin)_News_Anchor）")
        print("  --param K=V           直接写入对应 params 对象的任意参数（可重复）")
        print()
        print("环境变量（可选）：")
        print("  DSH_HOME（由客户端设置）；厂商凭据仅在后台配置")
        sys.exit(1)

    task_type = sys.argv[1]
    prompt = sys.argv[2] if len(sys.argv) > 2 else ""
    if prompt.startswith("--"):
        prompt = ""

    model_id = _arg_after(sys.argv, "--model")
    resolution = _arg_after(sys.argv, "--resolution")
    aspect_ratio = _arg_after(sys.argv, "--aspect-ratio")
    duration = _arg_after(sys.argv, "--duration")
    mime_type = _arg_after(sys.argv, "--mime-type")
    image_url = _arg_after(sys.argv, "--image-url")
    video_url = _arg_after(sys.argv, "--video-url")
    audio_url = _arg_after(sys.argv, "--audio-url")
    voice_url = _arg_after(sys.argv, "--voice-url")
    quality = _arg_after(sys.argv, "--quality")
    gen_count = _arg_after(sys.argv, "--gen-count")
    voice_id = _arg_after(sys.argv, "--voice-id")
    enable_audio = _arg_flag(sys.argv, "--enable-audio")

    timeout = _arg_after(sys.argv, "--timeout")
    if timeout is not None:
        global API_TIMEOUT
        API_TIMEOUT = int(timeout)

    # 收集 --param K=V（可重复）
    params_overrides = {}
    i = 1
    while i < len(sys.argv):
        if sys.argv[i] == "--param" and i + 1 < len(sys.argv):
            kv = sys.argv[i + 1]
            if "=" in kv:
                key, val = kv.split("=", 1)
                # 尝试解析 JSON（数字/布尔/字符串）
                try:
                    params_overrides[_normalize_key(key.strip())] = json.loads(val)
                except (ValueError, json.JSONDecodeError):
                    params_overrides[_normalize_key(key.strip())] = val.strip()
            i += 2
        else:
            i += 1

    kwargs = {}
    if resolution:
        kwargs["resolution"] = resolution
    if aspect_ratio:
        kwargs["aspect_ratio"] = aspect_ratio
    if duration:
        kwargs["duration"] = duration
    if mime_type:
        kwargs["mime_type"] = mime_type
    if quality:
        kwargs["quality"] = quality
    if gen_count:
        # 尝试转数字
        try:
            kwargs["gen_count"] = int(gen_count)
        except ValueError:
            kwargs["gen_count"] = gen_count
    if enable_audio:
        kwargs["enable_audio"] = True
    if voice_id:
        kwargs["voice_id"] = voice_id
    if image_url:
        kwargs["image_url_list"] = [u.strip() for u in image_url.split(",") if u.strip()]
    if video_url:
        kwargs["video_url_list"] = [u.strip() for u in video_url.split(",") if u.strip()]
    if audio_url:
        kwargs["audio_url_list"] = [u.strip() for u in audio_url.split(",") if u.strip()]
    if voice_url:
        kwargs["voice_url_list"] = [u.strip() for u in voice_url.split(",") if u.strip()]
    if params_overrides:
        kwargs["params"] = params_overrides

    result = generate_media(task_type, prompt, model_id=model_id, **kwargs)
    print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
