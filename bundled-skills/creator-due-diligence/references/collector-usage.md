# 包内公开数据采集器

`scripts/tikhub_public.py` 是单页只读入口，经企业插件提供的 Node 适配器访问统一 API 网关；业务脚本使用 Python 3.10+，macOS/Linux 使用 POSIX 文件锁，Windows 使用标准库 msvcrt 字节锁，无需额外锁依赖。两者均锁定同一个任务台账，覆盖预算检查、费用预留、取数及结果落盘；竞争时等待持有者释放，不自动重发网络请求。空台账不会添加占位字节，进程退出后系统释放锁。`references/public-endpoints.json` 是已核对的接口/参数合同。本版本只做离线行为验证，目录中的40条接口均为文档确认，不能写成全部线上可用。

查参数时按目标`path`筛选目录条目，只读取本次要用的路线；不必一次加载全部40条合同。目录给输入约束，响应解析仍按当次官方文档及小样本核验。

## 能力边界

- 固定网关连接 `tikhub`，没有任意base-url或任意端点选项，网关限制转发路径与方法。
- 企业插件提供 `DSH_HOME` 和 `DSH_SKILL_PROXY_NODE`，后台管理供应商凭据；不读取本地厂商密钥、不接收Cookie或命令行密钥。
- 参数通过本地JSON文件传入，按合同检查位置、类型、枚举及对象ID替代要求。ID用字符串；网关返回的大ID也必须为字符串。收到超过JS安全整数范围的数值时拒绝保存，记录缺口，不能把可能舍入的数值转换为看似准确的ID；网关上游也须保留原始字符串精度。
- 命令默认dry-run不联网。代理执行正常背调时主动加 `--execute`，按采样计划发出真实取数请求，不把命令预检模式当成必须再次征求用户授权。执行直接读取目录中的 `price_usd`，不访问查价接口；查价接口不可用不影响目标取数。
- 首次任务默认总额1美元，用户指定更低额度时传入 `--budget-usd`；首次用 `--prior-spend-usd` 计入台账之外已有费用（缺省0）。后续两项省略时均继承原台账中的有效值；不能直接改预算或把此前支出改为0。用户批准追加后使用下面的专用参数。所有平台、分页及相关技能共用该总额；预算不够时拒绝下一请求，台账损坏时停止，不换台账抹掉已发生费用。
- 先在加锁台账按内置单价预留本次费用，再发送请求；网络错误或未确认实扣的调用保留预留额。`price_basis=builtin_catalog` 及 `price_checked_at` 标明估算依据与日期，不冒充实时价格；实际费用始终记null，账单核实由代理另行记录。每次请求最多60秒，无自动重试。
- 同路线失败后停止；有诊断依据且预算足够时最多一次`--recheck`，之后改用已核对替代路线或记录缺口。403只标请求拒绝、原因待核。
- 网关错误记 `gateway_error`，单独保留 `gateway_http_status`；该状态不能视为供应商原始 HTTP 状态。费用实际额保持未知，先核对后台记录，不自动重发。
- 诊断保留 `stage/path/gateway_code/gateway_http_status`，不包含供应商错误正文。数据请求失败为 `kind=result`，保留该路由按内置价格预留的费用。兼容旧版台账中的查价 `kind=diagnostic`：它不算数据调用失败，不占用数据费用，也不阻断后续取数。
- 保存前删除认证、Cookie、签名链接、媒体下载字段、解密密钥、IP等字段。此入口用于文本/元数据与评论；完整媒体审阅使用宿主获准的独立能力。
- 保存路径须在本次获准输出目录；同名输出不覆盖。终端只输出状态、请求ID与预算，不回显参数值或原始上游错误。

## 用法

先用普通文件编辑工具在本次输出目录创建参数文件，例如微信账号发现：

```json
{"keyword":"品牌指定的达人名称","business_type":"account","sort":"default","raw":false}
```

在技能根目录执行参数校验：

```bash
python3 scripts/tikhub_public.py --path /api/v1/wechat_search/v2/fetch_search --params /absolute/task-output/account-search-params.json
```

企业插件已登录、网关连接已配置后，用户发起正常背调任务即可执行同一请求；默认总预算1美元，无需另问。以下命令省略 `--budget-usd`，台账外已有支出通过 `--prior-spend-usd` 按实际填入（默认为0）：

```bash
python3 scripts/tikhub_public.py --path /api/v1/wechat_search/v2/fetch_search --params /absolute/task-output/account-search-params.json --execute --output /absolute/task-output/wechat-account-search-01.json --ledger /absolute/task-output/tikhub-calls.jsonl
```

首次验证后，代理检查：账号归属、稳定ID、嵌套业务状态、预期字段、真实返回条数、排序、下一页游标与大整数。`business_ok_unreviewed`只说明基础业务状态未报错，**不代表身份已确认或取得有效证据**。有效空结果、结构变更和上游异常必须另行区分。

### 预算追加与续跑

下一笔会超额时，采集器退出码为2，返回 `status=budget_exhausted`、`data_request_attempted=false`，以及当前 `budget_usd`、累计 `cumulative_reserved_usd`、下一笔 `next_request_usd`、至少容纳该笔的 `minimum_total_budget_usd` 和差额 `additional_usd_needed`。最低总额只覆盖下一笔，不代表剩余调查的完整报价。

该次停止作为 `kind=diagnostic/stage=budget_check` 写入原台账，本次预留0，不算目标数据请求失败；即使任务第一笔就被拦截，也保存当时的总额及台账外已有支出，授权续跑不会把此前费用恢复为0。

