> 冻结历史记录：保留旧 Shell 在记录日期的结论和验收状态，不代表当前实现或线上状态。现行说明见 [Insight 文档入口](../../../README.zh.md)。

# Core 升级前的本地分支整理与基线

日期：2026-10-08。当前阶段完成本地分支整理、升级目标选择和无工作目录变更的合并预检；尚未正式合并或验证新 Core。

本文保留升级开始前的状态。随后完成的实际合并、兼容适配与验证见[Core 升级结果](2026-10-08-core-upgrade-result.md)。

## 保留的调研结果

- `docs/analysis/2026-09-30-official-desktop-platform-assessment.md` 原样保留，仍为本地未提交文件。
- 清理前后 SHA-256 均为 `07655228f50bf2894f093a9178d0bed89c2ca6061cec2b6245d05190999de44d`。
- 本轮继续现有 Shell + Core + Plugin 路线，未采用官方桌面替换方案。

## 已清理的本地分支

仅删除本地分支引用；未删除远端分支、发布标签或工作目录。

| 仓库 | 分支 | 原提交 | 安全依据 |
| --- | --- | --- | --- |
| Shell | `codex/fix-skill-list-and-sync-20260928` | `69669c3cb86175391ba9cbdc3c34743a15985f2a` | 是当前 `main` 的祖先 |
| Shell | `codex/skill-capability-audit` | `5fa32fdf9fc1edfcd07a826f79fa31af9938c9cd` | `git cherry main` 显示补丁已存在于 main；对应十二技能修复已由 main 的 PR #17 提交承载；原远端引用保留 |
| Core | `codex/core-0.1.5-rc.2` | `5c7450d116d59f972b5df64efa3942220d363809` | 已包含于当前发布基线 |
| Core | `codex/core-1.0.0-integration-20260922` | `9ff38a40d5` | 已包含于当前发布基线 |
| Core | `codex/fix-minimal-bundled-skills` | `5f668026071a5c2f2a0796aff1900be62b0aebe4` | 与当前发布 tag 相同 |
| Core | `codex/gateway-capability-20260914` | `42ddfb640a` | 已包含于当前发布基线 |
| Core | `codex/rc21-macos-sidebar-spacing` | `5f668026071a5c2f2a0796aff1900be62b0aebe4` | 新升级分支从同一发布 tag 建立后删除；发布 tag 和原远端引用保留 |

## 保留的分支与工作树

- Shell `main` 保持 `0709fb21d811c5924e1dd8a7a67962d6c4390a24`。
- Shell `codex/release-v1.0.0-rc.18`：有一条未被祖先检查或补丁等价检查确认合入 main 的提交，保留。
- Core `master`：现存本地主分支，仍是 `833f4246ab`，不是本轮升级起点，不移动其引用。
- Core `codex/insight-skill-picker-20260918`：相对当前发布基线有四条非补丁等价提交，保留；不能仅凭功能名称相同删除。
- Core `codex/core-0.1.6-alpha.2-insight-20260918`：被现存工作树占用，保留；检查时该工作树干净。
- Core `codex/windows-console-repair-20260921`：被 Git 工作树记录占用，记录提示路径失效；本轮保留分支和记录，未删除或强制清理工作树。
- Shell 另有 detached 工作树记录，包括一个失效记录，本轮未改动。

Shell 与 Core 的 origin 引用已获取；Core 的 upstream 引用及 tag 已获取。fetch 清除了 origin 已不存在的两个 Shell 远端跟踪引用，不是删除服务器分支。官方参考仓库检出仍保持原版本，未切换它的源码。

## 已确定的升级目标

用户选择：最新已发布 tag，保留因赛定制，不追随未发布主干。

