> 冻结历史记录：保留旧 Shell 在记录日期的结论和验收状态，不代表当前实现或线上状态。现行说明见 [Insight 文档入口](../../README.zh.md)。

# 技能展示与来源

专家技能由 Shell 的 insight-desktop-integration 提供。搜索框下分为“平台预置”和“用户自定义”，每次打开默认平台；选择仍向原生草稿写入 `/name`。

## 产品交付

目录包包含 SKILL.md、ui.json、脚本和相对资源。产品继续提供：

```json
{"displayName":"达人推荐","shortDescription":"发现并筛选合适达人，规划预算内的投放组合。"}
```

- UTF-8 JSON 对象，最大 8 KiB；标题最多 60 个 Unicode 码点，简介最多 160 个，均为非空单行纯文本。
- 平台包必须含合法的两个字段；非法配置、重复原生 name 阻止构建。
- 用户 sidecar 可选、逐字段回退到原生 name/description；坏 JSON、超长、缺失和读取失败不影响合法技能使用。
- 平铺 Markdown 不读取根 ui.json；符号链接也按原发现入口区分平铺文件与目录包。
- 展示配置不覆盖原生身份、模型说明、正文、来源或调用策略。搜索匹配展示字段与原生 name/description。

## 构建索引

scripts/generate-skill-presentations.mjs 遍历实际 bundled-skills，生成被 Git 忽略的 build/skill-presentations.json。测试、integration 类型检查及构建前生成，新增合法包不改代码名单。

索引分开记录 name 与 entryPath，支持目录 ppt-maker-new 声明 ppt-maker-new-new。它不是执行注册表，不为磁盘缺失包提供可调用项。当前为 15 个平台技能，media-generator 显示“多媒体创作”。现有打包规则完整携带正文、脚本、资源和 ui.json。

随包技能同步自 Codeup insight-desktop-skills 的 master 提交 43ef92827a05ae9e7de0852a044f3d76a543d32e（2026-10-27），新增“画布工作流智能构建”并更新“线下活动查询”简介，PPT 包版本保持 5.5.8-rc17。保留 Shell 已上线的 media-generator 交付说明修正：远端 URL 不等于本地落盘，接受 URL 的下游可直接交接。

画布构建技能的 model-matrix.md 仅规范化末尾空行以通过仓库格式检查，其余内容保持上游快照。

达人背调包另有本地兼容修正：预算台账锁按系统使用 POSIX flock 或 Windows msvcrt，取消启动时对 fcntl 的硬依赖。保持同一台账、原预算规则及请求链路；锁只负责本机进程互斥，详见该包的采集器使用说明。

## 来源与可用性

用户页签仅枚举两个全局来源：

1. agentsHome/skills：integration 显式配置优先，其次 DSH_AGENTS_HOME，默认 ~/.agents。
2. 当前账号实际 DSH_HOME/skills，排除 .system；不猜测 ~/.dsh。

项目级、其他插件及 Codex/Claude 专属目录不进入用户页签。合法全局链接保留原发现来源。

列表项仅显示标题与描述，不显示来源和可用性文案。只有 Core 当前 scope 实际胜出的 filesystem 定义且允许用户调用的项可选，其余保留点击限制，标题统一使用正文前景色，描述保留禁用效果。用户同名合并一行，优先实际可调用项；平台被覆盖时保留禁用项。页签按文字宽度左对齐，底部分隔线铺满内容区域；深色模式下输入框聚焦、页签激活与已选项采用白色，浅色模式沿用前景色保持可读。

弹层最小高度沿用现有 360px 上限，窗口空间不足时按触发按钮上方或下方的可用高度收缩；切换页签、搜索结果为空或技能数量较少时保持相同高度，长列表在内部滚动。

## 实现与刷新

- skill-inventory-service.ts 使用公开 FileSystemSkillProvider 只读枚举，不注册执行 provider。
- 公开 sessionQuery、workingDirectory、agent/preset scope、skills.snapshot 提供当前工作目录下的真实胜出结果，比较路径、source 与 provider。
- Shell desktopSkills.list({sessionId}) Remote 只返回展示字段、来源、可用性；不传文件路径，不接收任意路径。
- 打开、原生 skills/change、窗口 focus 时刷新；面板可见期间每 2 秒读取。合并请求，丢弃旧会话响应。
- 每次重新枚举并有界读取 sidecar；ui.json 单独更新也生效。执行目录沿用原生 watcher，不采信 Agent 的“安装成功”文字。
- 不完整观测保留旧项但禁用。已知入口变无效时保留说明；删除至少两次确认且间隔 500ms。首次无效包不会作为合法项展示。
- 不支持动态 Remote 挂载的旧 API 保留平台降级，用户页签提示不支持；当前配套 Host 服务缺失时报告不可用，读取失败不显示为未安装。

Core 源码、Runtime lock、其他插件与服务端不改。本机 dev 缓存须匹配仓库已有锁文件。

数量来自草稿，跨页签只计可用项。刷新不删除草稿，菜单选中的项失效时提示。Core 执行时按 name 读取当前定义，缺失或禁止调用时跳过注入继续消息。本期不锁定包版本，不保证第三方业务脚本依赖完整。

手动步骤与证据见 [验收文档](acceptance/insight-skill-picker.md)。
