# 达人候选与背调平台路由

## 状态与使用规则

本表基于截至 2026-10-16 的 TikHub 真实链路测试和 OpenAPI。端点方法、参数与最新健康状态以 `tikhub-endpoints.json` 为执行合同；本表解释平台能力边界。

> **状态词表（三种路由表共用）**：`core` 搜索与详情/评论/账号链路均实测通过 ｜ `fallback` 需固定降级版本或参数 ｜ `partial` 部分监测可用但有明确缺口 ｜ `known_object` **仅已知 URL/ID/账号可查，不作为关键词发现入口** ｜ `authorized` 目录有但 Token 权限不足 ｜ `unavailable` 已移除或实测失效。
> 同一平台可因能力不同而给出不同状态：**发现**能力与**已知对象**能力分别评估；三张表冲突时取更保守者并在报告中注明口径。

> 本表的 `live` / `catalog` / `failed` / `seed_only live` 描述的是**端点级**可用性；换算到上面的能力状态时：`live`→`core` 或 `fallback`、`catalog`/`seed_only`→`known_object`、`failed`→`unavailable`。视频号 / LinkedIn / 今日头条三者在三张表中的统一口径为 `known_object`（仅已知对象可查）。

- `live`：本轮或既有 POC 已取得有效业务数据。
- `fallback`：可用，但必须固定指定版本或 ID 转换。
- `catalog`：当前 OpenAPI 存在、尚未逐条实测；调用前只做一条小样本健康检查，通过后才能扩样。
- `failed`：已知返回错误、空发现或嵌套超时，不进入默认链路。
- `seed_only`：只支持用户给定账号、URL 或内容 ID 的背调，不承诺发现新候选。

`catalog` 不是“已验证可用”。报告必须分别显示候选发现、账号、作品、评论、受众与报价的字段状态。

## 默认达人平台

