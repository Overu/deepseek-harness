# TikHub 路由与调用约束

文档核查基线：2026-10-19。本次对照官方公开 OpenAPI 与价格目录整理了 [40条只读接口及内置价格合同](public-endpoints.json)，均标为 `docs_confirmed`，**不表示本版本已逐条实测成功**。每次运行在清单中记录 `method/path/version/docs_checked_at/observed_at/status/identity_check/field_coverage`；预算使用内置单价与核对日期，权限及响应结构按实际返回核验，不逐次查价。

## 1. 宿主取数条件

优先使用宿主已配置的 TikHub 连接器；缺少对应路线时，可使用包内 `python3 scripts/tikhub_public.py`，先读 [采集器使用合同](collector-usage.md)。它只调用目录内固定官方主机的只读端点，每次一页，默认只校验参数；真实取数由代理按采样计划逐页执行，当前不承诺无人值守全网批量采集。

若复用其他技能的调用器，先读取其执行合同和参数说明：未列入合同的端点不可通过改状态为 `live`、任意 `base_url` 或绕过调用器使用。包内目录尚未包含的路线，先重新核对官方文档并补适配，再做单对象验证；不靠猜参数直接探测。

工具必须满足：

- 仅向已核验的 TikHub 官方 API 主机发送凭证；禁止把认证头跟随跨域重定向发送。
- 请求经企业插件和统一 API 网关 `tikhub` 连接发送，后台管理供应商凭据。不要求用户粘贴密钥，不读取本地厂商密钥或配置文件，不将密钥放进命令、示例、日志或报告。
- 固定接口方法、参数位置与参数白名单；以下 POST 都是查询操作，不代表可使用其他写入端点。
- 在请求前按内置单价检查剩余预算并预留本次费用；单次任务默认总额1美元，无需逐次确认。缺失单价需补目录，不能假设为零；运行链路不依赖查价接口。
- 日志与缓存先移除认证头、Cookie、`cache_url`、`xsec_token`、`sign`、签名查询串和临时媒体 URL；保留脱敏 `request_id`、状态码及业务错误类别。原始媒体受控处理，不直接进入交付包。

缓存可复用但注明原抓取时间；不能把旧数据标成最新。对同一请求不盲目重试；有明确瞬时错误依据时最多一次，仍需预算。新路由先小样本验证，失败后最多尝试一个文档已核验的替代版本；本路由失败不等于整平台无数据。

## 2. 默认重点路由

历史内容与评论应作为两条独立证据链：先列出可见历史作品及其原生话题标签，再按作品层选评论；平台搜索命中不能冒充账号完整历史。标题/文案热词、视频口播热词与评论热词分别存储。接口只返回评论热词汇总而没有原评论时，可作选题线索，不能据此计算用户情绪或购买反馈。控制预算时优先扩大**不同作品的覆盖**，而不是在单一争议帖反复深翻评论。

### 小红书搜索

