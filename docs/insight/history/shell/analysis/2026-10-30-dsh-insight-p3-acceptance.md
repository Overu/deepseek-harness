> 冻结历史记录：保留旧 Shell 在记录日期的结论和验收状态，不代表当前实现或线上状态。现行说明见 [Insight 文档入口](../../../README.zh.md)。

# Insight P3 验收记录

> 历史阶段记录：下文的阶段状态、待授权描述和运行结果保留当次背景，不代表当前进度。当前状态见 [P5 收口](2026-10-30-dsh-insight-p5-delivery.md)，下一阶段见 [P6 交接](2026-11-02-dsh-insight-p6-handoff.md)。历史失败保留，不将未复验项记为通过。

日期：2026-10-30（Asia/Shanghai）。状态：首轮验收未通过，P3 继续收口，不进入 P4。对象为 insight 分支当前未提交工作区的 macOS arm64 原生开发客户端，产品版本 1.0.9-dev.0、DSH 运行时 0.2.2-alpha.2。生产旧客户端和旧账号 Home 不参与本轮操作。

## 自动化检查

本轮证据保存在 DSH 工作区 apps/desktop/.desktop-build/qualification/p3-20261030，避免继续只使用会被清理的临时日志。source-manifest.json 已在内置资源接线后刷新 1,291 个源码文件摘要，Remote 修复前的 1,285 个文件摘要另存 source-before-remote-fix.json。HEAD 仍为 P2 阶段提交；未提交源码需要与日志和产物一起评审。含本地连接凭据的原始启动日志不应直接分享。

| 项目 | 当前结果 | 证据 |
| --- | --- | --- |
| 当前产物构建 | 启动修复后 8/8 通过 | build-artifacts.log |
| 汇总类型检查 | 最新产物及回归测试调整后，Host/Client 两项通过 | build-check.log |
| 技能输入、Picker、品牌和库存 | 5 文件、27 项通过 | skills.log |
| Desktop 启动及权限 | 2 文件、153 项通过 | desktop.log |
| Canvas Host/Client 接入层 | 423 项通过 | canvas.log |
| 四组件真实 Host Loader | 1 项通过，只证明 Host 激活及 Client bundle 可读取 | real-loader.log |
| 新增 Remote 启动回归 | 2 项通过；暂时恢复原自依赖后 1 项失败、1 项通过，已恢复修复源码 | remote-regression.log、remote-negative.log |
| Remote 修复定向 lint | 两个变更文件通过；测试中不安全的 matcher 对象赋值已修正 | remote-lint.log |
| 包依赖准入 | 未通过：3 个 Host 导出尚未进入安全或 peer-required 分类 | remote-package-dependencies.log |
| Canvas 独立前端 | 本日重跑：38 文件，469 项通过、7 项失败 | canvas-iframe.log |
| 源码 whitespace | 排除三个源码补丁文本后通过 | diff-check-source.log |
| 完整 git diff --check | 未通过：三个 .patch 文本有 394 条尾空白诊断，392 个空上下文行及 2 个原文删除行 | diff-check.log |

## 原生验收

