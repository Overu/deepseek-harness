# IconPark 图标

IconPark 图标通过 `<icon>` 写入 SML。完整索引用于识别合法名称，不代表所有图标都随包提供；默认检索只返回本包已有 PNG 的图标。

## 机器优先流程

`<skill>` 是含 `SKILL.md` 的技能根目录。

```bash
python3 <skill>/lark/scripts/iconpark_tool.py search --query "增长趋势" --limit 8
python3 <skill>/lark/scripts/iconpark_tool.py resolve --name chart-line
python3 <skill>/lark/scripts/iconpark_tool.py list-categories
```

`search` 返回 `iconType`、`category`、`name`、`tags`、`score`、`available_offline`。默认候选的 `available_offline` 为 true。SOL 选择语义合适的候选写入 XML，并指定可见颜色：

```xml
<icon iconType="iconpark/Charts/chart-line.svg" topLeftX="80" topLeftY="120" width="32" height="32">
  <fill>
    <fillColor color="rgba(37, 99, 235, 1)"/>
  </fill>
</icon>
```

## 使用规则

- SOL 从渲染提示中的 `offline_icon_types` 或默认检索结果选取图标；DSH 可执行检索、传递结果，不能替 SOL 设计或随机替换图标。不要阅读全文索引或凭记忆拼路径。
- 图标用于概念提示、步骤、状态、指标、角色和导航；不要用无关装饰图标填充版面。
- 常用尺寸：行内状态图标 16-24px，标题图标 28-40px，主视觉图标 56-96px。
- 图标必须填充颜色并和背景有足够对比；深色背景优先放在浅色圆形/方形底上，或使用 `rgba(255, 255, 255, 1)` 作为图标填充色。
- 查不到合适图标时，由 SOL 判断是否用语义等价的现有图标、已有本地图像或不依赖图标的构图。准确图形不可替代时，报告缺少素材；不要随机替换或把圆形占位当作目标图标。

## 离线与兼容边界

- 本包提供 22 个与索引名称一致的 PNG；检索和转换使用同一资源定位函数。`available_offline` 表示包内资源存在，不是像素质量认证。
- `search --include-unavailable` 显式检索完整目录；`resolve` 也可识别完整目录的名称。两者会标记缺少包内资源的结果为 false，不能直接承诺离线出图。`list-categories` 的数量是完整目录数量。
- 完全离线时，“会议”可能没有直接命中：可把“团队”等检索结果交给 SOL 判断是否符合页面语义，不得自动改名冒充会议图标。
- 转换器默认不联网。仅显式允许网络取图时才设置 `PPT_ICON_ALLOW_NETWORK=1` 启用原有 GitHub/PyMuPDF 兜底；可用网络也不保证下载成功。已有项目 `assets/icons/` 缓存仍可使用。
- 缺失资源返回 `icon_placeholder` 转换诊断并进入现有质量/恢复流程，不静默当作成功；不要靠反复 SML 修复解决网络或资源故障。

## 高频示例

| 语义 | iconType |
|---|---|
| 设置/配置 | `iconpark/Base/setting.svg` |
| 目标 | `iconpark/Base/aiming.svg` |
| 增长趋势 | `iconpark/Charts/positive-dynamics.svg` |
| 折线趋势 | `iconpark/Charts/chart-line.svg` |
| 占比 | `iconpark/Charts/chart-proportion.svg` |
| 数据看板 | `iconpark/Charts/data-screen.svg` |
| 成功 | `iconpark/Character/check-one.svg` |
| 失败/风险 | `iconpark/Character/close-one.svg` |
| 团队/用户 | `iconpark/Peoples/peoples.svg` |
| 安全防护 | `iconpark/Safe/protect.svg` |
| 全球/市场 | `iconpark/Travel/world.svg` |
| 邮件/联系 | `iconpark/Office/envelope-one.svg` |
