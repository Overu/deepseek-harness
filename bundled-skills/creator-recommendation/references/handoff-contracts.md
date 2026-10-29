# 投放组合与投中监测交接契约

> 本文件自 `creator-recommendation/references/data-contract.md` 拆分而来（2026-09-18），按需查阅。

## 投放组合输出

`portfolio` 和 `full_plan` 模式使用以下稳定结构：

```yaml
portfolio_plan:
  plan_id: string
  plan_version: string
  generated_at: ISO-8601
  mode: portfolio | full_plan
  objective: [string]
  total_budget: { amount: number | null, currency: CNY }
  budget_status: closed | partial | not_plannable
  assumptions: [string]
  selected_creators:
    - creator_key: string
      platform: string
      creator_id: string
      entity_cluster_id: string | null
      primary_role: string
      secondary_roles: [string]
      assigned_scenario: string
      content_task: string
      capability_role_basis: [reach | audience_fit | seeding | conversion | cost_efficiency]
      commercial_capability_score: number | null
      commercial_evidence_coverage: number
      creator_fee: number | null
      selection_reason: string
      replacement_creator_id: string | null
      gating_checks: [string]
  coverage:
    roles: [{ label: string, creators: [string], status: covered | gap | overlap }]
    audiences: [{ label: string, creators: [string], status: covered | gap | overlap }]
    scenarios: [{ label: string, creators: [string], status: covered | gap | overlap }]
    formats: [{ label: string, creators: [string], status: covered | gap | overlap }]
  budget_lines:
    - category: creator_fee | production_and_rights | paid_amplification | conversion_and_measurement | contingency
      amount: number | null
      status: quoted | estimated | reserved | unknown
      note: string
  phases:
    - name: string
      creators: [string]
      release_condition: string | null
      observation_window: string | null
      success_rules: [decision_rule]
      stop_rules: [decision_rule]
  risks: [string]
  unresolved_costs: [string]
  monitoring_handoff: monitoring_handoff
```

`decision_rule` 至少记录指标、比较基准、方向和数据来源。缺少有依据的阈值时保留相对规则，不填造数值。

---

## 投中监测交接

```yaml
monitoring_handoff:
  handoff_id: string
  plan_id: string
  plan_version: string
  generated_at: ISO-8601
  campaign:
    name: string | null
    start_at: ISO-8601 | null
    end_at: ISO-8601 | null
    objectives: [string]
  tracking_registry:
    - tracking_id: string
      platform: string
      creator_id: string
      creator_name: string | null
      profile_url: string | null
      plan_status: planned | confirmed | replaced | cancelled
      primary_role: string
      scenario: string
      message_points: [string]
      deliverables: [string]
      planned_content_count: number | null
      planned_publish_window: { start_at: ISO-8601 | null, end_at: ISO-8601 | null }
      content_ids: [string]
      content_urls: [string]
      replacement_tracking_id: string | null
      allocated_budget: { amount: number | null, currency: CNY }
  kpi_definitions:
    - kpi_id: string
      metric: string
      formula: string
      numerator: string | null
      denominator: string | null
      source: public_api | ad_platform | ecommerce | crm | survey | other
      observation_window: string
      data_lag: string | null
      target_value: number | null
      target_direction: above | below | within | relative
      baseline_ids: [string]
      comparator: gt | gte | lt | lte | between | percentile | null
      baseline_logic: all | any | mean | median | specific | null
      relative_delta: number | null
      relative_delta_unit: absolute | percent | percentile_point | null
      success_action: string
      stop_action: string
      owner: string | null
  baselines:
    - baseline_id: string
      platform: string | null
      tracking_ids: [string]
      metric: string
      scope_type: creator | cohort | brand | campaign | competitor
      scope_id: string | null
      value: number | null
      unit: string | null
      sample_size: number | null
      window: string
      captured_at: ISO-8601 | null
      source_ref: string
  first_party_mapping:
    - metric: string
      source: string
      join_key: string | null
      availability: available | planned | unavailable
  upstream_context:
    insight_handoff_id: string | null
    accepted_learning_return_ids: [string]
    query_manifest: [object]
    risk_watchlist: [object]
    evidence_manifest: [object]
```

`tracking_id` 在计划版本间保持稳定，除非换成不同达人/账号；替补启用时新旧记录通过 `replacement_tracking_id` 关联。`kpi_definitions` 负责锁定同名指标的公式、分母、窗口和数据源，防止投中阶段重新解释“互动率”“搜索提升”或“转化”。

当 `target_direction=relative` 时，`comparator`、`baseline_logic`、`baseline_ids` 与 `relative_delta` 必须共同给出；若没有有依据的相对幅度，将 `relative_delta` 保持 `null` 并把该规则标为观察规则，不得用于自动加投/停止。达人或内容基线必须通过 `tracking_ids` 关联注册表对象；跨平台时同时填写 `platform`。
