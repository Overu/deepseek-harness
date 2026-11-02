> 冻结历史记录：保留旧 Shell 在记录日期的结论和验收状态，不代表当前实现或线上状态。现行说明见 [Insight 文档入口](../../../README.zh.md)。

# RC2 自动下载缺少 `app-update.yml`

## 结论

2026-09-10，已安装的 `1.0.0-rc.1` 能从 OSS/CDN 发现 `1.0.0-rc.2`，但点击“下载更新”后失败：

```text
ENOENT: no such file or directory, open '/Applications/因赛AI.app/Contents/Resources/app-update.yml'
```

这不是 OSS、CDN、Manifest、YAML 或安装包下载地址缺失。RC1 和 RC2 的 Candidate 构建配置将 `publish` 设为 `null`，导致 `electron-builder` 没有把 `app-update.yml` 写入应用资源目录。

`electron-updater` 在检查阶段使用 Shell 动态设置的 OSS Generic Provider，因此仍能发现新版本；调用 `downloadUpdate()` 时才读取包内配置中的 `updaterCacheDirName`，从而在本地文件缺失处失败。

## 修复

- Stable 与 Candidate 的 builder 元数据统一声明 OSS Generic Provider：`https://updates.insight-aigc.com/desktop/`。
- 所有打包命令继续使用 `--publish never`；该配置只生成客户端所需的 `app-update.yml`，不会让 `electron-builder` 上传或公开资产。
- 发布工作流在 macOS arm64、macOS x64 和 Windows x64 的真实打包目录中校验 `app-update.yml`：
  - `provider: generic`
  - `url: https://updates.insight-aigc.com/desktop/`
  - `updaterCacheDirName: insight-desktop-updater`
- 自动更新发现和下载仍由已签名 Manifest 与不可变 OSS 版本目录控制；客户端不使用 GitHub Releases 作为更新源。

本地使用真实 macOS ZIP target 验证后，YAML 已进入 `.app` 和 ZIP，并被 `_CodeSignature/CodeResources` 的 SHA-256 资源封印覆盖。GitHub Actions 仍必须重新完成签名、公证、stapling 和 Sonoma 分发门禁。

## 已安装版本的恢复边界

无法远程向已签名、已安装的 RC1/RC2 应用包补写 `app-update.yml`，也不得修改或覆盖已有 RC tag 和资产。因此必须发布新的 `1.0.0-rc.3`：

1. RC1/RC2 检测到 RC3 后，自动下载仍可能显示同一错误；用户点击错误页已有的“下载完整安装包”，从同一份已验证 Manifest 对应的 OSS 版本目录下载 RC3 DMG/EXE 并覆盖安装。
2. RC3 包含正确的 `app-update.yml`；从 RC3 开始，后续 RC 或 Stable 才能验收应用内直接下载、校验、安装和重启。
3. 首发验收记录必须把这一次整包桥接与后续一次自动升级分开记录，不能把 RC1→RC2 写成自动更新已通过。

## 防回归门禁

- 单元测试锁定 OSS Generic publish 元数据，并继续锁定所有 `package:*` 命令的 `--publish never`。
- `verify-packaged-update-config.mjs` 对缺文件、GitHub Provider、错误 URL 和错误缓存目录失败关闭。
- 原生发布 job 只有在真实包内配置通过后才进入 Draft 汇总。
