> 冻结历史记录：保留旧 Shell 在记录日期的结论和验收状态，不代表当前实现或线上状态。现行说明见 [Insight 文档入口](../../../README.zh.md)。

# 专家技能双页签验收

2026-10-26。本轮仅改 Shell；Core 源码、Runtime lock 未改。本文替代历史单页签与本地 Core Runtime 验收步骤。

## 启动本地 dev

```sh
cd /Users/boxser.shi/Documents/harness/insight-desktop-shell
export PATH=/Users/boxser.shi/.nvm/versions/node/v22.21.1/bin:$PATH
npm run dev
```

标准 dev 准备已有锁定 Runtime、构建 integration、刷新 bundled profile 并启动。锁定 Core 为 0.2.1-rc.2，commit 90e7d68e5472883e54affe254eebc2bc0a97f7bc；无需构建 Core，不用历史 dev:local Runtime。

integration 客户端从账号 profile 副本加载；源文件更新不等于该副本更新。若 dev 正在运行，修改 integration 后关闭本次 dev，再重新 npm run dev，不只刷新网页。

## 平台与基础交互

1. 登录并打开工作区新会话，点击“专家技能”。每次打开默认“平台预置”，当前 12 项。
2. 核对中文标题/简介、PPT 制作、多媒体创作；PPT 真实 ID 为 ppt-maker-new-new。
3. 搜索中文标题、原生 ID、简介片段，只过滤当前来源。切换保留关键词，重开默认平台并清空关键词。
4. 连续选择两个平台技能，面板不关闭，草稿包含两个 /name；重复点只取消对应项。手动删 token 后勾选同步。
5. 核对 hover、选中、禁用、focus；页签方向键/Home/End、搜索上下/Enter、Esc。中文 IME 不受影响。
6. 缩小窗口后列表可滚动，底部仍可操作；轮询不抢搜索或页签焦点。

## 用户全局根与动态更新

共享根默认 ~/.agents/skills；遵守 integration agentsHome 配置及 DSH_AGENTS_HOME。账号根使用本次运行日志中的实际 DSH_HOME/skills。macOS dev 通常为：

```text
~/Library/Application Support/insight-desktop-dev/insight/accounts/<账号标识>/harness/skills
```

使用独立验收名称，完成后只清理自己创建的包。

1. 共享根新增 acceptance-shared/SKILL.md（示例见下）；保持“用户自定义”打开，下次约 2 秒轮询后出现，来源“共享技能”。
2. 无 ui.json 时显示原生字段；增加合法 sidecar 后显示中文。单独改 sidecar 无需重启；坏 JSON 回退原文，不禁用合法技能。
3. 账号根新增 acceptance-account；两个用户根均能发现，列表只展示标题和描述，不展示来源或覆盖文案。首次创建不存在的 skills 根也能发现。
4. 标准模式下选择共享、账号及平台各一项，草稿按原生 name 写入，跨页签数量正确。
5. 已显示的 SKILL.md 改为无效内容：保留禁用说明；恢复合法内容后重新可选。首次无效包不作为合法项出现。
6. 删除验收包，稳定确认后从列表移除；已有草稿 token 不被本列表删除，菜单选中项失效时提示且不计有效数量。
7. 通过 Agent 对话分别安装到共享和当前账号根，无需重启发现。安装到项目目录不进入用户全局页签。
8. 真实调用须核对会话中的 skill-invocation 正文及相对资源读取；不以列表出现或模型自述证明业务脚本成功。

SKILL.md 示例（账号包同步改 name）：

```markdown
---
name: acceptance-shared
description: Temporary shared skill for desktop acceptance.
---
When invoked, state that desktop acceptance instructions were loaded.
```

可选 ui.json：

```json
{"displayName":"共享验收技能","shortDescription":"验证本地技能入口与动态刷新。"}
```

## 覆盖、异常与隔离

- 用户两个根同名合并一行，按 Core 真正胜出项判断可用性。用户覆盖平台时平台项禁用，用户胜出项可选。
- 项目/插件同名胜出时全局候选不得误标可调用。user-invocable: false 可见但不能选择。
- minimal 模式不挂载全局根时仍展示安装项但不可选；标准模式恢复真实可用性。条目不增加状态文案。
- 权限/扫描失败保留禁用数据并提示未确认，不误报卸载或首次空目录；恢复读取后刷新。
- 目录链接和平铺 .md 链接按原入口处理；删除链接而目标仍存不得残留。平铺文件不读根 ui.json，同入口改 name 旧行移除。
- 切换账号不显示旧账号专有项；共享项按新会话 scope 判定。快速切换会话，旧响应不覆盖当前列表。
- 刷新不改附件、引用、撤销、IME、发送。失效 token 原生行为为跳过注入继续消息；本期不锁定技能版本。

