> 冻结历史记录：保留旧 Shell 在记录日期的结论和验收状态，不代表当前实现或线上状态。现行说明见 [Insight 文档入口](../../../README.zh.md)。

# 1.0.6 与当前本地版本归档

归档日期：2026-10-09。初次归档仅整理本地 Git 与交付文档；同日按用户随后明确要求，将 Core 集成线快进合入并推送到 `master`。未执行远端分支删除、安装包重建或用户数据变更。

## 发布版本与当前入口

| 仓库 | 1.0.6 不可变代码 | 当前工作入口 |
| --- | --- | --- |
| Shell | `v1.0.6` / `29718822b36a232eeabe202b77fed6ae44256338` | `main` 快进到发布基线，再单独提交本次归档文档；应用代码及 Runtime lock 不变 |
| Core | `insight-runtime-v0.2.1-alpha.1-insight.3` / `c3aaab2e76ddfad6163478687287774ad7233374` | `master` / `origin/master` / `0d314b68b3be24a66831601d6b4252217175dc71` |

Core PR #2 已于 2026-10-09 12:16:40 合入 `codex/core-0.2.1-alpha.1-20261008`，合并提交 0d314b68 的文件树与发布 Core c3aaab2 完全一致。初次归档时 `master` 仍为旧 833f4246；用户随后明确要求合入默认主线，已在 18:14 左右完成 `833f4246 → 0d314b68` 的快进与正常推送，并通过 GitHub REST 核实远端。后续 Core 开发入口改为 `master`；定位已发产品仍使用不可变 Runtime tag。

正常 pre-push 的 `pnpm run typecheck` 通过（34.58 秒），没有绕过 hook。合入前使用最新已抓取的 `origin/master` 执行 change-scope，并确认旧 master 是目标祖先、工作区干净、目标文件树与 insight.3 一致。推送触发的主线 CI 与既有三平台发布验收分开记录，不把已触发或排队视为通过。

