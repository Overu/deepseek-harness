# 品类与竞品洞察平台路由

## 使用范围

> **状态词表（三种路由表共用）**：`core` 搜索与详情/评论/账号链路均实测通过 ｜ `fallback` 需固定降级版本或参数 ｜ `partial` 部分监测可用但有明确缺口 ｜ `known_object` **仅已知 URL/ID/账号可查，不作为关键词发现入口** ｜ `authorized` 目录有但 Token 权限不足 ｜ `unavailable` 已移除或实测失效。
> 同一平台可因能力不同而给出不同状态：**发现**能力与**已知对象**能力分别评估；三张表冲突时取更保守者并在报告中注明口径。

本表汇总截至 2026-09-21 已真实通过的 TikHub 只读链路，以及为正确降级必须知道的失败路由。精确方法和必填参数以 `tikhub-endpoints.json` 为执行合同；本表用于平台选择与业务解释。状态不等于各平台数据覆盖率；每次研究仍需记录查询、时间窗、返回样本量和数据新鲜度。

状态：

- `core`：发现与至少一条内容验证链路实测通过。
- `fallback`：主能力可用，但必须使用指定旧版或 ID 转换。
- `partial`：只能回答部分问题；不得补造缺失的评论、发现或账号数据。
- `known_object`：只能从已知 URL/ID/账号继续取数，不作为关键词发现入口。
- `authorized`：当前 Token 权限不足，不进入默认研究。
- `unavailable`：当前 OpenAPI 已移除或实测失效。

## 明确可用路由

