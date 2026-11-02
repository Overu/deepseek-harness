> 冻结历史记录：保留旧 Shell 在记录日期的结论和验收状态，不代表当前实现或线上状态。现行说明见 [Insight 文档入口](../../../README.zh.md)。

# 2026-09-08 macOS Safe Storage 候选版故障与验收

## 状态与验收范围

- 状态：macOS Apple Silicon 定向候选已解决并人工验收。
- Candidate：`v0.1.2-rc.3`。
- Shell commit：`ce70b86774d44ee48b9212d5b7ce4c060e7a337a`。
- Core Runtime：`insight-runtime-v0.1.1-rc.10`，Core commit `833f4246abaf3ce5fcf39c3f81a8be2499e7f434`，Core version `0.1.1-rc.2`。
- GitHub Actions：[run 34210934030](https://github.com/Boxser567/insight-desktop-shell/actions/runs/34210934030)，手工输入 `candidate_tag: v0.1.2-rc.3`、`target: macos-arm64`。
- 人工结论：从该 run 下载 DMG 并安装后，启动不再弹出 `因赛AI Safe Storage` 密码框。
- 未覆盖：macOS Intel、Windows、`target: all`、完整 Candidate Release、覆盖安装、N→N+1 自动更新和该 DMG 的完整登录/重启数据连续性回归。

本结论只关闭 macOS Apple Silicon 签名候选的钥匙串授权回归，不代表三平台发布完成。

## 2026-09-09 本地 DEV 回归与处理

`1.0.0-rc.1` 本地 `因赛AI Dev` 目录包再次出现 `因赛AI Dev Safe Storage` 密码框。DEV 虽然已经隔离产品名、App ID 和用户数据目录，但本地重建没有稳定代码签名；只在 `safeStorage` 失败后捕获异常无法阻止 macOS 先显示系统授权框。

Electron 官方说明 macOS `safeStorage` 依赖钥匙串且需要稳定代码签名，Cookie encryption 也复用同一系统能力；Chromium 则明确把 `--use-mock-keychain` 作为避免开发构建阻塞式钥匙串弹窗的测试开关：[Electron code signing](https://www.electronjs.org/docs/latest/tutorial/code-signing)、[Chromium macOS build instructions](https://chromium.googlesource.com/chromium/src/+/HEAD/docs/mac_build_instructions.md#avoiding-system-permissions-dialogs-after-each-build)。

DEV 通道现按以下边界运行：

- macOS 在 Chromium 初始化前启用 `use-mock-keychain`，阻止未稳定签名的开发构建访问真实钥匙串；
- 认证 Session 使用非持久分区，测试环境 Cookie 不跨进程保存；
- 访问令牌只保留在 Main 进程内，不读取、不改写既有 `auth/test.json`，也不调用 `safeStorage`；
- 不保存明文 token，不自动删除钥匙串条目、Cookie、Profile、会话、工作区或插件数据；
- 退出 DEV 后需要重新登录属于预期行为。Candidate/Stable 的正式安全持久化不变，仍必须使用 Developer ID 签名、公证包验证连续启动。

自动回归覆盖了“存在旧密文时 DEV 启动不恢复、不改写，当前进程登录仍成功，重建会话后回到未登录”。本地目录包已完成三次进程级冷启动，启动命令均包含 `--use-mock-keychain`，对应系统安全日志未出现 `因赛AI Dev`/`Safe Storage` 访问记录。2026-09-09 已人工打开最终 `final4` 目录包，确认不再出现钥匙串密码框；本地 macOS DEV 回归通过。

## 2026-09-09 `1.0.0-rc.1` 首发身份复现与定论

安装本地构建的 `insight-1.0.0-rc.1-mac-arm64.dmg` 后，正式产品名的 `因赛AI` 在登录流程中再次弹出一次 `因赛AI Safe Storage` 授权框。这不是 DEV 行为，也不是当前应用签名损坏：安装后的 App 使用 `Developer ID Application` 签名并通过严格 codesign 校验，当前 Bundle ID 为 `com.insight-aigc.desktop`，Team ID 为 `8P39WV82RX`。

对同名钥匙串条目进行不读取机密内容的 ACL 检查后确认：该条目创建于当前构建之前，解密权限仍绑定旧 Bundle ID `com.insight.desktop`，代码签名要求中的 Team ID 同为 `8P39WV82RX`。产品名没有变化，因此新旧应用都会访问 `因赛AI Safe Storage`；但当前 `com.insight-aigc.desktop` 不满足旧条目的 designated requirement，macOS 按安全模型要求用户授权。当前 App 的 Cookie Encryption fuse 为关闭状态，本次访问来自登录成功后使用 Electron `safeStorage` 加密保存 access token；拒绝授权后不会生成认证密文文件。

这项证据把原因收敛为“首发前 Bundle ID 变更遗留的同名钥匙串 ACL 冲突”。对于从未安装内部包的新用户，首次正式包会直接创建绑定 `com.insight-aigc.desktop` 与当前 Team ID 的条目；后续版本只要保持产品名、Bundle ID 和 Team ID 稳定，系统无需再次询问。正式发布不能用 `use-mock-keychain` 或明文 token 绕过该安全边界。

发布流水线现对最终 macOS `.app` 增加三项阻断检查：`CFBundleIdentifier` 必须为 `com.insight-aigc.desktop`，`CFBundleName` 必须为 `因赛AI`，签名 `TeamIdentifier` 必须等于发布环境配置的 Apple Team ID。首发前只清理测试机上已确认绑定旧 ID 的精确 `因赛AI Safe Storage` 条目，再以云端签名、公证并 staple 的新身份 DMG 完成登录和三次冷启动；未通过前不得发布 Stable。

### 干净状态人工回归结论

2026-09-09 清理测试机上全部 `insight-desktop*` 用户数据、旧保存状态以及正式/DEV Safe Storage 条目后，重新安装同一 `1.0.0-rc.1` Apple Silicon 本地 Candidate：首次打开进入全新登录流程，没有恢复旧账号或对话；完成登录并反复完全退出、重新启动后，未再出现钥匙串授权框。

登录时新建的 `因赛AI Safe Storage` 条目与认证密文创建时间一致。只读 ACL 复核显示 `/Applications/因赛AI.app (OK)`，designated requirement 为 `com.insight-aigc.desktop`，Team ID 为 `8P39WV82RX`；安装 App 的 Developer ID 签名身份与之相同。由此确认当前身份在干净状态下能够创建并持续访问正确的钥匙串条目，先前弹框来自历史 `com.insight.desktop` ACL 与残留 Profile，而非当前应用每次启动的固有行为。

该结论完成本地 Apple Silicon Safe Storage 预验收，但本地 DMG 未经过 Apple 公证，不能替代 GitHub Actions 最终签名、公证、staple、quarantine 和三次冷启动门禁。

## 现象

使用云端 `Developer ID Application` 签名、公证并 staple 的 DMG 安装后，应用启动会请求访问 `因赛AI Safe Storage`。未选择“始终允许”时，一次启动可能连续请求两次；退出后再次启动仍会重复请求。拒绝授权后登录界面可进入，但登录操作会把本地安全存储失败显示为“认证服务暂时不可用”。

## 根因证据

登录钥匙串中的旧 `因赛AI Safe Storage` 条目早于待验收 DMG 创建。旧条目可能由复用正式产品名和正式 `insight-desktop` 用户数据身份的本地构建创建，也可能仍绑定历史 Bundle ID；必须读取条目 ACL 与当前 App 的 designated requirement 后再归因。后续应用不满足旧访问控制时，macOS 会触发系统授权框。

因此，云端签名、公证本身并不是重复弹框的失败点。已确认的两类首发前污染是本地快速验证复用生产身份，以及正式 Bundle ID 调整后同名条目仍绑定旧 ID。

## 修复与安全处理

代码侧将安全存储拒绝与远端认证失败分离：当 `safeStorage` 不可用或用户拒绝授权时，当前登录只保留在内存，不写入明文 token，也不把成功的远端登录改写为“认证服务暂时不可用”。该会话退出应用后不会恢复，属于失败关闭而不是降低凭据保护。

验证前只删除已确认由内部构建创建或绑定历史 Bundle ID 的精确条目：

```bash
security delete-generic-password -s '因赛AI Safe Storage' "$HOME/Library/Keychains/login.keychain-db"
```

该操作不得扩大为删除 Cookies、整个钥匙串、完整用户 Profile、会话、工作区或插件数据。删除后由云端签名应用重新创建条目。

## 构建与自动检查结果

该 run 的 Release preflight、macOS Apple Silicon 构建以及 Sonoma distribution compatibility 均成功。Apple Silicon job 完成 Developer ID 签名、Apple 公证、staple、完整 bundle 校验、DMG 校验和 artifact 上传；Sonoma job 对下载后的 DMG 只读挂载，并再次执行严格签名、分发策略和 stapling 校验。

由于 target 为 `macos-arm64`，macOS Intel、Windows 和 Publish 均按设计跳过。该 run 只生成 `macos-apple-silicon` Actions artifact，不创建 `v0.1.2-rc.3` GitHub Release。

## 同批次相关修复

- 默认窗口调整为 `1024 × 720`，最小窗口调整为 `800 × 480`，并增加低高度登录布局，避免部分 Windows 屏幕无法操作登录页。
- Candidate 与 Stable 的制品基础名统一，channel 只保留在发布策略和签名 manifest 中。
- workflow 增加 `macos-arm64`、`macos-x64`、`windows-x64` 定向候选 target；定向运行不发布 Release。
- `package.json` 和发布策略推进到 `0.1.2-rc.3`。

## 后续构建规则

1. 日常快速功能验证只运行隔离身份的 `因赛AI Dev`，禁止运行使用正式产品名、App ID/channel 或正式用户数据目录的本地未签名 Candidate。DEV 不访问真实钥匙串，退出后需要重新登录。
2. Safe Storage 行为只能用云端 Developer ID 签名并完成公证的 DMG 验证；本地 DEV 无法证明该路径。Candidate / Stable 的 `com.insight-aigc.desktop`、`因赛AI` 与 Apple Team ID 自首发起视为持久身份，变更前必须单独设计钥匙串迁移。
3. 单平台 Actions artifact 可以关闭对应平台候选门禁，但不得写成完整 Candidate/Stable 发布通过。
4. 发生钥匙串提示时，先比较精确条目的创建时间、签名身份、应用路径和用户数据目录，不先删除用户 Profile，也不通过明文持久化绕过安全存储。
5. 安全存储拒绝、远端认证失败和业务接口失败必须保持不同错误语义。

## Git 状态边界

`v0.1.2-rc.3` 相关的 `ac11928`、`7ce8290`、`4d57b1e`、`ce70b86` 四个提交位于 `codex/v0.1.2-rc.2-integration`，尚未进入 `origin/main`。本次验收成立后仍需通过新的 PR 合入；不得把已合并的 PR #1 当作这四个增量提交的交付证据。
