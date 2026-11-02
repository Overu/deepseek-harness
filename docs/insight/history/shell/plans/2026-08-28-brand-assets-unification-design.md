> 冻结历史记录：保留旧 Shell 在记录日期的结论和验收状态，不代表当前实现或线上状态。现行说明见 [Insight 文档入口](../../../README.zh.md)。

# 因赛AI品牌资产统一设计

## 目标

客户端只展示因赛AI品牌，不再携带或显示旧鲸鱼图标、DeepSeek 产品标识或重复的明暗主题 Logo。品牌资产必须有明确源文件、可重复生成，并继续支持 macOS、Windows、浅色主题和暗色主题。

## 范围

本次变更覆盖桌面应用图标、安装包图标、启动页、登录页、Harness 侧边栏、插件恢复页和安全模式页。它删除 Shell 中无运行引用的旧 Logo 与 loader GIF，并更新打包约束与测试。

`@deepseek-ai/*` Runtime 包名、Runtime 内部技术标识、历史技术文档和测试夹具不属于产品视觉展示，不在本次重命名范围。Shell 仍通过 `core-runtime.lock.json` 锁定 Core Runtime；品牌清理不得改变 Runtime 集成方式。

## 品牌源文件

仓库只维护两个可编辑的 SVG 源文件：

- `build/brand-mark.svg`：用户提供的纯图形标，保持透明背景和白色路径，供界面按场景着色或合成。
- `build/brand-wordmark.svg`：图形标与“因赛AI”文字的横向组合，用于启动页等宽幅位置。

图形标与文字标使用同一几何图形。主题差异由 CSS 滤镜或页面背景处理，不再维护 `logo-light.*` 和 `logo-dark.*` 两组内容重复的文件。

## 派生资源

`build/app-icon.png` 是系统图标的 1024×1024 位图源。它使用因赛AI主蓝色圆角底板、居中的白色图形标和适合系统缩略尺寸的安全留白。`scripts/generate-app-icons.mjs` 从它继续生成：

- `build/icon.icns`，供 macOS 应用和 DMG 使用；
- `build/icon.ico`，供 Windows 可执行文件、安装器和快捷方式使用。

这些格式是系统容器，不是独立品牌源。生成脚本必须拒绝缺失或尺寸错误的 `app-icon.png`，避免安装包回退到 Electron 默认图标。

## 使用规则

- 启动页使用 `brand-wordmark.svg`。浅色背景将白色文字标转换为深色显示，暗色背景保持白色显示。
- 登录页和 Harness 侧边栏使用 `brand-mark.svg` 或由它生成的界面资源；侧边栏不再内联旧 `app-icon.png`。
- 插件恢复页、安全模式页、窗口图标、Dock、任务栏和系统通知使用 `app-icon.png` 或安装包内对应的 `icon.png`。
- `dsh-loader.gif`、`dsh-loader-dark.gif`、`logo-light.png`、`logo-dark.png`、`logo-light.svg` 和旧 `build/icon.png` 没有当前运行引用，直接删除并从 `extraResources` 移除。若以后需要加载动画，应使用 CSS 驱动 `brand-mark.svg`，不恢复旧 GIF 命名或旧图形。
- Core Runtime 自带但未在产品界面展示的依赖资产不复制到 Shell 品牌目录。若未来某个 Core 页面实际显示上游 Logo，应通过公开 UI 插槽覆盖，不修改下载后的 Runtime 制品。

## 构建约束

品牌源文件随 Shell 仓库版本化，打包不访问外部 Logo URL。`electron-builder` 只复制实际运行需要的品牌文件；测试必须验证新资源被打包、旧资源不再列入 `extraResources`，并验证 macOS 与 Windows 图标配置仍指向生成文件。

品牌更换不得触发 Core Runtime 发布。它是 Shell 自有产品层能力，可独立完成本地测试与打包验证。

## 验证曲线

自动验证按成本递增执行：

1. 检查 SVG 可解析、位图尺寸正确、派生 ICNS/ICO 可生成。
2. 运行品牌与发布配置的聚焦测试。
3. 运行 Shell 全量测试和 `npm run build:prepared`。
4. 启动本地 DEV，由用户人工检查登录页、启动页、明暗主题、侧边栏和恢复页面。
5. 人工验收通过后再构建本地 DMG；本次不以 GitHub Actions 作为首轮验证环境。

## 人工验收标准

- macOS 应用程序目录、Dock、窗口切换器和 DMG 中只显示新图形标，没有旧鲸鱼图标。
- 启动页显示横向“图形标 + 因赛AI”，浅色和暗色背景都清晰可见，标志不拉伸、不裁切。
- 未登录页面显示新图形标；登录流程、会话恢复和退出不受影响。
- 登录后侧边栏显示新图形标和“因赛AI”，展开与折叠状态都没有旧 DeepSeek/Harness 产品 Logo。
- 插件恢复页和安全模式页显示新应用图标。
- 应用内不再出现旧 loader GIF；加载过程没有缺图、破图或空白占位。
- Windows 安装器图标由后续 Windows Runner 验证，本轮本机验收不阻塞代码完成。
