---
name: creator-recommendation
description: Use when 品牌需要达人发现、二次背调、候选筛选，或在总预算内规划达人组合、角色分工和分阶段测试；不用于直接下单、投中监测或投后复盘。
---

## 企业版数据调用

本技能通过本目录的只读调用器和 `scripts/enterprise_proxy.mjs` 访问统一 API 网关的 `tikhub` 连接。企业插件自动携带当前登录态，后台管理 TikHub 凭据、鉴权与请求头；技能不得读取用户 Token 或厂商 Key，也不得直接请求 TikHub。

接口合同、费用门禁、必填参数、业务响应检查与任务台账仍由本技能执行。网关失败或结果不确定时停止该任务的路由调用，保留已有证据和计费未知状态；先核对请求结果，再决定是否显式恢复。

# 达人推荐与二次背调

## 目标

把品牌需求转化为一份可执行、可复核的达人投放建议。输出必须区分：

- 已由数据验证的事实；
- 基于事实做出的判断；
- 下单前仍须由品牌、MCN 或达人后台核验的事项。

TikHub 取数必须走版本化接口合同 `references/tikhub-endpoints.json` 和只读调用器 `python3 scripts/tikhub_readonly.py`。调用器固定 HTTP 方法、参数语义、费用上限与响应净化；不得绕过合同临时拼接请求。Skill 不保存、索取、展示或写入任何 API Key、Cookie、达人账号密码或其他凭证。

遇到接口报错、批量空结果或需要扩样时，读取 [调用与故障处理](references/api-execution.md)。该文件提供可直接运行的参数写法、路由探测、熔断及费用台账口径。

## 输入

先收集或从上下文提取以下信息；缺失且不会改变结论的项目可作明确假设，缺失且会显著影响选择时才向用户确认：

```yaml
brand_brief:
  mode: shortlist | portfolio | full_plan
  brand: 品牌名
  product: 产品/型号
  category: 品类
  # 取值必须是 references/data-contract.md 的平台 slug 枚举（下游按 slug 落库）
  platforms: [douyin, xiaohongshu, bilibili, weibo, kuaishou, wechat_channels, tiktok, instagram, youtube, x, threads, lemon8]
  conditional_platforms: [wechat_mp, zhihu, reddit, linkedin, xigua, pipixia, toutiao]
  objective: 种草 | 搜索提升 | 转化 | 内容资产 | 上市声量
  target_audience:
    city_tier: [一线, 新一线]
    gender: 女性为主
    age: [25-40]
    life_stage: [养宠, 带娃, 装修, 大户型]
  product_scenarios: [宠物毛发, 地毯, 低矮家具底部]
  competitors: [竞品品牌]
  exclusions: [不可合作的品类或达人类型]
  upstream_insight:
    handoff_id: 可选，来自 category-competitor-insight
    opportunity_inputs: [按 opportunity_id 成组的场景、人群、动作证据、达人类型和主张护栏]
    query_manifest: [可选，完整查询对象]
    risk_watchlist: [可选，完整风险对象]
    evidence_manifest: [可选，完整证据对象]
  previous_learning_returns: [可选，来自 brand-campaign-monitoring]
  budget:
    total: 可选
    per_creator: 可选
    currency: CNY
    includes_platform_fees: true | false | unknown
    data_research_cap_usd: 可选
  portfolio:
    desired_creator_count: 可选
    required_roles: [声量, 专业验证, 场景种草, 搜索内容, 转化测试]
    campaign_phases: [首测, 放量]
    deliverables: [原生视频, 素材授权, 白名单]
    risk_preference: conservative | balanced | aggressive
    paid_amplification_allowed: true | false | unknown
    first_party_metrics_available: [搜索, 点击, 加购, 成交]
  period: 近30天
```

## 模式

- `shortlist`：发现、背调和排序候选；总预算缺失时默认使用该模式。
- `portfolio`：已有候选池，在总预算内完成角色分工、组合去重、预算闭合和分阶段测试。
- `full_plan`：从产品场景化开始，连续完成候选发现、背调、组合与测试方案。

用户明确要求“组合、预算、投放矩阵或怎么搭配”时选择 `portfolio`；同时要求重新找达人时选择 `full_plan`。`portfolio` 或 `full_plan` 必须读取 [投放组合规划规则](references/portfolio-planning.md)。