主代理据此向用户说明已用/预留、追加用途、建议追加额与**新的总上限**，等待明确同意；不同意就交付已有结果和缺口。脚本不会自行弹出授权对话框或代表用户同意。只有获得真实同意后，才执行带 `--approve-budget-usd 新总额 --approval-ref 授权引用` 的下一条请求。授权引用用可追溯的对话/审批记录标识（1–128位ASCII字母、数字、`_.:-`，以字母或数字开头），不粘贴原始对话或凭据。

例如用户同意从总预算1美元提高到**总预算2美元**（即追加1美元），沿用原台账、使用新的快照路径：

```bash
python3 scripts/tikhub_public.py --path /api/v1/wechat_search/v2/fetch_search --params /absolute/task-output/account-search-params.json --execute --output /absolute/task-output/wechat-account-search-02.json --ledger /absolute/task-output/tikhub-calls.jsonl --approve-budget-usd 2 --approval-ref user-confirmation-01
```

新总额不是“额外可花金额”；本任务已有支出和失败/不确定费用全部继续计入。加锁台账追加 `kind=budget_update`，保存旧总额、新总额、台账外此前支出、授权引用及时间，不重写旧预留。后续请求省略预算与追加参数，自动使用已批准的总额和此前支出；再次超额时重新申请。相同引用与同一有效总额重复传入不重复记账或叠加额度；旧引用不能批准不同金额或回退到旧总额。

追加授权在任何付费请求前持久化；即使后续请求被其他校验拦截，已记录的授权仍有效。追加预算只解除预算限制，不自动重试已失败请求，也不重置原路线的诊断复查次数。所有取数仍经企业网关且不逐次查价。

### 评论列表与样本检查（1.2.4）

当前按响应合同解析抖音 `app/v3/fetch_video_comments` 的 `data.comments`，以及小红书 `app_v2/get_note_comments` 的 `data.data.comments`。其他入口仍需先核对真实结构并补响应合同；不能把缺少自动统计当作评论数为0。

`comment_sample` 单独记录本页返回条数、有效去重评论数、重复数、不可用条数和 `state`。有效条目需有非空字符串ID与正文，且未被标记 `hidden=true/invalid=true`。不把平台宣称的总评论量当成实际取得数量。

- `valid_comments`：有可用的去重评论，仍需人工核对对象、相关性和证据含义。
- `empty_page`：已核对的列表确实为空；顶层 `status=empty`，只代表本页无返回。
- `no_usable_comments`：列表存在，但没有满足ID、正文及可见性要求的条目。
- `invalid_structure`：列表缺失或类型不符；顶层 `status=invalid_response`，不保存为有效快照，也不当成空页。

可加 `--min-valid-comments N` 传入本次采样计划明确的**单页**目标。低于目标记 `sample_status=insufficient`，达到记 `target_met`；未指定目标记 `not_assessed`，不自动判定证据充分。仅对已声明评论响应合同的路由接受该参数。达到数量目标不代表背调充分，也不能凭单页推断全网风评；跨页/作品还需统一去重、分层并检查相关性。

例如小红书仅取得1条有效评论，目标为5条时，保留 `valid_comment_count=1` 和 `sample_status=insufficient`，不写成“无评论”。诊断和样本统计进入台账/审计记录，业务报告仍遵循原报告合同。

翻页时把返回游标原样放入新的参数文件，用新快照文件名、同一台账继续请求。微信游标中的`+/=`不能自行解码重组；小红书多游标同时回传；B站搜索用cursor而不是臆造page；快手eID与数字ID先转换核对。默认/热门/最新排序分别建立样本，不把重复快照累计成新评论。

## 维护与校验

内置价格表与接口合同共用 `references/public-endpoints.json`：40条路由均含 `price_usd/price_checked_at/price_source`，单价单位为USD/请求。日常业务直接使用此表，不逐次查询价格，不因价格表日期较早自动中断取数。维护者在技能更新时集中核对受影响单价及来源日期，不把维护查价插入每次业务调用；本次沿用表内2026-10-19价格快照，未伪造新的核价日期。新增路由需同时补单价，缺失或非法单价属于目录错误，不当作免费调用或自动联网查价。

官方OpenAPI：`https://api.tikhub.io/openapi.json`。后台只需为本次取数配置对应业务路由；查价路由不是本采集器执行的前置条件。文档更新后只修改受影响的白名单与解析规则，不自动开放整个目录。当前公开路由未包含的能力，先补适配再取数。

退出码：0为响应快照已保存（不等于样本充分）；1为数据请求/验证/保存失败；2为本地参数、目录或累计预算预检未通过。诊断用具体阶段、路由和网关错误码定位。需要后台维护者检查目标路由权限时，保留脱敏诊断，不读取本地凭据或改走直连。

离线回归命令（无网络、无凭证）：

```bash
python3 -m unittest discover -s scripts -p 'test_*.py' -v
```

Windows 使用安装的 Python 3.10+ 执行同一命令（通常为 `python`）。原生进程测试在当前系统验证并发预算互斥与进程退出释放；Windows 适配器另含无 fcntl 导入、锁竞争和异常释放测试，不调用真实接口。

离线通过只能证明调用器的参数/预算/脱敏行为；每条平台链路仍要在真实背调开始时按预算逐个探测，记录当次身份匹配、字段覆盖和停止原因。采集器不自动生成情绪结论、判断负面事实或声称全网完整覆盖。
