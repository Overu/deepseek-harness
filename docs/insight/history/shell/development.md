> 冻结历史记录：保留旧 Shell 在记录日期的结论和验收状态，不代表当前实现或线上状态。现行说明见 [Insight 文档入口](../../README.zh.md)。

# 因赛AI Desktop 开发说明

## 本地启动与验证

```bash
npm ci
npm run dev
npm test
npm run typecheck
npm run build
```

`dev` 会准备由 `core-runtime.lock.json` 锁定的 Core Runtime、运行时清单和默认插件 Profile；`build` 准备 Runtime、清单与集成，默认 Profile 由打包命令的 `prepare:bundled-profile` 步骤准备。开发数据与生产数据使用不同的应用目录；不要并行运行多个工作树来验证同一个 Profile。

当前 `npm run dev` 是完整准备路径；已实现的 `npm run dev:local -- /absolute/path/to/local-runtime` 校验并复制指定本地 Runtime，构建集成、刷新DEV Profile并启动Electron，不修改正式Runtime锁。为避免频繁 Core、插件和 Shell 联合开发重复发布 Runtime 或重建 Profile，项目已批准 [本地组合开发架构](local-composed-development.md)。目标接口按修改层提供 `dev:shell`、`dev:core` 和 `dev:plugin` 三类入口；这些 script 在真正加入 `package.json` 并完成文档验收前属于待实现设计，不能作为当前可执行命令。

## 打包

```bash
npm run package:mac:arm64
npm run package:mac:x64
npm run package:win
```

安装包必须在目标操作系统和架构上构建。GitHub Actions 的 `windows-2022` runner 负责 Windows x64；macOS 正式包还需要签名和公证。构建完成后，检查包内的 `Resources/runtime/runtime.json`、默认 Profile 和目标平台 Node.js，再进行手工启动验证。

## 变更约束

Shell 只修改宿主职责。需要把 Harness 内部行为正式纳入客户端时，先在 `insight-harness-core` 中发布新的 Runtime 制品，再有意更新 Shell 锁定版本；不要把 Core 的包、补丁或 `node_modules` 回填为 Shell 依赖。

本地组合开发允许在可删除的 DEV Runtime 中临时投影指定 Core package 的构建产物，以便发布前快速验证；该覆盖不改变正式所有权。正式 build、目录应用和安装包仍必须回到锁定 Runtime，拒绝源码软链接、本机绝对路径和 DEV 标记。

## 窗口装饰与平台隔离

- Windows 的 `autoHideMenuBar`、`setMenu(null)`、`titleBarStyle` 和 `titleBarOverlay` 必须放在明确的 `process.platform === 'win32'` 分支；macOS 的全局菜单和原生交通灯不能随 Windows 窗口修复被关闭或覆盖。
- 禁止显示菜单的 Windows 二级窗口必须同时设置隐藏菜单选项和 `setMenu(null)`；只设置 `autoHideMenuBar` 会允许用户按 Alt 再次显示菜单。
- Windows 使用透明标题栏覆盖层前，必须确认 WebContents 的 Caption Controls 区域没有可见控件；无法证明时使用随明暗主题切换的不透明覆盖层，避免原生与页面控件重叠。
- 窗口尺寸和装饰发生变化时，测试必须分别覆盖 `win32` 与 `darwin` 配置；进入候选发布前还要在两个目标系统分别检查菜单、窗口控制按钮、系统缩放和长文案布局。
