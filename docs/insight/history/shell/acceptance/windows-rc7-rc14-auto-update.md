> 冻结历史记录：保留旧 Shell 在记录日期的结论和验收状态，不代表当前实现或线上状态。现行说明见 [Insight 文档入口](../../../README.zh.md)。

# rc7 → rc14 单机自动升级验收准备

状态：rc14 手动覆盖升级已由用户确认成功、会话保留。自动升级尚未开始。用户同意复用现有 OSS/CDN 做内测，要求避免主动弹窗并尽量减少对 Mac 的影响。

## 已确定的发布方式（2026-09-20，用户调整为仅 Windows）

- 用户取消全平台构建 run 35493516218，明确要求优先快速验收 Windows，暂不处理 Mac。
- 复用 `https://updates.insight-aigc.com` 和成功构建 run 35491806028 的原始 `windows-x64` 安装器、blockmap、latest.yml，不重新编译。
- 产物源码为 `edeb64316641f08604f0d13be82aa41d68448b63`。签名工作流验证原始构建成功、仓库/工作流身份、版本及可选更新策略，并按原始提交写入 Manifest。
- 发布工具已通过 PR #3 支持 `windows-x64` Candidate 范围；Stable 仍必须包含全平台产物。签名和 OSS OIDC 权限不变。
- Candidate 的 `desktop/candidate/current.json` 跨平台共享；切换到仅 Windows 清单后，Mac 检查会报告缺少目标产物。这是用户本次优先 Windows 验收所接受的临时限制，不能称为全平台可发布。
- 策略保持 `optional`、最低支持版本 `1.0.0-rc.1`，不移动 Stable 指针。
- rc7 已有启动后 15–30 秒和每 6 小时的后台检查。`autoDownload=false`、`autoInstallOnAppQuit=false`，更新窗口由用户操作打开；本次不增加主动弹窗。
- 签名工作流 run 35494042276 成功；stage run 35494113269、promote run 35494212767 均成功。

## 更新源就绪标准

`desktop/releases/v1.0.0-rc.14/` 中包含完整 Windows 产物及签名清单；签名与客户端已有公钥匹配。指针与 Manifest 版本一致，Windows 的 `latest.yml`、安装器和 blockmap 哈希正确。沿用发布工作流验证，不绕过签名、TLS 或覆盖不可变资产。

## 数据保护与执行顺序

1. 条件就绪前保持 rc14，不卸载。
2. 完全退出后备份 `%APPDATA%\insight-desktop` 整个目录。此路径与 `%LOCALAPPDATA%\Programs\insight-desktop` 安装目录不同。 账号及 Harness 数据在 `insight\accounts\<scope>\` 下；工作区外部业务文件保留原位置。备份留在用户电脑，不上传账号数据。
3. 不让旧 Core 直接处理唯一一份 rc14 数据。保留原目录的离线副本，测试可使用单独的新数据目录状态和一条可识别的测试会话；旧会话保持性已有手动升级证据。
4. 更新源确认就绪后，按完整步骤正常卸载 rc14、安装原版 rc7；保留默认更新配置。
5. 启动 rc7，确认测试会话，保持运行，从客户端检查更新。必须明确显示 rc14，再下载、安装、重启。不得手动关闭客户端或杀进程来帮助通过。
6. 保存主安装器与兼容卸载器两份日志；确认 rc14 版本、测试会话、基本对话、无遗留升级进程。区分自动重启与手动启动。
7. 核验 `resources/update-distribution.json` 与发布内容一致；保留备份，完成退出后的数据恢复计划，不覆盖正在写入的数据。

此文是准备清单，不是让用户现在执行卸载的指令。Windows 签名、OSS/CDN 和 Candidate 指针核验完成后，才通知用户执行。

## 发布结果（2026-09-20 14:26 CST）

- OSS `desktop/releases/v1.0.0-rc.14/` 已上传 5 个文件；Windows 安装器 297704834 字节。
- Candidate 指针已从 `1.0.0-rc.12` 更新为 `1.0.0-rc.14`，发布工作流从 OSS 回读确认。Stable 未动。
- GitHub rc14 已发布为 prerelease；原始 Windows 构建不变，签名通过客户端仓库公钥再次验证。
- 发布工具 28 项相关测试及工作流契约校验通过。
- 当前执行环境访问 CDN 的 HTTPS 握手失败，无法声称 CDN 已验证。OSS 发布成功不等于 Windows CDN 下载验收通过；请在目标 Windows 内手动检查并确认 rc14 后继续。
- Windows 真实自动升级尚未验收。当前若仍运行 rc14，需要先备份用户数据并恢复 rc7 测试状态；同版本检查不能验证升级。
