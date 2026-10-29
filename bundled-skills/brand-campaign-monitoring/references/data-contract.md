# 监测数据契约

## 设计原则

- 原始平台字段与跨平台归一化字段并存；归一化失败时保留 `null`，不猜值。
- 所有统计必须绑定 `published_at`、`collected_at`、`window` 和 `source_status`。
- 内容、评论、账号和聚合快照使用稳定的复合键，避免同一内容被重复计入。
- 不持久化授权头、Cookie、Token、签名、短期媒体地址或平台私密字段。

## content_record

```yaml
content_record:
  record_key: "platform:content_id"
  plan_id: 可选
  plan_version: 可选
  tracking_id: 可选，关联投前达人/内容任务
  platform: douyin | xiaohongshu | bilibili | wechat_mp | wechat_channels | tiktok | other
  content_id: 平台原始内容 ID
  canonical_url: 可追溯公开 URL；无法稳定生成时为 null
  content_type: video | image | article | post | audio | other
  title: 可选
  text: 可选
  author_id: 平台原始作者 ID
  author_name: 可选
  author_url: 可选
  published_at: ISO-8601 或 null
  collected_at: ISO-8601
  query_ids: [触发该记录的查询 ID]
  campaign_relation: owned | paid_creator | earned | competitor | unknown
  parent_content_id: 转发、转载或回复所指向的原内容 ID；无则 null
  metrics:
    impressions: null
    views: null
    likes: null
    comments: null
    shares: null
    saves: null
    followers: null
  metric_availability: [views, likes, comments]
  source_status: valid | empty_valid | degraded | unauthorized | timeout | invalid
  # 取值域与 category-competitor-insight 的 business_status 一致：本技能按「单条来源」记录，
  # 该技能按「一次查询」记录；empty_valid = 查询成功但无数据，**不得当作失败**。
  source_route: API 路由标识
  raw_reference: 可选的临时原始结果索引，不放密钥或签名 URL
```

## comment_record

```yaml
comment_record:
  record_key: "platform:comment_id"
  platform: 平台
  comment_id: 平台原始评论 ID
  content_id: 所属内容 ID
  parent_comment_id: 回复对象；无则 null
  author_id: 可选
  text: 评论文本
  published_at: ISO-8601 或 null
  collected_at: ISO-8601
  like_count: null
  labels:
    relevance: relevant | irrelevant | uncertain
    sentiment: positive | neutral | negative | uncertain
    intent: purchase | inquiry | comparison | complaint | advocacy | other | uncertain
    risk_topics: []
  label_confidence: 0.0-1.0
  evidence_excerpt: 最短必要证据片段
  source_status: valid | degraded
  # 记录级子集：评论接口不可用时不得据内容级评论数伪造 comment_record；
  # 其余状态（empty_valid/unauthorized/timeout/invalid）表示该条评论记录不存在，而非 degraded。
```

不得在评论接口不可用时，根据内容级评论数伪造 `comment_record`。情绪、意图和风险主题只能来自实际文本样本。

## monitoring_snapshot

```yaml
monitoring_snapshot:
  snapshot_id: 唯一 ID
  previous_snapshot_id: string | null
  plan_id: 可选
  plan_version: 可选
  brand: 品牌
  campaign: 可选
  window:
    start_at: ISO-8601
    end_at: ISO-8601
    timezone: Asia/Shanghai
  baseline:
    type: previous_period | pre_campaign | creator_history | cohort | custom | none
    start_at: 可选
    end_at: 可选
  coverage:
    requested_platforms: []
    valid_platforms: []
    degraded_platforms: []
    missing_platforms: []
  sample:
    contents: 0
    comments: 0
    creators: 0
    queries: 0
  metrics:
    content_count: 0
    engagement_total: null
    engagement_rate: null
    negative_share: null
    purchase_intent_share: null
    first_party: {}
  kpi_results:
    - kpi_id: string
      actual_value: number | null
      baseline_ids: [string]
      status: above | below | within | unknown
  topics: []
  anomalies: []
  status: normal | watch | warning | incident
  confidence: high | medium | low
  limitations: []
```

## action_log

```yaml
action_log:
  - action_id: string
    snapshot_id: string
    plan_id: string | null
    plan_version: string | null
    tracking_ids: [string]
    status: recommended | accepted | rejected | executed | superseded
    observation: string
    evidence_refs: [string]
    recommendation: string
    trigger: string
    owner: string | null
    recommended_at: ISO-8601
    review_at: ISO-8601 | null
    executed_at: ISO-8601 | null
    actual_change: string | null
    review_result: string | null
```

没有来自用户或有权系统的确认时，`status` 保持 `recommended`；不得由公开数据推断动作已执行。

## learning_return

```yaml
learning_return:
  return_id: string
  snapshot_id: string
  plan_id: string | null
  plan_version: string | null
  generated_at: ISO-8601
  creator_updates:
    - tracking_id: string
      observed_role_fit: strong | mixed | weak | unknown
      observed_scenario_fit: strong | mixed | weak | unknown
      evidence_refs: [string]
      recommendation: keep | scale | revise_task | replace | observe
  opportunity_updates:
    - opportunity_id: string
      result: supported | mixed | contradicted | insufficient
      evidence_refs: [string]
      next_validation: string
  query_updates:
    add_terms: [string]
    retire_terms: [string]
    add_search_exclusions: [string]
    add_risk_terms: [string]
  kpi_updates:
    - kpi_id: string
      observation: string
      proposed_change: string | null
      evidence_refs: [string]
  unresolved_questions: [string]
```

`learning_return` 是下一轮洞察、达人规划或监测的学习输入，不直接改写历史机会卡、达人分数或计划版本。上游采纳后应创建新版本并保留旧版本引用。

## 字段计算规则

1. `engagement_total` 仅汇总明确存在的互动字段，并在结果中列明组成；不同平台缺失字段不得按零处理。
2. `engagement_rate` 的分母必须显式写明是播放、展现还是粉丝；没有可靠分母则保持 `null`。
3. `negative_share` 的分母是被判为 relevant 且 sentiment 非 uncertain 的评论或内容文本数。
4. 跨平台总量保留平台分项。平台搜索覆盖率不同，不将简单总和解释为全网绝对声量。
5. 发生补采、分页或路由降级时更新 `collected_at`、`source_route` 和 `source_status`。
6. 同一平台优先按内容 ID 去重；跨平台转载保留多条记录并通过 `parent_content_id` 或主题聚类建立关系。
7. 有投前交接包时，每个内容记录关联 `tracking_id`，每个 KPI 关联 `kpi_id` 和 `baseline_ids`；没有稳定关联时不得生成“完成率”。

## 置信度规则

- `high`：核心平台均有效，样本和基线充分，关键判断有多条独立证据。
- `medium`：存在局部降级、评论缺失或基线较弱，但结论由多个平台或一方数据支持。
- `low`：主要入口为空/失败、样本极少、只有单一来源，或结论依赖代理指标。
