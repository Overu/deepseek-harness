> 冻结历史记录：保留旧 Shell 在记录日期的结论和验收状态，不代表当前实现或线上状态。现行说明见 [Insight 文档入口](../../../README.zh.md)。

# Insight P4 交付报告

> 历史阶段记录：下文的阶段状态、待授权描述和运行结果保留当次背景，不代表当前进度。当前状态见 [P5 收口](2026-10-30-dsh-insight-p5-delivery.md)，下一阶段见 [P6 交接](2026-11-02-dsh-insight-p6-handoff.md)。历史失败保留，不将未复验项记为通过。

日期：2026-10-30（Asia/Shanghai）。状态：按最终简化范围完成实现及本机副本验收，代码已按用户要求阶段提交至 DSH insight：`675192ea4b`。未进入 P5。P3 既有未关闭项仍以其验收报告为准。

## 1 最终范围与变化

P4 只让 Insight 使用 Shell 已有的 `userData` 位置和账号 `<scope>/harness` 目录作为 DSH_HOME。选择逻辑不导入、转换或合并已有数据；启动后的正常 DSH profile、storage 和 Session 写入仍在该 Home 中进行。原有配置文件保留不等于旧 web profile 中的所有设置自动成为 desktop profile 的有效设置。

用户已取消旧定时任务兼容、未登记会话补归属、profile 暂存和迁移状态管理。对应尝试实现、测试和设计草案已撤回，不保留 Schedule、Host 或复杂接管扩展。`bundled-skills` 未修改，也未验证其内容正确性。

| 位置 | 变化 |
| --- | --- |
| Insight `account-home.ts` | 复用已有 `harness`；新账号创建 `harness`；不再默认另建 `harness-native` 或写入原生 Home 标记 |
| Insight 启动状态与登录页 | 只有 `harness-native` 时显示 `pre-release-data`，保留文件并提示联系维护人员，不显示空工作区；两者都有时以 `harness` 为准 |
| Desktop 开发脚本 | Insight 默认 userData 改为 Shell 使用的操作系统应用数据目录；显式 `DSH_DESKTOP_USER_DATA_DIR` 仍优先；官方 DSH 产品默认值保持原状 |
| 测试、README、基线轨迹和升级指南 | 覆盖目录选择、隔离、异常路径和预发布目录保护；记录开发默认位置的变化 |

本轮官方 Desktop 变化仅为上述开发启动路径适配，轨迹见 [官方基线修改记录](../../../baseline-changes.zh.md)。打包产品原有的 `insight-desktop` userData 名称不变，本轮没有修改 electron-builder。

## 2 结构和数据流

```text
Shell 原有 userData
├─ insight/accounts/<scope>/
│  ├─ harness/                 原 Home，作为 DSH_HOME
│  │  ├─ sessions/             保留原日志世代
│  │  ├─ storages/             原工作区及业务状态
│  │  ├─ memories/、attachments/ 等
│  │  └─ profiles/             原 web 保留，原生 desktop 按正常运行规则初始化
│  └─ harness-native/          若有则保留，不自动合并
└─ 其他 Shell 数据             原位保留
```

登录服务返回稳定 user ID → Main 按原有环境和 user ID 算法计算 scope → Integration 选择该 scope 的 `harness` → Desktop Host 从这个 Home 启动 DSH 原生 profile → 现有会话与工作区服务读取原数据。手机号和显示名不参与目录身份计算。

| 运行方式 | macOS 默认 userData |
| --- | --- |
| Insight 开发版 | `~/Library/Application Support/insight-desktop-dev` |
| Insight 打包正式版 | `~/Library/Application Support/insight-desktop` |
| 隔离验收 | 通过 `DSH_DESKTOP_USER_DATA_DIR` 指向独立副本，不启动旧 Home |

Windows 路径使用 APPDATA，Linux 使用 XDG_CONFIG_HOME 或 `~/.config`；跨平台定位有单元测试，本轮实机范围为 macOS。

## 3 已通过验证