开始执行前必须读取 [数据契约](references/data-contract.md)、[评分规则](references/scoring.md) 和 [报告模板](references/report-template.md)。涉及平台选择、候选发现或账号背调时必须读取 [达人平台路由与字段能力](references/creator-platform-routing.md)。

## 输入门禁

任何付费调用前，必须冻结品牌/产品/品类、目标平台、投放目标、目标人群（或明确采用“泛人群探索”）、预算与单达人上限、时间窗及 `data_research_cap_usd`。缺少会改变候选池或预算组合的字段时先向用户确认；不得在等待澄清时先跑候选发现。接收品类洞察时还必须确认 `upstream_insight.handoff_id`、机会 ID 与主张护栏可解析，否则只做补充提问，不启动达人查询。

## 工作流

### 1. 产品场景化

将产品能力翻译成达人可以自然演示的生活任务，而不是只以泛类目筛选。每个场景至少写清：

- 用户痛点、产品能力、可拍的动作证据；
- 适合的达人类型；
- 对应的受众特征；
- 不适配的表达方式或风险。

例如，扫地机器人应拆成养宠毛发、带娃碎屑、装修入住、大户型/复杂地面、技术测评等不同任务；不得将“家居达人”作为充分推荐依据。

若输入带有 `upstream_insight`，先按 `handoff_id` 和 `opportunity_inputs[].opportunity_id` 逐组复用场景、人群、动作证据和主张护栏，只对缺口补充研究。不得把 `creator_archetypes` 当作已验证达人，也不得在没有新证据时改写上游禁用表达。仍在有效期内的 `evidence_manifest` 优先复用。

若输入包含 `previous_learning_returns`，按 `return_id` 记录采纳、拒绝或待验证。采纳达人任务、替补或 KPI 建议时生成新 `plan_version` 并引用原 `return_id`，不覆盖旧计划或自动重写历史评分。

### 2. 候选发现

按 [达人平台路由与字段能力](references/creator-platform-routing.md) 选择每个平台已验证的“商业搜索、内容导向发现、账号搜索或 seed-only”入口。筛选条件优先级为：产品场景相关性 → 可验证的目标受众证据 → 距核验日 30 天内的可验证商单活跃度 → 平台内近期内容表现 → 已验证报价与预算 → 标题可见商业密度 → 竞品冲突。距核验日 31–90 天仍有可验证商单记录的达人可进入补充池；超过 90 天无可验证商单记录的达人不进入推荐、替补或组合。

- 同一能力有多版接口时，选择最近实测成功且业务字段有效的路由；新版失败时使用已验证 fallback，不能仅凭 HTTP/顶层成功判定可用。
- 抖音星图候选发现当前首选 `search_kol_v2`（`GET /api/v1/douyin/xingtu/search_kol_v2`，2026-10-16 实测有效）：单次最多 20 位，直接带 `star_id`、`core_user_id`、粉丝数、省份/城市、`price_20_60`/`price_60` 报价、`last_10_items`（标题/播放/赞评转）与 `task_infos.price_infos`。该路由不支持 `page`，扩样按场景关键词与粉丝区间切分并按 `star_id` 去重；`followerRange=10-100` 表示10万–100万粉丝，单个区间零结果只记本次 `empty`。报价、地域与互动条件必须在返回数据上逐项过滤。
- `xingtu_v2/search_creator` 自 2026-10-16 起上游 400 失败（`search_anchor`、`xingtu/search_kol_v1` 同时失败），恢复前不得作为发现链路。恢复后按内容发现必须显式 `seach_type=3`，`seach_type=2` 只用于用户已给出准确昵称的账号核验，不得把昵称搜索结果当成类目候选池。
- 用户要求的平台必须产出候选，或写入 `platform_gaps` 并说明缺失链路和决策影响；不得用抖音候选代替小红书、B站或海外平台候选。
- 记录数据抓取日期、平台和主要筛选条件。
- 粉丝数是**必保留、必展示**的达人规模指标；同时保留近 10 条中位播放或等价的稳定性指标。两者必须并读，不得用粉丝数替代内容表现。
- 初筛阶段保留足够候选，不把单条爆款直接视为保量能力。