| 项目 | 当前结果 |
| --- | --- |
| Insight 登录页、品牌和短信表单 | 通过基本流程：原品牌和登录表单已显示，手机号与验证码可输入，获取验证码进入倒计时；不宣称完成全部分辨率下的视觉一致性验收 |
| 协议及登录 | 通过：沿用用户此前明确批准的相同协议选择，两次短信登录均进入工作区；未测试密码登录或代做图形验证码 |
| 首次工作区启动 | 首轮失败：Client 提示 desktop-integration 等待 remote.insightSkills；私有包修复后，两次登录均成功打开工作区 |
| 故障恢复 | 已关闭发生故障的验收实例，未点击禁用第三方组件或改动旧数据 |
| 账号与设置 | 通过：显示测试账号昵称、脱敏手机号、产品版本、测试环境与平台；设置从账号菜单进入，左下独立设置入口已移除 |
| 模型开箱即用 | 通过：不填写用户 API Key，托管模型返回 conversation OK；模型菜单可打开。多模型切换和各推理档位尚未逐项验收 |
| 模型配置隐藏 | 通用设置中没有模型凭据配置；仍存在官方 Session Log 上传设置和运行时版本展示，见下方残留项 |
| 四组件实装 | 通过：重登后，在设置→内置插件→全局插件看到 Integration、Canvas、Memory、Prompt 四个条目均已启用；Canvas 详情显示运行中。主要插件页过滤了 profile 直接提供的私有 bundle，不能以该页缺席判断未安装 |
| 必需组件保护 | 执行端保护由已有自动化测试覆盖；本轮未向真实账号发起停用、卸载、替换请求，不能将完整插件清单的只读详情等同于操作拒绝验收 |
| Memory 界面 | 通过基本加载：非空会话出现记忆、技能、待办与设置标签；项目日志与配置可读，未出现组件独立更新入口。未实际写记忆、采纳建议或推送 Git 同步 |
| Prompt 真实增强 | 通过：托管模型完成增强预览；原文在预览期间保留；回填替换草稿；撤销恢复原文。未发送增强后的业务提示词 |
| 技能菜单与多选 | 账号技能通过：隔离账号 Home 创建两个临时测试技能，搜索+回车可同时选择，草稿出现两个 /name；取消第一项保留第二项，均取消后选中计数归零。未调用这两个技能，测试目录已清理 |
| 内置技能目录接入 | 首轮失败后已补正并通过原生复测：平台预置显示 15 项，中文搜索、简介及两项多选/逐项取消正常；不涉及内置技能内容正确性判定 |
| Canvas 列表与打开 | 通过：真实会话仅调用 canvas_list(limit=3) 与 canvas_open；现有画布在 dsh-app://app/desktop-canvas/view 中加载，显示原有节点；未创建、编辑、删除、上传或触发生成 |
| Canvas 侧栏与引用 | 通过侧栏全屏→退出全屏及移除现有草稿节点引用；引用新增、与技能切换共存、复制读取和 iframe 原生权限路径仍待定向验收 |
| Desktop 菜单 | 已看到重启、查看日志、缩放、全屏入口；发现开发模式有两个相同重启条目。未逐项触发所有菜单命令 |
| 退出、重登与开发数据保留 | 通过：账号退出关闭实例并返回登录门；同一账号重新登录后，原测试会话及两轮内容仍可读；退出后测试会话日志仍存在且非空。不等同于 P4 旧历史迁移 |

## 已发现的启动阻断与修复

Integration Client 只通过 import type 引入生成 Remote 类型，却把 remote.insightSkills 设为自身的启动前置条件。没有其他 Client 挂载这个私有 namespace，因此 apply 永远无法执行。Host Loader 测试只检查 Client bundle 返回成功，旧品牌测试又预先伪造了 namespace，均无法发现真实浏览器启动缺口。

修复只涉及 Insight 私有包：运行时引入生成 contribution，启动依赖保留 slots 与 remote，在安装产品插槽前调用官方 ctx.remote.$mount。产品 UI 放在依赖 remote.insightSkills 的子 fiber 中，namespace 变化时重建；正常清理与失败回滚均先卸载 UI，再卸载 contribution。export type 保留声明合并，运行时依赖补齐生成 Remote 所用的 zod。新的组合回归使用真实 Typert Registry、Connection 和 Gateway，仅模拟线上的响应，不预先提供技能 namespace；从已注册 Picker 插槽实际调用 list，并验证 namespace、插槽的激活和卸载。

独立复核确认前述挂载顺序、依赖生命周期及 zod 声明问题已关闭，所检查的 Client 启动修复未发现新的实质缺陷；这不等于全部 P3 代码已经审查或验收通过。官方 DSH 源码、根 React 配置及根 lint 规则没有因此修改。

## 首轮发现及收口范围

### 随包技能接线缺失

现有私有库存从 DSH_BUNDLED_SKILL_DIR 读取内置分类，DSH 文件系统技能提供方也使用同一入口。首轮验收时原生 Desktop 没有提供该目录，因此即使根 bundled-skills 已存在，运行时也不会把它作为平台技能根。当前 electron-builder 配置仅复制 Insight 品牌资源，没有复制这套目录。临时账号技能能被菜单发现，说明库存 Remote 和多选编辑链路已经工作，不能用该结果掩盖内置资源缺口。

首轮提出的官方接入范围如下，后续已获授权并实施，结果见本文最后一节：

