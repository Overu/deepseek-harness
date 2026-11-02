> 冻结历史记录：保留旧 Shell 在记录日期的结论和验收状态，不代表当前实现或线上状态。现行说明见 [Insight 文档入口](../../../../README.zh.md)。

# Login Agreements Implementation Plan

> 按用户明确要求在本会话直接实施，使用 main。

**Goal:** 登录页可在弹窗阅读两份用户提供的本地协议。

**Architecture:** Agreement 控件独立于 checkbox label；LegalDocumentDialog 使用原生 dialog。可信本地正文以 HTML raw 动态导入，样式限定于正文容器。

**Tech Stack:** React 18、TypeScript、CSS、Vitest、Chromium。

## Global Constraints

- 精确文案：我已阅读软件许可及服务协议和隐私政策。
- 点击协议不改变同意状态，不提交登录，关闭保留表单。
- 保留提供正文，清理办公软件元数据和固定页面布局。
- 保留已有未跟踪的 pnpm-workspace.yaml；不调整版本和发布状态。

## Task 1：内容与弹窗接入

- [x] 清理两份 HTML 至 src/renderer/src/legal，校验全部正文及加粗内容与原始文件一致。
- [x] 新建 LegalDocumentDialog.tsx，按协议 id 动态加载正文，提供加载/错误/重试、Esc/关闭、焦点恢复和正文滚动。
- [x] 修改 LoginView.tsx：两个 type=button 协议入口，checkbox 独立 label，模态状态不改变现有表单状态。
- [x] 修改 styles.css：协议 hover/focus-visible、响应式弹窗、正文表格与可读排版。

## Task 2：验证与交付

- [x] Vitest 校验两份 HTML 仅含允许标签、无外部资源和执行内容、标题日期和章节完整。
- [x] npm run typecheck；npm test -- test/login-agreements.test.ts test/auth-form-model.test.ts；renderer 生产构建。
- [x] 浏览器验证两协议正文、hover、关闭/Esc、焦点恢复、表单/checkbox 保留、窄窗口和生产 CSP。
- [x] 复查最终 diff，记录手动验收与内容替换步骤。
