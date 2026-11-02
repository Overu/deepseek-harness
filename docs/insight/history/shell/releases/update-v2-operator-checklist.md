> 冻结历史记录：保留旧 Shell 在记录日期的结论和验收状态，不代表当前实现或线上状态。现行说明见 [Insight 文档入口](../../../README.zh.md)。

# Desktop Update v2 操作清单

本清单用于 `v1.0.0-rc.20` 桥接、按目标测试最终版本、拒绝失败版本，以及把同一批 已验收字节转为 Stable。任何签名、摘要、身份、兼容或 CDN 门禁失败都必须停止，禁止 覆盖 tag、Release Asset 或 OSS 不可变对象。

## 0. 本地与合入门禁

- [ ] 当前分支已合入 `main`，工作区干净，`package.json`、Runtime 锁和兼容声明已审核。
- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run build:prepared`
- [ ] `node scripts/verify-release-workflow.mjs .github/workflows/release.yml package.json`
- [ ] `node scripts/verify-publish-workflow.mjs .github/workflows/publish-update.yml scripts/github-oss-client.mjs`
- [ ] `node scripts/verify-release-v2-workflow.mjs .github/workflows/release-v2.yml`
- [ ] `node scripts/verify-publish-v2-workflow.mjs .github/workflows/publish-update-v2.yml`
- [ ] `git diff --check`

## 1. 发布 rc.20 桥接包

rc.18 因打包后的沙箱 About preload 引用拆分模块而被拒绝；rc.19 已构建为 Draft， 但尚未完成 CDN 和安装升级门禁。旧 `.github/workflows/release.yml` 与 `.github/workflows/publish-update.yml` 在 rc.20 后只用于 桥接维护，不再创建新的日常 Candidate。

- [ ] 从已审核提交创建短期分支，设置 `package.json` / lock / policy 为 `1.0.0-rc.20`、`candidate`、`optional`。
- [ ] 运行 `Release desktop installers`：`candidate_tag=v1.0.0-rc.20`，`target=all`。
- [ ] 核对三端签名/公证、Runtime 测试、Manifest 和 Draft 资产。
- [ ] 运行 `Publish desktop updates` 的 `stage`，核对 OSS/CDN 的 HEAD、Range、长度、 SHA-512 与压缩响应；仅在门禁和三平台升级验收通过后以精确版本执行 `promote`。
- [ ] 在 rc.17 的 macOS arm64、macOS x64、Windows x64 实机验证自动发现、下载、安装、 重启和 userData 连续性。
- [ ] 确认启动、六小时和恢复定时任务只检查 Stable；在更新窗口连续点击 Logo 五次、 经二次确认后才手动检查 Candidate，不出现内测开关或额外提示。
- [ ] 从 rc.17 三平台验证自动发现 rc.20；已安装 rc.18/rc.19 的内部测试机因只执行 Stable 后台检查，必须人工安装或显式触发内测检查，不能把它计为自动升级通过。
- [ ] 冻结 `desktop/candidate/current.json` 在 rc.20。失败时废弃 rc.20 并使用更高 legacy RC，禁止替换 rc.20 字节。

## 2. 初始化最终版本并构建安装包

`Build desktop v2 installers` 输入为 `version` 和 `platform`。日常选择 `all`，一次 workflow 并行构建 macOS Apple Silicon、macOS Intel 和 Windows x64；如需补救可选择 `mac`（两个 macOS 架构一起构建）或 `windows`。第一次运行创建不可移动的 `v<version>` tag 和 Draft； 之后只能从该 tag 补齐目标。tag 创建后不允许再修改该版本源代码。公共测试在构建前运行一次， Windows 构建再执行平台测试；每个目标继续独立完成安装包、签名、公证和更新配置校验。

- [ ] 运行 `Build desktop v2 installers`，填写最终 SemVer（例如 `1.0.3`）和 `platform=all`。
- [ ] 确认 Draft 资产全部以 `<target>--` 开头，且含安装包、更新元数据、blockmap、 `insight-target.json` 和签名。
- [ ] 确认重复运行只验证或补齐缺失资产；同名不同摘要必须失败，禁止 `--clobber`。
- [ ] 记录 workflow run URL、tag commit、Runtime tag/commit、Target Manifest SHA-512 和安装包摘要。

单平台故障可用 `mac` 或 `windows` 补齐；Stable 转正前要求三个目标全部完成。

### 数据格式升级：先建立恢复基线

当新版本写入的整体 Data Schema 超出当前 Stable 的读取范围时，普通 Candidate 发布继续拒绝。 不能扩大旧 Manifest 的读取声明，也不能修改已发布 tag。此类版本先作为正式 App ID 的恢复基线包 进行线下覆盖安装验收；它不进入 Candidate 指针。

1. 构建全部三目标 Draft。每个实际包执行启动冒烟、真实历史 v3→v4 迁移和恢复续写检查； `release-proof-<target>` 制品保留 Core 身份、归档摘要和会话结果。校验是自动证据，不能代替实机验收。
2. 用 `stage-target` 分别上传三目标不可变资产；保存 OSS/CDN 的安装器长度、SHA-512、HEAD/Range 证据。
3. 三平台分别完成干净安装、从当前 Stable 覆盖安装、三次重启、真实账号/模型请求、工作区、 会话、主题、提示词增强与内置插件验收。任何问题都不能填写通过记录。
4. 对每个实际通过的目标运行 `accept-recovery-baseline-target`，填写 `version`、目标和相同的 `confirm_version`。发布器检查完整签名链与安装器，要求新包能读旧 Stable 写入的数据和自身数据， Profile/账号 Schema 不变，并要求确实需要向前升级数据格式。记录在独立的签名 `recovery-baseline-acceptance/<target>.json` 中，绑定验收时 Stable 信封摘要与新 Target 摘要。
5. 三目标记录齐全后才运行 `promote-recovery-baseline`，填写相同版本确认。该命令要求三份记录 引用同一个、仍未变化的 Stable 基线；复核全局版本下限与统一 Shell/Core/兼容身份。 沿用既有 Release Index 签名与不可变资产发布，最后更新 Stable 指针；Candidate 指针保持不变。
6. 公开新 Stable 的三目标签名 Manifest 已确认能读新数据后，更高版本才按普通 `publish-candidate-all` 路线发布。恢复目标是这个新基线，不是旧 Core。

2026-10-09 操作者明确授权本次 1.0.4→1.0.5 使用已有 Dev 多轮实测与三平台自动门禁， 不追加重复人工测试。签名接受记录表示发布接受决定，未新增实测的项目仍如实记录在 [恢复基线验收记录](1.0.4-recovery-acceptance.md)，自动签名/摘要/兼容/CDN/恢复检查继续全部执行。

本次采用 `1.0.4` 新 Core 恢复基线→`1.0.5` Candidate。若二者 Core 相同，恢复安装不能修复 其共享的 Core 缺陷；恢复基线的真实模型与插件验收必须独立完成。正常兼容版本仍使用普通 Candidate→Stable 路线，不能借此入口跳过 Candidate。

## 3. 投放和验收单一 Candidate 目标

发布前确认 CDN 对 `/desktop/candidate-v2/` 使用 1 分钟、权重 99 的缓存规则， 且三个 `current.json` 公网响应的 `X-Swift-CacheTime` 为 `60`。新增规则后， 须刷新已缓存的三个精确指针 URL；仅修改规则不会清除旧的长缓存对象。正常发布等待 60 秒收敛并以发布器校验为准，不需要每次手动刷新 CDN。

日常在 `Publish desktop v2 updates` 运行一次 `command=publish-candidate-all`，填写精确 `version`、`target=none`。发布器先上传并验证三个目标的不可变资产，再逐个校验兼容性、 更新三个 `desktop/candidate-v2/<target>/current.json`。每个指针仅写入一次；若中途失败， 重跑同一命令验证已完成字节并继续。单目标 `stage-target` 和 `publish-candidate` 仅用于故障补救。

1. 测试者在更新窗口连续点击 Logo 五次，经二次确认后检查内测更新。Candidate 不应产生红点、后台检查或主动通知。
2. 完成干净安装、覆盖安装、上一接受版本到当前版本、连续三次重启、主题、完整安装包恢复、 userData、账号、会话、工作区、设置和插件验证。
3. 记录三目标验收结果后，运行一次 `command=promote-stable-all`、`target=none`，填写 `version` 和相同的 `confirm_version`。它复验三个签名 Target Manifest、Candidate 指针和 OSS 对象清单，为三个目标写入不可覆盖的签名验收记录，再执行 Stable 发布。安装包的完整 字节校验已在 Candidate 阶段完成，转正时不重复下载。任一目标未通过时不得运行该命令。

任一目标失败时运行 `reject-version`，填写精确版本确认和简短原因。拒绝不会删除资产；已 指向该版本的 Candidate 指针会原位提交同版本签名 `rejected` tombstone，GitHub Release 会 标记为 prerelease/REJECTED，客户端后续检查必须拒绝安装。即使 Release 已公开但 Stable 指针 尚未提交也可执行该动作；Stable 指针已经指向该版本后禁止撤回。修复必须使用全局更高的最终 SemVer。

## 4. 转为 Stable（不重新构建）

- [ ] 三个 Candidate 指针均指向相同版本。
- [ ] 三个目标的人工验收均已完成；`promote-stable-all` 将写入签名验收记录并复核摘要。
- [ ] 三个 Target Manifest 的 Shell commit、Runtime、兼容声明和版本完全一致。
- [ ] Candidate `writesDataSchema` 可由当前 Stable 读取；首个 Stable 前由签名 rc.20 桥接包读取。
- [ ] 对应目标的恢复 DMG/NSIS 已从 OSS 与 CDN 按 Manifest 长度和 SHA-512 校验通过。
- [ ] 确认 `promote-stable-all` 成功；失败可重跑，或使用单目标 `accept-target` 与 `promote-stable` 定位并补救。
- [ ] 确认发布器生成并签名 Release Index、追加到 GitHub Draft 和 OSS，先公开 GitHub Release， 最后写入 `desktop/stable/current.json`。
- [ ] 确认 Stable 客户端能自动发现；已安装相同 Candidate 字节的用户显示“当前版本已转为正式版”， 且不重新下载。

## 5. 公网与证据

逐项保存响应头、正文摘要与时间：

- `https://updates.insight-aigc.com/desktop/candidate-v2/darwin-arm64/current.json`
- `https://updates.insight-aigc.com/desktop/candidate-v2/darwin-x64/current.json`
- `https://updates.insight-aigc.com/desktop/candidate-v2/win32-x64/current.json`
- `https://updates.insight-aigc.com/desktop/stable/current.json`
- `https://updates.insight-aigc.com/desktop/releases/v<version>/insight-release.json`
- `https://updates.insight-aigc.com/desktop/releases/v<version>/targets/<target>/...`

- [ ] 指针在 60 秒窗口内收敛，版本目录保持一年 immutable。
- [ ] 安装资产支持 HTTPS、HEAD 和 Range，无重定向或字节改写。
- [ ] CDN 下载摘要与 Target Manifest 完全一致。
- [ ] 报告中不包含更新私钥、OIDC Token、STS 凭证、用户路径或完整异常响应。
- [ ] rc.17 仍能通过冻结的 legacy Candidate 指针到达 rc.20。

只有以上证据齐全后才清理不再被 legacy 或 v2 指针引用的旧 Draft/Release；不得先删除再验证。