| 文件/区域 | 必要变化 |
| --- | --- |
| apps/desktop/src/main.ts | 仅 Insight 为 Host 固定设置 DSH_BUNDLED_SKILL_DIR；开发指向父仓根目录，安装包指向 resources/bundled-skills；普通官方产品行为不变 |
| apps/desktop/scripts/electron-builder-config.mjs | 仅 Insight 整目录复制根 bundled-skills 到同名资源目录，不重排、拆分、改写或校验技能正文 |
| 对应 Main/打包测试与基线修改记录 | 验证路径、整目录复制和官方产品不受影响；安装制品再次核对目录结构与库存可见性 |

同步来源、根目录结构与既有整目录同步方式保持不变。验收只检查资源交付、加载和选择，内置技能的正文、脚本及业务正确性不在本次范围。

### 产品残留与组件可见性

设置中的 Session Log 上传开关仍对应运行中的官方请求扩展；当前 Insight 禁用官方模型提供方、默认走 yinsai-gateway，没有证据表明这轮对话向官方接口发送了该字段。建议在 Insight 私有 composition 中隐藏这项无当前用途的设置，不能把“开关显示为开启”直接解释为已发生上传。

全局插件清单能证明四组件已装载，但名称显示为构建路径，主要插件页又不列出这类私有 profile bundle，用户不易确认组件状态。建议使用 Insight 自身的只读组件状态入口展示产品必需组件；若改官方插件页过滤规则，需另获授权。开发模式重复重启菜单、通用设置的 DSH 运行时版本以及官方网页搜索配置入口，也需一并核对并清理无效产品概念。

### 自动化未关闭项

依赖准入的三个导出分别为 resolveAgentsHome、FileSystemSkillProvider、DeepSeekSearchProvider。补充 peer/dev 声明不能替代安全分类。需要人工判断各导出能否重复加载、是否必须共享实例，或应改用既有服务；如修改官方依赖策略，需授权并记录轨迹。

Canvas 独立前端本日仍有 7 项失败：5 项遗漏 registerCanvasTools 的必需依赖对象，另 2 项从预期业务结果变为 rejected，相关 fixture 尚未跟上环境和 Session 接入。应修正 fixture 后验证它们到达真实创建、写入及未知结果分支，不能放宽断言或添加生产默认值来掩盖失败。独立前端额外 standalone TypeScript 的 19 项既有错误仍未关闭；本日未重跑该额外检查。

完整 git diff --check 的 394 条诊断均在三个固定源码 .patch 文本，本轮源码检查排除这些文本后通过。补丁上下文或删除行不能直接去掉原文空格，否则会破坏回放语义；应在补丁生成与检查规则中明确处理，并重新验证回放，而非宣称完整检查已通过。

## 保留的未通过与待确认事项

昨天提出的根 React/ReactDOM 测试依赖修正和 Canvas 独立前端 lint 所有权调整仍待用户确认，见 [检查收口设计](2026-10-29-dsh-insight-p3-check-closure-design.md)。本轮验收不据此改动这两项根配置，也不将 scope 外的 i18n 门禁标为通过。

Canvas 的创建、保存、重载、连线、布局、素材导入、OSS、音乐/参考音频及付费生成未在本轮真实账号上逐项执行。复制和权限矩阵的真实允许/拒绝路径、四组件破坏操作的界面拒绝以及完整 Memory 可选功能仍待验收；不能用构建、接入层 423 项或只读画布打开代替“插件全部功能正常”。

历史会话迁移和任意旧文件只读导出属于 P4，OSS/CDN、测试版更新与原地安装升级属于 P5；本轮不对这些能力作通过声明。不修改生产旧账号数据，也不因重登保留新会话而宣布原地升级的数据兼容性已完成。Insight 不新增 i18n 工作；已有范围外门禁如实登记。

下一次 P3 验收应先关闭随包技能接线与测试/依赖门禁，再覆盖尚未执行的功能矩阵。P3 通过后仍须用户确认才进入 P4。

## 用户反馈后的技能布局补正

用户指出绝对路径标题和技能弹层不符合原 Shell。调查结论、私有 UI 补正及待授权的最小官方扩展见 [插件名称与技能弹层补正](2026-10-30-dsh-insight-p3-display-corrections.md)。绝对路径来自运行时解析相对 bundle 入口，并非将开发机地址写入正式配置；显示名称和简介缺失不能直接推出安装包不可用。

技能弹层已在私有 Integration 中恢复“平台预置 / 用户自定义”两栏，后者合并账号与共享来源；紧凑触发器显示“专家技能”，列表呈现名称、短简介及选中标记，并独立滚动。UI 标签从已发现技能旁的 ui.json 读取，仅影响展示与搜索。保留 DSH 原生调用名称、同名覆盖规则和旧式 toggleSkill，不改 bundled-skills 内容。

