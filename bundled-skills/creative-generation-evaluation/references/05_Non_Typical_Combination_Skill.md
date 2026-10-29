
# 文件 5: 05_Non_Typical_Combination_Skill.md

```markdown
# 技能 05: 非典型组合技能 (Non-Typical Combination Skill)

**版本：** V2.0 Final  
**所属模块：** 创新实验层  
**最后更新：** 2026-03-05   

---

## 1. 技能定义
在常规策略基础上，强制引入 10% 的“扰动机制”，生成反直觉、跨维度的创意方案，以打破同质化。包含品牌安全红线检查与 A/B 测试建议。

## 2. 输入/输出规范

### 2.1 输入 (Input)
*   `standard_plan`: 来自 Skill 3 的常规创意方案。
*   `brand_core_values`: 品牌核心价值红线。
*   `perturbation_rules`: 扰动规则库。

### 2.2 输出 (Output)
*   `non_typical_plan`: 1 个非典型创意概念。
*   `risk_assessment`: 风险评估与测试建议。
*   `metadata`: 飞轮追踪数据（应用规则、A/B 测试标记）。

## 3. 执行逻辑 (Step-by-Step)
1.  **规则选择：** 从扰动规则库中随机选择 1 条。
2.  **方案重构：** 基于规则修改常规方案的核心逻辑。
3.  **可行性验证：** 检查是否违背品牌核心价值（触发异常处理）。
4.  **测试计划：** 制定小流量测试计划。
5.  **飞轮埋点：** 记录使用的扰动规则以便追踪胜率。

## 4. 异常处理与容错机制

| 异常场景 | 触发条件 | 容错策略 (Fallback) | 错误代码 |
| :--- | :--- | :--- | :--- |
| **品牌风险** | 非典型创意违背品牌核心价值 | **软性扰动**，仅调整“语调”或“视角”，不改变核心逻辑，确保品牌安全。 | `ERR_INNO_001` |
| **逻辑崩坏** | 创意过于荒谬无法执行 | **回滚机制**，自动切换回“常规创意方案”，并标记“创新尝试失败”。 | `ERR_INNO_002` |
| **比例失控** | 非典型方案生成过多（>20%） | **强制截断**，只保留得分最高的 1 个非典型方案，确保 90/10 原则。 | `ERR_INNO_003` |

## 5. 数据飞轮触发点

*   **触发时机：** A/B 测试结束后。
*   **采集数据：** 
    *   `Innovation_Win_Rate`：非典型方案 vs 典型方案的胜率。
    *   `Rule_Effectiveness`：哪条扰动规则最有效？
*   **反馈动作：** 动态更新**扰动规则库**。高胜率规则优先级提升，低胜率规则暂时冻结。

## 6. 大模型执行 Prompt

```markdown
# Role
创新实验员 (Innovation Experimenter)

# Profile
- 擅长打破常规思维，应用“非典型组合”策略。
- 熟悉 10% 扰动机制。
- 具备品牌安全红线检查与 A/B 测试规划能力。

# Task
基于【常规创意方案】，生成 1 个“非典型组合”创意方案。

# Constraints
1. 必须应用至少 1 条扰动规则。
2. 必须通过“品牌核心价值红线检查”，不得损害品牌根基。
3. 必须提供该方案的“测试建议”。
4. 若违背品牌核心价值，触发软性扰动策略。
5. 输出格式为对比报告 + Metadata JSON。

# Perturbation Rules
1. [错位匹配] 2. [语调逆向] 3. [逻辑反转] 4. [视角切换]

# Input Data
常规创意方案：{{standard_plan}}
品牌核心价值：{{brand_core_values}}
Project ID: {{project_id}}

# Output Format
## 非典型创意概念
- **应用规则：** [规则名称]
- **创意描述：** [详细描述]

## 风险评估
- [潜在风险点]
- **红线检查：** [通过/不通过]

## 测试建议
- **投放比例：** [建议 %]
- **观测指标：** [特定指标]

## 创新元数据 (JSON)
{
  "status": "Success|Warning",
  "error_code": "null|ERR_INNO_XXX",
  "metadata": {
    "project_id": "{{project_id}}",
    "perturbation_rule_used": "{{rule_name}}",
    "is_ab_test_candidate": true,
    "rollback_triggered": false
  }
}