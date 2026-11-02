> 冻结历史记录：保留旧 Shell 在记录日期的结论和验收状态，不代表当前实现或线上状态。现行说明见 [Insight 文档入口](../../../README.zh.md)。

# 桌面客户端 OSS 更新分发设计

## 状态与目标

本文记录 2026-09-08 已批准并已完成代码实现的首发更新方案。当前尚未向用户发布任何桌面客户端，因此不设计 GitHub 旧客户端迁移、桥接版本或历史协议兼容。

首个公开版本发布前，仍必须完成真实 GitHub Draft、OSS/CDN 上传和三平台安装验收。安装包 workflow 只创建 Draft；独立发布 workflow 通过 GitHub OIDC 与测试 Gateway 获取目录级 STS，客户端更新的唯一生效点仍是发布器最后提交的渠道指针。发布身份的后续决策以[桌面更新 STS 发布设计](2026-09-09-desktop-update-sts-publishing-design.md)为准。

目标不是构建复杂的更新平台，而是建立一条足够小且不会把已安装用户困住的更新链：

- 正常情况可在客户端内检查、下载并安装整包更新；
- 差分下载失败时由 `electron-updater` 回退到整包下载；
- 可信 Manifest 已解析但自动下载失败时，客户端提供“下载完整安装包”入口，直接打开同一不可变版本目录内的 DMG 或 NSIS；
- `updates.insight-aigc.com` 保持不变时，其背后的 OSS Bucket 或 CDN 供应商可以迁移而不要求已安装用户重新下载客户端。

本文扩展[桌面客户端更新与上游管理方案](2026-09-03-desktop-update-and-upstream-policy-design.md)。签名、公证、应用数据保留与构建门禁继续遵守[客户端构建运行手册](../client-build-runbook.md)。发布身份与 STS 接入已在 2026-09-09 的补充设计和执行计划中固化。

## 决策摘要

- 阿里云 OSS + CDN 是 Candidate 和 Stable 从首个公开版本起唯一的客户端自动更新源。
- 生产客户端只内置一个自有 HTTPS 更新域名；域名背后的 OSS、CDN 和源站可以替换。
- GitHub Releases 只保存同一批制品的公开镜像、构建记录与人工灾备下载，不参与客户端自动选源或自动回退。
- 每个平台只构建一次。OSS 与 GitHub 发布完全相同的已验证字节，禁止分别重建安装包。
- 版本目录不可变；每个渠道只有 `current.json` 一个可变提交点。
- `latest-mac.yml`、`latest.yml`、产品 Manifest、签名、安装包和 blockmap 全部放在不可变版本目录中，不在渠道目录维护第二组可变 YAML。
- 客户端先验证 Ed25519 产品 Manifest，再把 `electron-updater` Generic Provider 指向该 Manifest 对应的不可变版本目录。
- 客户端继续核对产品 Manifest 版本、更新 YAML 版本和实际下载文件摘要；Windows 未签名阶段不能移除这层产品签名。
- 不实现客户端内 OSS/GitHub 自动双源切换、自研断点下载器、增量补丁系统、历史版本列表或自动降级。

## 最小更新模型

```text
固定自有域名
https://updates.insight-aigc.com/desktop/
          |
          +-- stable/current.json
          +-- candidate/current.json
                         |
                         v
          releases/vX.Y.Z/  （不可变）
             ├── insight-update.json
             ├── insight-update.json.sig
             ├── latest-mac.yml
             ├── latest.yml
             ├── DMG / ZIP / NSIS
             └── blockmap
```

客户端不列举 OSS 对象，也不根据最后修改时间猜测最新版本。更新检查只执行以下路径：

1. 根据自身渠道读取一个固定的 `current.json`。
2. 校验指针的 Schema、渠道和严格语义版本。
3. 使用应用内置的固定 HTTPS Origin 和版本号确定性生成 `releases/v<version>/`，下载其中的 `insight-update.json` 与 `insight-update.json.sig`。
4. 使用应用内置 Ed25519 公钥验证 Manifest 原始字节，并校验渠道、版本、平台、架构、兼容范围和制品摘要。
5. 将 `electron-updater` Generic Provider 设置为同一不可变版本目录。
6. 读取该目录的 `latest-mac.yml` 或 `latest.yml`，并要求其版本与已验证 Manifest 完全一致。
7. 下载更新；差分不可用时允许 `electron-updater` 自动回退整包。
8. 下载后重新计算实际文件大小和 SHA-512，只有与 Manifest 一致才允许安装。
9. Manifest 已验证后，根据目标平台选择同目录的 DMG 或 NSIS 作为人工整包地址；渲染进程只获得“是否可用”，不获得或提交 URL。