| 补正检查 | 结果 | 证据 |
| --- | --- | --- |
| 技能 UI、库存和可选标签 | 3 文件、17 项通过；独立复核复跑同样通过 | skill-layout.log |
| 最新产物构建 | 8/8 通过 | skill-layout-build-artifacts.log |
| 最新产物后的汇总类型 | Host/Client 两项通过 | skill-layout-build-check.log |
| 七个变更 TS/TSX 文件 lint | 通过 | skill-layout-lint.log |
| 私有包 whitespace | 通过 | skill-layout-diff-check.log |
| 包说明文档对 | 已更新两种说明并刷新单个 pairing 记录；检查结果另见对应日志 | skill-layout-docs.log |
| macOS 原生深色、浅色弹层 | 两栏、360px 卡片、名称、短简介和勾选可读；原主题“跟随系统”已恢复 | 本轮原生界面操作 |
| 原生显示名与调用名 | 选择“布局验收专家甲/乙”后草稿写入 /p3-layout-a 与 /p3-layout-b；两项可同时保留并逐项取消 | 本轮原生界面操作 |
| 测试数据清理 | 两个隔离账号临时技能及其 ui.json 已删除，测试技能未执行；既有会话仍可读 | native-skill-layout-fixtures.json 仅记录测试目录 |

独立复核发现的 remembered 标签丢失、可选元数据特殊文件阻塞和截断简介可读性问题均已修正。元数据读取先拒绝非普通文件，采用不跟随符号链接和非阻塞打开，再核对文件种类与大小，读取上限 8 KiB 并检查取消；测试的 POSIX FIFO 子进程有 5 秒 watchdog，Windows 跳过该 POSIX 用例。上述校验只针对可选展示文件的读取方式，不是内置技能业务正确性检查。

当次技能布局验收已观察桌面分辨率下的浅色/深色基本展示，未覆盖 390px 视口、触控软键盘和全部边缘定位。当时内置栏为空；后续资源接线及授权状态见下节。插件名称方案现按用户要求暂缓，P3 状态保持未通过。

## 已授权的内置资源接线结果

用户随后明确：插件名称方案先保留、暂不修改；允许 Main 和 electron-builder 的内置技能最小接入。本次未修改 package-meta.ts 或插件名称解析。

Main 已仅为 Insight 固定传入 DSH_BUNDLED_SKILL_DIR：开发使用仓库根 bundled-skills，安装后使用 resources/bundled-skills；清除继承的大小写变体，官方产品继续保留用户自定义路径。Host 启动前对资源目录执行打开、枚举和关闭，缺失、同名普通文件或目录读取失败会阻止启动。账号在该异步步骤中失效时，取消启动并释放目录句柄。

Insight 的 extraResources 已增加根 bundled-skills 的独立整目录复制，同步配置声明中的资源类型；未改变目录结构、同步机制或技能内容。官方修改轨迹已更新到 DSH 的 docs/subsystems/insight-baseline-changes 中。

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| Main 与实际 builder 复制测试 | 两文件、161 项通过；Darwin/Windows 目标配置均在 macOS 上运行 | bundled-resources-tests.log |
| 实际同步目录复制 smoke | 322 个文件或链接的路径、摘要、可执行位一致，源目录未变化 | bundled-resource-copy.json |
| 最终产物 | 8/8 通过 | bundled-resources-build-artifacts.log |
| 产物后的汇总类型 | Host/Client 两项通过 | bundled-resources-build-check.log |
| 五个实现/声明/测试文件 lint | 通过，无诊断 | bundled-resources-lint.log |
| 对应源码 whitespace | 通过 | bundled-resources-diff-check.log |
| 三对受影响文档、六个文档链接 | 通过 | bundled-resources-docs-check.log、bundled-resources-doc-links.log |
| 独立复核 | 目录种类检查、句柄释放、账号失效竞态与 Insight 专属范围问题已关闭；末项测试类型 lint 已修正并由定向 lint 复核 | 本轮独立复核结果 |
| 原生内置列表复测 | 已通过：解锁后按正式开发入口启动最终构建，15 项列表、中文搜索、短简介及两项多选/逐项取消正常 | bundled-resources-native-acceptance.json、bundled-resources-native-final.log |

