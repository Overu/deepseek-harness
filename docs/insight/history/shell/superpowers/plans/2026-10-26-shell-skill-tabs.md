> 冻结历史记录：保留旧 Shell 在记录日期的结论和验收状态，不代表当前实现或线上状态。现行说明见 [Insight 文档入口](../../../../README.zh.md)。

# Shell Expert Skill Tabs Implementation Plan

**Goal:** 以 Shell 公开 Host 扩展支持平台/用户双页签、包内展示信息和全局技能动态发现。 **Architecture:** 复用公开 FileSystemSkillProvider 只读枚举；从 Core 当前 scope snapshot 读取真实胜出者。Shell 专用 Remote 传递无路径的产品投影。UI 打开时刷新并在可见期间轮询，原生 skills/change 继续触发刷新。 **Tech Stack:** TypeScript、React、Cordis/Typert public API、Vitest、现有 Node Runtime。

## Global Constraints

Core 源码、Core Runtime lock、其他插件和服务端均不修改。不注册额外执行 provider。产品 ui.json 必须校验，用户 ui.json 可选。共享 agentsHome/skills 与当前 DSH_HOME/skills 是唯一用户来源。按原生 name 调用当前定义，不实现包版本锁定。

## Task 1：公开 API 接通与安装投影

- [x] 增加 `skill-inventory-contract.ts`，定义窄 list(sessionId) Remote、有限输入和纯数据结果校验。
- [x] 增加 `skill-inventory.ts`，依赖注入读取器，先测试两个用户根、同名胜出、userInvocable=false、sidecar失败、读取失败保留、符号链接。
- [x] 增加 `skill-inventory-service.ts`，只实例化公开文件provider，不注册执行服务；使用公开 sessionQuery/preset/snapshot 观测真实生效目录。
- [x] 使用现有 Typert 显式 descriptor 注册和客户端 $mount 连接。真实 Gateway 夹具验证，不能只mock服务名。

## Task 2：构建索引

- [x] 新增 `scripts/generate-skill-presentations.mjs`，实际解析 name 与 entryPath，校验合法 JSON/文案与重复ID。
- [x] 在类型检查、测试与集成构建前生成；替换手工 bundled 映射，旧展示回退仍兼容。
- [x] 测试新增非枚举技能、PPT目录差异、非法元数据和干净目录生成。

## Task 3：双页签与刷新

- [x] 改造 skill-catalog 适配 Shell Remote，保留旧Runtime平台降级，用户能力不支持时显示错误。
- [x] SkillPicker 增加默认平台tab、用户tab、分组搜索、跨tab有效计数、禁用/来源/读取状态。
- [x] 打开时读取，打开期间定时读取，监听原生事件与窗口focus。刷新不能命中旧Core客户端Promise；晚到结果丢弃，不抢输入焦点。
- [x] 完成类型检查、针对性回归和集成构建，刷新 bundled profile。

## Task 4：运行验收

- [x] 真实Host/Gateway验证两个根枚举、原生watch后胜出快照更新和资源读取。
- [x] 完整 Shell 隔离验证双tab、全局根、原生草稿及安装/更新/删除；生产菜单组件验证搜索/keyboard。真实 Agent/模型业务调用仍待外部验收。
- [x] 更新设计/审查文档，明确Shell-only最终方案与仍未覆盖的平台验收。