## 自动验证与本轮证据

```sh
npm run typecheck
npm run build:desktop-integration
npm run prepare:bundled-profile
npm exec electron-vite -- build
npm test -- --exclude '**/.local-archives/**'
```

.local-archives 为本地历史备份，排除复制的测试源，不为其安装无关依赖。

- 全量 Shell：139 个测试文件通过，1051 项通过、2 项跳过。
- 锁定 Runtime 真实 Gateway：公开 Remote 注册/校验、两个用户根、未知 provider、preset 回退、原生 watcher 安装发现与 registry.get 正文读取、sidecar 更新、稳定删除、符号链接和平铺重命名。
- 生产菜单组件浏览器：默认页签、跨页签选择、禁用防护、范围搜索、键盘、Esc/重开、400×430 视口；无页面异常。
- 完整 Shell 隔离客户端：两个全局来源、平台/用户多选、原生草稿、安装、sidecar 更新、部分写入/恢复、删除保留草稿和重开默认通过。临时账号认证，不发送模型请求。

完整 Shell 夹具（先完成上方构建）：

```sh
INSIGHT_SMOKE_ROOT="$PWD" \
INSIGHT_SMOKE_OUTPUT="$(mktemp -d /tmp/insight-skill-tabs.XXXXXX)" \
INSIGHT_SMOKE_SKILL_TABS=1 \
node_modules/.bin/electron test/fixtures/candidate-desktop-smoke.cjs
```

JSON 页面状态是断言证据；隐藏 WebContentsView 缺截图表面时记录 capture-error，截图能力不作为技能功能成败。

本轮最终通过记录：/tmp/insight-skill-tabs-desktop-20261026-final/skill-tabs-passed，另覆盖用户页签范围搜索。该临时目录不随项目分发。

## 待外部验收

真实 Agent 对话安装/调用和业务脚本依赖、Windows/macOS Intel、隔离安装包、权限受限环境及跨账号手动操作尚未完整验收。不得以本机逻辑/DOM 通过宣称全业务或全平台通过。

## 已有账号升级回归：工作区与会话看似丢失

2026-10-26 的实际账号复现：旧 Canvas 0.3.0-alpha.23 带入 hoisted 的 dsh-storage-domain@0.2.1-alpha.1。Runtime 已为 0.2.1-rc.2；旧插件被拒绝后，其 Core 依赖仍抢占存储组件，导致 workspace/session controller pending。表现为列表空、workspace/create 报 service-unavailable；磁盘数据没有被删除。

Shell 在服务停止、依赖修复完成后检查所有声明依赖的所有权，沿用 Runtime 公开兼容性判定及既有豁免。只有被拒绝 bundle 独占、与安装内 Core 冲突的副本才移入 profile/.insight-runtime-conflicts/<批次>/，保留恢复记录；显式 Core 依赖、仍被活跃插件使用或图不完整时不移动。不升级旧插件、不授予豁免，不修改会话与工作区数据。

回归证据：

- 原账号副本在修复前复现原报错；修复后原工作区与 5 个 session ID 恢复，workspace/create 复用原工作区，created=false。
- 实际账号历史目录已备份；应用修复后 50 个数据文件 SHA-256 均与备份一致。
- 实际 dev 重启后核对界面：harness 工作区和原 5 条会话均显示，原会话正文可打开。未重新创建工作区。
- 新增 profile-runtime-repair.test.ts 验证保留数据/插件、活跃依赖保护、既有豁免、显式依赖与缺失依赖保护及重复运行。
- 修复后全量回归：140 个文件、1055 项通过，2 项跳过；类型检查与构建通过。
- 完整 Shell 夹具可设置 INSIGHT_SMOKE_RECOVER_ACCOUNT_FROM=<脱敏或本机私有的 DSH_HOME 副本> 复验。该模式只向隔离 app-data 复制资料，使用测试认证，不发送模型请求。输出保留在指定临时目录，不应提交真实会话内容。

检查时使用原账号登录；不需要重新创建工作区。旧 Canvas 仍按原生版本检查保持不可用，若要使用它需单独安装兼容版本，不用 allow-version 绕过。
