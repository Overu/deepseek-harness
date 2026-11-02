> 冻结历史记录：保留旧 Shell 在记录日期的结论和验收状态，不代表当前实现或线上状态。现行说明见 [Insight 文档入口](../../../README.zh.md)。

# P4.1 旧数据只读盘点

日期：2026-10-30（Asia/Shanghai）。状态：只读盘点完成。用户最终确认 P4 只复用旧 `harness` 作为 DSH_HOME；不进行导入、转换、合并、定时任务兼容或迁移状态管理。代码基线为 DSH insight 的 ff40a73591、Shell main 的 4caca9c。本步没有修改产品源码、旧账号数据或系统配置，没有创建迁移副本、启动迁移、运行历史任务、调用模型或发布客户端。P3 的既有未关闭项不因本次盘点被标记通过。

## 1 范围与证据保管

本机只读扫描三个已由代码确认的数据根：旧正式版 `~/Library/Application Support/insight-desktop`、旧开发版 `~/Library/Application Support/insight-desktop-dev`、当前仓库隔离开发版 `deepseek-harness/apps/desktop/.desktop-build/development/insight-desktop-dev`。目录标签说明来源，不单凭目录名推断服务环境或后端账号身份。迁移账号仍必须以可信环境和后端 user ID 派生的 scope 为准。

只输出结构和汇总，不将会话正文、标题、手机号、user ID、账号 scope、配置凭证或完整资源 URL 写入此报告。精确本机路径、逐文件元数据和结构化读取记录留在 DSH 被忽略的 `apps/desktop/.desktop-build/qualification/p4-20261030/`，不纳入 Git。`.credentials.yaml` 只统计文件元数据，未读取内容；不读取登录凭据存储、浏览器 Cookie 或密钥链。技能目录只确认存在和一级目录数量，不检查技能内容正确性。

## 2 本机样本

| 项目 | 旧正式版账号 | 旧开发版账号 | 当前原生开发账号 |
| --- | --- | --- | --- |
| 账号目录数量 | 1 | 1 | 1 |
| Home | harness | harness | harness-native |
| 工作区登记数 | 1 | 2 | 1 |
| 工作区原路径存在 | 1/1 | 2/2 | 1/1 |
| 工作区登记的会话 ID | 2 | 18 | 2 |
| 日志中的独立会话 ID | 2 | 21 | 2 |
| 物理日志文件 | 2 | 25 | 2 |
| 日志版本分布 | V4 × 2 | V0 × 1、V3 × 5、V4 × 19 | V4 × 2 |
| 带 parentSession 的物理日志 | 0 | 2 | 0 |
| 附件目录中的文件 | 未发现附件目录 | 18，约 39.90 MB | 未发现附件目录 |
| profile 归档文件 | 3，约 17.43 MB | 51，约 681.82 MB | 0 |
| 盘点文件数 | 39 | 3495 | 17 |
| 盘点逻辑字节总量 | 17,689,302 | 791,069,706 | 106,605 |

物理日志数不等于会话数；同一会话的不同 generation 必须完整保留。字节数使用十进制 MB，表中逻辑总量包括旧插件归档及部分缓存，不等于运行时业务量，也不是 APFS 物理占用。扫描不跟随符号链接，排除 `node_modules`、`.git`、`.desktop-bin` 及 Home 根 cache；旧开发 profile 中另有约 78.05 MB 的 `.pnpm-store`。旧正式和旧开发样本均未发现扫描错误或扫描范围内的符号链接。所在卷盘点时可用约 51.2 GB；本报告不据此为其他用户保证空间充足。

## 3 会话读取结果及限度

复用 Shell 现有只读历史读取器，按其 32 MiB 上限读取完整串联 Zstandard 帧、校验 UTF-8、完整行和 JSON；随后使用当前 DSH 已构建 catalog，以 recovery=strict、validation=transformed 解码。V0/V3 使用 historicalSessionFormatCatalog，V4 使用 sessionFormatCatalog；未对来源执行写打开、发布 generation 或启动 Host。

| 来源 | 完整读取并严格解码 | 物理日志事件行总计 | 拒绝/读取错误 |
| --- | --- | --- | --- |
| 旧正式版 | 2/2 | 60 | 0 |
| 旧开发版 | 25/25 | 5570 | 0 |
| 当前原生开发版 | 2/2 | 80 | 0 |

以上事件行总计按物理日志计算，可能重复包含不同 generation 中的历史，不是界面消息数。V0/V3 原格式解码通过只说明 27 个旧物理日志可由当前 catalog 严格读取，不构成数据迁移、继续对话或业务兼容验证。样本包含子代理、旧 Workflow、交付物、模型选择及工具调用/结果等事件；本阶段不将这些数据转换或重放。

旧正式版工作区登记的 2 个会话均有日志。旧开发版登记的 18 个会话也均有日志，但日志目录另有 2 个子会话和 1 个未登记的顶层会话。本阶段不处理其归属或展示策略。

## 4 账号与目标 Home

旧 Shell 与当前 Integration 使用相同的 scope 算法：SHA-256 对 `insight-account-v1\0environment\0userId` 求摘要，取前 32 个十六进制字符。该算法支持按稳定账号定位，不能从手机号、显示名或任意目录名称推导替代身份。

旧开发账号与当前原生开发账号的 scope 相同，但 userData 根不同，两边已有会话，当前样本的会话 ID 无重叠。旧正式账号与当前原生开发账号的 scope 不同，不能据此声称正式账号已登录核验。P4 使用 Shell 的 userData 根和账号 `harness`，不默认跨 userData 合并。