`current.json` 只是发现指针，不是信任根。指针被篡改时，客户端最多读取不到更新或指向一个仍通过签名校验的旧版本，不能安装未签名的新字节。

强制更新策略从本地可信缓存恢复时，客户端使用已签名 Manifest 的渠道和版本按同一规则重建版本目录，并在再次调用平台更新器前配置 Generic Provider；不能依赖上一次进程内存中的 URL。

## 产物矩阵

| 产物 | 用途 | 要求 |
| --- | --- | --- |
| macOS arm64/x64 DMG | 人工安装、故障兜底 | Developer ID 签名、公证、staple；客户端只选择适配当前架构的 DMG。 |
| macOS arm64/x64 ZIP | macOS 自动更新 | `electron-updater` 必需，不作为普通下载入口展示。 |
| macOS ZIP blockmap | 差分下载 | 与 ZIP 同目录；生成或验证失败时阻止发布。 |
| Windows x64 NSIS EXE | 人工安装、自动更新 | 当前允许未签名，但必须经过产品 Manifest 验证。 |
| Windows EXE blockmap | 差分下载 | 与安装器同目录。 |
| `latest-mac.yml` / `latest.yml` | Generic Provider 元数据 | 存放在版本目录，引用同目录内带版本号的确切制品。 |
| `insight-update.json` | 产品发布策略与制品摘要 | 使用规范化 UTF-8 JSON。 |
| `insight-update.json.sig` | 产品发布身份 | Ed25519 分离签名。 |

所有对外文件名包含版本号；修复任何已生成制品都必须创建新版本，不能覆盖同版本对象或 GitHub Release 资产。

## OSS 对象布局

```text
desktop/
├── stable/
│   └── current.json
├── candidate/
│   └── current.json
└── releases/
    ├── v0.1.2-rc.1/
    │   ├── insight-update.json
    │   ├── insight-update.json.sig
    │   ├── latest-mac.yml
    │   ├── latest.yml
    │   ├── insight-0.1.2-rc.1-mac-arm64.dmg
    │   ├── insight-0.1.2-rc.1-mac-arm64.zip
    │   ├── insight-0.1.2-rc.1-mac-arm64.zip.blockmap
    │   ├── insight-0.1.2-rc.1-mac-x64.dmg
    │   ├── insight-0.1.2-rc.1-mac-x64.zip
    │   ├── insight-0.1.2-rc.1-mac-x64.zip.blockmap
    │   ├── insight-0.1.2-rc.1-windows-x64-setup.exe
    │   └── insight-0.1.2-rc.1-windows-x64-setup.exe.blockmap
    └── v0.1.2/
        └── ...
```

版本目录必须满足：

- `releases/vX.Y.Z/` 或 `releases/vX.Y.Z-rc.N/` 一经上传即不可变；目标前缀存在时，只允许在远端文件完整且全部摘要与本次已签名发布完全一致时幂等复用，任何缺失或差异都失败且不得覆盖。
- 版本 YAML 只使用相对文件名引用同目录制品，不跨版本或跨 Origin。
- 不依赖 OSS 目录语义、对象排序或列表接口。

渠道指针最小结构为：

```json
{
  "schemaVersion": 1,
  "channel": "stable",
  "version": "0.1.2"
}
```

`current.json` 不接受 URL 字段。生产配置中的更新 Origin 必须是无用户名/密码、查询参数或片段的固定 HTTPS Origin；客户端只在其固定 `/desktop/` 根下拼接已校验的渠道和版本。网络请求发生重定向时，最终 URL 仍必须保持同一 Origin 和预期路径。

## 缓存与网络规则

- 版本目录：`Cache-Control: public,max-age=31536000,immutable`。
- `current.json`：`Cache-Control: public,max-age=60,must-revalidate`。
- JSON/YAML 使用明确的 UTF-8 Content-Type；DMG、ZIP、EXE、blockmap 和签名使用对应二进制 Content-Type。DMG/EXE 设置 `Content-Disposition: attachment` 和原始安全文件名，保证系统浏览器执行下载而不是页面导航。
- 更新域名支持 HTTPS、HEAD、Range、正确的 `Content-Length` 和断点续传。
- “手动检查更新”绕过客户端本地结果缓存并要求网络重新验证；无需为此维护多份渠道元数据。
- 发布正确性只依赖 `current.json` 的 60 秒 TTL，不依赖 CDN 刷新 API。若基础设施已有刷新能力，可把它作为加速步骤；版本对象不能刷新为不同字节。
- Electron 主进程直接请求时不依赖浏览器 CORS，也不能启用会拦截无 Referer 请求的防盗链规则。

