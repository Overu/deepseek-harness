---
description: "Insight Desktop 为 DeepSeek Harness 内置技能提供的 Office 工作流指引。"
kind: "package-bundle"
---

# @insight-ai/builtin-skill-extensions

[English](README.md) | 中文

## 概述

Insight Desktop 默认加载此组合。你可以在会话中提取 PDF 文本并保留原始页码，也可以检查已保存 PPTX 的指定幻灯片。视觉检查无法完成时，Agent 可以交付已通过结构检查的 PPTX。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

[Insight 配置条目](cordis.patch.yml)规定了 PDF 的输入、页数和输出上限。PPTX 工具遇到输入超限时，如果文件大小不超过 160 MiB，会对同一批幻灯片重试一次。Insight 配置可调低重试上限。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

[Host 插件](src/index.ts)注册工具和工作流指引。PDF 提取复用文档预览使用的 PDF.js 版本。PPTX 工具在会话沙箱中运行已安装的 LibreOffice Kit CLI。

</details>

<a id="model-experience"></a>
## 模型体验

### Office 工作流指引

#### 模型看到什么

模型可使用 `pdf_extract_text`、`office_render_pptx` 和一条运行时上下文。文本工具返回原始页码，无可选文本的页面返回空字符串。渲染工具返回生成的预览或视觉检查失败状态。

##### Office 指引

```markdown
Office skill extensions:
For PDF content analysis, summaries, or questions, call pdf_extract_text first. Cite the original PDF page numbers. Render only relevant pages that lack usable text or need visual inspection of figures or layout.
For an edited PPTX, reopen the saved file with python-pptx to verify its structure. If the model accepts images and visual review is needed, call office_render_pptx with the saved PPTX and all selected slide numbers in one batch. Use a fresh preview directory in the workspace, inspect the returned images, then remove those previews.
office_render_pptx handles size retries. If it cannot render the batch, stop the visual review, deliver the structurally verified PPTX, and state that visual inspection was not completed. On success, report which slides you inspected.
```

#### 对 Token 的影响

指引在保留的运行时上下文中占一项。在继续同一 Session 时，相同的指引不会新增上下文消息。

#### 对 KV Cache 的影响

稳定的指引保留已提交的请求前缀。指引变更会进入下一次运行时上下文快照。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- PDF.js 提取可选文本。纯图片页面需要视觉检查。PPTX 还原度取决于渲染器和已安装字体。

<a id="dev-note"></a>
### 开发备注

无。