视频号、LinkedIn、今日头条等 `seed_only` 平台只有用户提供已知账号/URL/ID 时进入背调，不能据此承诺“发现一批新达人”。`catalog` 路由先对一个对象做业务健康检查，成功后才能扩样。

#### 双对象语义健康检查

任何按达人 ID 返回画像、传播、地域、市场或商业能力的路由，在首次使用或状态变更后必须用两个已确认不同的达人执行双对象语义健康检查：核对请求 ID 来自合同指定字段（星图详情优先使用 19 位 `star_id`），验证核心字段非空，且两份净化后的业务数据不能完全相同。可运行 `python3 scripts/tikhub_guard.py canary --left <A.json> --right <B.json> --core-field <字段路径>`。若返回相同默认 payload、对象不匹配或核心字段空，立即将该路由标记为 `failed`，不得继续扩样或用于评分。

### 3. 二次背调

对进入候选名单的每位达人统一富集，字段与可用性按 [数据契约](references/data-contract.md) 执行。若任务涉及达人价值判断、邀约优先级、预算分配或投放角色，必须同时建立 `commercial_capability` 商业能力画像。

按平台字段可用性尽量完成：

1. 最多最近 10 条有效作品：保留实际样本数、内容形态、内容年龄和接口明确返回的播放/阅读、点赞、评论、分享、收藏、完播率或互动率；只对存在且口径一致的字段计算中位数和波动范围。
2. 达人粉丝数：记录抓取时点的原始粉丝数，并与近 10 条中位播放共同判断账号规模、内容效率和放量风险。
3. 标题可见的商业内容密度、同品类内容密度，以及近期本品/品牌/竞品合作证据。
4. `recent_commercial_activity`：最近一条可验证商单的日期、核验日期、证据类型与引用。只有平台商业记录、授权后台/MCN/达人提供的订单或合作记录，或有明确付费合作标签、合作声明的公开内容可标记为 `verified`；泛广告密度、内容题材或推测不构成商单记录。近 30 天为优先候选，31–90 天为可选候选；超过 90 天或无法验证时只能列入淘汰/暂缓。
   `online_status=1`、报价单起止时间、任务类型、连接指数、普通作品发布时间和数据抓取时间均不证明发生过商单。逐条商单证据写入 `recent_commercial_activity.evidence`，保留事件日期、账号键、来源字段与明确合作标记；禁止将 `checked_at` 代填商单日期。无法取得时保留已发现的账号为“暂缓：商单待核验”，不得为凑足用户要求的人数降低门槛。
5. 人群分布以抖音星图 `get_author_fans_distribution` 为主来源（2026-10-16 双对象语义健康检查通过，返回省份/城市/年龄/性别/城市等级/兴趣/八大人群与更新时间）：使用前必须先跑 canary，保留原始标签与占比，并在报告中写成「平台模型标签」，不得当作真实身份、家庭结构或购买行为核验。2026-09-21 记录的 `get_author_audience_distribution` 仍为 `failed`，不得使用。其他平台无直接接口或授权后台数据时保持 `unavailable`。
6. 报价、预估播放、CPM/CPE 只有抖音星图已实测：报价取自 `search_kol_v2` 的 `price_20_60`/`price_60` 与 `task_infos.price_infos`（`online_status=1` 表示在架接单），近 30 天中位播放、完播率、互动率、稳定性与预期 CPM/CPE 取自 `get_author_spread_info`；其他平台在用户、MCN 或后台提供前保持 `null`，不估算。
7. 只在逐条评论链路实际有效时抽查购买意向、产品疑问、负面体验和广告反感。TikTok、Instagram 等已知失败平台标记 `unavailable`，不可用评论数替代评论文本。
8. 商业能力画像必须拆分为内容传播力、人群匹配度、种草能力、带货转化力、商业性价比，以及单列的稳定与风险。每个维度都引用原始证据并标记为公开事实、平台估算、授权实际、模型计算或缺失。
9. 抖音优先使用星图 V2 的报价、人群、传播、转化能力、历史转化视频/商品和商业效果预估路由；除已实测 `live` 路由外，`catalog` 路由先做单达人业务健康检查。TikTok Creator 电商分析只用于账号所有者授权的数据，不能拿来公开背调竞品达人。
10. 交付需要可直接点击的平台链接时：抖音主页链接用 `encrypt_uid_to_sec_user_id`（uid → `sec_user_id`，拼 `https://www.douyin.com/user/{sec_user_id}`），并抽样用公开搜索交叉核验 uid 与昵称一致；星图主页链接按 `https://www.xingtu.cn/ad/creator/author/douyin/{star_id}` 构造，必须注明需登录星图且未经登录态实测，或改用「星图 ID + 达人广场搜索」表述。