开发 .app 直接启动不提供所需运行时环境；一次直接打开的实例在登录后按预期报缺少 DSH_DESKTOP_PRIMARY_RUNTIME_DIR，已退出。用户解锁后，已退出未登录的旧实例，重新通过 pnpm run start:desktop 的 Insight 环境启动最终构建，短信登录成功，原验收会话及两轮内容仍可读。本次复测不构成已验证正式安装包或内置技能业务正确性的声明。

原生列表显示 15 项内置技能。“线下活动查询”和“创意发想”经搜索可选择，草稿分别写入 /activity-search 和 /creative-generation-evaluation；两项可同时保留，取消第一项不影响第二项，全部取消后计数归零且发送按钮禁用，Escape 关闭菜单。测试过程未发送消息、执行技能或改动 bundled-skills 内容，本次测试选择已移除。

本轮未生成/发布正式安装包，未在 Windows 实机验证，未执行内置技能正文或脚本，也未触及生产旧账号 Home。此前 Canvas 前端 7 项失败、3 项依赖准入及其他未完成的 P3 功能矩阵仍须收口；P3 保持未通过，不进入 P4。

## 登录协议弹窗样式补正

登录页的软件许可及服务协议、隐私政策采用原 Shell 的页内阅读布局：居中卡片、固定标题与右上关闭按钮、独立滚动正文、固定底部关闭按钮，尺寸和留白参考 Shell，并复用 DSH Modal 的焦点管理与 Escape 行为。两份正文以构建期静态资源导入，原 HTML 文件与 P2 HEAD 的字节及 SHA-256 一致；不新增网络读取，不更改协议条款。阅读或关闭不勾选同意，不提交登录，已填手机号与验证码保留。

实现位于 Insight 专用登录组件及原生登录入口，移除已无消费者的协议 IPC 和独立 BrowserWindow；不修改通用 DSH Modal、官方标题栏或暂缓的 package-meta 方案。账号存储、会话和历史迁移逻辑不变。

验证：登录组件及启动测试 14/14，定向 lint、build:artifacts 8/8、其后的 build:check 2/2、README 单对双语记录和对应源码 whitespace 检查通过。证据位于 DSH apps/desktop/.desktop-build/qualification/p3-20261030/legal-dialog-tests.log、legal-dialog-build.log、legal-dialog-build-check.log、legal-document-integrity.json。最终开发构建的服务协议弹窗已在本机截图核对：860px 宽版卡片、18px 圆角、固定标题和页脚、右上 × 与底部蓝色关闭按钮显示正常。首轮截图暴露的 380px 默认宽度覆盖和基础样式缺失已修正，并重新完成上述测试、lint、产物和类型检查。本机工具仍出现 AX 与截图不同步、noWindowsAvailable / elementHasNoFrame，原生正文滚动、隐私弹窗切换和关闭交互保留待测；两份协议的组件交互测试均通过。未生成或发布正式安装包。

P3 其他未通过项继续沿用前文，不进入 P4。

## P3 阶段性提交

2026-10-30 按用户要求创建代码阶段提交：DSH insight 分支 ff40a73591a3632bcdbb5a903d69aa2c1ea963f6，提交标题为 feat(insight): checkpoint P3 desktop features and native acceptance。这是当前迁移工作的本地存档，不代表 P3 全项验收完成，也不授权进入 P4 或发布客户端。

正常 pre-commit 首次发现长行、类型成员分隔符与一处同值条件分支，已修复后重试。23 个受影响文件的编译后语法树对照通过；除合并同值条件分支外均为格式调整。Canvas 父仓补丁已重新生成，三个固定源码补丁通过当前源码的反向匹配检查；Memory 检查排除构建生成的根 lib。Insight 补丁目录沿用仓库既有的补丁空白属性，保留上游上下文和删除行的原始字节，不关闭普通源码空白检查。

最终 pnpm run build 的产物与 Host/Client 汇总编译共 10 项通过；正常 pre-commit 的双语对应记录、暂存源码 lint、空白、PiAi provider 元数据和 vendor guard 五项均通过，未绕过钩子。证据为 DSH qualification/p3-20261030 下 checkpoint-build.log 和 checkpoint-commit-final.log。此前功能测试和原生验收沿用本报告记录；未重跑全仓测试、未发布远端分支、未生成正式安装包。Canvas 前端失败、依赖准入和其余待测项保持前文状态。
