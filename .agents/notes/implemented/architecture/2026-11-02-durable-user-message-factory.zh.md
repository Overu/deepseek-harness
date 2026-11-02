# Agent Note: 可复用的持久化用户消息行

Status: implemented

[English](2026-11-02-durable-user-message-factory.md) | 中文

## 问题

装饰历史用户消息的插件需要复用原生正文、附件、来源、时间及复制控件。取出 keyed 条目的原始 React 组件不会同时转移其声明的子 Slot 或注入 props。因此，原生渲染新增注册所有的依赖后，包装组件可能失败。

## 决策

Chat 注册 session-scoped `conversation.chat.user.message` Factory，`UserMessageInput` 只包含持久化 user 或 steering `node` 及调用方授权的 `loadImage`。原生 keyed 入口与 Canvas 包装层通过框架调用该 Factory，不取出彼此的组件。Factory 拥有 `conversation.chat.user.before`，只有 user 行渲染此 chain。pending 与本地 echo 行保留独立路径。

Canvas 解析既有节点引用协议，并把仅用于显示的副本传给 Factory。有效标签显示为 Canvas 预览，无效或未知标签保留原文。Session 记录及模型可见输入保持不变。Canvas 注册随节点声明释放，不依赖原生条目的注册顺序。

## 考虑过的替代方案

**把完整原生消息行复制到 Canvas。** 重复维护展示逻辑，插件需要持续追踪原生变化。

**调用原始组件并传入空来源回调。** 丢失既有来源展示，仍耦合私有注册细节。

**增加通用渲染器委托。** 完整消息行 Factory 已满足当前复用需要，无须扩展 Slot 分派。

## 影响

原生展示保持共享，同时需要在基线更新时维护一个公共 Factory。原生行输入、来源子声明或注册生命周期变化后，需要执行真实注册的 Canvas 测试及记录会话回放。两种插件加载顺序、steering、附件、复制、卸载重挂及记录内容不变均属于回归范围。
