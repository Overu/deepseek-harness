> 冻结历史记录：保留旧 Shell 在记录日期的结论和验收状态，不代表当前实现或线上状态。现行说明见 [Insight 文档入口](../../../README.zh.md)。

# Memory Evolve 恢复与 Core rc.2 适配

## 原因与范围

`memory` 工具由社区插件 `dsh-memory-evolve` 提供。修复前，当前开发账号的 Profile 已没有该插件的依赖、bundle 和安装目录；已有记忆文件仍在。移除发生的具体操作尚未确定，不能归因于本次 Core 升级。

当前账号是第 9 代 Profile，而 `feature/windows` 的内置模板是第 8 代。第 9 代来自 `feature/workflow-op` 的 `7a5b96b`，该提交增加工作流插件；其本身没有移除 Memory。Shell 对更高代 Profile 保留现有配置，因此不会用第 8 代模板补装缺失插件。本次不修改该保护逻辑，也不降低或重置 Profile。

保留的 Memory 上游包还声明已移除的 client-runtime 依赖，注入不存在的 `conversation` 服务，并使用旧的会话导航方法。修复以原始 `0.1.0` 归档为输入，生成 `0.1.0-insight.1`：更新公开客户端依赖和导航接口，匹配 Core tools peer，并为十一组 HTTP 路由接入 Core connection 鉴权。记忆 store 源码及数据格式不变。Core 和 Canvas 源码均未修改。

验证使用 Shell 当前锁定的 darwin-arm64 Runtime：Core `0.2.1-rc.2`、commit `5ff83ca5b9142f812ce0016a37b90bb72dad6ea9`、Node `24.9.0`。归档及可复现适配流程见 [vendor 说明](#historical-source-1)。

## 验证

- 定向测试：`npx vitest run test/memory-evolve-compatibility.test.ts test/bundled-profile.test.ts`，20 项通过。覆盖上游片段校验、重复适配、store 字节保留、HTTP 鉴权、已有 daily/project 内容上的批量追加与读取。
- `npm run typecheck`、`npm run prepare:bundled-profile` 通过；单插件安装及 Host 启动验证通过。模板版本保持 8，更新插件归档、摘要和冻结锁。
- `npm test`：1019 项通过、2 项跳过、2 项失败。失败均在 `test/runtime.test.ts` 的 Windows 标题栏 inset 断言（期望 0，实际 36），不属于本次修改范围。
- 使用完整账号副本做原生 Electron 验证：70 个客户端插件完成启动，Memory 与 Canvas 同时加载，未见客户端错误或 Host 未激活警告。通过真实 Core tools 执行链批量追加 daily/project 并读取成功；已认证请求成功，未认证请求返回 401；稳定运行 20 秒。只写副本中的合成测试数据，没有调用真实模型。
- 原账号通过 Shell「导入本地插件」安装修复包并重启 Harness，Memory 启用，记忆面板显示长期、项目记忆及现有待确认建议。Canvas 启用且已有画布可见。安装目录中的 78 个插件文件与修复归档逐字节相同。

## 数据保留

操作前在 `/private/tmp/insight-memory-restore-20261026/harness-before` 保存完整账号快照，校验了 4146 个文件或链接。该目录权限为 0700，未写入仓库；临时目录备份应在系统清理前按需要另行保管。验证副本与原账号分开，未将测试数据拷回。

安装后核对结果：

- Profile 保持第 9 代，仅新增 Memory 依赖及 bundle；原有依赖和 bundle 保留。
- 原有 13 个记忆目录文件无缺失。12 个文件摘要不变；更新检查缓存 `update-state.json` 仅 `lastAttemptAt` 改变，记忆内容未改写。
- 原有 25 份会话归档无缺失。24 份摘要不变；打开的会话在原有 211 条记录后追加一条 `session/end-seed`，解压后原始 JSONL 是当前文件的完整前缀。对应的会话投影缓存随之刷新。
- Canvas 仍为 `0.3.0-alpha.32`，66 个包文件摘要不变；43 个 storage 文件中仅上述会话投影缓存变化，其余文件不变。

没有重放此前失败的两条业务记忆，没有接受待确认建议，没有重置 Profile。原始失败调用的内容应由用户在确认事实仍有效后重试。


## 迁入时保留的历史源码位置

以下是原报告引用的旧仓源码或当时本机构建证据，不是当前安装包依赖；未将旧仓业务源码复制到文档目录。原始目标同时记录在导入清单中。

<a id="historical-source-1"></a>

- `insight-desktop-shell:vendor/plugins/README.md`
