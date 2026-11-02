> 冻结历史记录：保留旧 Shell 在记录日期的结论和验收状态，不代表当前实现或线上状态。现行说明见 [Insight 文档入口](../../README.zh.md)。

# Desktop 发布说明

## 当前仓库基线

2026-10-27 已将三平台 `1.0.9` Candidate 同字节推广为 Stable，Core Runtime 锁为 `insight-runtime-v0.2.1-alpha.1-insight.4`。对外 Stable 为 [1.0.9](releases/1.0.9.md)，GitHub Release 已公开并标记为 latest；三个 Candidate 指针保持 `1.0.9`。本次按操作者明确转正指令接受发布，未新增实机人工测试；交付范围、下载入口和证据见 [1.0.9 正式发布记录](releases/1.0.9.md)。后续操作前仍须实际查询在线 Candidate/Stable 指针，不把历史记录作为实时状态。

日常发布使用 v2 流程，权威操作步骤见 [Desktop Update v2 操作清单](releases/update-v2-operator-checklist.md)，构建与人工门禁见 [客户端构建 Runbook](client-build-runbook.md)。当前源码工作流分别为 `.github/workflows/release-v2.yml`（Build desktop v2 installers）和 `publish-update-v2.yml`（Publish desktop v2 updates）。旧 `release.yml` / `publish-update.yml` 仅留作 legacy 桥接，不作为日常最终 SemVer 发布入口。

## 应用身份与数据

| 用途 | appId | 产品名 | userData |
|---|---|---|---|
| Candidate / Stable | `com.insight-aigc.desktop` | 因赛AI | `insight-desktop` |
| DEV | `com.insight-aigc.desktop.dev` | 因赛AI Dev | `insight-desktop-dev` |

Candidate 不增加新的应用身份。升级/恢复沿用原数据目录，不清空会话或 Profile；旧签名包的验收不能代替新身份/新字节验收。发布不能隐式修改 Core lock、插件组合、用户目录或应用身份。

## 分支管理

- `main` 是唯一长期集成基线。功能/修复经审核后进入 main；短生命周期 `release/vX.Y.Z` 仅接收阻断修复，发布或取消后回合并并清理，不维护第二条长期主线。
- `dzm/` 分支及作者或提交者为 `duzhimeng` 的提交仅供只读产品意图参考；禁止 merge、cherry-pick、rebase、squash、补丁搬运或复制代码进入本项目。所需能力从当前 main 独立实现并验证，发布前审计祖先和作者/提交者。
- v2 在源代码验证通过后预约不可移动的 `v<最终SemVer>` tag 和 Draft；tag不是发布成功。之后只能补齐该tag的制品，不能改源代码或覆盖已验证同名资产。
- Candidate验收、Stable推广复用同一批已验证字节，不为转正重新构建。公开GitHub/正式OSS对象及旧tag不可覆盖，不回写更低版本渠道指针。

## 生产发布顺序

1. 明确发布范围与用户授权，记录Shell commit、目标三平台、Core tag/commit、版本、Runtime lock及打包输入。按变更运行定向/全量测试、类型检查和构建，完成精确DEV实例的人工验收。
2. 运行 `Build desktop v2 installers`：输入最终 `version` 和 `platform=all`（macOS arm64、macOS x64、Windows x64）。`mac`/`windows`仅作符合冻结输入条件的补救，不凭本机包替代原生平台构建。
3. 验证Draft的目标Manifest/签名、安装包、更新元数据、blockmap及完整文件集；记录run URL、tag、commit和摘要。同名不同字节必须失败，不使用clobber。
4. `Publish desktop v2 updates` 的 `publish-candidate-all` 将原制品复验后投放Candidate。Github OIDC经固定测试Gateway换目录级OSS STS，不使用长期AccessKey。
5. 三平台验证干净/覆盖安装、更新重启、登录、账号隔离、会话/工作区/设置/用户插件，以及可信恢复基线的数据兼容；失败停止，不以删用户数据或重新生成资产过关。
6. 人工明确验收通过后，以精确 `version`/`confirm_version` 执行 `promote-stable-all`。单目标stage/accept/recovery/promote/reject仅按操作清单补救，不绕过整版本门禁。
7. 保存不可变发布证据、渠道提交前后响应和已知问题。不要将workflow成功、DEV通过或可发现更新等同于实际安装/恢复已通过。

## 分发与安全约束

- 客户端更新源为 `https://updates.insight-aigc.com`，不以GitHub Releases作为自动更新源。真实签名/Manifest决定可用版本，Renderer不提供任意下载地址。
- OSS版本目录只写不可变对象；渠道指针最后提交。Bucket禁止启用Versioning/WORM破坏已定义的覆盖语义；CDN遵循当前发布脚本的HEAD/Range、缓存、长度、摘要和压缩校验。
- `desktop-release` Environment保护签名和推广。Apple凭据及产品签名私钥只走既有Secret配置，STS权限限发布所需目录，不加入长期AK/SK或无关控制面权限。
- macOS在对应平台验签、公证、stapling与实际启动；Windows验证NSIS及真实安装/进程退出。macOS最低系统要求以当前package/build配置为准，不能让无法运行的旧安装器依靠应用内更新自救。
- Core、Shell、Profile及数据schema兼容是独立证据。可信完整安装包可用于覆盖恢复；不启用任意降级或让安装器删除用户数据。

协议与一次性配置详情保留于 [OSS分发约束](plans/2026-09-08-desktop-update-oss-distribution-design.md)、[OIDC/STS约束](plans/2026-09-09-desktop-update-sts-publishing-design.md)、[v2设计](plans/2026-09-22-desktop-update-v2-design.md)。这些日期设计不替代当前操作清单与实际脚本。

## 发布记录

稳定版记录保存在 `docs/releases/`：版本/channel、Shell/Core身份、Node/pnpm、目标平台、run URL、制品/Manifest摘要、指针前后事实、安装/升级/恢复与数据保留证据。旧RC操作时间线和重复临时日志见 [历史归档](archive/README.md)。

复盘用于防止复发，不把历史临时做法作为当前工作流；新故障在 `docs/incidents/` 中记录可复用的原因和恢复边界。详细检查模板见 [构建记录模板](client-build-runbook.md#构建记录模板)。
