# 机会卡规则

## 卡片结构

```yaml
opportunity_card:
  opportunity_id: string
  title: string
  priority: high | medium | hypothesis
  target_context: string
  target_audiences: [string]
  user_tension: string
  competitor_territory: string
  whitespace: string
  content_proposition: string
  action_proofs: [string]
  creator_archetypes: [string]
  unsuitable_expressions: [string]
  claim_guardrails: [string]
  evidence_ids: [string]
  evidence_types: [trend, content, comment, creator, ad]
  confidence: high | medium | hypothesis
  risks: [string]
  next_validation: [string]
```

## 形成标准

- `high`：至少三条高相关证据、至少两种证据类型，并且覆盖用户讨论或明确竞品内容；没有未解释的关键反证。
- `medium`：至少两种证据类型互相支持，但平台、时间窗口或样本量存在明显限制。
- `hypothesis`：只有一种证据类型、证据冲突、相关性不足，或仅有泛品类信号。

“空白”必须是“在当前公开样本中尚未被充分占领/验证”的谨慎表述，而不是宣称市场无人提供或消费者一定需要。竞争样本不足时，将空白写为“待扩大样本验证”。

## 排序原则

优先级按以下顺序判断：

1. 用户张力是否具体、可被产品能力回应；
2. 竞品叙事是否存在可验证的差异化空间；
3. 内容是否能展示可见的动作证据，而非只复述卖点；
4. 证据是否跨模块相互支持且足够近期；
5. 主张风险是否可控。

不要为了数字化而伪造精确分数。若用户要求量化排序，可使用“高/中/低优先级”，并逐项说明证据与缺口。

## 与后续工作衔接

每张进入执行的卡片需补充：

- 推荐内容形式、前 3 秒钩子和可拍动作证据；
- 适合的达人类型与不适合的表达；
- 建议验证指标及不能从公开数据验证的字段；
- 需要品牌、投放后台或访谈补充的证据。

这些字段按 `opportunity_id` 进入 `insight_handoff`，避免下游重新改写场景、人群和风险边界。