| 平台 | 候选发现 | 账号与近期作品 | 评论背调 | 人群/报价 | 使用结论 |
|---|---|---|---|---|---|
| 抖音 | `live` `GET /api/v1/douyin/xingtu/search_kol_v2`（2026-10-16 实测）：单次 20 位，含报价、粉丝、省份/城市、近 10 条作品与 `task_infos` 报价单；**不支持翻页**，扩样靠多关键词切分。`failed`：`xingtu_v2/search_creator`、`search_anchor`、`xingtu/search_kol_v1`（2026-10-16 上游 400）；恢复后内容发现须显式 `seach_type=3`。公共内容补充 `POST /api/v1/douyin/search/fetch_general_search_v2` | `live` `get_author_link_info`、`get_author_local_info`（达人常驻地）、`get_author_market_fields`、`get_author_spread_info`（近30天播放/完播/互动/稳定性/CPM·CPE 及同业分位）；星图详情优先使用 `star_id`（19 位）；`get_author_base_info` 仍失败 | `live` `/api/v1/douyin/app/v3/fetch_video_comments`；星图 `get_author_hot_comment_tokens` 可用 | `live` `get_author_fans_distribution`（省份/城市/年龄/性别/城市等级/兴趣/八大人群，2026-10-16 canary 通过）；报价取 `search_kol_v2` 的 `price_20_60`/`price_60` 与 `task_infos.price_infos`；`get_author_audience_distribution` 仍 `failed` | 可做商业发现 + 完整人群/传播/报价画像；人群为平台模型标签，所有 ID 型路由先做双对象语义健康检查 |
| 小红书 | `live` 内容导向 `/api/v1/xiaohongshu/app_v2/search_notes` → 作者；`catalog` `/api/v1/xiaohongshu/app_v2/search_users` | `live` `/api/v1/xiaohongshu/app_v2/get_user_info`；`catalog` `/api/v1/xiaohongshu/app_v2/get_user_posted_notes` | `live` `/api/v1/xiaohongshu/app_v2/get_note_comments` | `catalog` `/api/v1/xiaohongshu/pgy/get_blogger_fans_profile`；报价未实测 | 可发现并做公开内容背调；人群/报价未验证时为 `null` |
| B站 | `live` `/api/v1/bilibili/web/fetch_general_search` → UP 主 | `live` `/api/v1/bilibili/web/fetch_user_profile`；`catalog` `/api/v1/bilibili/web/fetch_user_post_videos`；详情固定 `fallback` `/api/v1/bilibili/web/fetch_one_video` + `bv_id` | `live` `/api/v1/bilibili/web/fetch_video_comments` | 无已验证商业人群/报价 | 可做公开账号、内容与评论背调；不用详情 V3 |
| 微博 | `live` `/api/v1/weibo/web/fetch_search` → 作者；用户搜索 V2 仅 `catalog` | `fallback` `/api/v1/weibo/web/fetch_user_info`；`catalog` `/api/v1/weibo/web/fetch_user_posts` | `fallback` `/api/v1/weibo/web/fetch_post_comments` | 无已验证商业人群/报价 | 固定 `web` V1；`web_v2` 详情/评论/用户已知失败 |
| 快手 | `catalog` `/api/v1/kuaishou/app/search_user_v2`；`live` feed/内容导向发现 `/api/v1/kuaishou/app/fetch_selection_feed` | `live` `/api/v1/kuaishou/app/fetch_one_user_v2`；`catalog` `/api/v1/kuaishou/app/fetch_user_post_v2`；详情 `/api/v1/kuaishou/app/fetch_one_video` | `live` `/api/v1/kuaishou/app/fetch_video_comment` | 无已验证商业人群/报价 | 用户搜索先健康检查；可用 feed/内容作者建立候选池 |
| 视频号 | `failed` `/api/v1/wechat_search/v2/fetch_search_videos` 两次返回空 | `seed_only live` `/api/v1/wechat_channels/v2/fetch_channel_info`、`/api/v1/wechat_channels/v2/fetch_user_videos`、`/api/v1/wechat_channels/v2/fetch_video_detail` | `seed_only live` `/api/v1/wechat_channels/v2/fetch_video_comments` | 无已验证商业人群/报价 | 只背调已知分享链、`object_id` 或 finder username；不能承担“发现一批达人” |
| TikTok | `live` 内容导向 `/api/v1/tiktok/web/fetch_general_search`；`catalog` `/api/v1/tiktok/web/fetch_search_user` | `live` `/api/v1/tiktok/web/fetch_user_profile`；`catalog` `/api/v1/tiktok/web/fetch_user_post`；详情 `/api/v1/tiktok/web/fetch_post_detail_v2` | `failed` `/api/v1/tiktok/web/fetch_post_comment` | 无已验证商业人群/报价；`/api/v1/tiktok/ads/get_creators_card` 未实测 | 可做公开候选、账号与作品；评论、人群、报价均不可作为必填 |
| Instagram | `live` `/api/v1/instagram/v1/fetch_search` → 用户/话题 | `live` `/api/v1/instagram/v1/fetch_user_info_by_username_v3`、`/api/v1/instagram/v1/fetch_user_posts_v2`、`/api/v1/instagram/v1/fetch_post_by_id` | `failed` `/api/v1/instagram/v1/fetch_post_comments_v2` | 无已验证商业人群/报价 | 可做账号与作品背调；只保留帖子级评论数，不做评论主题 |
| YouTube | `live` `/api/v1/youtube/web_v2/get_general_search_v2`，按 video/channel | `live` `/api/v1/youtube/web/get_channel_info`；`catalog` `/api/v1/youtube/web_v2/get_channel_videos`；详情 `/api/v1/youtube/web_v2/get_video_info_v2` | `live` `/api/v1/youtube/web_v2/get_video_comments` | 无已验证商业人群/报价 | 频道、长视频和 Shorts 分组；不可直接与短视频播放比较 |
| X / Twitter | `live` `/api/v1/twitter/web/fetch_search_timeline` → 作者 | `live` `/api/v1/twitter/web/fetch_user_profile`；`/api/v1/twitter/web/fetch_user_post_tweet`；`/api/v1/twitter/web/fetch_tweet_detail` | `live` `/api/v1/twitter/web/fetch_post_comments` | 无已验证商业人群/报价 | 适合观点型/KOL 候选；转推与原创分开 |
| Threads | `fallback live` `/api/v1/threads/web/search_profiles` | `live` `/api/v1/threads/web/fetch_user_info_by_id` → `/api/v1/threads/web/fetch_user_posts` → `/api/v1/threads/web/fetch_post_detail_v2` | `live` `/api/v1/threads/web/fetch_post_comments` | 无已验证商业人群/报价 | 不用已知失败的 `search_top` 或用户名直取主链 |
| Lemon8 | `live` `/api/v1/lemon8/app/fetch_search` → 作者 | `catalog` `/api/v1/lemon8/app/fetch_user_profile`；`live` 内容详情 `/api/v1/lemon8/app/fetch_post_detail`；无用户作品列表路由 | `live` `/api/v1/lemon8/app/fetch_post_comment_list` | 无已验证商业人群/报价 | 可做内容导向候选；不能保证取得统一“最近 10 条” |