### 4. 评分与分层

按 [评分规则](references/scoring.md) 在同平台、同内容形态的可比 cohort 内分别计算 `recommendation_fit_score` 与 `commercial_capability`，并同时给出 `evidence_coverage` 和 `commercial_evidence_coverage`。前者回答“是否适合本项目”，后者回答“适合承担什么商业任务”；不得合并成一个分数。跨平台组合不用一个总分机械排序。输出层级：

- **优先邀约**：场景、直接受众证据、稳定性及历史证据均成立，且有近 90 天可验证商单记录；受众字段缺失时禁止进入本层；
- **小额测试**：有近 90 天可验证商单记录，且有潜力但缺少转化/品类验证，或稳定性不足；
- **条件型补充**：有近 90 天可验证商单记录，只适合细分人群、技术背书或素材资产；
- **素材复用优先**：有近 90 天可验证商单记录，且必须有可引用的既有品牌素材、授权范围或历史作品证据；没有 `asset_reuse_evidence` 时禁止进入本层；
- **淘汰/暂缓**：存在明确冲突、受众偏离或无法支撑预算。

分数不能掩盖一票否决风险：有效竞品排他、明显的广告疲劳、无法接受的报价、品牌安全问题，应单独置顶。粉丝数不单独加权，避免与播放规模重复计分；它必须作为名单和单卡中的规模诊断字段展示。完播率和互动率只在口径、样本期和数据来源可比时横向比较。

商业能力综合分只在五个正向维度证据完整，或覆盖率达到评分规则门槛且目标关键维度不缺失时生成。风险作为扣分或硬门槛单列；缺少 GMV、点击或转化数据时，不得从播放、点赞或评论意向反推成交能力。

稳定性指标必须同时输出机器可读的名称、公式和值：`min_max_ratio = min_views/max_views` 与 `median_max_ratio = median_views/max_views` 不得混名。没有受众、报价或转化证据时不得通过重归一化制造完整高分；“泛人群探索”最多进入“优先测试/小额测试”，不能升级为“优先邀约”。

同一自然人/机构的多个平台账号分别保留 `creator_key`，只有可验证互链或用户确认时才合并到 `entity_cluster_id`。组合覆盖和预算集中度同时按账号与实体查看，避免重复计算增量覆盖。

### 5. 形成可执行建议

`shortlist` 模式直接进入输出。`portfolio` 和 `full_plan` 模式按 [投放组合规划规则](references/portfolio-planning.md) 将入围达人组成预算闭合的投前方案；组合选择看角色、场景、人群和内容形式的增量覆盖，不按单达人分数机械取前 N 名。

组合规划必须给出：

- 每位达人的主任务、选择理由、最近商单活跃度和可替补对象；近 30 天候选优先，31–90 天候选入选时说明其不可替代的增量价值；
- 每位达人的商业能力强项、证据覆盖率，以及强项与主任务的对应关系；
- 场景、人群、内容形式与投放目标的覆盖及重叠；
- 达人费、制作/授权、加热测试、承接/归因和机动预留的预算口径；
- 首测、观察、放量或停止的条件；
- 尚未报价或没有第一方数据时的预算情景与待核项。

阈值优先使用品牌目标、达人自身近期基线或同批可比内容。没有依据时只定义指标和决策方式，不自行发明固定增长百分比、CPA 或 ROI 目标。

### 6. 输出

使用 [报告模板](references/report-template.md) 输出。每位达人必须有：平台与 `creator_key`、可选跨平台实体归并、各能力路由状态、粉丝数及抓取时点、实际有效作品样本数、接口真实返回的可比指标、`evidence_coverage`、商业能力五维分项、稳定与风险、`commercial_evidence_coverage`、推荐角色、结论、内容命题和签约前待核事项。缺失完播率、受众、报价、GMV或转化时保留 `null`，不补估。

