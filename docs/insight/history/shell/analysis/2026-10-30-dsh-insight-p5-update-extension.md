> 冻结历史记录：保留旧 Shell 在记录日期的结论和验收状态，不代表当前实现或线上状态。现行说明见 [Insight 文档入口](../../../README.zh.md)。

# P5 更新执行与发布工具最小接入

> 历史阶段记录：下文的阶段状态、待授权描述和运行结果保留当次背景，不代表当前进度。当前状态见 [P5 收口](2026-10-30-dsh-insight-p5-delivery.md)，下一阶段见 [P6 交接](2026-11-02-dsh-insight-p6-handoff.md)。历史失败保留，不将未复验项记为通过。

> OSS 指针设计以现行发布工具为准：最终采用单发布入口、写前核对和写后回读，不使用 OSS 不支持的原子 CAS；本页早期条件写入设想不再适用。

日期：2026-10-30。状态：待授权现有官方文件和工具依赖变更；Insight 产品内实现可先行开发。

## 目标与取舍

Insight 负责签名版本发现、正式/内测选择和更新窗口，DSH 继续负责唯一的 electron-updater、下载、平台签名、任务收尾和安装。使用 electron-updater 已公开的 custom provider 接口，将已经验签、校验摘要的 metadata 和唯一下载文件直接交给 updater，避免验签后又读取一次可变化的 generic feed。不读取或改写 updater 私有字段，不迁入旧 Shell UpdateManager。

正式版后台检查；更新窗口图标 3 秒五连击后，通过 Main 原生风险确认才检查一次内测。新客户端支持 rc，旧 V2 正式版本兼容保持原语义；rc 使用新命名空间，不写到旧 candidate-v2。当前没有经过验证的原生正式恢复基线，界面不承诺降级到旧 Shell 后数据必然可读。

## 现有官方文件改动范围

| 文件 | 最小改动 |
| --- | --- |
| `apps/desktop/src/update-coordinator.ts` | 接受 Main 内部提供的 custom provider 配置及稳定目标标识；在原有检查锁内设置来源，避免不同来源错误共享检查、已有候选被后台检查重定向；继续保留独立下载/安装授权及现有停机流程 |
| 同文件 | 为 Shell 已有“跳过此版本”提供仅针对当前未下载候选的清除方法；不能清除下载中、已下载或版本不匹配的目标 |
| `apps/desktop/src/main.ts` | 将 Insight 更新占位分支接到产品 provider 和独立更新窗口；现有 schedule 仅调用正式检查，内测只由窗口请求和风险确认触发；保留官方产品分支及退出清理 |
| `apps/desktop/tsdown.config.ts` | 加入 Insight 专用更新窗口和隔离 preload 的构建入口，类似现有 Insight 登录窗口接法 |
| 对应测试、声明及基线记录 | 覆盖目标版本/资产绑定、不同来源并发、取消确认无请求、后台不查内测、preload 主 frame 来源限制和退出清理 |

新增的薄 Electron 适配位于 Desktop 的 `insight-update-*` 文件；版本验签、偏好、五击和页面业务位于 `packages/insight/desktop-integration`。Renderer 不提供 feed URL、文件路径或可信版本声明。初版 Insight 关闭差分下载，先验证完整 payload 的签名摘要绑定；保留 DSH 的完整包下载和安装执行器。

不修改 `update-schedule.ts`、`update-channel.ts`、官方强更模块、官方通用设置或官方发布 workflow。构建相关四文件的修改范围另见 [构建接入](2026-10-30-dsh-insight-p5-build-extension.md)，不在本页扩大签名执行器权限。

## 发布工具依赖

OSS 发布沿用 Shell 的阿里官方 SDK，不自行实现 OSS 鉴权签名。拟在根 `package.json` 的 devDependencies 加入 `ali-oss@6.23.0` 及必要类型包，并更新 `pnpm-lock.yaml`；它们只供发布工具使用，不加入客户端运行时或业务包依赖。发布 job 只安装其使用的轻量工具依赖，不重复构建 DSH workspace。

独立 Insight workflow 先将不可变构建产物存入 GitHub Release；发布 workflow 验证同字节后经现有 OIDC→STS 服务上传 OSS，远端核验完成后再切渠道指针。缺失更新签名私钥或新仓 OIDC 信任时应明确阻止真实投放，离线发布测试可继续。

## 验证要求

签名错误、metadata 与 payload 不一致、跨域/路径替换、同版本换文件、额外文件和候选并发重定向都必须拒绝。真实下载继续以已验签 SHA-512 校验；macOS/Windows 安装继续使用现有平台签名机制。用临时测试密钥和本机随机端口验证，不使用真实私钥制造测试投放。最终实现安排独立安全审查。
