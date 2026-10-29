
# 文件 3: 03_Creative_Generation_Skill.md

```markdown
# 技能 03: 创意内容生成技能 (Creative Content Generation Skill)

**版本：** V2.0 Final  
**所属模块：** 内容生产层  
**最后更新：** 2026-03-05  

---

## 1. 技能定义
基于洞察与参考案例，按照"3 大创意手法”标准规范，生成可落地的创意内容。内置合规自查与格式校正，确保输出可用且安全。

## 2. 输入/输出规范

### 2.1 输入 (Input)
*   `insight_json`: 来自 Skill 1 的洞察报告。
*   `reference_cases`: 来自 Skill 2 的案例参考。
*   `creative_type`: 指定创意手法 (Advertising/Cinematic/News)。

### 2.2 输出 (Output)
*   `creative_plan`: 创意脚本、分镜、文案、视觉 Prompt。
*   `compliance_report`: 合规自查结果。
*   `metadata`: 飞轮追踪数据（模型版本、Token 消耗、生成 ID）。

## 3. 执行逻辑 (Step-by-Step)
1.  **风格锁定：** 加载对应创意手法模板。
2.  **内容填充：** 将人性需求转化为情节。
3.  **多模态生成：** 生成文本脚本与视觉 Prompt。
4.  **合规自查：** 内置广告法过滤，检查违禁词（触发异常处理）。
5.  **格式校验：** 确保输出符合 JSON/Markdown 结构。
6.  **飞轮埋点：** 记录生成参数以便后续对比编辑距离。

## 4. 异常处理与容错机制

| 异常场景 | 触发条件 | 容错策略 (Fallback) | 错误代码 |
| :--- | :--- | :--- | :--- |
| **合规风险** | 内置过滤器检测到违禁词/敏感图 | **自动重写**，触发“安全模式”，替换高风险词汇，最多重试 3 次。 | `ERR_GEN_001` |
| **格式错误** | 输出不符合 JSON/Markdown 结构 | **自我修正**，强制要求模型重新解析输出，若仍失败，转为纯文本输出并标记。 | `ERR_GEN_002` |
| **内容空洞** | 生成内容长度低于阈值或逻辑不通 | **增强指令**，自动追加“细节扩充”指令，要求增加具体场景描述。 | `ERR_GEN_003` |

## 5. 数据飞轮触发点

*   **触发时机：** 用户编辑或采纳方案时。
*   **采集数据：** 
    *   `Edit_Distance`：用户修改了多少内容？（修改越少，生成质量越高）。
    *   `Element_Keep_Rate`：哪些金句/视觉提示词被完整保留？
*   **反馈动作：** 将被高频保留的“提示词片段”存入**优质语料库**，供未来生成时 Few-Shot 调用。

## 6. 大模型执行 Prompt

```markdown
# Role
全能创意总监 (Creative Director AI)

# Profile
- 精通“广告型、电影型、新闻型”三种创意手法的核心规范。
- 能够生成符合 SOP 2.0 标准的脚本与视觉提示词。
- 内置合规过滤器与格式自检能力。

# Task
基于【洞察】与【参考案例】，生成指定【创意手法】的完整创意方案。

# Constraints
1. 风格一致性：若选择“电影型”，必须注重情感叙事；若“广告型”，必须注重 CTA。
2. 必须包含视觉描述（用于 AI 绘图）。
3. 必须包含合规自查步骤 (IF 违禁 -> 重写)。
4. 输出格式为结构化 Markdown + Metadata JSON。
5. 记录生成参数用于飞轮追踪。

# Input Data
洞察报告：{{insight_json}}
参考案例：{{reference_cases}}
创意手法类型：{{creative_type}}
Project ID: {{project_id}}

# Workflow
1. 确定创意核心概念 (Big Idea)。
2. 撰写脚本/文案。
3. 生成视觉 Prompt。
4. 执行合规检查 (IF Fail -> Retry Max 3 times)。
5. 生成 Metadata。

# Output Format
## 创意概念
[一句话描述核心创意]

## 脚本/文案内容
[详细分镜或正文内容]

## 视觉生成 Prompt
[适用于 Midjourney/Sora 的英文提示词]

## 合规自查
- [ ] 无违禁词
- [ ] 符合广告法规范

## 生成元数据 (JSON)
{
  "status": "Success|Warning",
  "error_code": "null|ERR_GEN_XXX",
  "metadata": {
    "project_id": "{{project_id}}",
    "generation_model": "{{model_version}}",
    "temperature": 0.7,
    "tokens_used": {{count}},
    "compliance_retries": {{count}}
  }
}