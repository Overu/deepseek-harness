> 冻结历史记录：保留旧 Shell 在记录日期的结论和验收状态，不代表当前实现或线上状态。现行说明见 [Insight 文档入口](../../../../../README.zh.md)。

# 画布成果入口：减少 Core 改动的方案修订

状态：基于当前源码的设计建议，尚未编码或验证真实 UI/持久恢复。用户新增约束：Core 经常合并 upstream，未来可能采用官方完整客户端架构；应降低长期维护与迁移成本。本文修订上一份文件菜单分析中的推荐路径，保留素材来源绑定和节点定位目标。

## 最终建议

采用**插件持有来源记录、插件贡献对话成果区、插件执行画布导航**的方案。当前阶段不改 Core 通用文件卡片、present 数据格式和系统打开应用菜单，也不向 Shell 主进程加入画布业务。

交互顺序调整为：可信来源绑定 → 对话内显式画布成果入口 → 节点定位。菜单补充成为将来官方提供合适扩展点之后的可选增强，不作为本方案完成条件。

此方案完整满足“从画布产生的素材回到来源画布/节点”，但入口位于插件自己的成果区，**不会出现在现有通用本地文件卡片的菜单中**。若必须把按钮放入每张现有文件卡片或原菜单，则当前 Core 的相关上下文/扩展点仍需调整，不能同时承诺现有入口位置和零 Core 改动。

## 推荐交互

在产生画布素材的对话结果区域，插件贡献一个小型成果区，例如：

```text
画布成果 · 耳机营销素材                       [打开画布]
场景 1 · 已生成图片                          [定位节点]
场景 2 · 已生成图片                          [定位节点]
```

上述标题是 UI 示例，不代表已读取真实节点名。实际标题、节点、产物必须来自可信画布记录。是否展示缩略图取决于现有素材预览服务的可复用性；不另建图片/视频播放器，也不为增加入口强制下载文件。

同一画布的本轮成果聚合；多个画布分组；节点多产物保留本次产物引用。普通非画布图片/视频继续使用当前成果卡片，不出现画布入口。仅创建画布可显示其资源入口，但不能称为已生成素材。

现有本地文件卡片继续供预览、系统打开和显示文件位置。如果 Agent 自行下载/改名/加工后用 present 交付文件，不能仅凭文件名或路径猜测其画布身份。本阶段的来源对象是插件已确认的**画布产物**；通用本地文件的逐一身份绑定属于另一项要求，必须经插件可信导出/交付步骤才能提供。

## 已核对的可复用接口

- Core `conversation.chat.turnTail` 已为 `list`、`scope: session`，可以添加新的贡献而不覆盖通用成果区；owner 提供 `turn`、`seq`。现有 ui-deliverables 就通过它挂载。
- Core `uiConversation.events.register` 可解释既有调用事件，建立原始调用与 Turn 的归属；插件可以使用已有 `tool/call`、PTC 根调用标识等已知事件，不新增持久事件种类。
- Core `ctx.storageDomain.open`／`ctx.storage.domain.open` 可打开插件自定义 Domain；表的 `put` 在持久写入成功后返回，`close` 等待已入队写入收口。base composition 已包含 storage-domain 和 JSON backend；实际客户端仍需做依赖/部署检查。
- 插件 `src/host/canvas-run-tools.ts` 已取得原生 `CanvasRunState`：canvasId、nodeId、requestId、workflowTaskId/nodeTaskId、outputs、version。来源应在这里建立，不依赖 Agent 的总结文案或后续下载行为。
- 插件 `src/client/index.tsx` 已调用 `ctx.sidebarRight.openResource(canvasAddress(id))`；Core 已支持导航 params。复用同一个 canonical address，通过 params 携带 nodeId。
- 插件 `CanvasTab.tsx` 与原生 ReactFlowProvider 可以接入只读视图定位。节点定位不调用保存或生成，不改变历史节点的当前主图。

