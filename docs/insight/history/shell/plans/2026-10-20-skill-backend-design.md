> 冻结历史记录：保留旧 Shell 在记录日期的结论和验收状态，不代表当前实现或线上状态。现行说明见 [Insight 文档入口](../../../README.zh.md)。

# Skill 后端表结构与接口设计草案

本方案覆盖 V1.2 的技能中心、后台 Skill 管理和 Skill 资源授权。服务端管理官方技能的展示属性、版本、包和授权，客户端负责当前账号在本机的安装、启停、卸载及 DSH 接入。采用关系型逻辑模型，不绑定数据库、框架或网关前缀；以下 `/api` 是候选前缀，所有 endpoint 均为拟新增接口。

设计以[产品需求](https://ecn23rpwn6ce.feishu.cn/wiki/JcGAwhIKWikdiFka5oDcMoTynEb)为业务范围，以 Shell 锁定的 Core `c3aaab2e76ddfad6163478687287774ad7233374` 为运行时兼容基线，并对照 DSH 上游 `687f282e8625c6b8d11ff58211a90524be2e4317`。不引入个人技能云同步、重新实现用户角色系统或远程执行技能的 HTTP 接口。

## DSH 结构与字段组合

### 已核对的原生能力

| 对象 | DSH 已有语义 | 对本方案的影响 |
| --- | --- | --- |
| SkillSummary | `name`、`description`、`whenToUse?`、`invocation`、`source`、`provider`、`resourceBase?`、`path?` | 保留模型发现、手动调用及资源定位能力，不把目录摘要当完整技能包 |
| SkillDefinition | 摘要加 `content`、`metadata?` | 正文按需加载，完整资源随包分发 |
| SkillProvider | `list`、`get`；通过 `ctx.skills.registerProvider` 注册 | 企业托管技能可通过公开 Host 扩展接入，无需新增 Core 私有接口 |
| 文件技能 | `<directory>/SKILL.md` 或平铺 `<name>.md`；只发现扫描根的直接条目 | 市场包先限定为一个入口的目录包；DSH 原生平铺技能继续保留其能力 |
| Frontmatter | 必须有合法 `name`、非空 `description`；支持 `whenToUse`、`metadata`、`disable-model-invocation`、`user-invocable` | 官方上传按该语义校验，保留原始内容和未知字段 |
| 同名覆盖 | 先按作用域，再按 provider rank 等规则决定生效项 | 市场记录与会话生效技能不是同一个列表，不能绕过 Core 重新推导胜出者 |
| 调用控制 | `disable-model-invocation` 省略时允许模型调用；`user-invocable` 省略时允许用户调用 | 包内调用策略、企业分发授权、用户启停必须分开 |

`version`、`metadata.version`、分类、上下架、下载量并非上述 DSH 注册表负责的业务能力。它们由企业市场补齐。`license`、`allowed-tools`、`compatibility` 等未知扩展字段可以原样保留，但不能据此声称当前 Core 已执行相关策略。

源码依据：[Core Skill 服务](https://github.com/Boxser567/insight-harness-core/blob/c3aaab2e76ddfad6163478687287774ad7233374/packages/skill/skill/src/index.ts)、[Core 文件解析器](https://github.com/Boxser567/insight-harness-core/blob/c3aaab2e76ddfad6163478687287774ad7233374/packages/skill/skill-filesystem/src/index.ts)、[DSH 上游类型](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/skill/skill/src/index.ts)、[DSH 上游文件解析器](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/skill/skill-filesystem/src/index.ts)。

### 必须区分的字段

| 含义 | API 字段 | 取值来源和修改规则 |
| --- | --- | --- |
| 系统记录身份 | `skillId` | 服务端生成、不复用；用于关联、授权和更新 |
| 原生技能标识 | `skillName` | 来自 YAML `name`，遵循 `^[a-z0-9]+(?:-[a-z0-9]+)*$`；创建后不可修改 |
| 包内目录名 | `entryPath` | 上传时识别；不要求等于 `skillName` |
| 产品展示名称 | `displayName` | 后台输入，官方技能最多16字符；不修改原生 `name` |
| 产品卡片简介 | `shortDescription` | 后台输入，最多40字符；不覆盖模型路由描述 |
| 产品详情说明 | `description` | 后台输入，最多500字符；与完整 SKILL.md 分开 |
| 模型路由描述 | `runtime.description` | 从包内 YAML `description` 解析；随包版本冻结，不适用40／500字符的展示限制 |
| 技能指令全文 | `SKILL.md` 与 `runtime.content` | 原始文件包含 frontmatter；DSH `content` 为去除 frontmatter 后的正文 |
| 发布版本 | `version` | 后台填写的 SemVer，最多20字符；负责市场升级比较 |
| 原始声明版本 | `declaredVersion` | 识别 `metadata.version`／顶层 `version`，仅表示包内声明，不替代发布版本 |

现有 PPT 技能目录为 `ppt-maker-new`，原生名称为 `ppt-maker-new-new`，这是必须保留的真实兼容用例。现有 [`ui.json` 展示规则](../skill-display.md)继续支持；后台实时展示属性优先于包内展示默认值，但只在产品 UI 中合并，不能写回已签名包或模型指令。

## 表结构

共六张新业务表。下列 `id` 均是服务端生成的不透明主键，API 一律按字符串传输；用户和角色 ID 对接既有身份服务。JSON 指逻辑类型，可映射为数据库 JSON 或受校验文本。时间统一使用带时区的时间值，API 返回 UTC ISO 8601。

### skill_category 分类

| 字段 | 逻辑类型 | 约束／用途 |
| --- | --- | --- |
| id | ID | 主键 |
| name | String | 非空、唯一，最多10个 Unicode 码点 |
| is_default | Boolean | 仅系统“待分类”为 true；不可删除、重命名或由普通创建接口设置 |
| revision | Integer | 乐观锁，从1开始 |
| created_at、updated_at | Timestamp | 创建和最后修改时间 |

固定初始化一个“待分类”。删除普通分类时，在同一事务中将其技能迁入“待分类”再删除分类，不改变版本、上架状态和授权。历史版本中的分类名称快照不参与迁移。

### skill 官方技能主表

| 字段 | 逻辑类型 | 约束／用途 |
| --- | --- | --- |
| id | ID | 主键，对外为 `skillId`；删除后不复用 |
| native_name | String | 对外为 `skillName`，来自包内 `name`；全局唯一且永久保留，不因软删除释放 |
| display_name | String | 非空，最多16码点；未删除记录中名称唯一 |
| short_description | String | 非空，最多40码点 |
| description | String | 非空，最多500码点；产品详情说明 |
| category_id | ID | 必填，关联分类，默认“待分类” |
| listing_status | Enum | `unlisted`／`listed`；新建和下架均为 `unlisted` |
| latest_version_id | ID | 关联本技能的当前发布版本，成功创建后不能为空 |
| first_listed_at | Timestamp? | 首次上架时间，用于后续确定 new 提示口径 |
| revision | Integer | 属性、上下架和当前版本变动时递增 |
| created_by、updated_by | ActorID | 从管理员身份提取，不接受请求体伪造 |
| created_at、updated_at、deleted_at | Timestamp? | 删除采用软删除；创建和更新时间必填 |

主表不放 `enabled`、`installed_version`、`is_installed` 或永久 `is_preinstalled`。安装属于本机账号，是否预装属于某个客户端发行版的清单。下载量通过成功分发记录聚合，分类数量通过主表聚合，不额外维护独立状态。

图标在本期使用产品默认图标；原文未定义运营上传图标的属性或流程，如需要可单独补充媒体资源约定。

### skill_version 发布版本

| 字段 | 逻辑类型 | 约束／用途 |
| --- | --- | --- |
| id | ID | 主键，对外为 `versionId` |
| skill_id | ID | 关联技能 |
| version | String | 无 `v` 前缀的 SemVer，最多20字符；同技能唯一 |
| package_id | ID | 关联已校验、不可变的技能包 |
| release_notes | Text | 更新说明；首版可为空，后续发布必填 |
| display_snapshot | JSON | 发布时名称、简介、详情说明及分类 ID／名称的完整快照 |
| artifact_signature | JSON | 签名算法、keyId、签名值；签名覆盖稳定序列化的 skillId、skillName、version、包 SHA-256 等交付身份 |
| published_by | ActorID | 发布人 |
| published_at | Timestamp | 发布时间 |

只保存成功发布的版本，失败上传或校验不生成版本记录。发布新版本不改变 `listing_status`。版本、包和快照不可原地编辑；名称等属性编辑只改 `skill`，不回写快照。

约束：`UNIQUE(skill_id, version)`；`latest_version_id` 必须属于当前技能。版本比较用 SemVer 规则，禁止字符串排序；包内 `name` 必须始终等于主表 `native_name`。发布事务锁定或比较主表 revision，重新检查版本严格高于当前版本，再插入版本、更新指针和记录审计。两个相同或 SemVer 优先级相等的版本不能靠不同 build metadata 绕过“严格更高”条件。

### skill_package 技能包与上传校验

| 字段 | 逻辑类型 | 约束／用途 |
| --- | --- | --- |
| id | ID | 主键，对外为 `packageId` |
| status | Enum | `uploading`／`validating`／`ready`／`rejected` |
| original_filename | String | 展示上传时的包名，不用于拼接磁盘路径 |
| storage_prefix | String | 服务端生成的私有对象存储位置，不返回给普通客户端 |
| entry_path | String | 包内相对 SKILL.md 路径 |
| sha256 | String? | 服务端计算的交付 ZIP 校验值，ready 时必填 |
| archive_size_bytes、unpacked_size_bytes、file_count | Integer? | ready 时必填；用于下载、校验及解压限制 |
| manifest_json | JSON? | 原始 frontmatter、解析后的运行时字段、可选 ui.json、声明版本；全部由服务端产生 |
| file_index_json | JSON? | 包内规范相对路径、大小、SHA-256和预览类型；用于文件树及安全文本预览 |
| validation_report | JSON? | 校验器版本、错误／警告码和相关包内位置，不包含服务器目录 |
| uploaded_by | ActorID | 上传者；只有本人或有相应管理权限者可查询未发布包 |
| created_at、validated_at、expires_at | Timestamp? | 创建时间必填；未被版本引用的临时包到期清理 |

一个包包含一个技能入口及其全部 `scripts/`、`references/`、`assets/` 等资源，不拆成只能存正文的技能记录。允许 ZIP 根部直接是技能内容，或只有一个包装目录；拒绝多个可安装入口的歧义，资源中的示例 SKILL.md 不额外注册成技能。目录名不作为技能身份。

ready 后原包、解析结果、文件索引均不可修改。SHA-256 相同不直接向其他上传者暴露已有私有包信息。已被历史版本引用的包不参与临时清理，技能软删除也不立即删除历史包。发布与过期清理必须互斥认领同一 package，禁止发布提交前后被并发清理删除对象。

上传或解压只处理数据，不执行 SKILL.md、脚本、依赖安装命令或包内配置。必须限制压缩前后大小、文件数、压缩比与解析资源，拒绝路径穿越、绝对路径、链接逃逸以及跨平台规范化后冲突的条目。具体容量限额按技能包需求另定，不照搬案例导入的20GB。

文件夹上传由客户端或后台页面保留相对路径打包后走相同上传接口，不接收调用方本机的绝对目录。分片、断点续传沿用所选对象存储的标准上传会话，不另造传输协议。

### role_skill_grant 角色资源授权

| 字段 | 逻辑类型 | 约束／用途 |
| --- | --- | --- |
| role_id | RoleID | 既有角色身份 |
| skill_id | ID | 官方技能身份 |
| granted_by | ActorID | 授权操作者 |
| created_at | Timestamp | 授权时间 |

联合主键 `(role_id, skill_id)`。用户有效技能集合是其所有启用角色授权的并集；技能待上架时允许预授权。分类勾选提交时展开成具体 skillId，不授予未来新加入该分类技能的隐式权限。

授权默认覆盖该技能的市场查看、安装和更新；原需求没有独立的更新权限配置项，暂不增加多个授权布尔字段。后台管理权限与这里的技能使用资源授权分开校验。角色禁用后保留记录但不计入有效授权；角色删除时清除其关联，不删除技能、用户或客户端文件。

### skill_delivery 分发记录

| 字段 | 逻辑类型 | 约束／用途 |
| --- | --- | --- |
| id | ID | 主键，对外为 `deliveryId` |
| user_id | UserID | 认证用户身份，只在服务端保存 |
| operation_id | String | Main 生成的单次安装／更新操作 ID；与 user_id 联合唯一 |
| skill_id、version_id | ID | 绑定实际交付的技能及版本，不接受其他版本的结果确认 |
| action | Enum | `install`／`update` |
| status | Enum | `issued`／`succeeded`／`failed` |
| error_code | String? | 受限错误码，不上传任意本机路径或异常栈 |
| created_at、download_expires_at、completed_at | Timestamp? | 创建和下载授权到期时间必填 |

记录用于重试幂等、分发审计及下载量统计，不能证明客户端仍安装该版本，也不能据此替客户端执行安装。相同 operationId 的相同请求返回同一记录；若绑定技能、版本或 action 不同则返回冲突。终态不可更改，相同结果重报不重复计数。

建议下载量口径为成功安装／更新的市场分发次数；安装回执在本地校验并提交安装后上报。预装初始化、管理员历史包下载、失败请求和重复回执不计数。该指标依赖客户端回执，不是防作弊或计费依据；最终产品统计口径仍需确定。

### 查询索引与审计

除主键、外键和上述唯一约束外，增加 `skill(listing_status, category_id)`、`skill_version(skill_id, published_at)`、`role_skill_grant(skill_id, role_id)`、`skill_delivery(skill_id, status)`、`skill_package(status, expires_at)`。同一批量授权查询使用有效角色集合，避免逐技能查询权限。

管理员属性编辑、上下架、版本发布、分类迁移、删除和授权变更均写入操作审计；可用现有审计设施。若后端没有审计存储，实施时必须补齐持久化审计，不能只打普通运行日志。所有管理修改使用 revision／If-Match 防止覆盖他人变更。

## API endpoint

### 公共约定

管理员和客户端接口均认证并服务端鉴权。身份从可信认证上下文获取，不接收客户端自报 userId 作为授权依据。Main 发起企业服务请求，普通 Renderer、技能脚本不持有账号凭据。

请求／响应使用 camelCase；列表统一 `items`、`total`、`page`、`pageSize`，限制最大页大小。错误至少包含 `code`、`message`，HTTP 状态区分401、403／404、409、413、422。创建返回201，异步校验返回202，重复幂等请求返回同一资源。业务信封与正式网关确定后统一，不为此设计多套成功码。

客户端对不可见技能统一返回不可用，避免区分未授权、已删除及不存在而泄露目录。下载 endpoint 每次请求都重新验证当前有效授权和上架状态，不把历史 delivery 当永久授权。文件内容仅按相对路径索引读取，不接受任意 URL、对象存储 key 或本机路径。

### 2 管理后台 Skill 管理

| 方法 | Endpoint | 对应需求／行为 |
| --- | --- | --- |
| GET | `/api/admin/skills` | 2.1 列表；参数 `q, categoryId, listingStatus, page, pageSize`，支持名称与原生名称／编号搜索 |
| POST | `/api/admin/skills` | 2.2 创建；传展示属性、categoryId、ready packageId、version；原子创建首版，默认待上架 |
| GET | `/api/admin/skills/{skillId}` | 2.5 基本信息、当前版本、下载量和 revision |
| PATCH | `/api/admin/skills/{skillId}` | 2.3 只允许展示属性和分类；请求需 If-Match，不接受 nativeName、版本或运行时指令 |
| PUT | `/api/admin/skills/{skillId}/listing` | 2.1 上下架；传 `listingStatus`，新上架要求有效版本和可交付包 |
| DELETE | `/api/admin/skills/{skillId}` | 2.1 软删除并从分发目录移除；保留历史身份和包 |
| POST | `/api/admin/skills/batch-operations` | 2.1 批量上架／下架／删除；传 action、ID与revision列表；整批校验并在一个事务提交 |
| GET | `/api/admin/skills/{skillId}/versions` | 2.5 按发布时间倒序分页读取版本记录；默认可先展开首条 |
| POST | `/api/admin/skills/{skillId}/versions` | 2.4 传 packageId、version、releaseNotes；需 If-Match，发布后保持上架状态 |
| GET | `/api/admin/skills/{skillId}/versions/{versionId}` | 2.5 返回该版本完整快照、运行时元数据和包信息 |
| GET | `/api/admin/skills/{skillId}/versions/{versionId}/files` | 2.5 返回版本绑定包的文件树 |
| GET | `/api/admin/skills/{skillId}/versions/{versionId}/file?path=...` | 2.5 有界读取可预览文本；二进制只返回元信息，不执行HTML、JS或Markdown代码 |
| GET | `/api/admin/skills/{skillId}/versions/{versionId}/package` | 2.5 下载该版本真实ZIP，不回退最新包、不计市场下载量 |

版本查询必须校验 versionId 归属 skillId。历史包丢失时版本记录仍可查看，返回 `packageAvailable: false` 和受限原因码；下载返回 `SKILL_PACKAGE_UNAVAILABLE`。

### 技能包上传

| 方法 | Endpoint | 行为 |
| --- | --- | --- |
| POST | `/api/admin/skill-packages` | 创建上传会话；传 filename、sizeBytes和可选客户端校验值，返回 packageId、标准分片上传会话及到期时间 |
| POST | `/api/admin/skill-packages/{packageId}/upload-parts` | 按 partNumber 获取当前会话的受限分片上传地址，用于续传；服务端校验上传者、配额和状态 |
| POST | `/api/admin/skill-packages/{packageId}/complete` | 完成标准分片会话后进入服务端校验；幂等调用，不信任客户端声称的完整性 |
| GET | `/api/admin/skill-packages/{packageId}` | 查询状态、解析字段、文件索引和校验错误；ready 才能用于创建／发布 |

分片上传URL只允许该会话的指定对象和分片，短时有效；不能签发任意 bucket／key。包校验失败清理临时内容，不产生技能或版本。ready 包发布时仍需检查可读、未过期、上传归属及管理权限，避免先校验后被替换或被其他人引用。

### 2.6 分类与 4.5 数据资源授权

| 方法 | Endpoint | 行为 |
| --- | --- | --- |
| GET | `/api/admin/skill-categories` | 分类、数量和 revision |
| POST | `/api/admin/skill-categories` | 2.6.1 新增普通分类，只接收名称 |
| PUT | `/api/admin/skill-categories/{categoryId}` | 2.6.2 一次提交名称修改及技能迁移；传分类revision和逐项源分类／目标分类／技能revision，整批事务提交 |
| DELETE | `/api/admin/skill-categories/{categoryId}` | 普通分类删除与迁入待分类在同一事务完成，需 If-Match |
| GET | `/api/admin/roles/{roleId}/skill-grants` | 当前角色授权集合、可配置技能目录及授权revision，包含待上架技能 |
| PUT | `/api/admin/roles/{roleId}/skill-grants` | 使用完整 skillIds 集合覆盖保存；需匹配授权revision，失败不部分保存 |

分类抽屉迁移只允许“当前分类移出”或“待分类加入当前分类”。授权revision由授权存储统一维护，可用既有角色资源配置版本，也可由当前集合生成条件更新标识；并发保存必须比较和提交在同一事务中完成。

角色创建、成员分配、启停接口复用身份系统，不在此重新设计；这里只规定其变更应及时影响有效 Skill 授权。管理端菜单和接口操作权限依然要单独验证。

### 1 客户端技能市场与分发

| 方法 | Endpoint | 行为 |
| --- | --- | --- |
| GET | `/api/skills` | 1.1 只返回已上架、有授权、未删除的市场技能；支持 q、categoryId和分页 |
| GET | `/api/skill-categories` | 返回当前用户市场可见分类和对应数量，不能泄露无权查看的技能数量 |
| GET | `/api/skills/{skillId}` | 1.3 当前展示属性、最新发布版本、运行时摘要和可执行的市场动作 |
| POST | `/api/skills/check-updates` | 1.5 Main 提交本机市场技能的 skillId／installedVersion；逐项返回最新版本或统一 unavailable，服务端不持久化所报安装清单 |
| POST | `/api/skills/{skillId}/deliveries` | 安装／更新前校验授权；传 versionId、operationId、action，创建绑定当前最新版本的交付记录并返回校验信息及下载地址 |
| GET | `/api/skill-deliveries/{deliveryId}/package` | 仅记录所属用户可下载，支持Range续传，每次重验分发权限；对象存储内容经受控服务读取 |
| PUT | `/api/skill-deliveries/{deliveryId}/result` | Main 报告 succeeded／failed；幂等记录结果，成功仅计数一次 |

市场搜索匹配展示名、简介和原生 skillName／系统编号。安装页和待更新页的搜索范围由客户端本地列表控制，不把 GET /skills 当成这两个页签的完整数据源。check-updates 必须检查最新版本严格高于上报版本、仍可见且能分发；检查结果与实际下载间发生撤权时，下载重新鉴权并拒绝。

目前不开放普通客户端历史版本下载。若点击更新后最新版本再次变化，创建交付返回 `SKILL_VERSION_CHANGED`，刷新提示后由用户重新触发；已经绑定并获准下载的交付不静默换包。同operationId重试已创建交付时，校验身份与请求内容后返回原记录，不因新发布而重绑版本；下载仍重新鉴权。

结果回执校验交付所有权和状态转换，不要求技能当前仍在市场可见；已经完成的本地安装不能因为随后下架而变成失败。下载授权到期只阻止继续下载，不阻止所属用户为已完成操作补报同一结果。

安装、启停、卸载、自定义上传／创建不设计成中央服务端的安装命令。它们是可信 Main／Host 的本地操作，后端200不能等同于本机安装成功。官方市场技能下架、删除或撤权后，详情从本地安装快照读取，后端不因调用方声称“已安装”而重新泄露不可见资源。

### 分发响应示例

以下是 data 中的业务字段，ID与哈希为占位示例，不代表已经存在的线上资源。

```json
{
  "deliveryId": "delivery_example",
  "skillId": "skill_example",
  "skillName": "ppt-maker-new-new",
  "versionId": "version_example",
  "version": "1.0.0",
  "presentation": {
    "displayName": "PPT制作",
    "shortDescription": "制作和修改演示文稿",
    "description": "根据主题、素材或已有演示文稿制作和修改PPT。"
  },
  "runtime": {
    "name": "ppt-maker-new-new",
    "description": "Use when creating or materially editing a presentation.",
    "invocation": { "modelInvocable": true, "userInvocable": true }
  },
  "package": {
    "entryPath": "ppt-maker-new/SKILL.md",
    "sizeBytes": 1024,
    "sha256": "<server-computed-sha256>",
    "downloadPath": "/api/skill-deliveries/delivery_example/package",
    "signature": {
      "algorithm": "<selected-artifact-signing-algorithm>",
      "keyId": "<trusted-release-key-id>",
      "value": "<signature>"
    }
  }
}
```

示例路径相对ZIP根；客户端必须保留该入口目录内的完整资源树。响应不返回用户ID、Token、服务器目录或本机资源路径。`source`、`provider`、`rank`、`locator`、`resourceBase.path` 在本机安装后由受信 Host 生成，不接受上传者借 metadata 改写。

## 与客户端和 DSH 的衔接

### 1.3 更新及 1.4 安装状态

客户端在账号隔离目录内持久保存 `localSkillId`、`marketSkillId?`、`skillName`、`installedVersion`、`packageSha256`、安装来源、`enabled`、`everInstalled`、卸载墓碑和最近展示快照。完整包与本地记录完成提交后才产生安装成功回执；失败恢复旧包与旧记录。安装操作按账号和技能串行，DSH 不得观察到解压一半的目录。

市场技能使用稳定 marketSkillId 关联版本；自定义技能使用本地身份，不能冒充市场记录。自定义同标识替换需要确认，保留本地身份、启停和对话选择关系；与官方技能冲突时创建独立名称的副本，不原地替换官方原件。菜单、手动调用和模型自动发现均应遵循启停状态及包内调用策略，而不是只隐藏UI。

建议使用公开 SkillProvider 从独立账号托管目录提供已安装且启用的技能；该目录不应同时被原生文件扫描器重复发现。现有安装包的 bundled 根必须退出直接发现，改由托管记录决定是否贡献候选项，否则停用或卸载后旧预装包会重新出现。DSH 的项目、本地及插件技能继续按原生作用域和优先级决议，同名覆盖时展示真实胜出来源，不伪造可调用官方条目。

`skills/change` 用于目录失效；读取会话目录继续使用公开 `skillCatalog`／`remote.skills.list({sessionId})`。当前专家技能菜单的 [`filterSkills`](#historical-source-1)只展示固定预装名单，后续接入必须改成按实际托管安装状态和胜出来源筛选，否则市场新技能与自定义技能不会进入菜单。

### 1.1 官方预装及升级

12个官方技能导入正式 skill／version／package 记录。每个客户端发行版携带固定 `skillId + skillName + versionId + version + packageSha256 + 源目录` 的预装清单，不能启动时把本地旧包标记成服务端当前最新版。构建时以校验过的包和文件索引生成内置资源。

首次安装按本地预装清单初始化，默认启用、无需下载。普通客户端升级仅在该技能仍安装且预装基线版本更高时升级；保留停用状态，保留卸载墓碑，不降级更高版本。服务端独立发布的版本仍由用户主动更新。存量客户端首次迁入托管记录时保留已有内容，不清理其他技能和账号文件。

### 1.2 自定义技能兼容

官方市场包严格符合 DSH 原生 frontmatter；自定义导入按产品规则识别标题、YAML name／skill_id、简介和版本，缺失版本默认1.0.0。完整 SKILL.md 用于只读安全预览。

产品文档同时出现“YAML name 不合法则拒绝”和“YAML 缺失／不标准可兜底”。推荐将两阶段分开：先识别并展示兜底结果；需要修复原生 name、description 或 frontmatter 时，向用户展示规范化结果，确认保存后生成可被 DSH 加载的副本并保留原件。无法安全确定调用控制字段时阻止安装，不能兜底为允许调用。此处为待确认的产品决策，不能把只有展示信息的原文件直接标为运行时可用。

## 状态和验收

- 市场可见：未删除、listed、存在有效角色授权。角色授权并集在服务端计算。
- 可更新：本地已安装、远端版本更高、仍市场可见且包可交付；客户端保留更高本地版本。
- 属性修改：市场和有权获取实时属性的已安装列表刷新；原始包、运行时指令及历史快照不变。不可见技能仍使用本地快照。
- 本地停用：停止后续调用且不删除文件；卸载中的运行任务检查由 Host 负责，正在调用时拒绝卸载。
- 发布失败：不生成版本、不移动最新版本指针、不改变上架状态。两个并发发布不能覆盖版本指针或产生版本倒退。
- 批量迁移／授权：失败不部分保存；条件版本过期返回409，不覆盖较新的管理员修改。
- 包预览／下载：按版本绑定真实包；越权、跨技能版本引用、路径逃逸、损坏包及缺失历史包均明确失败。
- 分发重试：同operationId不重复生成记录；同成功回执不重复计数；校验或安装失败不留半安装记录。
- DSH兼容：覆盖带资源目录包、目录名不同于name、可选ui.json、未知metadata、两个调用控制开关和作用域同名覆盖；原生平铺技能继续可用。
- 预装升级：覆盖首次安装、用户停用、主动卸载、远端独立新版、本地更高版本及存量账号迁入。

## 需要确定的产品口径

1. 自定义技能是否采用“识别兜底＋确认规范化”的两阶段规则。
2. 授权取消后本地已安装技能是否继续运行。原文只明确保留文件和详情；本方案不把“禁止下载”冒充“远程撤销已下载代码”。
3. new标识的时间窗口、卸载后是否再次显示，以及下载量是否采用上述成功分发口径。
4. 发布版本与包内版本声明不一致时的处理。建议存在声明时要求一致，未声明时允许以发布版本为准；历史技能首次纳管需确定基线版本。
5. 签名格式、公钥信任及轮换方案、技能包容量／解压上限。签名覆盖的身份字段应在实现前冻结；校验值不能替代来源签名。

以上决策不影响六张表的主要职责划分。实施顺序建议为：包校验与分类／技能／版本 → 角色授权与受控分发 → 12技能纳管和预装清单 → 客户端本地生命周期及DSH公共接入。


## 迁入时保留的历史源码位置

以下是原报告引用的旧仓源码或当时本机构建证据，不是当前安装包依赖；未将旧仓业务源码复制到文档目录。原始目标同时记录在导入清单中。

<a id="historical-source-1"></a>

- `insight-desktop-shell:packages/insight-desktop-integration/src/skill-catalog.ts`
