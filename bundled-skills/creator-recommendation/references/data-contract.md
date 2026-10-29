# 达人推荐数据契约

## 统一输入

数据工具层应返回可追溯的结构化对象；接口原始字段可变化，但输出字段保持稳定。

```yaml
creator_recommendation_output:
  requested_platforms: [string]
  platform_gaps:
    - platform: string
      reason: string
      failed_route: string | null
      decision_impact: string
  creators: [creator]

creator:
  creator_key: "platform:creator_id"
  platform: string
  creator_id: string
  entity_cluster_id: string | null
  identity_confidence: high | medium | low | unverified
  identity_evidence: [string]
  nickname: string
  captured_at: ISO-8601
  source_endpoint: string
  source_version: string
  route_status:
    discovery: live | fallback | catalog | failed | seed_only
    profile: live | fallback | catalog | failed | unavailable
    posts: live | fallback | catalog | failed | unavailable
    comments: live | fallback | catalog | failed | unavailable
    audience: live | catalog | authorized | failed | unavailable
    quote: live | user_provided | authorized | failed | unavailable
    commerce: live | catalog | authorized | failed | unavailable
    conversion: live | catalog | authorized | failed | unavailable
  evidence_coverage:
    available_dimensions: [scene_fit, stable_performance, audience, category_history, price, seeding, conversion]
    missing_dimensions: [string]
    comparable_score_available: true | false
  profile:
    followers: number | null
    followers_captured_at: ISO-8601 | null
    category_labels: [string]
    quote: { min: number | null, max: number | null, currency: string | null }
    quote_source: xingtu | platform_backend | mcn | creator | user | unavailable
    forecast_play: number | null
    forecast_cpm: number | null
    forecast_cpe: number | null
  recent_posts:
    period: latest_10
    posts:
      - item_id: string
        published_at: ISO-8601 | null
        content_age_hours: number | null
        content_format: short_video | long_video | image_text | article | post | other
        title: string | null
        labels: [string]
        views: number | null
        likes: number | null
        comments: number | null
        shares: number | null
        completion_rate: number | null
        interaction_rate: number | null
        metric_basis: views | reads | impressions | followers | unavailable
        available_metrics: [string]
        visible_brands: [string]
        category_tags: [string]
    median_views: number | null
    median_completion_rate: number | null
    median_interaction_rate: number | null
    view_range: { min: number | null, max: number | null }
    stability_metric:
      name: min_max_ratio | median_max_ratio
      formula: min_views/max_views | median_views/max_views
      value: number | null
    title_visible_commercial_density: number | null
    direct_category_density: number | null
  historical_evidence:
    brand_posts: [post_evidence]
    competitor_posts: [post_evidence]
  recent_commercial_activity:
    status: verified | unavailable | requires_authorization
    latest_verified_commercial_at: ISO-8601 | null
    checked_at: ISO-8601 | null
    evidence_type: observed_public | authorized_actual | missing
    evidence_refs: [string]
    selection_reason: string | null  # 31–90天候选的增量价值或无同角色近30天候选
    evidence:
      - evidence_ref: string
        creator_key: string
        commercial_at: ISO-8601  # 实际合作/商单内容发布时间，不能用抓取时间
        record_kind: platform_commercial_record | authorized_cooperation_record | explicit_paid_partnership
        evidence_type: observed_public | authorized_actual
        source_ref: string  # 可追溯的订单/合作资料/内容ID或URL
        source_field: string  # 商单记录或明确合作标记所在的原始字段
        commercial_marker: string  # 明确合作声明/平台商业内容标记/订单记录摘要
  asset_reuse_evidence:
    - content_id: string
      brand: string
      ownership_or_license: owned | licensed | pending_verification
      valid_until: ISO-8601 | null
  audience:
    source: xingtu | platform_model | authorized_backend | unavailable
    status: verified | modelled | authorized | unavailable
    gender: [{ label: string, share: number }]
    age: [{ label: string, share: number }]
    city_tier: [{ label: string, share: number }]
    city: [{ label: string, share: number }]
    interests: [{ label: string, share: number }]
    life_stage_labels: [{ label: string, share: number }]
  comments:
    sampled_item_ids: [string]
    purchase_intent_signals: [string]
    product_questions: [string]
    negative_signals: [string]
    ad_fatigue_signals: [string]
    status: verified | unavailable | requires_authorization
  commercial_capability:
    cohort_definition: string | null
    recommendation_fit_score: number | null
    commercial_capability_score: number | null
    risk_adjusted_score: number | null
    commercial_evidence_coverage: number
    strongest_capabilities: [reach | audience_fit | seeding | conversion | cost_efficiency]
    recommended_roles: [声量 | 专业验证 | 场景种草 | 搜索内容 | 转化测试 | 素材资产]
    dimensions:
      reach: { score: number | null, evidence_refs: [string] }
      audience_fit: { score: number | null, evidence_refs: [string] }
      seeding: { score: number | null, evidence_refs: [string] }
      conversion: { score: number | null, evidence_refs: [string] }
      cost_efficiency: { score: number | null, evidence_refs: [string] }
      risk: { level: low | medium | high | unknown, penalty: number | null, evidence_refs: [string] }
    commerce_signals:
      gmv_range: { min: number | null, max: number | null, currency: string | null }
      product_click_range: { min: number | null, max: number | null }
      click_through_rate_range: { min: number | null, max: number | null }
      conversion_rate_range: { min: number | null, max: number | null }
      related_video_count: number | null
      related_product_count: number | null
      representative_video_refs: [string]
      representative_product_refs: [string]
    evidence:
      - evidence_ref: string
        metric: string
        value: number | string | object | null
        evidence_type: observed_public | platform_estimate | authorized_actual | model_derived | missing
        source_endpoint: string | null
        captured_at: ISO-8601 | null
        note: string | null
  limitations: [string]
```

