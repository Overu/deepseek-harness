> 冻结历史记录：保留旧 Shell 在记录日期的结论和验收状态，不代表当前实现或线上状态。现行说明见 [Insight 文档入口](../../../../../README.zh.md)。

# alpha.22 画布客户端下载修复

2026-10-16。按[investigate](#historical-source-1)流程调查并修复；用户确认插件内完整适配。工作分支 `codex/canvas-batch-integration`，在本轮之前alpha.21未提交修改上继续，未改Core、Shell业务源码或后端，未提交/推送，也未替换真实客户端插件。

## 调查结论

症状：选中图片节点点击下载，系统浏览器打开原图，却没有下载。

根因链：`NodeOperation`等原生入口调用 `legacy/src/utils/index.ts::downloadFile`。旧函数直接fetch远端素材；插件页面 `src/host/page-route.ts` 的CSP仅允许同源connect，直接请求OSS必被拦截。catch执行window.open，而Shell `src/main/security.ts` 将外部弹窗转为系统浏览器。问题是Web下载方法迁入桌面时缺少传输适配，不是生成、OSS产物或节点保存失败。

用Shell当前Electron二进制、专属临时Profile、真实旧UI函数和实际pageHandler进行离线复现：CSP拦截=true，外部打开企图1次，原生下载0次；没有真的启动外部浏览器或访问真实账号。

## 修复与模块

- `src/host/download-route.ts`：新增受Core浏览器鉴权保护的POST `/desktop-canvas/api/download`；严格JSON只接收canvasId/url，通过现有canvas/get按当前账号核对权限和精确资源来源，再流式返回二进制。`src/host/index.ts`注册并沿用卸载生命周期，不新增Agent工具。
- `canvas-app/legacy/src/utils/index.ts`：桌面元标记存在时，远端单文件、ZIP和PPT/PDF下载共用同源入口，再复用原Blob下载；失败显示错误，禁止window.open兜底。独立Web下载路径保留原行为；下载开始只显示进行中，不预先声称成功。
- `src/host/page-route.ts`：connect-src仅增加本地blob/data读取，远端http/https仍未放开。支持本地对象资源，无需交给Host。
- 两份下载回归及page-route既有测试覆盖实际行为；版本升alpha.22。协议及长期手测维护在Plugin `docs/protocol.md`、`docs/acceptance.md`，不复制到Agent指引中心。

下载只允许当前可访问画布的已保存非文本data.value/product[].value，以及storyboardTool已声明列的image/video/audio单元格。仅文本中的链接、其他画布或尚未加入当前图的素材库资源不授权。后者需独立可信素材来源入口，不用任意URL兜底。

Host不传桌面Token、Cookie或Authorization，不跟重定向；HTTPS、全DNS公网校验、固定连接IP及TLS域名校验，复用全Fake-IP时的受控独立解析。请求12KiB、单资源512MiB、总时限5分钟。HTTP/HTML错误、超限、截断或取消不能保存为成功；响应已开始时中断流，使浏览器blob读取失败。Host流式转发，不把整段视频缓存在Node内存。

## 验证与审查

- 修复前下载UI5失败/原Web1通过；修复后8项UI测试通过。Host14组真实HTTP黑盒通过，含鉴权、来源、分镜、SSRF、DNS固定/Fake-IP、无凭据/重定向、错误页、超限、截断、超时取消和流式提前送达。
- 全量根测试336/336、原生/UI348/348（27文件），无跳过。插件/实际Core SDK及未使用符号检查通过；Web9条既有诊断逐条一致，无新增。
- 新鲜隔离Electron复测使用真实修复后的UI函数、原生下载事件及实际Host route，注入已授权画布和本地HTTP上游：PNG、有效MP4、ZIP均原生保存，字节一致；ZIP同名文件各自保留；共3下载、0外开企图；404不下载，本地Blob/Data可读，远端CSP阻断不再发生。不是mock一个成功toast。
- 实际alpha.22压缩包隔离安装/卸载通过，包含新下载入口鉴权/非法来源拒绝及既有八工具、Skill/四章读取、来源持久化与SSE/v4桥。
- 独立review发现分镜和本地Blob/Data边界，均补齐后复核关闭。素材库未入图边界保留，不扩大权限。

证据：[检查摘要](2026-10-16-alpha22-checks.json) · [Electron前后对比](evidence/2026-10-16-alpha22-electron-download.json) · [实际包审计](evidence/2026-10-16-alpha22-package-audit.json) · [隔离PASS](evidence/2026-10-16-alpha22-isolated-pass.txt) · [Web基线](evidence/2026-10-16-alpha22-web-types.json)。不归档真实登录凭据或原始启动日志。

## 包与手测

[alpha.22插件包](#historical-source-2)，64文件、14,624,079字节；与本次构建逐字节一致，白名单通过。alpha.20/21归档哈希未变。

SHA256：`ed3762bafec4b049683898b2aa1c7ff4d9863b83ce2a50af5a9278ec184697b0`

安装后重启Harness，直接使用已有素材，不用重新生成：

1. 打开自己的已保存画布，选中图片点击下载。应触发客户端原生下载/保存流程，不启动外部浏览器；打开文件核对内容，再测节点其他产物。
2. 下载现成视频/音频，核对大小、格式和播放。多选两份素材下载ZIP，解压后数量和内容完整；同名文件不互相覆盖。
3. 分镜节点下载已保存的图片/视频/音频单元格。取消系统保存时不应声称完成。
4. 若已有过期素材案例，检查失败提示且不外开、不产生错误文件；无需生成或故意破坏现有节点。普通教程链接仍照常外开。

状态：DONE_WITH_CONCERNS。研发、review与隔离验证完成；真实客户端账号、系统保存对话框及不同平台的人工验收未代做。当前维护分支同时含此前alpha.21未提交改动；本轮未自动合并、提交或推送。


## 迁入时保留的历史源码位置

以下是原报告引用的旧仓源码或当时本机构建证据，不是当前安装包依赖；未将旧仓业务源码复制到文档目录。原始目标同时记录在导入清单中。

<a id="historical-source-1"></a>

- `/Users/boxser.shi/.agents/skills/gstack/investigate/SKILL.md`

<a id="historical-source-2"></a>

- `desktop-canvas-plugin:insight-ai-desktop-canvas-plugin-0.3.0-alpha.22.tgz`
