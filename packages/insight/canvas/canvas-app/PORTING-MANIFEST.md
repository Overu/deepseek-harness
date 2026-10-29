# 画布源码迁入清单

本目录是一次性复制的独立 Canvas Web 子项目。构建和运行不读取旧仓库；后续修改只在当前插件仓库进行。

## 来源与范围

- 来源：`insight-web-platform` 的 `master`，提交 `28a2df99725b204f8f8d9fc5e240d7d368525d01`；复制时工作树干净。
- 入口：旧 `src/routes/Canvas.tsx`。按它的静态导入闭包复制画布业务及运行所需的全局样式、声明、字体和静态资源，共 536 个来源文件。
- 路径：旧 `src/**` → `legacy/src/**`，旧 `tailwind.config.js` → `legacy/tailwind.config.js`，旧 `public/**` → 当前 `public/**`。具体文件及来源 SHA-256 见 [SOURCE-FILES.sha256](SOURCE-FILES.sha256)。
- 未复制旧项目的 `node_modules`、构建产物或环境变量文件；新入口不挂载旧登录页和整站路由。源码闭包中仍含由旧画布组件静态引用的登录相关模块，保留它们是为了避免本轮改写业务依赖；它们不构成客户端登录入口。旧 `routeConfig` 的其他页面不进入新路由树。

## 接入差异

- `legacy/src/api/request.ts` 转出 `src/request.ts`。该适配器把旧 API 的 GET、POST、PUT JSON 请求送到同源、受保护的 Host 画布业务路由，保持原有 `code/data/msg` 响应结构；iframe 不读取或保存客户端 Token。Host 只转发固定 Gateway 下的业务路径前缀，详见[传输规范](../docs/protocol.md)。FormData 文件上传和绝对 URL 直连仍未接通。
- 插件子项目的 `.env` 将旧源码的 `VITE_MODEL_PARAMS_URL` 指向同源 `/desktop-canvas/api/model-params`；Host 根据客户端环境读取旧 Web 相同的固定测试/生产模型配置 CDN，不携带 Token。旧源码的 `getModelParams()` 和图像分层节点组件保持原样。此配置不依赖旧项目仓库或其环境变量文件。
- `legacy/src/components/canvasFlow/settings/toolListConfig.tsx` 是另一处有记录的来源文件改动：仅将工具 GIF/MP4 的协议相对 URL 固定为 HTTPS。旧 Web 页面运行在 HTTPS 下，而桌面本地 iframe 运行在 HTTP 下；未修改时资源会解析为 HTTP 并被页面 CSP 拦截。来源哈希清单仍记录复制时的原始文件。
- `src/main.tsx`、`src/canvas-router.tsx`、`src/desktop-canvas.tsx`、`src/auth-context.tsx`、`src/desktop-canvas-header.tsx` 和 `vite.config.ts` 是新接入层。它们提供 `/canvas/$id` 的内存路由、必要 Provider、桌面登录失效状态、旧源码导入别名，以及仅包含分享按钮和画布名称的左上角标题。`legacy/src/components/canvasFlow/index.tsx` 在隐藏旧 Header 时挂载该标题。按钮在名称前、间距 12px，点击后直接调用旧 `canvas/share` 并复制当前环境的 Web 分享链接；社区发布及旧 Header 的会员/积分等入口仍隐藏。Host 在受保护页面注入环境对应的 Web 域名。插件附加的画布 ID 与“加入对话”浮层已移除。节点摘要消息能力保留，供后续其他入口唤起。画布沿用旧业务的实时保存。
- `src/share-link.ts` 校验 Host 注入的测试/生产 Web 域名，使用 `canvas/share` 返回的分享码构造完整 URL。自动复制受 iframe 权限限制时尝试传统复制；如仍失败，标题下保留可选中的链接与再次复制按钮，避免把剪贴板旧内容误报为分享成功。
- 旧页面 HTML 引用的阿里 Iconfont 项目 `4929106` 额外冻结为 `src/iconfont.css` 与 `src/iconfont.woff2`，不在上述旧仓库文件数内。来源样式：`https://at.alicdn.com/t/c/font_4929106_89kb7dh2z3d.css`；字体：同名前缀的 `.woff2`（查询版本 `1766384094316`）。CSS 仅把远程字体 URL 改为相对子项目资源。当前 SHA-256：CSS `21a5401ab598cfa6d75af2f7716d16f9b3a0c7ef9fb057cd25dbeee4a48691f6`，字体 `3ecdfaed9e45c82f95333fb65d1d5cff1941cf8f8f47758aee235f94283d5c0c`。
- 原有节点、连线、`flowStore` 版本队列、`partialUpdate` 和旧业务内部 `saveFlow` 调用未改动。插件额外的保存按钮已移除；测试画布 `2873` 的真实桌面加载、编辑、实时持久化、重开及与旧项目测试环境的数据一致性已由用户人工确认，单次请求响应和版本号尚未独立核对。