本地 upstream/master 基线为 `5badb15009`，2026-10-03；当前 Core 与该基线的 turnTail 声明、SidebarRight service、uiConversation Client export 文件无差异。这说明当前可利用的入口来自已有 upstream 架构；**不代表已验证未来官方最新版本或承诺 API 长期稳定**。

## 来源记录与执行链路

1. Host 在接受一次 canvas_run 时记录真实拥有者、会话、原始 Turn/根调用、目标画布/节点和运行请求身份。桥的路由会话标识不能未经核对直接等同于 UI 会话或用户账号。
2. Host 收到可信原生状态时保存来源记录。已确认的新 outputs 可以登记为本次产物；submitted/unknown 不能升级成“生成成功”，节点旧图不能补为本次结果。
3. 插件私有 Domain 保存版本化数据，记录至少包含拥有者/会话、原始调用/Turn、canvasId、nodeId、requestId、可用的原生 task IDs 和逐项产物引用。ordinal/outputIndex 仅为顺序，不单独充当产物身份；可取得原生 assetId 时优先保留。
4. Client 从插件受保护的来源查询/更新通道取得记录，turnTail 只负责挂载和展示。初次进入/重连读取快照；后续变更推送沿现有连接机制或插件 SSE 接入，不靠持续轮询，不从 DOM 反推卡片。
5. 点击打开按钮复用现有 Sidebar API；点击定位把 nodeId 放入 navigation.params，由插件视图等 ready/测量完成后聚焦原节点。

来源记录是导航与归属数据，不是第二份画布数据库、另一套生成调度或通用文件索引。画布状态仍以原生服务为准。产物 URL 可能过期，导航依赖画布/节点身份；获取预览时复用授权读取能力，不把临时 URL 当永久身份。

不需要为导航额外新增 Agent 生成工具；现有 canvas_run 的可信执行点已经知道来源。仅当未来要求“导出的每个本地文件也携带准确来源”时，才规划插件导出入口及文件身份登记，不把它提前引入本阶段。

## 必须避开的实现问题

- **外部会话事件恢复问题**：当前持久恢复会拒绝不在 Core `KNOWN_SESSION_EVENT_TYPES` 且未标 ignorable 的事件；普通 Session.append 没有对应 ignorable 写入参数。仅声明合并自定义事件再 append 不能保证历史恢复。本方案不写新的 SessionEventType，不修改生成目录或 Session 格式。
- **Jobs 不能充当来源数据库**：Jobs 为运行时服务，result 首次读取交付、工具输出还可能截断；Agent 未读 job_output 不应导致来源丢失。直接从可信 run.state 写私有来源记录。
- **异步完成不能归到错误轮次**：结果完成时对话可能已开始下一轮，保存原始调用归属，更新原始成果区。PTC/inspection 嵌套调用按真实 rootCallId 与拥有者归属处理，不能只匹配最外层工具名。
- **持久失败不能触发再生成**：素材已生成与来源登记成功是两个事实。来源写入失败只影响入口，报告记录不可用；不能改成业务生成失败或自动重新提交模型。
- **历史与会话隔离**：重启和原对话历史应恢复；不能用 sessionId 全量展示已被截断、不属于此历史的调用记录。fork/复制对话需要明确 lineage 与授权规则，首期可限定原始对话历史，不自动复制来源。
- **视图定位保持只读**：相同画布复用 Tab，重复点击仍定位；节点删除则打开原画布并提示，不能新建替代节点；重跑不能把历史素材静默切换成新主图。
- **插件卸载与数据处理**：入口随插件卸载消失，通用文件仍可打开；来源数据版本化，迁移保留/导出路径需要随部署定义。不能以“插件零 Core patch”推导“无需迁移数据”。

## 改动范围与结构

以下是建议职责拆分，尚未创建代码文件。