- `GET /api/v1/xiaohongshu/app_v2/search_notes`
- [官方文档](https://docs.tikhub.io/420136398e0)，状态 `docs_confirmed`。
- 使用 `keyword`、`page`，排序按任务选择综合、最新或评论热度等文档支持值；继续翻页须保留首轮返回的 `search_id`、`search_session_id`。
- 内容检索分别覆盖达人本人、本品/竞品关键词和第三方讨论。搜索索引不能当作完整作品档案；时间筛选不能擅自扩成任意三年回溯。

### 蒲公英历史笔记与详情

- `POST /api/v1/xiaohongshu/pgy/get_blogger_notes_v2`
- [V2 文档](https://docs.tikhub.io/506372191e0)，状态 `docs_confirmed`。
- body：`user_id`，`page_number` 从 1 起，`page_size` 1–8，`note_type` 0 全部/1 图文/2 视频，`order_type` 1 最新/2 阅读/3 互动。
- 业务路径 `data.data.noteList[].noteInfo`，含 `noteId/title/notePublishTime/noteType` 及文档说明的表现字段。与旧版列表路径不同，不用旧版 parser 的空值证明上游缺失。
- `notePublishTime` 原值、单位与转换后时间分别保存；按真实单位处理秒/毫秒并做合理日期检查，不用抓取时间补发布时间。
- 旧版 `POST /api/v1/xiaohongshu/pgy/get_blogger_notes` 的合作筛选与 V2 不同。需要合作笔记筛选时先重新核对[旧版文档](https://docs.tikhub.io/479321009e0)，不要向 V2 传旧版 `note_type=3`。文档不可读时，参数语义标为待核验。
- 逐篇详情：`POST /api/v1/xiaohongshu/pgy/get_note_detail`，body `note_id`；[官方文档](https://docs.tikhub.io/479321007e0)。取实际正文与原文链接，字段不能靠接口名称推断。
- 如返回话题/标签字段，记录原字段与作品 ID；没有该字段时只可从已取得正文抽取词项，并标成 `creator_term`，不可伪装为平台原生标签。
- 列表为空只能说明该查询无返回；跨域内容或其他入口仍可能有结果，不能写为“无作品/无商业合作”。

### 小红书评论：两种入口不得混用

| 入口 | 用途 | 限制 |
|---|---|---|
| `POST /api/v1/xiaohongshu/pgy/get_note_comments`，body `note_id` | 查看精选评论和其中的作者回复 | 固定精选 Top5，**无分页**，不能支持整体情绪比例 |
| `GET /api/v1/xiaohongshu/app_v2/get_note_comments` | 公开评论分页与分层抽样 | 可获取范围仍受上游可见性、折叠和删除影响 |

[精选评论文档](https://docs.tikhub.io/508112774e0)：响应 `data.data` 是线程数组，主楼 `comment`、回复 `l1L2Comments`、用户映射 `userMap`；使用字符串 ID，避免 JavaScript 安全整数损失。不可不断尝试 page 参数获取更多精选评论。

[公开评论文档](https://docs.tikhub.io/420136394e0)：输入 `note_id` 或 `share_text`；`sort_strategy=latest_v2` 与 `like_count` 分开抽样；翻页同时回传 `cursor/index/pageArea`。文档不推荐 `default` 排序，可能重复或遗漏。需要楼中楼时查[子评论接口文档](https://docs.tikhub.io/420748830e0)，不要臆造参数。

这两类接口均有“返回成功但业务空/异常仍可能计费”的情况。判断业务成功、计费成功、有效证据获取是三件不同的事。

### 抖音搜索与内容

- `POST /api/v1/douyin/search/fetch_general_search_v3`：[综合搜索 V3](https://docs.tikhub.io/501036593e0)，状态 `docs_confirmed`。
- `POST /api/v1/douyin/search/fetch_video_search_v5`：[视频搜索 V5](https://docs.tikhub.io/501036597e0)，状态 `docs_confirmed`。
- 两者 body：`keyword/offset/page/search_id/backtrace`；初次 `offset=0,page=1`，其余游标空；按 `data.pagination` 回传后续游标。固定每页 10 条，页码上限 200；上限不是覆盖保证。
- V3 不支持旧版所有排序/筛选。默认先选最新；有旧版独有业务需求时核对旧文档，说明使用旧版的原因，不把版本号当能力大小。
- 搜索返回描述/媒体引用不等于完整口播。逐作品详情、主页作品、评论与回复接口应在[当前目录](https://docs.tikhub.io/)核对最新版本和 ID 语义后加入宿主合同。没有逐条评论就不生成评论主题分布。
- 抖音历史作品与评论取样须分别记录版本、分页/游标、排序、返回数、去重数和最早/最晚作品日期；只取得作品热评或聚合词时，不宣称完成系统评论调查。

### 微博历史追查

- `GET /api/v1/weibo/web_v2/fetch_advanced_search`
- [官方文档](https://docs.tikhub.io/381269425e0)，状态 `docs_confirmed`。
- query：`q`；`search_type` 支持 all/hot/original/verified/media/viewpoint；`include_type` 支持 all/pic/video/music/link；`timescope=custom:开始日期:结束日期`；`page`。
- 可按事件时段查原帖、回应和后续，媒体/认证筛选不是真实性认证。曾有其他 web_v2 端点失败，不代表本端点必然失败或必然可用。
- 账号发现：`GET /api/v1/weibo/web_v2/fetch_user_search`，`query` 或 `nickname`；[文档](https://docs.tikhub.io/381269428e0)。主页历史：`GET /api/v1/weibo/web_v2/fetch_user_posts`，`uid/page/since_id`；[文档](https://docs.tikhub.io/381269407e0)。
- 评论优先 `GET /api/v1/weibo/app/fetch_status_comments`，`status_id/max_id/sort_type`；`sort_type` 是字符串 `"0"` 热门或 `"1"` 时间，分别采样。翻页取 `data.moreInfo.params.max_id`；[文档](https://docs.tikhub.io/410358104e0)。

### 星图合作信息

- `GET /api/v1/douyin/xingtu_v2/get_author_cp_info`
- [官方文档](https://docs.tikhub.io/489299447e0)，状态 `docs_confirmed`。
- `o_author_id`、`platform_source`、`platform_channel`。文档对业务返回语义不充分，不能承诺完整品牌合作历史。需对象匹配、实际字段和统计期验证后使用；不可将账号 ID 与星图作者 ID 混用。
- 只有元数据或默认空响应时，标为未取得合作证据，不能输出“未合作竞品”。热词只能帮助发现线索，不能替代原始评论。

## 3. 新增跨平台取数路线

完整背调的账号盘点覆盖八个基准平台；已确认账号按采样优先级进入计划。以下是本次核对的入口，完整参数、枚举、位置与当前价格快照见目录；正文页码和游标不可跨路线混用。

| 平台 | 账号/内容发现与历史入口 | 评论与关键限制 |
|---|---|---|
| 抖音 | `POST /douyin/search/fetch_user_search_v2`；`GET /douyin/app/v3/handler_user_profile`、`fetch_user_post_videos` | `GET /douyin/app/v3/fetch_video_comments`、`fetch_video_comment_replies`；评论count固定20，默认排序不当作热门/最新；主页首屏只传sec_user_id，续页传max_cursor，不传count |
| 小红书 | `GET /xiaohongshu/app_v2/search_users`、`get_user_info`、`get_user_posted_notes`；第三方用`search_notes` | `get_note_comments`、`get_note_sub_comments`；ID与分享链接替代，排序latest_v2/like_count分别记录；业务异常也可能计费 |
| B站 | `GET /bilibili/app/fetch_search_by_type`，搜账号用`search_type=user`；`GET /bilibili/web/fetch_user_profile`、`fetch_user_post_videos_v2` | `GET /bilibili/app/fetch_video_comments`，av_id/bv_id二选一，mode=2时间、3热门；历史V2固定最新、pn无目录页码上限，不等于隐藏作品可取 |
| 快手 | `GET /kuaishou/app/search_user_v2`、`search_comprehensive`；`GET /kuaishou/web/fetch_user_info`；`GET /kuaishou/app/fetch_user_post_v2` | `GET /kuaishou/app/fetch_video_comment`，pcursor翻页；主页资料用eID、作品V2只用数字user_id，须先解析确认 |
| 视频号 | `POST /wechat_search/v2/fetch_search`，business_type=account/video；`POST /wechat_channels/v2/fetch_user_profile`、`fetch_user_videos`、`fetch_video_detail` | `POST /wechat_channels/v2/fetch_video_comments`，object_id来自详情/列表，last_buffer翻页，传comment_id展开回复；finder username与作品ID分开，均保留字符串 |
| 公众号 | 微信搜索business_type=account/article；`POST /wechat_mp/v2/fetch_account_profile`、`fetch_account_articles`、`fetch_article_detail_h5` | `POST /wechat_mp/v2/fetch_article_comments`返回**精选**，buffer翻页；文章列表page_size可能被忽略，按next_offset翻页；精选不代表全部读者意见 |
| 知乎 | `GET /zhihu/web/fetch_user_search_v3`、`fetch_user_info`、`fetch_user_articles`；第三方用`fetch_article_search_v3`、`fetch_question_answers` | `GET /zhihu/web/fetch_comment_v5`当前只接answer_id，order_by=score/ts；文章列表不是本人回答全集，文章ID不能套回答评论接口 |

表内路径统一加 `/api/v1`。微信搜索仅启用已核对的all/account/article/video垂类；不采朋友圈等私人内容。旧作品评论可能是近期留言，必须保存作品与评论各自日期。

官方参考：[B站评论](https://docs.tikhub.io/382707663e0)、[视频号作品](https://docs.tikhub.io/472974841e0)、[视频号评论](https://docs.tikhub.io/472974843e0)、[微信搜索](https://docs.tikhub.io/472974860e0)、[公众号文章](https://docs.tikhub.io/472974858e0)、[公众号精选评论](https://docs.tikhub.io/472974853e0)、[知乎回答列表](https://docs.tikhub.io/350606794e0)。其余以目录中的官方OpenAPI来源定位。

海外平台按已确认活动范围扩展；先核对发现→详情→评论链路及权限，只有已知URL/ID入口标为 `known_object_only`。TikTok Creator等所有者授权接口不能用于未授权第三方背调。

## 4. 权威补证

严重指控需补查与具体事件有关的公开官方通报、公开处理结果或可追溯原始声明。TikHub 搜索到的转载只作线索；不能用其替代源页面核验。无法核验时保留 `unverified/disputed`，不做法律结论。

## 5. 错误、预算和覆盖

- 业务请求直接使用内置价格表，查价接口不参与执行。旧台账 `stage=price_lookup` 且 `data_request_attempted=false` 表示数据路由尚未测试，不能阻断新请求或推断目标不可用。数据请求、响应验证及输出保存分阶段记录，保留 `path/gateway_code/gateway_http_status`；以目标实际返回诊断该路由，不把单路由失败扩大为整个平台不可用。
- HTTP 403 的默认结论是“请求被拒，原因待核验”。记录脱敏业务码和信息；只有明确权限说明或提供方确认，才认定需开权限。也可能有上游限制或资源问题。
- 401、403、400、空响应、请求超时分别记录；不要用统一“无数据”覆盖失败原因。禁止探测他人 Cookie、绕过权限或自动买权限。
- 区分 `docs_confirmed / verified_this_run / historical_success / failed / untested`。HTTP 200 还需核对内部业务码、对象、目标字段及去重后内容。
- 预算是任务累计值：台账外已有支出＋已预留费用＋下一次内置单价不得超过总额，默认1美元；并发调用共享同一账本。网络结果不确定但可能计费的请求也先占用额度。保留价格表来源及日期，未确认实扣时给出估算，不写“实际花费”。
- 记录查询词、排序、页数、去重后内容数、最早/最晚发布日期、停止原因、失败入口。`has_more=false` 只表示该查询到尾，不等于历史全覆盖。
- 默认在单次任务1美元总预算内按优先级完成取数；用户指定更低预算时遵循。额度耗尽即停止新付费调用，交付范围内结果与缺口，不承诺这个预算足以深查多年全平台；只有追加预算时才再次请求授权。
- 预算不足返回 `budget_exhausted` 后，由主代理向用户说明建议追加额和新总额；用户同意才用 `--approve-budget-usd 新总额 --approval-ref 授权引用` 在原台账追加授权并续跑。旧费用和路线失败记录保留，后续调用自动继承新上限，不把追加额误当成新总额，也不以换台账重置预算。完整命令见 [采集器使用合同](collector-usage.md#预算追加与续跑)。

## 6. 本地实测修正（2026-10-22）

抖音 `app/v3/fetch_user_post_videos` 的本地请求中，携带 `count=20` 返回400；仅 `sec_user_id` 的首屏和增加 `max_cursor` 的续页快照成功。当前执行合同移除 `count`，其余可选参数不自动补入，保留这次实测与文档的差异。本记录不是企业网关线上验收或路由永久可用的承诺。

同次小红书 `app_v2/get_note_comments` 快照的 `data.data.comments` 包含非空正文。按该层级解析，不因顶层没有 `comments` 就判为空。自动样本检查与最低数量目标的边界见 [采集器使用说明](collector-usage.md)；精选评论入口不能替代普通评论的总体抽样。