| 平台 | 状态 | 发现/搜索 | 详情与账号验证 | 评论/用户声音 | 品类洞察用法与限制 |
|---|---|---|---|---|---|
| 抖音 | `core` | `POST /api/v1/douyin/search/fetch_general_search_v2`，body=`keyword,offset,count`；趋势 `POST /api/v1/douyin/index/fetch_multi_keyword_hot_trend`，query=`keyword_list,start_date,end_date`；热点 `GET /api/v1/douyin/billboard/fetch_hot_total_list`，至少传 `type` | `/api/v1/douyin/app/v3/fetch_one_video` | `GET /api/v1/douyin/app/v3/fetch_video_comments`，`aweme_id,cursor`；单页约 20 条，不能假定 `count` 生效 | 可做趋势、热点、内容和评论；日期为 `YYYYMMDD`；热点 `type=range` 需起止日期，snapshot 未传时点可能为空 |
| 小红书 | `core` | `/api/v1/xiaohongshu/web_v3/fetch_search_suggest`；`GET /api/v1/xiaohongshu/app_v2/search_notes`（POST 实测 405） | 图文 `/api/v1/xiaohongshu/app_v2/get_image_note_detail`；视频 `/api/v1/xiaohongshu/app_v2/get_video_note_detail`；账号 `/api/v1/xiaohongshu/app_v2/get_user_info` | `/api/v1/xiaohongshu/app_v2/get_note_comments` | 搜索结果先判断图文/视频类型；`web_v3/fetch_search_notes` 已知 404，不作 fallback |
| B站 | `fallback` | `/api/v1/bilibili/web/fetch_general_search` | `/api/v1/bilibili/web/fetch_one_video` + `bv_id`；账号 `/api/v1/bilibili/web/fetch_user_profile` | `/api/v1/bilibili/web/fetch_video_comments` | `fetch_one_video_v3` 对真实 URL 返回 400；固定用 V1 详情 |
| 微博 | `fallback` | `/api/v1/weibo/web/fetch_search` | `/api/v1/weibo/web/fetch_post_detail`；账号 `/api/v1/weibo/web/fetch_user_info` | `/api/v1/weibo/web/fetch_post_comments` | `web_v2` 详情、评论、用户均实测失败；固定用 `web` V1 |
| 知乎 | `partial` | `/api/v1/zhihu/web/fetch_article_search_v3` | `/api/v1/zhihu/web/fetch_column_article_detail` | `/api/v1/zhihu/web/fetch_comment_v5` 仅适用于回答 ID | 文章搜索样本不能直接串回答评论；默认只做文章主题与主张分析 |
| 快手 | `core` | `/api/v1/kuaishou/app/fetch_selection_feed`；当前目录另有 `/api/v1/kuaishou/app/search_video_v2` | `/api/v1/kuaishou/app/fetch_one_video`；账号 `/api/v1/kuaishou/app/fetch_one_user_v2` | `/api/v1/kuaishou/app/fetch_video_comment` | feed 主链已实测；关键词搜索路由需先做小样本业务健康检查再扩样 |
| 微信搜一搜 + 公众号 | `core` | `/api/v1/wechat_search/v2/fetch_search`，`business_type=article` | `/api/v1/wechat_mp/v2/fetch_article_detail`；账号 `/api/v1/wechat_mp/v2/fetch_account_profile` | `/api/v1/wechat_mp/v2/fetch_article_stats`；`/api/v1/wechat_mp/v2/fetch_article_comments` | 搜索文章 URL 再串公众号详情；统计与社交平台播放/互动不可直接比较 |
| 视频号 | `known_object` | `/api/v1/wechat_search/v2/fetch_search_videos` 实测业务成功但两个关键词均为空 | `/api/v1/wechat_channels/v2/fetch_video_detail`；`fetch_channel_info` | `/api/v1/wechat_channels/v2/fetch_video_comments` | 只对已知分享链、`object_id` 或 finder username 做验证；空搜索不代表无声量 |
| TikTok | `partial` | `/api/v1/tiktok/web/fetch_general_search` | `/api/v1/tiktok/web/fetch_post_detail_v2`；账号 `/api/v1/tiktok/web/fetch_user_profile` | `/api/v1/tiktok/web/fetch_post_comment` 对两个高评论样本均失败 | 可做内容、作者与可见互动；不得输出评论情绪/异议结论 |
| Instagram | `partial` | `/api/v1/instagram/v1/fetch_search` | `/api/v1/instagram/v1/fetch_user_info_by_username_v3`；`fetch_user_posts_v2`；`fetch_post_by_id` | `/api/v1/instagram/v1/fetch_post_comments_v2` 实测失败 | 可做账号、内容和帖子级评论数；不得生成评论主题 |
| YouTube | `core` | `/api/v1/youtube/web_v2/get_general_search_v2` | `/api/v1/youtube/web_v2/get_video_info_v2`；频道 `/api/v1/youtube/web/get_channel_info` | `/api/v1/youtube/web_v2/get_video_comments` | 可做视频、频道与评论；长视频/Shorts 分开比较 |
| Reddit | `core` | `/api/v1/reddit/app/fetch_dynamic_search` | `/api/v1/reddit/app/fetch_post_details` | `/api/v1/reddit/app/fetch_post_comments` | 搜索结果返回带 `t3_` 前缀的 ID；详情/评论必须保留 `t3_` 前缀（去掉前缀返回空 `data={}`） |
| X / Twitter | `core` | `/api/v1/twitter/web/fetch_search_timeline` | `/api/v1/twitter/web/fetch_tweet_detail`；账号 `/api/v1/twitter/web/fetch_user_profile` | `/api/v1/twitter/web/fetch_post_comments` | 以 `tweet_id` 与 `screen_name/rest_id` 串联；转推与原帖分开 |
| Threads | `fallback` | `/api/v1/threads/web/search_profiles` | `/api/v1/threads/web/fetch_user_info_by_id` → `fetch_user_posts` → `fetch_post_detail_v2` | `/api/v1/threads/web/fetch_post_comments` | `search_top` 和用户名直取曾返回 400；发现入口以账号搜索为主，不宣称全量话题覆盖 |
| LinkedIn | `known_object` | 无已验证的通用内容搜索；从已知公司页进入 | `/api/v1/linkedin/web_v2/get_company_posts`；`get_post_detail` | `/api/v1/linkedin/web_v2/get_post_comments` | 公司 profile 两个样本嵌套超时；适合已知 B2B 竞品内容，不用于全网发现 |
| Lemon8 | `core` | `/api/v1/lemon8/app/fetch_search` | `/api/v1/lemon8/app/fetch_post_detail` | `/api/v1/lemon8/app/fetch_post_comment_list` | 搜索返回 `item_id/group_id`；详情补 `media_id` 后取评论 |
| 今日头条 | `known_object` | 当前 OpenAPI 无关键词搜索 | `/api/v1/toutiao/app/get_article_info` | `/api/v1/toutiao/app/get_comments` | 只接收已知 `group_id`，不承担品类发现 |
| 西瓜视频 | `fallback` | `/api/v1/xigua/app/v2/search_video` | `/api/v1/xigua/app/v2/fetch_one_video` | `/api/v1/xigua/app/v2/fetch_video_comment_list` | `fetch_one_video_v2` 实测 400；固定使用 V1 详情 |
| 皮皮虾 | `core` | `/api/v1/pipixia/app/fetch_search` | `/api/v1/pipixia/app/fetch_post_detail` | `/api/v1/pipixia/app/fetch_post_comment_list` | 使用 `cell_id + cell_type` 串联；不调用增加浏览数接口 |
| Telegram | `authorized` | 当前 Token 缺少 scope | 当前 Token 缺少 scope | 当前 Token 缺少 scope | 不进入默认研究，开通权限并重测后再启用 |
| 网易云音乐 | `unavailable` | 旧 `search_v1` 实测 404 | 当前 OpenAPI 无该前缀 | 当前 OpenAPI 无该前缀 | 不调用 |

## 路由选择

1. `quick_scan` 默认选择与目标市场相关的 `core/fallback` 平台；`partial/known_object` 只有在其限制不影响研究问题时加入。
2. 每个平台先做一页小样本；同时通过 HTTP、顶层状态、嵌套业务状态和核心字段门禁后再分页扩样。正式 `full_analysis` 的核心查询继续采集至少 3 页，或达到 Skill 定义的连续两页饱和门槛。
3. 搜索为空时记录 `empty_valid`，再用同义词、其他平台或已知 URL/ID 交叉验证；不得写成“没有需求/竞品内容”。
4. 评论链路不可用时，内容级评论数只能作为弱信号；`user_voice` 不得由评论数推断。
5. 发现、详情、评论、账号各自记录路由状态；一个环节成功不代表整个平台为 `core`。

## 跨平台可比性

- 原始播放、阅读、点赞、评论、分享、收藏只做平台内、同内容形态、相近发布时间的比较。
- 跨平台综合使用主题覆盖、叙事占位、证据形式、平台内分位和标准化变化，不直接相加绝对互动量。
- 公众号阅读、YouTube 长视频、Shorts、图文笔记和短视频分别成组；没有共同分母时 `engagement_rate=null`。
- 平台缺失字段是 `null`，不是零；partial/fallback 样本在结论旁显示能力状态和限制。
