---
description: "从侧边栏打开 Insight 技能中心。"
kind: "package-bundle"
---

# @insight-ai/skill-center

[English](README.md) | 中文

## 概述

点击 Insight 侧边栏中**插件**下面的**技能中心**，浏览并管理 OSS 中已发布的平台技能。可以按名称、ID 或简介搜索、查看技能详情，并为当前登录账号安装、更新或移除技能。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用此包

点击**技能中心**，在主内容区域浏览技能卡片。打开页面时会读取 [OSS 目录](https://insight-desktop-updates.oss-cn-guangzhou.aliyuncs.com/desktop/skills/skills.json)。输入搜索词或提交搜索表单可筛选已读取的目录。读取失败时显示**重试**；已发布目录为空时显示独立空状态。**查看详情**展示完整描述。每张卡片会根据当前账号的已安装版本显示**安装**、**已安装**或**更新**。已安装技能的详情还提供**移除**。安装和更新期间会显示带有**取消**操作的阻塞进度对话框。提交前取消或失败时，首次安装不留下内容，已安装版本保持不变；提交完成后即使取消请求稍后到达，仍报告成功。点击**插件**或会话可离开该页面。此包提供中文和英文文案；其他语言使用语言注册表的回退机制。

目录请求默认在 15 秒后超时，包含 JSON 正文读取。可在 `cordis.yml` 的插件配置中通过 `catalogRequestTimeoutMs` 修改这一正数毫秒预算；页面重新加载后生效。

Host 还会分别限制单个技能归档的请求时长、压缩字节数、归档条目数、解压字节数和可下载来源。配置方式见 [config.ts](src/config.ts) 中的 `packageRequestTimeoutMs`、`packageMaxDownloadBytes`、`packageMaxEntries`、`packageMaxExtractedBytes` 和 `packageAllowedOrigins`。

移除技能会删除安装记录及该技能专属的内容目录，包括遗留版本。启动时也会清理废弃版本和空技能目录。账号共享存储目录会保留，供其他安装使用。清理失败会记录日志，并在下次启动时重试。

本包也负责输入框中的**专家技能**选择器。列表为空时，滚动区域内会显示“去技能中心”按钮，点击后关闭选择器并打开技能中心。它将平台安装与用户技能分组展示；旧版共享技能会以只读条目保留在用户技能中，不会归属到当前账号，也不会被技能中心修改。

通过 `presetSkillIds` 配置以字符串表示的 OSS `id`，可在账号界面就绪后安装默认技能。Insight 包在 [cordis.patch.yml](cordis.patch.yml) 中选择了 ID `1` 到 `15`；没有 OSS ID 的条目使用技术名作为选择项。自动和手动安装共用可取消的阻塞进度浮层。自动安装失败或取消会停止本次启动的队列，下次启动仍可重试；不会自动升级已有安装。成功安装和主动移除会记入 `$DSH_HOME/platform-skills/auto-install-history`，因此已移除的预设不会再次自动安装。从配置移除选择项不会卸载对应技能。

通过 `legacySkillDirs` 配置仍然存在的旧目录，Desktop 会自动提供原 `bundled-skills` 位置。同名调用优先使用账号安装的版本。旧文件仍为共享内容，应用更新依然可能移除它们；用户自行维护的技能应复制到 `$DSH_HOME/skills`，纳入账号存储。

技能匹配优先比较 OSS `id`，数字 `1` 和字符串 `"1"` 代表同一个技能。任一方缺少 ID 时，才使用精确且唯一的技术名匹配。技术名取自目录的 `skill_id`，并且必须与归档中的 `SKILL.md.name` 一致；展示字段 `name` 不参与匹配。不同的非空 ID 不会按名称合并，身份冲突时不能自动安装或更新另一项安装。

安装记录分别保存账号本地的 `key`、可选的目录 `id` 和必填的技术名 `skillName`。移除历史保留相同的身份字段，防止已移除的预设再次自动安装。仅按技术名安装的技能在目录补充 ID 后更新时，会保留本地键并记录 ID。此首发格式不读取此前开发阶段的记录格式。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

专家目录作为 Cordis 子插件运行，声明会话查询和工作目录依赖；其 Remote 方法与安装器读取同一个账号平台技能服务。

[包补丁](cordis.patch.yml)挂载 Host 配置和浏览器插件。[浏览器入口](src/client/index.ts)向现有侧边栏面板列表、带键主面板和专家技能输入选择器注册内容，并等待各插槽声明。侧边栏负责选中状态和折叠导航。插件注册可取消的 Client 资源提供方来读取 OSS 目录，校验 JSON，仅保留已启用且有技能 ID 的记录，并按 `sort` 排序。Host 记录每个账号已提交的平台技能版本，并在技能发现目录外准备下载内容；仅当全部文件及安装记录均已准备完成后才发布技能，更新会在替换版本提交前保留此前的已提交版本。页面通过已注册的 Client 服务读取目录与安装状态，搜索和选中状态由组件持有，并在取消操作完成后才关闭进度。输入框、按钮、弹窗行为和反馈使用 DSH 基础组件；语义主题变量跟随应用外观，包括通过 portal 渲染到 body 的浮层。Shell 浮层独立于页面承载临时反馈。卸载插件会释放注册和字典。布局根据主面板宽度适配，并避让 macOS 标题栏。

</details>

<a id="model-experience"></a>
## 模型体验

### 技能中心页面

#### 模型看到什么

`@insight-ai/skill-center` 包显示并管理已发布的技能目录；浏览和安装不增加工具、模型请求或 Session 事件。安装后的技能会加入普通技能发现，并可在用户选择后加载到后续模型请求中。

#### Token 影响

打开页面不会增加模型输入 token。

#### KV Cache 影响

打开页面不会改变模型请求或缓存前缀。

## 已知限制与待办

<a id="known-limitations-and-deferred-work"></a>

- 目录读取依赖网络及 OSS 对应用来源的 CORS 授权。技能名称和描述使用目录中的语言；切换应用语言只翻译控件。目录不可用时，之前安装的技能仍可按 ID 移除。
- 目录只提供技能标识和可用版本，不提供跨设备安装同步。每个账号的安装仅保留在当前设备。
- 安装记录在正常运行中以原子替换方式写入；共享原子写入器不执行 fsync，因此断电时不保证替换已持久化。下次启动会清理被中断的暂存内容。已安装元数据损坏会明确失败，需要手动修复。
- 此私有包随 Insight Desktop 分发；标准 DSH Web 配置不启用它。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护工作上下文——点击展开</summary>

没有额外的维护约束。

</details>