| 检查 | 结果 |
| --- | --- |
| 聚焦测试 | 5 文件、35 测试通过：account-home、insight-development-data、insight-startup、login.client、product |
| 最终 `pnpm run build` | 10 门禁通过，含 artifacts、Host/Client aggregate check |
| 本轮源码和测试定向 ESLint | 10 文件通过 |
| 文档配对、升级指南、Markdown 链接 | 通过；完整 doc-sync 中对应门禁也通过 |
| `git diff --check` | DSH 与 Shell 均通过 |
| Shell 分析文档本地链接 | 本轮 4 份文档共 47 个本地目标存在 |
| 历史读取 | 当前已构建的 DSH 公开 JSONL provider 对测试副本 22 个会话执行只读 list/open/read，22/22 成功，包含旧格式会话 |
| 原生首次登录 | 两个旧工作区和原历史列表可见；分别打开两条历史会话，用户/助手消息、工具记录与轮次正常显示 |
| 原生重启后登录 | 使用菜单“重启应用与 Host”，重新登录后两个工作区和历史仍可见；再次打开两条历史，显示 3 轮 4 步、11 轮 38 步 |
| 原数据保护 | 旧生产、开发目录的 3,534 个已盘点文件大小和 mtime 无变化；25 份原开发会话日志在来源和测试副本中 SHA-256 均未变化 |
| 工作区状态 | 两个原工作区 ID、路径和已登记会话 ID 均保留；3 个归档 ID 未变化 |

实机使用旧开发账号 Home 的隔离副本，只复制 sessions、storages、memories、attachments；未复制凭据、旧 profile 依赖或用户项目文件树。副本产生正常初始化会话、会话锁及对应工作区时间更新，不能把正常启动描述为“整个 Home 不写入”。22 个读取结果包含原 21 个会话 ID 和 1 个原生初始化会话。

整个验收没有发送新消息、运行历史任务或触发生成，不据此声称已验证历史会话继续生成或全部远程成果访问。

独立最终审查未发现新的 P4 代码阻断点；副本首启、重启后二次登录及原始日志摘要证据关闭了本阶段的历史可见性验收缺口，审查结论不外推为安装升级通过。

## 4 未通过项与验证限度

完整 `pnpm run doc-sync` 为 41 通过、2 失败、0 跳过。失败文件与本轮改动无交集：

- `verify-repository-references`：`python/sdk/uv.lock:113` 的固定提交引用。
- `verify-concrete-terms`：现有 bundled-skills、Canvas/Memory 固定源码和 Memory 补丁中的用语；共涉及 33 个文件。按用户要求不改内置技能内容，不为本次目录复用扩展为固定快照清理。

没有运行全仓 lint、完整单元覆盖率或三平台安装升级。生产 Home 只读盘点，不在真实来源上启动 Host。Windows/Linux 原生行为、安装器覆盖旧版、OSS/CDN 更新和测试版 opt-in 属于 P5；本报告不代表发布批准。

归档会话在“显示已归档”中保留，当前 DSH 的归档行不可直接打开；本轮不恢复归档状态。未登记顶层会话、旧定时任务和任意旧文件导出按用户最终范围不作修复或兼容。旧 web profile 的第三方插件和设置文件保持原位，其在新 desktop profile 中的逐项功能效果不因目录复用而视为已验收。

## 5 风险与后续约束

新旧客户端不可同时写同一账号 Home；正式安装交接由 P5 验证。DSH 正常运行可能更新存储、缓存或创建后继日志，保留历史数据不构成旧二进制可读新数据或无损降级承诺。

仅有 `harness-native` 的预发布账号会停止启动，待维护人员确认数据处理；不会自动合并或删除。默认位置变更后，先前仓库隔离位置的数据也不会跨根自动合并。开发验证应继续显式设置独立 userData，避免把测试操作写入日常旧账号。

## 6 证据与交付状态

不含凭据的本地证据位于 DSH 被忽略的 `apps/desktop/.desktop-build/qualification/p4-20261030/`：`simple-native-acceptance.json`、`simple-data-verification.private.json`、`simple-source-metadata.private.json`、`simple-target-read.private.json`、`simple-final-build.log`、`simple-final-lint.log`、`simple-doc-sync.log`。含精确本机路径的私有清单不纳入 Git。

P4 的目录复用实现、聚焦检查和本机历史副本首启/重启验收已完成，代码已阶段提交。交付文档随本次 Shell 文档提交归档；不自动进入 P5。