新增主线 CI 的 [真实 API E2E 37916330562](https://github.com/Boxser567/insight-harness-core/actions/runs/37916330562) 在凭据预检失败，日志明确要求配置 `DEEPSEEK_API_KEY_EXTERNAL`，构建与真实业务测试均尚未执行。[CI master 37916331164](https://github.com/Boxser567/insight-harness-core/actions/runs/37916331164) 的 Wine Windows 检查在依赖安装阶段因 `ERR_PNPM_ENOENT` 的 hoisted-linker rename race 连续三次失败，未进入测试；两个 self-hosted standby 排队，远端 runner 清单为 0。其余检查在 18:21:33 截面仍未完成。证据见本机追加的 `core-master-ci-observation.json` 和失败日志；这不是本次发布包的重新验收，也不能写作全部 CI 通过。本轮未修改 CI 门禁或取消任务。

## 可恢复的本地归档

本地归档根目录为 Shell 仓库相对路径 `release-reports/archive-1.0.6-20261009/`，被 Git 忽略。它只用于本机恢复，不能假设其他机器已有这些文件；知识库只登记版本和证据摘要，不复制二进制备份。

- `before-cleanup.json`：清理前两仓库的全部引用、HEAD、分支、worktree、工作区状态及文件 SHA-256。
- `<repo>/before-cleanup.bundle`：全部已有 Git 引用和相关 worktree HEAD 可达对象；已通过 `git bundle verify`。
- `<repo>/tracked-unstaged.patch`、`tracked-staged.patch`：清理前已跟踪文件的实际差异。
- `shell/working-files/`：README、Runtime lock 和业务能力盘点的原始工作副本。未提交内容单独保留，不被描述为正式发布代码。
- `cleanup-result.json`：被删分支的名字/原 SHA、最终保留分支与 worktree 登记。
- 两仓库本地 `archive/2026-10-09-before-cleanup` 标签固定清理前 HEAD；`archive/2026-10-09-current` 固定归档后的当前提交。归档标签不推送，不改变产品 release tag。
- `<repo>/current.bundle`：相对于 before-cleanup 标签的增量归档；恢复时先载入完整 before-cleanup bundle，再载入此增量。
- `core-master-integration-proof.json`：随后合入 master 的远端核验、类型检查及当次 CI 状态截面。Core 新增本地 `archive/2026-10-09-before-master-merge` 标签保留旧 master 833f4246；此前 bundle、current 标签和清理证明保持原快照，不改写为本次新状态。

| 备份 | 字节数 | SHA-256 |
| --- | --- | --- |
| `shell/before-cleanup.bundle` | 327195715 | `7c8e6dd488f0e4fb108b14736aa19f113b2c43b5e69e9e298c95016743156bbf` |
| `core/before-cleanup.bundle` | 244877264 | `8ba9ec467604347a393a7621a3495a42fa662a525a1524fb3d45a72cce7c1a24` |

清理前 Shell HEAD 为 `1f0527427a1dc2ed43e46c9d291258b2de7c9eef`，Core HEAD 为 `c3aaab2e76ddfad6163478687287774ad7233374`。README.md、README.zh.md 的现有用户改动保留且不纳入归档提交。业务能力盘点经本次授权归档提交，不变更其已补全内容。

## 已清理的本地分支

删除前逐项验证该 SHA 是对应集成目标的祖先；仅使用 `git branch -d`。初次清理的 Shell 集成目标为 origin/main 29718822，Core 集成目标为 origin/codex/core-0.2.1-alpha.1-20261008 0d314b68。当时 Core 仅被集成线包含；随后 master 已接收同一目标，并追加清理已冗余的本地集成分支。

| 仓库 | 已删除分支 | 原提交 |
| --- | --- | --- |
| shell | `codex/candidate-1.0.5` | `3c595f96b91bf67f900e9144ba1056a86aa4c72c` |
| shell | `codex/candidate-1.0.5-release-record` | `b1f8bc3a33a8a2005c105b0252cdfab35281ced9` |
| shell | `codex/candidate-recovery-chain` | `2288e031d7991680087099ecb80c27cfeb3ac003` |
| shell | `codex/core-0.2.1-alpha.1-integration-20261008` | `688ee18c4973f0e3729f4433663551290c28f4b3` |
| shell | `codex/fix-local-plugin-upgrade-source` | `bf837f76331a6518813d0bb8254aff0a3d05e52a` |
| shell | `codex/fix-session-history-compatibility` | `1f0527427a1dc2ed43e46c9d291258b2de7c9eef` |
| shell | `codex/internal-release-v1.0.4` | `37d7a64f5e9f87a0772c80b996c7069ebee2f0d7` |
| shell | `codex/recovery-baseline-acceptance` | `324998c598489e7df30855499584c60d24660b27` |
| shell | `codex/windows-recovery-runner` | `ce815056220b70938996c3a52fa6688e47043499` |
| core | `codex/fix-session-history-compatibility` | `c3aaab2e76ddfad6163478687287774ad7233374` |
| core | `codex/windows-console-repair-20260921` | `be346c81694e14091bc4021cac78d3cad5dd6090` |
| core（master 合入后追加） | `codex/core-0.2.1-alpha.1-20261008` | `0d314b68b3be24a66831601d6b4252217175dc71` |

同时清除了指向已不存在目录的 Shell rc12 与 Core platform-repair 两条 worktree 登记。没有删除任何有效 checkout 目录。

## 保留分支及原因

| 仓库 | 分支 | 原因 |
| --- | --- | --- |
| Shell | `main` | 当前集成和本次本地文档归档入口 |
| Shell | `codex/release-v1.0.0-rc.18` | 6135f980 有 1 个不在 1.0.6 祖先链中的提交；保留同名历史 tag 和分支，不以内容相似推定已合并 |
| Core | `codex/core-0.1.6-alpha.2-insight-20260918` | fbbcc26c 虽已被新集成线包含，但仍被有效旧版本 worktree 使用；保留以便历史对照 |
| Core | `codex/insight-skill-picker-20260918` | f2a899a0 所在分支有 4 个不在发布 Core 祖先链中的提交；不能按已合并删除 |
| Core | `master` | 当前默认开发入口；已与 origin/master 对齐到 0d314b68，包含本次升级及修复 |

Shell web-search 的有效 detached worktree 保留。此次未清理远端分支、历史产品 tag、有效 worktree、node_modules、安装包或用户 Profile。

## 恢复与后续校验

在独立目录进行恢复，不直接覆盖正在使用的仓库。假设以下命令从 Shell 根目录执行，以 Core 为例：

```sh
git clone --mirror release-reports/archive-1.0.6-20261009/core/before-cleanup.bundle ../insight-core-archive.git
git -C ../insight-core-archive.git fetch ../insight-desktop-shell/release-reports/archive-1.0.6-20261009/core/current.bundle refs/tags/archive/2026-10-09-current:refs/tags/archive/2026-10-09-current
git -C ../insight-core-archive.git show archive/2026-10-09-current --no-patch
```

恢复单个被清理分支时，从完整 bundle 获取其原 refs/heads 名称，或核对上表 SHA 后创建新分支。未提交 README 需要另行检查并应用保存的 patch/working-files；Git 标签不会自动包含未提交工作。最终 SHA、增量包摘要、恢复校验及提交范围见本地 `archive-verification.json`。

正式发布和已知修复边界见[1.0.6 归档](../releases/1.0.6.md)。业务能力与尚未验证项见[业务盘点](2026-10-08-business-capability-inventory.md)。