`harness` 是 canonical Home。仅有 `harness-native` 而没有 `harness` 时启动停止并保留该目录；两个目录同时存在时以 `harness` 为准，`harness-native` 不改写。

## 5 数据拥有者与 P4 范围

| 数据 | 盘点发现 | P4 处理 |
| --- | --- | --- |
| 会话 | sessions 下有 V0/V3/V4 多代压缩日志、子会话与锁文件 | 直接保留在 `harness`；不复制、转换或修复 |
| 工作区 | 实际文件为 storages/workspace.json；旧/新样本 unit 均为 workspace v2，含 global 与 workspaces 表 | 直接保留在 `harness`；不复制工作区文件树 |
| 会话投影缓存 | 旧开发版有聚合及逐会话 session_projcache；其他样本有逐会话缓存 | 以日志为源验证重建能力，不把缓存当唯一历史或直接宣布可删除 |
| Canvas 结果与附件 | 旧开发版有 desktop_canvas_results/sources 记录及附件文件 | 保留资源与来源记录，核对路径、账号和成果引用；本步未访问远程资源 |
| 插件来源 | 正式版声明四个必需组件；开发版另声明旧 insight-workflow-op，并保留较多历史本地归档 | 记录活动来源和旧来源，四组件使用父仓版本；第三方选择保留；不复制旧依赖安装目录，不默认迁入全部历史归档 |
| 旧 Workflow | 开发样本中既有插件声明，也有历史运行事件 | 按用户决定退役执行器，保留历史事件和成果，不能随插件退役删除会话 |
| 配置 | 开发 profile patch 存在通用设置、主题和默认模型覆盖；profile 内还有旧本地包 | 原文件保留，不直接套旧 web profile；具体设置在 desktop profile 的生效情况按拥有者核对，目录复用不等于配置已逐项验证 |
| Memory | 实际有 daily、projects、SUGGESTIONS、dsh-memory-evolve/update-state 等；advisor 等目录需保留目录归属 | 原位保留，由拥有者读取；旧独立更新状态不恢复为 Git 自更新行为 |
| Prompt | 源码调查未发现独立持久化仓库，UI undo 等为内存状态 | 保留 profile 配置，不能承诺恢复旧进程中的瞬时面板/撤销状态 |
| 账号与共享技能 | Home 中未发现独立账号技能目录；共享 ~/.agents/skills 存在、一级目录 27 个；~/.dsh/plugins 不存在 | 核对配置中的自定义技能路径；共享目录原位使用，不复制；bundled-skills 继续按已批准方式同步，不验证其内容 |
| 更新偏好 | 旧正式版 updates/preferences.json 为 schema 1，candidateOptIn=true | 不在 P4 转换；更新实现和旧安装状态处理归 P5 |
| 凭据 | 旧 Home 存在凭据文件，仅盘点元数据 | 允许首次重新登录，不将凭据复制到迁移状态、配置或报告 |

## 6 不在 P4 范围内的盘点项

旧进程、LaunchAgent、定时任务、未登记会话、profile 归档、`harness-native` 合并和任意历史文件导出不在 P4 交付范围。它们的只读盘点结果仅保留为后续独立工作的信息，不作为 P4 启动阻断或兼容承诺。

## 7 本报告的限度

本报告不以只读盘点替代启动或产品验收。严格读取结果不能证明原生列表、继续对话、资源访问、历史导出、旧定时任务或预发布目录兼容。若这些能力重新进入范围，需要单独设计、实现和验证。

## 8 验证与证据

旧 Home 已盘点的 3534 个普通文件，在读取前后大小与 mtime 均未变化；未声称对全部内容做前后密码学摘要。当前原生开发实例仍可能活动，未将它纳入旧源静止证明。没有执行格式迁移、创建持久化目标、运行产品测试、读取技能正文或验证 Windows 安装升级。

| 本地证据 | 内容 |
| --- | --- |
| local-inventory.private.json | 三个来源的逐文件路径、大小、mtime、权限及扫描排除项 |
| session-structure.private.json | 串联帧完整读取后的 generation、会话标识及事件类型统计 |
| session-decoding.private.json | 已构建 catalog 的逐物理日志只读严格解码结果 |
| profile-storage.private.json | 包依赖名称/来源种类、配置键及存储结构，不包含配置值 |
| workspace-archive-summary.json | 工作区与日志归属、原路径存在性和归档数量 |
| size-summary.json | 扫描逻辑字节与排除目录 |
| launch-agent-summary.json | 只读 LaunchAgent 候选检查 |
| read-only-verification.json | 旧来源大小/mtime 前后对照 |

代码依据：[账号路径](../../../../../packages/insight/desktop-integration/src/desktop/account-scope.ts)、[当前 Home 启动门](../../../../../packages/insight/desktop-integration/src/desktop/account-home.ts)、[目标格式 catalog](../../../../../packages/session/session-format-catalog/src/index.ts)、[旧只读读取器](#historical-source-1)、[工作区记录](../../../../../packages/workspace/workspace/src/spec.ts)、[迁移范围](2026-10-28-dsh-insight-execution-report.md#8-持久化数据迁移)。


## 迁入时保留的历史源码位置

以下是原报告引用的旧仓源码或当时本机构建证据，不是当前安装包依赖；未将旧仓业务源码复制到文档目录。原始目标同时记录在导入清单中。

<a id="historical-source-1"></a>

- `insight-desktop-shell:src/main/session-history-export.ts`