## 原子发布流程

```text
build once
   -> verify/sign
   -> create GitHub Draft with identical bytes
   -> OIDC/STS publisher downloads and verifies Draft assets
   -> upload immutable OSS version directory
   -> verify through final CDN domain
   -> pre-promotion exact-installer smoke
   -> publish GitHub Release
   -> update channel/current.json last
   -> post-release canary
```

具体顺序：

1. 预检 tag、渠道、版本、发布策略、Core Runtime 锁、工作流和脚本语法。
2. 三个平台构建一次并完成当前 Runbook 要求的签名、公证、格式、blockmap 和 YAML 验证。
3. 汇总制品，生成并签名产品 Manifest，再执行完整资产验证。
4. 创建 GitHub Draft Release，上传相同字节并核对摘要；重跑时只允许复用资产完整且摘要完全一致的 Draft。
5. 独立 `Publish desktop updates` workflow 使用 GitHub Token 下载 Draft 全部资产，重新执行产品签名、文件集、版本和摘要验证；不得同步 Git tag 自动生成的源码压缩包。
6. 发布 workflow 使用 GitHub OIDC 向固定测试 Gateway 以 `{}` 换取目录级 OSS STS。版本前缀不存在则上传；已存在时只有完整文件集与本次摘要完全一致才幂等复用，任何缺失或差异都失败且不覆盖。
7. 上传完整不可变版本目录，并从 `https://updates.insight-aigc.com` 验证大小、摘要、缓存和 Range。
8. 在渠道推广前完成确切安装包验收；Stable 还必须已有 Candidate N→N+1 和同源整包兜底证据。
9. 人工确认后公开 GitHub Release。
10. STS 发布器直接从 OSS 读取权威渠道指针，确认当前版本严格小于新版本。
11. 最后一次性上传新的 `stable/current.json` 或 `candidate/current.json`，这是唯一生效点。
12. 等待或确认指针在约定 TTL 内收敛，从外部网络做检查、下载、校验、安装 canary，并保存证据；Candidate 在此时完成 N→N+1，失败后发布更高 RC，不自动降级。可选缓存刷新失败不回写版本对象。

任何推广前失败都不修改 `current.json`。推广后 canary 失败时暂停下一次发布并保留诊断入口，不覆盖版本对象，也不自动把指针改回低版本；回退行为必须经过明确决策，避免与客户端禁止降级规则冲突。

## 身份与权限

首版 OSS 写入由独立 GitHub Actions 发布 workflow 执行。它使用 GitHub OIDC 向 Insight Gateway 换取短期、目录级 STS；长期 AccessKey 不进入 GitHub Secrets、仓库、客户端、构建产物、命令参数或日志。Gateway 临时策略只允许读写 `insight-desktop-updates` Bucket 的 `desktop/` 前缀，不允许删除 Bucket、修改 ACL 或访问其他业务 Bucket。

发布 workflow 只从 `main` 手动运行，固定校验仓库 ID、workflow event、ref、Bucket、Region、endpoint 和更新 Origin。200～600 MB 资产使用普通 `PutObject`；每个文件前刷新临期 STS，令牌失效时整文件重试一次。详细契约见[桌面更新 STS 发布设计](2026-09-09-desktop-update-sts-publishing-design.md)。

## 客户端故障兜底

更新窗口在可信 Manifest 已解析后保存当前平台的人工安装包定位信息。自动下载失败时，除“重试”外显示“下载完整安装包”，由主进程在固定 Origin 和已验证版本目录下确定性生成 DMG 或 NSIS URL，再交给系统浏览器下载。IPC 不接收 URL，Manifest 的文件名必须是安全 basename。

若 `current.json`、Manifest 或签名尚未成功取得，客户端没有足够的可信信息判断“最新安装包”地址，只显示重试；不能为了始终展示按钮而信任未验签指针。若整个更新 Origin 不可用，同源整包也不可用，这是只依赖一个域名的明确可用性边界。

