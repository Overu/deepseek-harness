> 冻结历史记录：保留旧 Shell 在记录日期的结论和验收状态，不代表当前实现或线上状态。现行说明见 [Insight 文档入口](../../../../../README.zh.md)。

# alpha.21 批量能力整合交接

2026-10-16。已快进同步Codeup main至 `9f6299269d99ed63f7fd0ea4be28c930dc3937e6`，在 `codex/canvas-batch-integration` 完成本轮研发与构建。未提交/推送，未更新真实客户端，Core与后端不改；预存 `docs/windows-plugin-install.md` 保留。

## 本轮结果

保留新增的节点/连线 `ops[]`、运行 `nodeIds[]` 和侧栏左右配置。节点/边仍逐项使用原生Store、保存队列和可信版本；生成仍调用原生执行与监控，不引入新调度器。

- `canvas-app/src/agent-workflow-runner.ts`：将容量等提交前检查失败归为 `not_sent`。502/超时/取消不会误报生成未知或锁住画布；实际调用已发送而失联继续保留unknown防重。
- `src/host/canvas-run-tools.ts`：单/多目标共用预检、真实数量确认、Job订阅/取消/终态及来源处理；保留单目标node.run和多目标workflow.run。公开回执统一results/jobId/version，零提交拒绝仍为rejected，缺可信版本保留null。Job正常/超时/提交后异常也使用逐节点快照，保留已完成产物；停止等待后晚到来源仍可登记。
- `canvas-app/legacy/src/components/canvasFlow/index.tsx`：恢复已有MultiConnectionPreview组件渲染，沿用原hook与尺寸/拖线逻辑；不修改侧栏配置和业务行为。
- 指引中心同步批量保存、依赖已就绪的多目标生成和partial/paused恢复。工具只保留原子参数/状态说明；动态上下文只含JSON事实，无重复流程长文。
- `scripts/canvas-catalog-check.mjs` 与 `verify-isolated.mjs`：校验实际安装后Core转换的ops变体、nodeIds、放置与权限边界，实际官方工具拒绝旧入参；替换失效的旧action目录断言。

独立审查发现超时Job遗漏统一格式，已修复并补单/多目标计时器回归；复审无剩余阻塞问题。未做无关业务重构。

## 当前接口与范围

节点/边现使用ops数组，生成现使用nodeIds数组（单目标也使用数组）；不重新开放旧action/单nodeId入参。更新插件后重启Harness并新建对话，以当前目录为准。既有alpha.20归档未覆盖。

多个目标的上游必须已有产物，本轮不提供模板、工具节点创建或未就绪依赖链自动执行。批量编辑独立保存、失败停止且不回滚；容量暂停只续未提交目标。具体接口由Plugin仓库 `src/shared/canvas-tool-contracts.ts`、`docs/protocol.md` 维护，行为规则唯一源为 `guidance/desktop-canvas-workflow/`。

## 验证与产物

- 根回归322/322，原生集成340/340（26文件）；已使用实际Core模块完成来源装配回归，无跳过。
- 插件与实际Core公共SDK类型、未使用声明检查通过。Web仍为9条冻结基线诊断，逐条一致，无新增；不称Web全量类型通过。
- alpha.21实际包在独立未登录Profile安装/卸载通过；八工具、旧入参拒绝、官方Skill/四章读取、合成会话图片来源、私有Domain持久化与成果SSE、v4桥及静态/认证路由通过。业务CRUD/生成回执由集成夹具验证，隔离包不提交真实保存或生成。
- 归档64文件、14,620,390字节，所有文件与本次构建逐字节一致，白名单与6个指引资源完整，无测试、探针或身份文件。

包：[alpha.21](#historical-source-1)

SHA256：`1a8dc651e03740b3d6683de13d2868636a949424a24f82a34e7cfc9192d023c5`

证据：[检查摘要](2026-10-16-alpha21-checks.json) · [包审计](evidence/2026-10-16-alpha21-package-audit.json) · [隔离PASS摘要](evidence/2026-10-16-alpha21-isolated-pass.txt) · [Web基线比较](evidence/2026-10-16-alpha21-web-types.json)。原始带临时身份的启动日志不归档。

## 下一轮自然语言手测

安装本包、重启Harness、新建对话。顺序发送：

1. “新建一个叫‘双海报验收’的画布，准备两张耳机主题海报：一张通勤、一张音乐。分别放好文案和空图片节点，文案接到各自图片。先只保存，不生成，也不用打开画布。” 目标：闭画布完成4节点、2真实连线，无生成。
2. “把两句文案改成‘通勤轻负担’和‘音乐随身听’，海报都用方图，先别生成。” 目标：修改/配置持久化，连线不丢，不逐字段询问技术参数；打开核对再关闭。
3. “现在把这两张海报各生成一张，用当前可用的默认模型即可。” 目标：正常容量下多个就绪目标共用一个Job，两份真实新产物和正确画布成果入口。此步实际生成2张。
4. “只把通勤海报背景改为浅蓝，再出一张，音乐那张保持原样。” 目标：仅修改和生成指定目标，单份成果入口正确定位，其他产物不变。此步实际生成1张。
5. 在画布多选节点，拖动组合右侧加号后结束或取消。 目标：拖线预览跟随、正确消失；原生拖线和侧栏仍正常。

真实账号、Agent是否主动加载指引/关联并正确交付、界面拖线效果仍待本轮手测。无需在真实账号制造502/超时或大量付费来验证异常；这些边界已由隔离回归覆盖。完整长期清单见Plugin仓库 `docs/acceptance.md`。


## 迁入时保留的历史源码位置

以下是原报告引用的旧仓源码或当时本机构建证据，不是当前安装包依赖；未将旧仓业务源码复制到文档目录。原始目标同时记录在导入清单中。

<a id="historical-source-1"></a>

- `desktop-canvas-plugin:insight-ai-desktop-canvas-plugin-0.3.0-alpha.21.tgz`
