> 冻结历史记录：保留旧 Shell 在记录日期的结论和验收状态，不代表当前实现或线上状态。现行说明见 [Insight 文档入口](../../../README.zh.md)。

# 专家技能双页签审查记录

2026-10-26；Shell 分支 codex/skill-catalog-design-review，基线 f6c0ff6。

## 最终边界

此前将 Core 新接口视作前提的判断已撤回。公开 FileSystemSkillProvider、session/preset scope、skills.snapshot 与 Typert descriptor 足够支持本期。不改 Core 源码、Core lock、其他插件，不注册执行 provider。

## 已处理问题

| 问题 | 处理与验证 |
| --- | --- |
| 当前可调用列表遗漏隔离 preset 的安装项 | 独立安装观测与真实胜出结果匹配，未挂载项禁用 |
| 未知 provider 同路径误标可调用 | 比较路径、source、filesystem provider；Gateway 测试 |
| 显式 agentsHome 未遵守 | 配置透传优先于环境变量；不同根夹具 |
| 慢轮询请求结果饥饿 | session pending 合并；客户端合约测试 |
| 历史 preset 获取失败导致全不可读 | 原生全局 registry 回退；Gateway 夹具 |
| 部分写入/扫描失败误报卸载 | last-good 禁用、无效项保留、删除稳定确认 |
| 链接删除但目标存在导致残留 | 校验原发现 entryPath；Gateway 测试 |
| 同入口改 name 留旧行 | 按原入口替换旧身份；逻辑与 Gateway 测试 |
| 平铺链接到 SKILL.md 误读共享根 ui.json | 按 resourceBase 与原发现根区分；Gateway 回归 |
| 新包仍依赖手写名单/索引生成过晚 | 类型检查/测试/构建前生成；新增包和别名测试 |
| 独立组件可用但 Host 未注册 | 显式 Typert 双端 descriptor；Gateway 与完整 Shell 验收 |

最后一轮独立只读审查未发现新的 P1/P2，平铺链接修复已确认闭合。

## 2026-10-27 合并前生产代码复核

用户已完成手动验收。本轮只审查生产代码及配置，不将测试和文档作为审查对象。

- 技能列表改用 Core 公开 workingDirectory 服务：冷会话读取投影目录，活跃会话调用 ensure，避免切换目录后错误判断同名覆盖。
- 共享根使用公开 resolveAgentsHome，统一处理显式配置、环境变量、波浪线路径与空环境值。
- 启动依赖隔离将已安装 peerDependencies 纳入归属图，保护仍被活跃或获精确豁免插件使用的包。
- 隔离实现移入独立 profile-runtime-repair.ts，原 profile-repair.ts 不再有变更；主启动入口仅导入和调用，无 blocked bundle 时不遍历依赖图。
- 移除本轮新增但已不展示的来源/覆盖状态翻译键，保留用户验收的标题、描述和固定高度交互。

两次独立复核确认上述问题闭合，无剩余 P1/P2。11 个定向测试文件、79 项测试通过；Shell/integration 类型检查与生产构建通过。Core、Runtime lock、其他插件源码和服务端未改。

## 验证与剩余边界

全量测试、Shell/integration 类型检查、integration/bundled profile/electron-vite 构建通过。完整 Shell 隔离验收验证两个全局来源、原生草稿、多选、安装/更新/恢复/删除。见 [验收](../acceptance/insight-skill-picker.md)。

本机旧 dev Runtime 已备份并对齐原锁文件，未改锁或绕过插件版本检查。原生 watcher 在允许本机监听的环境测试。

按 name 调用当前定义，不固定包版本。列表成功不代表第三方脚本依赖完整。真实 Agent/模型业务、Windows/macOS Intel、隔离安装包与跨账号手动检查仍待验收；不授予三平台发布通过状态。
