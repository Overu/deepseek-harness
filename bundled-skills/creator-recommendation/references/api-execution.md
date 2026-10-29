# 接口调用与故障处理

## 参数与实际执行

所有路径、HTTP 方法与可传参数以 `tikhub-endpoints.json` 为准。`--query` 每个参数独立传入，不把多个参数拼成一个值；POST 参数用 `--body-json`。调用器拒绝未知参数、重复参数、错误位置与非法枚举值。

```bash
python3 scripts/tikhub_readonly.py \
  --contract references/tikhub-endpoints.json \
  --path /api/v1/douyin/xingtu/search_kol_v2 \
  --query 'keyword=足球' --query 'followerRange=10-100' \
  --max-cost-usd 0.002 --dry-run
```

实调去掉 `--dry-run`，添加 `--output <任务目录>/football.json --ledger <任务目录>/calls.jsonl`。同一任务所有调用共用台账；不要为绕过路由熔断改台账文件。新发现路由先一笔，业务有效再扩样，避免一次把十几个关键词发到已坏接口。目录态仅以 `--allow-catalog` 探测一笔；不得自动晋级或批量使用。

抖音当前发现入口 `search_kol_v2` 无翻页参数。按不同场景词、粉丝区间分组查询，按 `star_id` 合并，记录每个查询的新增账号数。出现重复集合后换切分维度；没有新增时停止，不把重复返回计算成新一页。单次少于20位或零位可能只是筛选无命中。

`attribute_datas.last_10_items` 实测可能是 JSON 字符串，先解析再按真实作品条目计数；`star_id`、`core_user_id` 保留为字符串。解析失败记字段缺失，不把字符串长度当作品数。报价档位、有效期与在架状态一起保留，价格区间依照用户指定档位在本地过滤。

## 诊断状态与动作

|诊断状态|解释与动作|
|---|---|
|`ok`|结构有效；画像类仍需双对象检查，之后再用于评分|
|`empty`|请求有效、当前查询零结果；换关键词或放宽一项筛选，不宣称全局故障|
|`upstream_error` / `invalid_response`|停止当前路由扩样，台账熔断；核对官方参数后最多一次 `--recheck-route`，随后用已验证替代或登记缺口|
|`edge_blocked`|403含 Cloudflare/1010 证据；检查访问链路，不能据此断言 Key 失效|
|`authentication_error`|供应商401或403响应明确说明鉴权错误；核对网关后台配置、账号状态与权限，不打印凭证|
|`gateway_error`|统一 API 网关调用失败；停止该路由后续调用，计费保持未知，先核对后台请求记录；不能用网关 HTTP 状态推断供应商鉴权|
|`forbidden_unknown`|403原因未明确，保留不确定性；不要直接归因为余额、过期或权限|
|`parameter_error`|422；对照契约与官方参数修正，不扫参数组合|
|`rate_limited` / `transport_error`|停止并发；限流或网络失败不自动重发，读超时的计费可能已发生|

每笔生成 `<output>.status.json` 与台账事件，包含路径、HTTP/业务状态、可用时的 request_id、声明单价及计费状态。错误正文仅在内存中识别，凭证与原始错误内容不落盘。返回非零时不得消费旧输出文件；以本笔 `response_saved` 判断是否写入。

默认不自动重试。累计费用不能把成功次数乘单价写成确定账单：未知计费保留未知；只有服务端明确声明不扣费的请求才可记零；实际扣款以账户账单为准。`--max-cost-usd` 仅约束单笔声明价格。

## 已验证替代的能力边界

- `search_creator` 与 `search_kol_v1` 的短视频达人发现用 `search_kol_v2`；旧版无新版原生的时间窗、报价与地域筛选时，不能声称这些筛选已在服务端生效。
- `search_anchor` 暂无已验证等价主播发现入口，短视频达人池不能当成直播池交付。
- `get_author_audience_distribution` 用 `get_author_fans_distribution` 取代，双对象校验后保留平台模型标签。
- 路由说明表提及但执行契约未声明的端点属于当前调用缺口。须从官方定义补全参数合同并探测后再用，不能临时猜参数或绕过调用器。

## 商单记录与接单状态

`task_infos.price_infos`、`online_status`、报价有效期只支持“当前能否报价/接单”。`last_10_items` 只支持作品表现。商单时效必须另有订单/合作记录，或明确付费合作声明的内容，并使用真实合作事件日期。接口没有返回上述证据时，`recent_commercial_activity.status=unavailable`，只能暂缓推荐。泛品牌词、标题出现品牌名、在架报价和抓取时点不能补足这项证据。