- 官方发布：[`dsh-v0.2.1-alpha.1`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-alpha.1)，2026-10-03 发布，属于预发行。
- 目标提交：`5badb15009ae1756c3afe0ae0cef1faafc290ccc`。
- 因赛起点：`insight-runtime-v0.1.6-alpha.2-insight.4`，提交 `5f668026071a5c2f2a0796aff1900be62b0aebe4`，与 Shell 现行 Runtime lock 一致。
- 已创建并切换 Core 本地分支：`codex/core-0.2.1-alpha.1-20261008`。
- 分支当前仍指向因赛起点，工作目录干净；没有 MERGE_HEAD 或未解决的工作目录冲突。

## 合并预检

运行 `git merge-tree --write-tree --name-only HEAD dsh-v0.2.1-alpha.1`，仅在 Git 对象库生成预检结果，没有开始工作目录合并。退出码 1 表示存在冲突。

预检得到 28 个冲突路径：

```text
.github/workflows/sandbox.yml
docs/subsystems/conversation.i18n.yaml
packages/api/remotes/src/remote-events.ts
packages/api/session-controller/src/skill-catalog.ts
packages/client/ui-attachment/tests/message-image.client.spec.tsx
packages/client/ui-chat/src/client/locale.ts
packages/client/ui-chat/tests/chat-view.client.spec.tsx
packages/client/ui-conversation/README.i18n.yaml
packages/client/ui-conversation/src/client/contract/input.ts
packages/client/ui-conversation/src/client/input/facade.ts
packages/client/ui-settings-general/README.i18n.yaml
packages/client/ui-settings-general/src/client/SettingsRoot.tsx
packages/client/ui-settings-general/src/client/chrome.tsx
packages/client/ui-settings-general/src/client/index.ts
packages/client/ui-settings-general/src/client/shell-contract.ts
packages/client/ui-settings-general/tests/settings-root.client.spec.tsx
packages/client/ui-sidebar/src/client/SidebarRoot.tsx
packages/client/ui-skill/README.i18n.yaml
packages/client/ui-trajectory/tests/views.client.spec.tsx
packages/client/ui-user-questions/tests/plan-review-panel.client.spec.tsx
packages/client/ui-user-questions/tests/user-questions-composer.client.spec.tsx
packages/client/ui-workflow-run/tests/workflow-run.client.spec.tsx
packages/extensions/cordis-client-runner/src/client/slot-catalog.ts
packages/preset/agent-presets/presets/minimal/agent.cordis.yml
packages/preset/agent-presets/tests/mount.spec.ts
packages/preset/agent-presets/tests/shipped-root.spec.ts
packages/subprocess/win32-process/README.i18n.yaml
scripts/gen-cordis-catalog.ts
```

其中极简预设 YAML 及两个预设测试为上游删除、因赛修改的冲突；不能直接保留旧路径就视为完成适配。旧的翻译配对 merge driver 无法解析部分上游配对记录，正式合并时须使用目标版本的文档规则处理。自动合并成功的 Runtime 清单、锁文件与构建脚本也必须复核，不能只检查上述冲突路径。

最新发布还移除了运行时 invariant 插件和 `./invariant` 导出，并调整了输入区扩展与预设行为。后续应重点检查自有 Runtime 依赖根、Profile、第一方集成以及 V3→V4 会话数据边界。

## 下一阶段的完成标准

1. 在上述新分支合入固定目标 tag，逐项保留或适配因赛设置、品牌、技能、Gateway 与 Windows 修复；不改变桌面路线。
2. 使 Runtime 依赖闭包、构建、相关类型检查及定向测试通过，处理目标版本的文档门禁。
3. 使用隔离 Profile 验证 Shell 与新 Core 的实际启动、技能、设置和账号生命周期，不让新版本写入生产数据。
4. 三平台 Runtime 通过构建与验收后，才单独更新 Shell Runtime lock；本轮未修改它。

本轮没有改产品源码、执行产品构建、上传制品或改发布指针。9 月 30 日报告的 70 个测试通过属于上轮证据，不是新 Core 的验证结果。
