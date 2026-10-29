# 示例计划

六份可直接跑通的 `plan.json`，覆盖最常用的结构。它们同时是 `scripts/validate_plan.py` 的活体样例
（全部必须是 0 error 0 warning；改了校验规则后请回归全部示例）。

| 文件 | 原型 | 覆盖的能力点 |
|---|---|---|
| `ecommerce-poster.plan.json` | A2 | 图片素材自动导入 + 代笔文本节点 + 3 路 fan-out + 带字海报提示词 + 安全区/合规验收 |
| `ecommerce-poster-fanout.plan.json` | A2 | **6 节点完整示范**：brief→文案→3 版式并行；已用 `layout_plan.py` 排好坐标；不含任何旁注/自检节点 |
| `variant-suite.plan.json` | A3 | **T1 LLM 文本节点**（写指令 + 登记 manualSteps）+ 锚点切片（`【套图N描述】`）+ 4 路生成 |
| `multi-platform-poster.plan.json` | A3 | 产品图 + Brief + LLM 文案 → 3:4/1:1/9:16/16:9 四平台海报；`reference_image_to_image` 模式门 + 7 节点 |
| `product-video.plan.json` | A10 | 图+视频+文本三输入视频生成 + 时长/画幅参数（参考视频走 `canvas_asset_import`） |
| `tts-voiceover.plan.json` | A8 | 文案 → TTS 配音：`configure` 写 `voiceId/seniorParams`，批量 `canvas_run` |

## 怎么用

```sh
# 1) 排坐标（列 = 依赖深度、列内按父节点重心排序、垂直居中）
python3 scripts/layout_plan.py examples/ecommerce-poster-fanout.plan.json --in-place

# 2) 校验（0 error 才能施工）
python3 scripts/validate_plan.py examples/ecommerce-poster-fanout.plan.json

# 3) 看工具调用序列（dry-run，不碰画布）
python3 scripts/render_plan.py examples/ecommerce-poster-fanout.plan.json

# 4) 按序列执行；每步写前读最新 confirmed 版本；runs[] 全部跑完才算执行完成
```

## 写自己的计划时

- 复制最接近的一份改，**不要从零写**；
- 保持 `edges[].sourceHandle/targetHandle` 显式书写（原生会自动回填，但显式写才能被校验和复核）；
- 新增生成节点时同步更新 `runs`（拓扑序）与 `estimate`（数量、计费点、是否触发确认闸门）；
- 任何需要人工的步骤（T1 文本节点、视频/音频上传、文本模型选择）都要进 `manualSteps`；
- 参数只写**标量**（`aspect_ratio / resolution / quality / gen_count / duration`），模型与模式放 `config`。

## 已知边界（示例没做，因为工具不支持）

- 示例里没有 `group` 分组、没有工具节点（多视角/高清/重绘/分镜）、没有模板实例化与整图运行；
- 音频示例见 `tts-voiceover.plan.json`：TTS 可配置（`voiceId/seniorParams`）也可运行；音乐/翻唱与音色克隆仍不在公开范围；
- 示例里**没有自检清单/说明这类旁注节点**——那属于内部逻辑，`validate_plan.py` 的 R19 会直接拦下；
- 三份示例都用 `gen_count: 1`：多图走**多节点 fan-out**（官方模板库的通行做法），需要放大同类图时再考虑提高 `gen_count`。