## 条件型创作者来源

这些平台可用于特定任务，但不进入默认商业达人全量池：

| 平台 | 明确链路 | 适用条件 |
|---|---|---|
| 微信公众号 | `live` `/api/v1/wechat_search/v2/fetch_search` → `/api/v1/wechat_mp/v2/fetch_article_detail`、`/api/v1/wechat_mp/v2/fetch_article_stats`、`/api/v1/wechat_mp/v2/fetch_article_comments`；账号/文章列表为 `catalog` `/api/v1/wechat_mp/v2/fetch_account_profile`、`/api/v1/wechat_mp/v2/fetch_account_articles` | 内容作者、媒体或垂直公众号；阅读与短视频播放不可比 |
| 知乎 | `live` `/api/v1/zhihu/web/fetch_article_search_v3`、`/api/v1/zhihu/web/fetch_column_article_detail`；用户搜索/资料/文章为 `catalog` `/api/v1/zhihu/web/fetch_user_search_v3`、`/api/v1/zhihu/web/fetch_user_info`、`/api/v1/zhihu/web/fetch_user_articles` | 专业答主、知识型内容；文章样本不能直接串回答评论 |
| Reddit | `live` `/api/v1/reddit/app/fetch_dynamic_search` → 保留 `t3_` 前缀 → `/api/v1/reddit/app/fetch_post_details`、`/api/v1/reddit/app/fetch_post_comments`；用户资料/帖子为 `catalog` `/api/v1/reddit/app/fetch_user_profile`、`/api/v1/reddit/app/fetch_user_posts` | 社区意见领袖或话题贡献者，不等同商业达人 |
| LinkedIn | `seed_only live` 已知公司 `/api/v1/linkedin/web_v2/get_company_posts` → `/api/v1/linkedin/web_v2/get_post_detail`、`/api/v1/linkedin/web_v2/get_post_comments`；公司 profile `failed` 嵌套超时 | B2B 企业号/高管内容；不做通用发现 |
| 西瓜视频 | `live` `/api/v1/xigua/app/v2/search_video` → `fallback` `/api/v1/xigua/app/v2/fetch_one_video` → `/api/v1/xigua/app/v2/fetch_video_comment_list`；用户资料/帖子为 `catalog` `/api/v1/xigua/app/v2/fetch_user_info`、`/api/v1/xigua/app/v2/fetch_user_post_list` | 中长视频作者；不用失败的详情 V2 |
| 皮皮虾 | `live` `/api/v1/pipixia/app/fetch_search` → `/api/v1/pipixia/app/fetch_post_detail`、`/api/v1/pipixia/app/fetch_post_comment_list`；用户资料/帖子为 `catalog` `/api/v1/pipixia/app/fetch_user_info`、`/api/v1/pipixia/app/fetch_user_post_list` | 特定内容生态测试；不调用增加浏览数接口 |
| 今日头条 | `seed_only live` 已知 `group_id` → `/api/v1/toutiao/app/get_article_info`、`/api/v1/toutiao/app/get_comments`；无关键词搜索 | 已知作者/文章背调，不承担候选发现 |

Telegram 当前 Token 缺少 scope，网易云音乐当前 OpenAPI 已移除，二者不进入候选池。

## 字段能力与比较

| 字段 | 可作为已验证主来源的平台 | 其他平台处理 |
|---|---|---|
| 报价、预估播放、CPM/CPE | 抖音星图：`search_kol_v2`（`price_20_60`/`price_60`、`task_infos.price_infos`）与 `get_author_spread_info`（`expect_cpm`/`expect_cpe`） | 用户/MCN/平台后台提供前为 `null`；不估算 |
| 性别、年龄、城市级别、兴趣、人生阶段 | 抖音星图 `get_author_fans_distribution`（2026-10-16 双对象语义健康检查通过） | 其他平台只有直接接口/授权后台返回且 canary 通过时填写；一律标注为平台模型标签，不从内容题材推断真实人口属性 |
| 粉丝数 | 对应账号接口实际返回的平台 | 保留抓取时点与原始口径；只做平台内规模诊断 |
| 播放/阅读 | 对应作品接口实际返回的平台；抖音另有 `get_author_spread_info` 的近30/90天中位播放与稳定性 | 按平台、内容形态和内容年龄分组；缺失为 `null` |
| 完播率 | 只有接口直接返回且口径明确的样本 | 不用点赞率或播放量代替 |
| 评论主题 | 逐条评论链路实际有效的平台 | TikTok、Instagram 等保持 `unavailable` |