## 投放组合输出

> 📖 详见 [`handoff-contracts.md`](handoff-contracts.md)。**按需读取**。

## 投中监测交接

> 📖 详见 [`handoff-contracts.md`](handoff-contracts.md)。**按需读取**。

## 字段解释

- `followers`：抓取时点的原始粉丝数，必须在候选横向表与逐人尽调卡展示；不可仅用“万”或“百万”模糊代替原始值。粉丝数用于判断账号规模，不能作为播放或转化表现的替代指标。
- `platform_gaps`：用户要求的平台若没有候选，必须逐平台登记原因、失败路由和决策影响；不得静默缺失或用其他平台候选替代。
- `stability_metric`：名称与公式必须严格配对，防止把最小/最大比误报为中位/最大比。
- `asset_reuse_evidence`：进入“素材复用优先”的必要证据；没有既有内容及授权状态时保持空数组，并禁止使用该层级。
- `followers_captured_at`：粉丝数的获取时间。粉丝数会变化；若该字段缺失，报告应标注“粉丝数时点未确认”。
- `median_views`：最新 10 条有播放数据作品排序后的中位数；偶数样本取中间两项平均值。样本不足时注明有效样本数。
- `completion_rate` / `median_completion_rate`：作品完成播放率及近 10 条中位数。记录接口原始口径；不可与不同视频时长、不同平台口径直接做绝对比较。
- `interaction_rate` / `median_interaction_rate`：接口返回的互动率及近 10 条中位数。点赞、评论、分享须同时保留，以便判断互动构成，不能只展示一个百分比。
- `creator_key` 是账号唯一键；`entity_cluster_id` 只在身份有可验证证据时用于跨平台去重。账号投放位与自然人/机构实体数必须分别统计。
- `evidence_coverage` 显示本平台实际可评分维度。缺失受众或报价不计为零，也不允许用推断补齐；跨平台不得按一个总分排序。
- `recommendation_fit_score` 回答“是否适合本次项目”，`commercial_capability_score` 回答“已有哪些可验证的商业能力”；两者必须分列，不得合并成一个无法解释的推荐分。
- `commercial_evidence_coverage` 按商业能力五个正向维度的原始权重计算。目标关键维度缺失时，综合商业能力分为 `null`，不得通过重归一化掩盖缺口。
- `commerce_signals` 优先保存接口原始区间和对象引用。GMV、点击、转化率等星图字段若为预估或区间，`evidence_type` 必须是 `platform_estimate`；只有授权后台实际结果才可标记 `authorized_actual`。
- `dimensions.*.evidence_refs` 必须指向 `commercial_capability.evidence[].evidence_ref`，使每个分项分数可回溯到原始事实；不能只写“带货能力强”。
- `recommended_roles` 必须由强项、目标适配和风险共同决定，并在组合方案中通过 `capability_role_basis` 保留依据。
- `recent_posts` 使用最多 10 条实际有效样本。没有作品列表路由或字段不足时保留真实样本数；完播率、互动率或播放缺失均为 `null`。
- `audience.source` 必须指向直接数据来源。内容题材、用户名或评论不能用于推断真实年龄、性别、城市级别或人生阶段。
- `followers` 与 `median_views` 应并列展示，用于识别账号规模和近期内容效率的关系；不得据此推导真实流量来源、成交或 ROI。
- `title_visible_commercial_density`：标题、标签或可见品牌字段中能识别为品牌/商品合作的作品占比，是保守近似，不能称为“官方商业内容占比”。
- `direct_category_density`：与本次品类直接相关的作品占比。例如扫地机项目中，扫地机、洗地机、吸尘器等应单列，避免把所有广告混在一起。
- `historical_evidence`：每条需保留作品 ID、可见品牌、发布时间、播放与互动；区分本品、直接竞品、相邻竞争品类。
- `recent_commercial_activity`：推荐资格的商单时效证据。`verified` 仅接受平台商业记录、授权后台/MCN/达人提供的订单或合作记录，或有明确付费合作标签、合作声明的公开内容；不能用泛广告密度、推测或普通内容题材代替。非淘汰层级必须有一条距 `checked_at` 不超过 90 天的有效记录，并保留日期、证据类型和可追溯引用。距核验日 30 天内为优先候选，31–90 天为可选候选；超过 90 天或无法验证时只能列入淘汰/暂缓，不得作为推荐、替补或组合成员。
- `recent_commercial_activity.evidence_refs` 必须解析到同对象 `evidence` 内的商单证据；事件日期取证据的 `commercial_at`，最近日期取所引证据最大值。`online_status`、报价起止时间、普通发帖时间与抓取时间均不构成商单发生证据；平台效果预估也不能证明已发生商单。
- `audience`：星图/平台模型标签，须保留原始标签与占比，不将兴趣标签等同于真实家庭身份。
- `comments.status`：没有可访问的逐条评论时必须是 `unavailable` 或 `requires_authorization`，其他评论字段保持空值。
- `budget_status=closed` 时，所有非空 `budget_lines.amount` 合计不得超过 `total_budget.amount`，且未知交易成本已被明确预留；否则使用 `partial`。
- `coverage.status=overlap` 表示多个达人承担高度相似的任务，需要说明保留重复覆盖的理由；没有增量价值的高分达人应进入替补而非机械入选。
- `decision_rule` 的基准优先级为品牌已确认目标、达人自身近期基线、同批同口径中位表现；平台预估与策略阈值必须明确标注，不能写成真实结果。
- `monitoring_handoff` 只能携带已确认值或明确的 `null`。缺少内容 URL 不等于无需监测，应按平台、达人和发布时间窗口执行发现任务。
- 计划改版、替补启用或预算重分配时生成新 `plan_version`；旧版本用于解释历史决策，不得覆盖。
- `upstream_context` 携带可独立消费的完整对象，不能只给无法解析的字符串引用；引用 ID 用于追溯，不替代实际查询、风险和证据字段。

## 结论的证据等级

<!-- 已按客户口径统一为一级～四级，原为 A/B/C/D -->
|等级|含义|可使用的表述|
|---|---|---|
|一级|接口或后台的直接数值/作品记录|“近 10 条中位播放为…”|
|二级|标题、标签、公开内容中的可见事实|“标题可见近期出现…”|
|三级|根据一/二级证据得到的运营判断|“适合以…场景测试”|
|四级|尚未获取的数据|“需在签约前核验”|
