> 冻结历史记录：保留旧 Shell 在记录日期的结论和验收状态，不代表当前实现或线上状态。现行说明见 [Insight 文档入口](../../../README.zh.md)。

# Insight P3：桌面权限矩阵设计

日期：2026-10-29。状态：用户已批准按矩阵实施；Insight 专用处理器已接入，原生权限交互仍待验证。官方产品继续使用原处理器。

## 当前证据

DSH `apps/desktop/src/microphone-permissions.ts` 对 `media` 以外的权限直接允许；媒体仅允许当前主窗口的应用主 frame 请求音频，macOS 继续由操作系统授权。旧 Shell `src/main/security-policy.ts` 只允许本地工作区主 frame 的 `clipboard-sanitized-write`，以及同一工作区来源的 fullscreen；其他权限拒绝。

Canvas 当前源码确有复制文字、分享链接和视频全屏操作；没有找到摄像头、录音、定位或屏幕捕获调用。文件上传使用普通文件选择器，不需要授予网页 `fileSystem` 权限。上述是代码路径证据，不等同于完整实物权限验收。

## 请求者识别

权限检查与请求处理器共用一个决策函数。首先要求 WebContents 是当前 Insight 主工作区窗口，窗口未销毁，其主文档是 `dsh-app://app/` 或 `/index.html`；其他窗口和来源先拒绝。登录页 `dsh-app://shell/insight-login.html` 不申请这些权限。

应用主 frame 必须同时满足 `isMainFrame` 和应用文档 URL。Canvas 子 frame 必须不是主 frame，`requestingUrl` 的 scheme、host 和 pathname 精确为 `dsh-app://app/desktop-canvas/view`，且 `id`、`viewId` 满足现有 Canvas 标识校验；存在时同时核对浏览器给出的 requesting/security/embedding origin。必需的请求来源缺失、冲突、opaque origin 或不满足对应规则时拒绝。不能信任页面自报 Origin、消息字段或普通请求头。

Electron 非媒体 permission request 回调不携带 embedding/security origin，不能把此前 check 的拒绝当成 request 的授权依据。两个回调均即时读取当前 WebContents 的原生 frame 树：完整 requestingUrl 必须唯一匹配一个存活、非 opaque 的 Canvas frame，其父 frameTreeNodeId 必须等于当前应用主 frame 的 ID。找不到、重复、嵌套、销毁、脱离或来源冲突均拒绝；可选的 origin 字段一旦存在仍需精确匹配。字段缺失时依赖的是原生 frame 所有权证据，不是页面来源声明或缓存的检查结果。

Electron 的 permission 回调没有独立 frame routing ID 或可靠用户手势字段；该方案不宣称以回调验证某次点击或某个唯一 Canvas 实例。它信任当前窗口中由本地固定路由返回的 Canvas 页面。浏览器本身的用户激活、Permissions Policy 和系统权限限制继续有效，不能由此绕过。若真实测试表明 Chromium 不提供判定所需字段，应先报告并调整设计，不能静默扩大匹配范围。

## 建议矩阵

| 权限/操作 | 工作区主 frame | 当前主窗口内本地 Canvas frame | 登录/恢复页、外部来源、其他 frame/窗口 |
|---|---|---|---|
| `media`，仅音频 | 保留官方麦克风规则；macOS 仍需 OS 授权 | 拒绝 | 拒绝 |
| `media` 视频、混合或未知类型 | 拒绝 | 拒绝 | 拒绝 |
| `clipboard-sanitized-write` | 允许，承接复制功能 | 允许，承接文本、参数、分享链接复制 | 拒绝 |
| `fullscreen` | 允许 | 允许，承接视频预览全屏 | 拒绝 |
| `clipboard-read` / `deprecated-sync-clipboard-read` | 拒绝网页权限；原生用户主动粘贴路径保留 | 拒绝网页权限；上传与粘贴在实物测试核对 | 拒绝 |
| `automatic-fullscreen` / `pointerLock` / `keyboardLock` | 拒绝 | 拒绝 | 拒绝 |
| 位置、通知、屏幕捕获、摄像头、设备、网页文件系统等其余权限 | 拒绝 | 拒绝 | 拒绝 |
| 未知及未来新增权限 | 拒绝 | 拒绝 | 拒绝 |

原生菜单全屏由 Electron role 执行，和网页 `fullscreen` 权限是不同入口。打开手册和外部链接仍走现有受控导航处理器，不扩大网页 `openExternal` 权限。

如浏览器的 iframe Permissions Policy 阻止已批准的复制/全屏，只在 CanvasTab 的该固定 iframe 上增加 `allow="clipboard-write; fullscreen"` 及所需全屏属性，不允许剪贴板读取、设备或其他权限，不改变 webSecurity、sandbox、CSP 或整个窗口的权限。

## 最小实施范围

- 新建 `apps/desktop/src/insight-permissions.ts`：纯决策函数与 Insight session adapter，使用 Electron 当前版本的实际回调字段；不复制官方麦克风实现。
- `apps/desktop/src/main.ts`：仅 Insight 分支调用新 adapter；官方产品继续调用原 `installMicrophonePermissions`。如为复用 OS 音频授权需要提取官方函数，另列精确 diff，不直接扩大本次授权。
- `packages/insight/canvas/src/client/CanvasTab.tsx`：仅在上述实测确有需要时声明 iframe 复制/全屏权限。
- 所属测试、Desktop/Canvas README 与 Insight 基线修改记录同步；不改旧 Shell 的现役安全处理器。

## 验收与失败处理

矩阵逐项覆盖 permission check 与 permission request 两入口：正确 owner、错误 owner、销毁窗口、正确主 frame、Canvas 路由、错误 path/id/viewId、外部/opaque origin、字段缺失/冲突、混合媒体以及未知权限。明确测试所有拒绝路径均不调用 macOS 授权 API，macOS 授权拒绝或异常不能放行。

原生 Electron 验证文本复制、Canvas 参数/分享链接复制、视频进出全屏、普通文件上传和主窗口录音；拒绝其他 frame 的录音及外部页面权限。登录、退出再登录后，旧窗口不能继续申请权限。Windows/macOS 的 OS 授权差异分别记录，不用本机结果替代平台验收。

没有业务需求证明的新权限一律保持拒绝，并给当前操作安全、简短的失败反馈；不因某个 UI 操作失败而改为全局允许。权限策略不是 Host 插件沙箱：DSH 的受信 Node 插件仍拥有其既有系统能力。
