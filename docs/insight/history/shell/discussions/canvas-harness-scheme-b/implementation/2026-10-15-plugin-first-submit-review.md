> 冻结历史记录：保留旧 Shell 在记录日期的结论和验收状态，不代表当前实现或线上状态。现行说明见 [Insight 文档入口](../../../../../README.zh.md)。

# 插件首版提交准备：桥梁审核

审核基线为 Plugin `c737496`（alpha.17），本轮为 alpha.18 整理候选。用户已报告核心能力完成初步人工验收。本次聚焦客户端/插件打通、契约、生命周期、编码边界和维护文档，不审查或重写成熟画布业务。

## 结论

当前分层能够承载目标：Host 提供 Agent 工具和身份/请求编排，Client 维持通信与常驻原生业务服务，iframe 是同一 Context/Store 的视图；图保存和来源持久化分开。模块没有必要按文件数量或目录对称性再拆管理器。本轮修复两项实际生命周期缺口，清理已无生产调用的旧协议，收口环境配置与文档，未发现本次审核范围内的剩余阻塞问题。

这个结论不表示未来 Core 升级自动兼容、不限量历史性能已压测，或成熟 Web 的既有类型诊断已解决。跨进程去重/生成恢复仍不在当前承诺内。

## 审核范围及保留的结构

| 范围 | 关键结论 |
|---|---|
| Host 工具/桥/路由 | 真实 Session 唯一 Client 定位、Context 固定、请求指纹、超时未知结果、有界缓存；本机鉴权优先，写入不自动重发 |
| Client 桥/命令端点/runtime | invisible Session binding、惰性服务、SSE重连与回执投递、执行前身份复核、Client所有权；关闭画布不卸载业务服务 |
| 共享协议与原生适配 | v4信封与业务DTO分开；工具声明单一来源；原生Context/Store、版本/保存队列、编辑保护复用，未再实现业务引擎 |
| iframe边界与导航 | 同源window/document/view绑定；独立React构建；节点选择与只读定位v1保留，视口动作不进入保存队列 |
| 生成及成果来源 | Jobs不充当来源数据库；原始根调用/Turn绑定，可信实际产物独立持久化；部分/晚完成及取消跟踪语义保持 |
| 安装/构建/依赖 | 发行资源白名单、服务静态闭包审计、实际Core公共SDK类型与隔离Profile验证；旧交付包保留 |

## 已完成的修复和清理

1. **Host卸载残留命令SSE**：`bridge-route.ts` 原只注销路由，没有主动关闭已经建立的响应和心跳。新增handler生命周期与stream集合，卸载关闭响应/监听/定时器。已发送写入因断开保持 `submission_unknown`，不会改判为未执行。回归测试先复现 `handler.close` 缺失，再验证关闭与二次关闭。
2. **runtime部分挂载失败回收延迟**：服务加载后第二个视图注册失败时，第一项挂载及新服务保留到整插件退出。现在失败立即回滚注册、dispose服务，后续卸载不二次释放；失败仍可观察，不静默重试加载。测试先复现 releases/disposed 为0，再验证均为1。
3. **验证脚本目录归属**：原 `CANVAS_VERIFY_HOME` 无条件递归清空。新增独立 `verification-home.mjs`，只允许新目录或带本仓库标记的专属目录，拒绝未标记目录、其他仓库标记与符号链接。新规则写入开发文档，不触碰用户真实Profile。
4. **环境配置重复**：API、Gateway、页面Web域及模型CDN各自维护环境选择。集中到 `src/host/service-environment.ts`；合法test/production行为保持，已有API错误语义保留。唯一有意变化是非法环境的页面不再静默注入测试分享域，而返回500，新增回归。
5. **过时内部协议**：全文引用确认 v2 `FrameBinding`/旧iframe业务命令及其parser只被旧测试使用。删除44行协议代码；有效字段/大小/循环结构与readiness校验迁到当前v4/Context测试。当前八工具声明、业务DTO/来源schema和节点选择/定位v1未改变。alpha.13工具fixture保留，未根据现声明重造期望值。
6. **维护命名**：不可见挂载改名 `SessionBinding`，保留 `retainSession` 和现有slot生命周期，没有重新引入测试UI。
7. **文档收口**：8份旧架构/实施计划/路线图移出Plugin仓库，完整字节副本与归属信息已与原Git提交逐文件核对；Shell 文档整理后统一存放于[历史归档](../../../archive/README.md)，清单保留原专项 archive 路径。重写README、protocol、acceptance、porting，新增architecture和development。保留Frozen迁入清单和依赖来源。当前文档链接检查无断链，移除旧后端SSE候选/历史待验收状态对现状的误导。

## 验证

- Plugin **261/261**，无失败或跳过；原生适配 **330/330**，26个测试文件。
- 根类型检查、当前部署Core公共SDK类型及Plugin未使用变量/参数检查通过。
- Web类型检查原9项诊断与冻结基线完全相同，无新增；不修改legacy业务来扩大此次清理。
- Vite/Host/Client构建通过，已有大chunk提示仍在；没有为消除提示改造业务依赖。
- 新专属临时Profile的实际Core安装/卸载、八工具、来源Domain恢复、真实Session根调用和历史、受保护查询/SSE、v4登记/会话同步/detach全部通过。无真实账号或模型生成。
- 58项归档文件与构建字节一致，无测试探针/身份文件；alpha.16/17原交付包哈希保持。当前包SHA256：`4f67168247f8500acfae169e196f0d8b478392a3fcc01063b7cd33fc3aae9f9c`。

详细证据见 [checks](2026-10-15-alpha18-checks.json)、[回收缺口的失败复现](evidence/2026-10-15-bridge-lifecycle-reproduction.txt)、[Package审计](evidence/2026-10-15-alpha18-package-audit.json)及[隔离PASS](evidence/2026-10-15-alpha18-isolated-pass.txt)。原始启动身份日志不归档。

## 提交范围与下一步

本轮仅Plugin源码、维护文档/测试和预发布版本；Shell只新增专项审核/归档材料，保留之前未提交内容。Core、后端和原生Web业务源码零改动。整理保存为新的本地提交，不重写之前开发历史。仓库尚未配置Git远端，本轮不推送或创建PR，也不将alpha候选宣称为正式稳定发布。

候选包：`/Users/boxser.shi/Documents/harness/desktop-canvas-plugin/insight-ai-desktop-canvas-plugin-0.3.0-alpha.18.tgz`。当前仓库的README和 `docs/architecture.md`/`protocol.md`/`development.md`/`acceptance.md` 是首版交接入口。

正式远端提交时配置目标仓库并按团队分支策略提交现有历史；无需为了本次整理再批量生成素材。若安装alpha.18复验，优先检查闭画布调用、成果导航、插件关闭/重新加载的通信恢复；沿用当前人工验收文档。
