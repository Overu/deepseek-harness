# 复用素材

先由Agent判断用户是否要使用画布能力以及素材用途。仅上传附件、引用节点或要求分析内容，不自动导入或生成。用户仅要求放入画布时只导入；要求在画布参考附件生成时，先导入被实际使用的附件，再按执行章建立参考节点到目标节点的真实连线。

对话消息中的node-refs表示已有画布节点：读取真实canvasId/nodeId核对，同画布直接复用该节点，不为同一参考物重复导入；跨画布使用时才导入目标画布，不建跨画布边。多个参考物仅使用Agent判定与本次生成相关的项；来源确实不明确才询问。

附件或对话生成素材先调用canvas_assets发现当前对话的真实来源。统一assets[]含mediaType、name和可原样用于导入的source；可按mediaType或sourceType筛选。attachment来自可见用户消息；conversation_asset来自同会话media-generator成功回执，其assetRef不是附件ID。发现不下载、不上传，也不扫描工作区。generatedSourceError表示生成来源未能确认，不能用其他附件悄悄替代用户指代的生成素材。

有唯一明确最近产物时直接复用；多份确实无法判断才简短询问。不要要求用户下载后重传、不编造URL/附件ID，也不读取skill-proxy连接文件或凭据。media-generator的image_list/video_list/audio_list字符串结果可复用；未知file_list结构不猜测。未完成/截断/缺失/过期来源按恢复章节处理，不重新付费生成来绕过。

canvas_asset_import按来源选择：

- 用户附件：attachment＋attachmentId，直接使用发现返回的source。
- 对话生成图/音视频：conversation_asset＋assetRef，由插件受控读取并转存画布OSS，不假称已经落盘。
- 画布内容：canvas_node＋真实canvasId/nodeId；多产物才补outputIndex。文本复制完整正文快照；媒体复用真实输出，不重新生成。
- 本地成片/文案等：workspace_file＋当前会话工作区内的path。可使用既有文件工具确认路径；不要为发现隐式下载、全盘扫描或探测Host路径。文件在工作区外时，经已授权文件操作复制到工作区后导入，无需用户重传。插件使用公开文件接口，不能解析其opaque标识或绕过执行环境边界。

支持UTF-8 TXT/Markdown（允许BOM，最多128KiB且32768字符）；PNG/JPEG/GIF/WebP；MP4/MOV/WebM；MP3/WAV/M4A/AAC。图片/音频须小于20MiB，视频小于200MiB且不超过300秒。名称只是候选类型，实际按内容/轨道检查；损坏、二进制文案或变化中的文件明确拒绝，不静默截断或转码。带配音视频保留原始音轨。四类导入不依赖生成模型服务。

正文建立原生文本节点；媒体建立对应类型的upload节点。saved说明节点保存成功；asset和assetRegistration分别说明上传/复用与入库。文字两者为not_applicable。入库失败不重新添加节点；上传成功但保存冲突也不暗换版本重写。同一调用回放原回执；明确创建第二份节点可以复用已确认上传，内容变化会重新验证。media-generator导入素材不能伪装成画布新生成成果。