## 依赖与封包

- 直接依赖及包声明许可见 [DIRECT-DEPENDENCIES.md](DIRECT-DEPENDENCIES.md)。版本固定为来源锁文件解析版本，完整依赖解析保存在 `pnpm-lock.yaml`。锁文件保留了旧解析图中未安装的条目；独立子项目离线、冻结锁文件安装已通过（实际安装 656 包），不携带旧仓库路径。
- 使用 Node.js >=22.12.0；当前验证构建使用 Node.js 24.4.1、pnpm 11.7.0、Vite 7.1.3。`npm run pack:plugin` 只将 Vite `dist` 加入根插件归档，不包含 `legacy` 源码和子项目 `node_modules`。
- 2026-09-29 `0.3.0-alpha.1` 打包：归档约 14.4 MB，解包约 42.6 MB。主要体积是视频相关的 FFmpeg WASM（约 32.2 MB）；首个编辑保存闭环不需要视频功能，待闭环通过后再评估按需加载或裁剪。
- `@ffmpeg/core` 在已安装包中声明 `GPL-2.0-or-later`。在分发包含其 WASM 的生产安装包前需完成相应许可评估；本清单不代表许可结论。

## 当前验收边界

`0.3.0-alpha.6` 的 Vite 构建、根包 TypeScript 检查、37 项聚焦测试、归档和隔离 Profile 安装/卸载已通过；隔离验证覆盖新模型配置路由的无浏览器会话拒绝行为。测试与生产模型配置 CDN 均返回 HTTP 200，测试配置包含 `GPT Image Layered` 及 `2层`、`1K` 默认参数。真实桌面下测试画布 `2873` 的图渲染、节点增删改查、实时持久化、重开、旧项目测试环境一致性和节点加入对话已由用户在先前版本人工验收；本次底栏修复仍待桌面复验。`0.3.0-alpha.4` 扩大画布业务路径转发、支持 PUT JSON，并移除附加浮层；这些改动及此前的资产列表、工具预览修复待真实桌面回归。`0.3.0-alpha.5` 恢复精简的画布名称与直接分享入口，其真实桌面点击、接口响应和复制结果尚待验证。`partialUpdate`、`saveOrUpdate` 的单次响应与版本号及异常路径仍待单独核对。SSE、生成、素材库和多标签扩展不属于首个闭环。

`0.3.0-alpha.7` 保持客户端环境一致：本地 Dev 为测试服务，正式安装版为生产服务。分享后展示使用服务端分享码生成的完整 Web URL；自动复制受 iframe 权限限制时提供复制回退和可选中的链接。41 项聚焦测试、根包类型检查、Vite 构建、归档及模拟生产环境的隔离 Profile 安装/卸载已通过；正式客户端的生产画布读取和真实分享响应仍待人工验收。

旧画布启动时仍尝试读取固定 CDN 的订阅模型映射；本版 CSP 阻止该直连，旧业务已有捕获并以空映射继续载入。受限模型的自动替换能力因此未验收。子项目 TypeScript 检查仍报 10 项旧工程同路径的既有诊断；新增接入层没有独立诊断。Vite 构建和运行验收不以这些历史诊断消失为前提。
