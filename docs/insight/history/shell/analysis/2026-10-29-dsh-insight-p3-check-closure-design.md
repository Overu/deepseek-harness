> 冻结历史记录：保留旧 Shell 在记录日期的结论和验收状态，不代表当前实现或线上状态。现行说明见 [Insight 文档入口](../../../README.zh.md)。

# P3 检查收口的两项待确认配置

日期：2026-10-29。状态：建议方案，尚未修改这两项 DSH 根配置；原生界面验收已按用户要求延期。

## 根 UI 测试依赖

独立调查确认：P2 HEAD 中根 Testing Library 使用 React 18.3.1，却解析到 ReactDOM 19.2.0；官方 queue-dock 测试单独执行也出现 older React element 错误。Integration 包内 React/ReactDOM 均为 18.3.1，新增技能测试通过。该测试错误不能直接解释成生产界面回归。

建议仅给根 package.json 的 devDependencies 补齐下面两个已有工作区版本范围，使用 pnpm 更新 lock。不使用全局 override，不改变 Canvas 独立前端的 React 19，不修改生产 JSX。

```json
{
  "react": "^18.2.0",
  "react-dom": "^18.2.0"
}
```

确认后重新核对根 Testing Library 的实际 React/ReactDOM 解析版本，并执行 queue-dock、trajectory、user-questions 与 Picker 的相关测试；这些结果不替代原生窗口验收。修改轨迹记录根 manifest 与 lock 的测试用途。

## Canvas 独立前端的 lint 所有权

根全仓 lint 报告约 41,828 条诊断，其中 41,800 余条位于 packages/insight/canvas/canvas-app，主要为原有分号、成员分隔符和缩进风格。DSH 插件 Host/Client 与独立 Canvas iframe 是不同构建面；本轮不应为了格式重排上游整套业务前端。

建议在根 .oxlintrc.json 的 ignorePatterns 加入唯一精确目录，保留原规则和其他包的检查：

```json
"packages/insight/canvas/canvas-app/**"
```

这项例外只调整 lint 所有权，不隐藏构建或类型检查失败。Canvas Host/Client 接入层继续遵循 DSH lint；iframe 继续执行自己的 Vite 构建和 test:agent。本轮额外执行的 iframe standalone TypeScript 检查有 19 项错误；用相同依赖和编译参数对照 P2 源码及归档中的四个遗漏库文件，仍是同样 19 项，没有新增错误种类。这些主要涉及已有 Zod、ProseMirror、React 类型和旧页面参数，仍需登记处理，不能标为类型检查通过。

确认例外后运行根 lint，并在交付报告中分别列出根检查范围、iframe 构建/测试及未通过的 standalone 类型检查。若不采用例外，则继续整改独立前端，预计会扩大补丁和上游同步差异。

## 已发现并修复的源码交付缺口

通用 lib/ 忽略规则曾遮住 Canvas iframe 的四个真实 legacy/src/lib TypeScript 文件。它们属于固定归档输入，源码回放旧目标清单却未包含它们。当前已为这一真实源码目录增加 Git 例外，将四个文件纳入交付，并重新生成 Canvas 差异；这项修正不改变组件功能或根 lint 规则。干净 checkout 的源码完整性不能依赖本机被忽略的文件。