| 归属／文件 | 本阶段职责 |
|---|---|
| Plugin 新 `src/shared/canvas-result-source.ts` | 插件自有来源字段、版本及读取校验；无 Core PresentedFile 扩展 |
| Plugin 新 `src/host/canvas-result-store.ts` | 使用官方 Domain 持久化来源记录与原始调用归属，生命周期内聚 |
| Plugin 新 `src/host/canvas-result-route.ts` | 受保护的会话来源查询/变更接入；授权与会话可见调用校验 |
| Plugin `src/host/canvas-run-tools.ts`、`src/host/index.ts` | 从已有可信状态登记，装配存储/接口；不改原生生成与保存顺序 |
| Plugin 新 `src/client/CanvasResults.tsx`、`src/client/canvas-results.ts` | 独立成果区、来源加载/订阅、原始 Turn 归属；不扫描或改写 Core 文件卡片 DOM |
| Plugin `src/client/index.tsx` | 注册已有 turnTail 扩展点及必要 Client 服务依赖 |
| Plugin `src/client/CanvasTab.tsx`、新 `src/shared/canvas-view-navigation.ts` | 接收导航 params、视图消息；保持 canonical URI |
| Plugin 新 `canvas-app/src/canvas-view-navigation.tsx`、`canvas-app/src/desktop-canvas.tsx` | 等视图 ready 后复用原生 fitView，只调整视口和临时高亮 |
| Plugin `package.json`／lock／patch、相关测试 | 精确声明官方 storage/UI 类型等依赖，按现有构建发布方式同步 |
| Core | 本阶段零业务源码/持久类型/菜单修改；使用已存在官方接口 |
| Shell | 安装/部署新版插件与必要已有服务；不新增画布 IPC 或聊天 UI 判断 |

不为迁移先建完整“通用平台适配层”。把现有官方 SDK 的存储调用、成果挂载、打开导航集中在上述小模块中即可；未来接口确实改变时再替换对应模块，保留来源格式和原生业务。

## 与其他方案比较

| 方案 | 优点 | 长期代价／限制 |
|---|---|---|
| 插件成果区＋私有来源＋节点定位（推荐） | 当前可做到 Core 零 patch；交互显式、历史可恢复、仅展示真实画布关联 | 按钮位于插件成果区；官方 SDK 变化仍需适配，来源数据需迁移 |
| Core 最小通用文件上下文扩展 | 按钮可进入现有文件卡片；画布逻辑仍归插件 | 涉及通用 Slot/交付来源与兼容；适合以后以通用资源扩展向 upstream 贡献，当前没有完整扩展点 |
| 前一版来源＋文件卡片＋菜单全面改造 | 与截图菜单位置完全一致 | 分散在多个 Core 交付/UI 包，合并与发布耦合较多；当前不推荐 |

若后续官方增加文件上下文动作扩展，复用插件来源记录与 opener 注册进去即可；不要提前 fork 系统菜单，也不复制 Core 的整套文件 UI。

## 建议实施顺序与验收条件

1. **来源先收口**：插件直接在可信执行点记录；非画布素材零记录；一张节点旧图不会成为本次产物。重启后原对话记录还在；不新增未知 Session 事件。
2. **显式成果区**：未打开画布也能看到正确来源入口；同画布归组，多画布不串。嵌套调用、异步跨轮结果与原始 Turn 对齐；普通文件 UI 保持原行为。
3. **节点定位**：新开/已开同一画布都能聚焦，组内节点与重复点击正确；生成/保存请求为零；删除节点有准确提示。
4. **依赖与迁移检查**：在当前实际 Core runtime 构建、装载并恢复历史；针对准备升级的 upstream runtime 复做兼容 smoke。数据格式与 SDK 适配分开验收，不声称未来无成本迁移。

菜单集成不进入本阶段验收，后端保持不改。本稿只更新技术选择与目标边界；未安装插件、触发素材生成或修改业务代码。