GitHub Release 仍保留相同字节供人工运维灾备，但客户端不实现自动 OSS/GitHub 双源回退，也不把 GitHub URL 暴露为产品内协议。

## 首发验收顺序

由于尚无已安装用户，首发不需要桥接版本：

1. 在测试前缀和本地 HTTP 测试 Origin 完成签名、缓存、重定向、截断、版本不一致和摘要错误测试；不在产品运行时保留模拟更新入口。
2. 使用当前仓库版本暂存 `0.1.2-rc.1` Candidate，在三种目标平台/架构做干净安装后推广 Candidate 指针。
3. 暂存并验收 `0.1.2-rc.2` 确切安装包，推广 Candidate 指针后立即从 rc.1 真实完成检查、下载、安装和重启，验证数据保留。
4. 使用最终 `0.1.2` Stable 的确切制品完成干净安装和覆盖安装。
5. 只有上述结果和同源整包下载兜底都通过，才更新 `stable/current.json` 并把首个 Stable 对外开放。

## 验收条件

- Candidate、Stable、Development 严格隔离；Development 不访问生产更新域名。
- macOS arm64、macOS x64 和 Windows x64 都能从不可变版本目录完成更新。
- 产品 Manifest、平台 YAML 和实际文件的版本、大小、SHA-512 一致。
- 差分失败可回退整包；签名、摘要、渠道、版本或 Origin 不一致时失败关闭。
- 断网、403/404/5xx、旧缓存、重定向、截断下载不会破坏当前可用版本。
- 可信 Manifest 已解析后，自动下载失败时可以从同一不可变版本目录下载 DMG/EXE 并完成覆盖安装。
- 更新后账号、会话、设置、工作区、用户资产和用户安装插件保持不变。
- OSS 与 GitHub 对应制品摘要完全一致；GitHub 不参与客户端自动更新决策。
- 发布中途失败时旧 `current.json` 保持有效；同版本重跑不能覆盖已有版本目录。
- 发布记录包含 tag、渠道、Shell/Core 身份、workflow、GitHub Draft/Release、OSS 前缀、指针内容、制品摘要和冒烟结果。

## 明确延后

- GitHub 旧客户端迁移、桥接版和更新协议 v2；首发尚无存量用户。
- 客户端自动双源切换、多 CDN 调度、自研下载器和自研差分补丁。
- 历史版本选择、自动降级、复杂回滚编排和跨版本数据库迁移平台。
- 多 Bucket、WORM、对象级 CAS 和自动生命周期清理；先保留所有首发 Stable 与最近 Candidate。
- 独立 Core Runtime 或必需插件在线更新；继续随完整客户端更新。
- Linux 包与 Windows Authenticode；Windows 签名前保留产品 Manifest 信任链。
- 基于遥测自动删除 Intel 构建；在有真实安装数据前继续输出 x64。
- multipart/checkpoint、断点续传与跨 workflow run 恢复；只有真实 RC 证明普通 `PutObject` 不可靠时再增加。

## 实施前外部前置

客户端编码使用已确定的 `https://updates.insight-aigc.com`，不依赖 Bucket Region、写入身份或外部下载页。首个生产 Candidate 推广前，必须确认私有 Bucket `insight-desktop-updates`、CDN HTTPS/Range/缓存规则、测试 Gateway 的目录级 STS 契约和 GitHub `desktop-release` Environment 均可用。缺少生产分发条件时不得写 `current.json`，也不得退回临时 Bucket URL 或 GitHub 自动更新源。

最低操作系统版本在首发时作为固定发布策略记录。只有未来 Electron 升级确实抬高最低系统要求时，才新增兼容分流设计；本期不提前构建多代更新服务。

## 参考资料

- [electron-builder Auto Update](https://www.electron.build/docs/features/auto-update/)
- [electron-builder macOS targets](https://www.electron.build/mac/)
- [OSS SDK PutObject](https://help.aliyun.com/zh/oss/developer-reference/simple-upload-12)
- [OSS 基于 RAM Policy 的目录级访问控制](https://help.aliyun.com/en/oss/user-guide/access-control-base-on-ram-policy)
- [CDN 回源私有 OSS Bucket](https://help.aliyun.com/en/cdn/user-guide/grant-alibaba-cloud-cdn-access-permissions-on-private-oss-buckets)
- [OSS CDN 加速](https://help.aliyun.com/en/oss/user-guide/cdn-acceleration)
