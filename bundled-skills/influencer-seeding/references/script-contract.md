# 可选脚本合同

Python 3.10+ 标准库；默认标准输入/输出，不创建文件。DSH 有等价的已配置能力时可直接使用。脚本结果不作为方案技术附录输出。

## TikHub 只读调用器

`python3 scripts/tikhub_readonly.py` 从 stdin 读 JSON，默认 dry-run；加 `--execute` 才发请求。

```json
{"endpoint":"xiaohongshu_search_notes_v2","params":{"keyword":"具体品类与场景","page":1},"unit_price_usd":0.01,"remaining_budget_usd":0.05,"price_source":"当前账户或该端点计价来源","price_checked_at":"2026-09-22"}
```

金额仅为格式示例。真实请求须有当前价格、来源、7 天内核价日期与剩余费用额度。每发一次请求保守占用一次预计费用，成功或失败均返回余额；调用方在本次上下文累计，不能重置余额。并发前先累计预留，不可共用一份余额。实际扣费以账户为准，无自动重试。

网关连接、路径、方法和允许参数见 [tikhub-endpoints.json](tikhub-endpoints.json)。失败/目录路由默认拒绝；`--probe` 仅允许对合同定义的只读路由作单次探测，不修改台账。未知参数、任意 URL、重定向及写接口不支持。企业插件携带登录态，凭据由网关后台管理。网关失败不自动重试，已预留费用保持占用，实际扣费须核对后台记录。

响应先清除凭证、临时缓存链接与签名 URL。成功状态仍为 `needs_semantic_validation`：必须检查实际对象、核心字段、筛选、时间与相关性，画像需双对象对照；退出 0 不证明数据可用于正式结论。只读不等于免费，已有授权预算可沿用，缺少时继续 DSH 检索。

## 指标与预算计算器

`python3 scripts/seeding_math.py` 从 stdin 读 JSON。无效输入退出 2，不输出 NaN/Infinity。

- `budget`：`total`、`items`。每项含 `name`、整数 `quantity`、`unit_cost`、`basis`、`source_ref`；basis 为 observed/hypothesis。超支、负数、小数数量、重复项目名失败；不同名称重复计费仍须人工核对。
- `paid_impressions`：`spend`、`cpm`、`basis`、`source_ref`；CPM 必须正数，成本非负。
- `rate`：`numerator`、`denominator`、`denominator_name`；分母必须具名且大于零。
- `gross_impressions`：`organic`、`paid`、`same_definition`、`disjoint_components`；有未知则总数未知，口径不一致或重复组件拒绝，不生成去重人数。
- `cohort`：`values`、`metric`、`window`；统计实际非缺失样本，中位数、最小/最大值与缺失数；0 不自动视为缺失，输入可比性需先核验。

```json
{"operation":"paid_impressions","spend":150000,"cpm":50,"basis":"hypothesis","source_ref":"仅为算术示例，CPM 未由项目数据校准"}
```

应计算为 3,000,000 次付费展示，不是自然流量、独立人数或成交。
