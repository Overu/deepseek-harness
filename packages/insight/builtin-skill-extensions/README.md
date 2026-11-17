---
description: "Office workflow guidance for built-in DeepSeek Harness skills in Insight Desktop."
kind: "package-bundle"
---

# @insight-ai/builtin-skill-extensions

English | [中文](README.zh.md)

## Summary

Insight Desktop loads this bundle by default. In a conversation, you can extract PDF text with original page numbers and review selected slides of a saved PPTX. The agent can deliver a structurally verified PPTX when visual inspection cannot finish.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

The [Insight profile row](cordis.patch.yml) sets PDF input, page, and output limits. The PPTX tool retries the same slide batch once after an input-size rejection if the saved file is at most 160 MiB. The profile can lower the retry ceiling.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The [Host plugin](src/index.ts) registers the tools and workflow instructions. PDF extraction uses the same PDF.js version as document preview. The PPTX tool runs the installed LibreOffice Kit CLI in the session sandbox.

</details>

<a id="model-experience"></a>
## Model Experience

### Office workflow guidance

#### What the model sees

The model sees `pdf_extract_text`, `office_render_pptx`, and one runtime-context contribution. The text tool returns physical page numbers and an empty string for pages without selectable text. The render tool reports the generated previews or a visual-review failure.

##### Office guidance

```markdown
Office skill extensions:
For PDF content analysis, summaries, or questions, call pdf_extract_text first. Cite the original PDF page numbers. Render only relevant pages that lack usable text or need visual inspection of figures or layout.
For an edited PPTX, reopen the saved file with python-pptx to verify its structure. If the model accepts images and visual review is needed, call office_render_pptx with the saved PPTX and all selected slide numbers in one batch. Use a fresh preview directory in the workspace, inspect the returned images, then remove those previews.
office_render_pptx handles size retries. If it cannot render the batch, stop the visual review, deliver the structurally verified PPTX, and state that visual inspection was not completed. On success, report which slides you inspected.
```

#### Token effect

The guidance occupies one retained runtime-context contribution. Identical guidance adds no new context messages to a continuing Session.

#### KV Cache effect

Stable guidance preserves the admitted request prefix. A change to the guidance is included in the next runtime-context snapshot.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- PDF.js extracts selectable text. Image-only pages require visual inspection. PPTX fidelity depends on the renderer and installed fonts.

<a id="dev-note"></a>
### Dev Note

None.
