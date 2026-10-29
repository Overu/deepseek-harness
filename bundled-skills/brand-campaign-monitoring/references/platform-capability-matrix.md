# 跨平台能力与降级矩阵

## 用法

> **状态词表（三种路由表共用）**：`core` 搜索与详情/评论/账号链路均实测通过 ｜ `fallback` 需固定降级版本或参数 ｜ `partial` 部分监测可用但有明确缺口 ｜ `known_object` **仅已知 URL/ID/账号可查，不作为关键词发现入口** ｜ `authorized` 目录有但 Token 权限不足 ｜ `unavailable` 已移除或实测失效。
> 同一平台可因能力不同而给出不同状态：**发现**能力与**已知对象**能力分别评估；三张表冲突时取更保守者并在报告中注明口径。

本文档用于路由选择和降级，不是 TikHub 全部端点手册。结论基于 2026-08-28 实测和 TikHub OpenAPI V5.3.2。上线前仍应使用当前端点目录做健康检查。

状态：

- `core`：搜索/发现与至少一条详情、评论或账号链路已实测通过。
- `fallback`：主要能力可用，但必须固定降级版本或参数适配。
- `partial`：可支撑部分监测，但发现、评论、账号或详情中有明确缺口。
- `known_object`：只能从已知 URL / ID / 账号继续取数，**不作为关键词发现入口**（与 category-competitor-insight 的 platform-routing.md 同名状态一致）。
- `authorized`：目录中存在能力，但当前 Token scope 或账号授权不足。
- `unavailable`：当前 OpenAPI 已移除或实测路由失效。

## 平台矩阵

| 平台 | OpenAPI 路由数 | 实测 | 可用能力 | 生产路由/降级 |
|---|---:|---|---|---|
| 抖音 | 333 | `core` | 关键词搜索、作品详情、评论；既有 POC 另已验证指数、榜单、星图达人/人群 | 搜索 `search/fetch_general_search_v2` → 详情/评论 `app/v3` |
| 小红书 | 43 | `core` | 笔记搜索、图文/视频详情、评论、账号资料 | `app_v2` 为实测主链；搜索结果先核对笔记类型 |
| B站 | 42 | `fallback` | 综合搜索、视频评论、UP 主资料、视频详情 | 详情 V3 对实际 URL 返回 400；降级为 `fetch_one_video` + `bv_id` |
| 微博 | 64 | `fallback` | 搜索、微博详情、评论、用户资料 | `web_v2` 三条路由对实际 ID 返回 400；降级为 `web` V1 |
| 知乎 | 41 | `partial` | 文章搜索、专栏文章详情 | 评论 V5 按回答 ID 调用；文章搜索样本不能直接串该评论路由 |
| 快手 | 38 | `core` | 推荐发现、作品详情、评论、账号资料；目录另有视频/用户/话题搜索 | feed → `photo_id` → 详情/评论/用户 |
| 微信搜一搜 | 2 | `core` | 综合搜索、视频号视频搜索 | 公众号文章搜索返回 37 条；两次视频搜索均为空 |
| 公众号 | 9 | `core` | 文章详情、阅读/点赞/转发等互动、评论；目录另有账号页和文章列表 | 搜一搜文章 URL 或已知 URL → `wechat_mp/v2` 详情/统计/评论 |
| 视频号 | 12 | `known_object` | 已知对象的详情、评论、账号资料实测通过 | 搜索入口两个关键词均返回空；需已知分享链、`object_id` 或 finder username |
| TikTok | 166 | `partial` | 关键词搜索、作品详情、账号资料；既有 POC 已验证 Ads 素材和逐秒留存 | 评论路由对两个高评论样本均返回 400，暂不作生产依赖 |
| Instagram | 93 | `partial` | 用户/话题搜索、账号资料、账号帖子、帖子详情 | 评论 V2 对有评论的公开帖子返回 400；暂使用帖子列表自带的评论数 |
| YouTube | 37 | `core` | 搜索、视频详情、评论、频道资料 | `web_v2` 搜索/详情/评论 + `web/get_channel_info` |
| Reddit | 28 | `core` | 动态搜索、帖子详情、评论 | 搜索返回带 `t3_` 前缀的 ID；详情/评论必须保留 `t3_` 前缀（去掉前缀返回空 `data={}`） |
| X / Twitter | 12 | `core` | 搜索、推文详情、回复/评论、用户资料 | 使用 `tweet_id` 和 `screen_name/rest_id` 串联 |
| Threads | 11 | `fallback` | 用户搜索、用户资料、作品列表、帖子详情、评论路由 | `search_top` 和用户名直取曾返回 400；稳定链是 `search_profiles` → user id → profile/posts → detail/comments |
| LinkedIn | 8 | `known_object` | 公司帖子列表、单帖详情、评论 | 公司 profile 两个品牌样本均为嵌套 `request_timeout`；不得把顶层 `code=200` 当成业务成功 |
| Telegram | 7 | `authorized` | 目录含频道资料、帖子、详情、评论、频道内搜索 | 当前 Token 明确返回缺少 scope；授予 Telegram 权限后重测 |
| Lemon8 | 16 | `core` | 关键词搜索、作品详情、评论 | 搜索返回 `item_id/group_id`，详情补 `media_id` 后再取评论 |
| 今日头条 | 7 | `known_object` | 已知文章详情和评论 | 当前 OpenAPI 无关键词搜索；需外部发现或已知 `group_id` |
| 西瓜视频 | 7 | `fallback` | 搜索、评论、视频详情 | 详情 V2 返回 400，V1 通过 |
| 皮皮虾 | 17 | `core` | 搜索、内容详情、评论 | 使用 `cell_id` 与 `cell_type` 串联；不调用增加浏览数的写入型路由 |
| 网易云音乐 | 0（旧目录 16） | `unavailable` | 旧目录曾列出搜索、歌曲、歌词、评论、用户/歌单 | OpenAPI V5.3.2 已移除该前缀，旧 `search_v1` 实测 404 |

## 跨平台实施规则

1. 主路由不按版本号机械选择，而按最近实测成功、字段完整和语义正确选择。
2. HTTP 200、顶层 `code=200` 和业务层有效是三个独立门禁。LinkedIn profile 顶层成功但嵌套 `request_timeout`，必须判为失败。
3. ID 转换必须平台化：Reddit 保留 `t3_` 前缀直传详情/评论，B站区分 aid/bvid/cid，视频号区分 object id/export id/finder username。
4. 评论不可用时，可保留内容级评论数作为弱信号，但不能生成评论情绪或异议主题。
5. 空搜索结果必须和其他平台、替代关键词或已知 URL/ID 交叉验证。