最后给出：

- 达人组合及各自任务；
- 适用模式下的预算闭合、测试方式和有依据的加投阈值；
- 合同/排期/素材/评论运营/归因的投前清单；
- 数据能力边界。

先将结构化结果保存为 JSON，再运行 `python3 scripts/validate_creator_output.py --input <结果.json>`。校验失败时不得交付正式名单或组合方案；必须修正平台缺口、层级证据、稳定性口径或瞬时字段后重跑。

`portfolio` 和 `full_plan` 还必须按 [数据契约](references/data-contract.md) 输出 `monitoring_handoff`，供 `brand-campaign-monitoring` 直接消费。交接包至少包括：计划 ID/版本、带平台的达人监测注册表、发布窗口与交付数量、角色/场景/信息点、预算分配、指标公式与阈值、逐指标基线、一方数据映射、查询/风险清单引用和计划状态。

> 输出对象（投放组合、投中监测交接）的字段定义见 [`references/handoff-contracts.md`](references/handoff-contracts.md)。**按需读取**。

内容 URL 在投前未知时保持空值，并以 `platform + creator_id + planned_publish_window` 作为发现任务；上线后补入内容 ID/URL。替补启用、达人取消或计划改版时递增版本并保留旧版本，不静默覆盖。

本 Skill 的终点是投前方案。发布后的持续采集、动态调预算属于投中监测；对实际传播或销售结果的评价属于投后复盘，不在本 Skill 中执行。

## 数据与费用护栏

- 只调用完成当前问题所必需的只读接口；先检索、再对入围候选深取。
- 研究预算被指定时，调用前按端点公开价估算，并在可能超额时停止并报告。
- 缓存同一达人、同一时间窗口的原始结果，避免重复付费调用。
- API Key 由统一 API 网关后台管理；严禁把凭证写入报告、日志、Skill、脚本或命令输出。
- 先用 `python3 scripts/tikhub_readonly.py --dry-run ...` 检查合同方法、默认语义与单次价格，再执行真实请求。
- 只读调用器禁止在执行脚本中读取 `.env`、`config.toml`、Shell profile 或其他配置文件；请求经企业插件和统一 API 网关发送。
- 原始响应必须先经 `scripts/tikhub_guard.py sanitize`；`cache_url`、`xsec_token`、`sign`、Cookie、认证头和短期签名媒体 URL 不得进入缓存、日志、模型上下文或报告。
- 同一路由先一笔健康探测，通过后再批量检索。上游 400、嵌套业务失败或结构失配时停止该任务内该路由扩样，使用同一任务 `--ledger` 保留状态并切换已验证 fallback；如有明确参数修正，可用 `--recheck-route` 做一次诊断。正常零命中记为 `empty`，调整关键词/筛选条件，不全局停用端点。
- `catalog` 路由只允许在显式单对象健康检查（`--allow-catalog`，每次一条）通过后扩样；ID 型画像/传播/人群/市场路由首次使用或状态变更后必须通过双对象语义健康检查。
- 请求头由统一 API 网关管理。供应商原始响应可用时，403 结合净化诊断区分 `edge_blocked`、`authentication_error` 和 `forbidden_unknown`；网关错误统一记 `gateway_error`，不能用网关状态码推断供应商鉴权。网络、TLS 或读超时均不自动重试，计费保持 `unknown`；只有平台明确声明不扣费时才能记为不计费。`--max-cost-usd` 是单次声明费用上限，累计研究费另按任务台账核算。
- 不调用下单、邀约、私信、登录、支付或改变第三方状态的接口，除非用户在当次请求中明确授权。

## 事实边界

公开作品数据通常可支持内容表现、标题可见品牌合作与公开互动的判断。以下信息必须有相应授权数据或可验证接口才可下结论：

- 推荐/搜索/关注/主页/付费等真实流量来源；
- 商业内容的官方精确占比；
- 评论的完整负面率与情绪分布；
- 星图订单、排他合同、实际成交与 ROI；
- 用户是否真实养宠、带娃或购买过产品。

对于以上字段，使用“待核验”“平台模型标签”“标题可见推断”等准确措辞，不将推断包装为事实。