## 达人商业能力路由

商业能力采集遵循“公开表现 → 平台商业估算 → 授权实际结果”的证据优先级。目录存在不等于已验证，调用前按状态做单达人健康检查。

|平台|维度|路由与状态|可用于的结论|
|---|---|---|---|
|抖音|传播与内容表现|`live` `get_author_spread_info`（近30/90天中位播放、完播率、互动率、稳定性、预期 CPM/CPE 与同业分位，2026-10-16 实测）+ `search_kol_v2` 的 `last_10_items`；`catalog` `get_author_spread_videos`、`get_author_daily_link`、`get_author_daily_link_score`|传播表现、内容稳定性与连接趋势；按实际字段标记公开事实或平台估算|
|抖音|人群匹配|`live` `get_author_fans_distribution`（2026-10-16 canary 通过，省份/城市/年龄/性别/城市等级/兴趣/八大人群）；`failed` `get_author_audience_distribution`|平台模型标签可直接支撑邀约层级的人群证据，但须标注为模型标签、不得写成真实身份|
|抖音|种草能力|`live` `get_author_hot_comment_tokens`；`get_author_convert_ability` 2026-09-21 未通过，公开视频评论为补充|热词和公开评论支持内容/疑问判断，不能写成成交或完整受众事实|
|抖音|带货转化|`catalog` `/api/v1/douyin/xingtu_v2/get_author_convert_ability`、`get_author_convert_videos_or_products`；旧版企业路由 `kol_conversion_ability_analysis_v1`、`kol_convert_video_display_v1` 仅作付费 fallback|GMV、点击、转化率区间及历史转化视频/商品；默认标记 `platform_estimate`|
|抖音|商业性价比|`live` `search_kol_v2` 报价 + `get_author_spread_info` 的预期 CPM/CPE 与同业分位；`catalog` `get_author_commerce_spread_info`|同任务 cohort 的成本效率与效果预估|
|TikTok|公开带货关联|`catalog` `/api/v1/tiktok/app/v3/fetch_creator_info`、`fetch_live_room_product_list`；公开作品/主页路由|识别带货身份、公开视频和直播商品关联，不等于店铺实际成交|
|TikTok|授权电商表现|`authorized` `/api/v1/tiktok/creator/get_account_insights_overview`、`get_product_analytics_list`、`get_video_to_product_stats` 等|仅用于已授权 Creator 账号的收益、曝光、点击、转化和商品分析，不用于竞品达人公开背调|
|其他平台|公开传播/种草|对应已验证账号、作品和评论路由|只评价公开内容表现和评论信号；人群、报价、GMV、转化缺失时保持 `null`|

接口返回只有顶层成功、空数组、字段语义不明或样本与达人不匹配时，路由状态不得升级为 `live`。GMV、点击、转化率和效果预估必须保留原始区间、统计周期、来源端点与抓取时间。

这里的路径是能力索引，实际可执行范围以 `tikhub-endpoints.json` 为准。未在合同声明的路径不得直接调用；先从官方定义补参数合同并探测，再按业务有效性判定。正常搜索零命中只表示本查询 `empty`，不据此把平台或路由整体改为 `failed`。故障诊断、台账与扩样方法见 [调用与故障处理](api-execution.md)。报价、在架接单与商单事件分开保存；`online_status=1` 不证明近期有商单。

评分先在同平台、同内容形态 cohort 内计算；跨平台组合不使用单一总分排序，而用场景、角色、人群证据、内容形式和平台增量覆盖。缺失人群/报价不自动扣为零，但必须降低 `evidence_coverage` 并列为签约前门槛。

## 跨平台身份

每个账号使用 `creator_key=platform:creator_id`。只有账号互链、相同官方主页、公开声明或用户确认等可验证证据支持时，才填写共同 `entity_cluster_id`；同时记录 `identity_confidence` 和证据。无法确认时保留为不同账号，但在组合报告中提示可能重复覆盖。
