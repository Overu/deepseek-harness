// Public Harness tool declarations only; validation and execution remain in the Host and native service.
export const canvasToolOutputSchema = { type: 'string' } as const

const nodePlacementParameterSpec = {
  description: 'auto追加且不移动旧节点；absolute为世界坐标；after在锚节点右侧放置，不建立连线，不保证消除附近重叠。',
  oneOf: [
    { type: 'object', additionalProperties: false, properties: { mode: { type: 'string', const: 'auto', required: true } } },
    { type: 'object', additionalProperties: false, properties: { mode: { type: 'string', const: 'absolute',
      required: true }, position: { type: 'object', required: true, additionalProperties: false, properties: { x: {
      type: 'number', required: true }, y: { type: 'number', required: true } } } } },
    { type: 'object', additionalProperties: false, properties: { mode: { type: 'string', const: 'after',
      required: true }, anchorNodeId: { type: 'string', required: true, description: '当前画布中的真实节点ID，最多100字符。' } } },
  ],
} as const

const parameterValues = { type: 'object', additionalProperties: true,
  description: '仅当前模型允许的标量技术参数；不能含model/modelType/prompt，不支持高级嵌套参数。' } as const

const nodeChangesParameterSpec = { type: 'object', additionalProperties: false, properties: {
  title: { type: 'string', description: '最多100字符，遵循原生命名规则。' }, text: { type: 'string', description: '仅文本节点正文，最多32768字符。' },
  prompt: { type: 'string', description: '普通生成节点的提示词，最多32768字符，不触发生成。' }, params: parameterValues,
} } as const

export const canvasToolContracts = {
  canvas_create: {
    name: 'canvas_create',
    timeoutMs: 90000,
    description: '创建空画布并初始化当前会话的服务，无需打开画布，不生成素材。created包含真实ID；runtime:not_ready不撤销创建。create_unknown表示创建结果未确认。',
    parameters: { name: { type: 'string', description: '可选画布名称，1–100字符。' } },
  },
  canvas_get: {
    name: 'canvas_get',
    timeoutMs: 90000,
    description: '只读画布，不打开画布。summary最多20个摘要且不提供写入版本；nodes返回正文/素材/参数及版本；graph返回真实端口、输入类型和边，outputs是素材URL。nodes/graph的confirmed版本可用于写入；graph分页固定expectedVersion。refresh:false为普通读取，true为权威重载，可能刷新可见画布。',
    parameters: {
      canvasId: { type: 'string', required: true, description: '正Long十进制字符串画布ID。' },
      view: { type: 'string', enum: ['summary', 'nodes', 'graph'], description: '默认summary；写前使用nodes或graph的confirmed版本。' },
      nodeIds: { type: 'array', items: { type: 'string' }, description: '仅nodes可用，1–20个唯一节点ID；省略前20个。' },
      refresh: { type: 'boolean', description: '仅nodes/graph可用；默认false，普通confirmed读取足够。true仅用于显式权威同步或冲突/未知回执恢复，会触发可见画布重载。' },
      nodeOffset: { type: 'number', description: '仅graph，非负整数；续页带expectedVersion。' },
      edgeOffset: { type: 'number', description: '仅graph，非负整数；续页带expectedVersion。' },
      limit: { type: 'number', description: '仅graph，各节点/边页长度1–20整数，默认20。' },
      expectedVersion: { type: 'string', description: '仅graph，第一页confirmed版本；任何offset大于0时必填。' },
    },
  },
  canvas_node_edit: {
    name: 'canvas_node_edit',
    timeoutMs: 90000,
    description: '按ops顺序保存普通节点：add新增、edit修改、remove删除及移除关联边、configure配置模型。全输入先校验，每项独立保存并传递新版本；失败或提交结果未知立即停止，completed列出已保存项，nextIndex为停止位置，不回滚。不生成；expectedVersion为最新confirmed版本。',
    parameters: {
      canvasId: { type: 'string', required: true, description: '已有画布ID，正Long十进制字符串。' },
      expectedVersion: { type: 'string', required: true, description: '最新confirmed版本原样传入。' },
      ops: { type: 'array', required: true, description: '非空有序操作数组，不设置条数上限；受消息大小与执行时间限制。', items: { oneOf: [
        { type: 'object', additionalProperties: false, properties: { op: { type: 'string', const: 'add',
          required: true }, node: { type: 'object', required: true, additionalProperties: false, properties: { type: {
          type: 'string', required: true, enum: ['text', 'image', 'video', 'audio'] }, placement: nodePlacementParameterSpec,
        changes: nodeChangesParameterSpec } } } },
        { type: 'object', additionalProperties: false, properties: { op: { type: 'string', const: 'edit',
          required: true }, nodeId: { type: 'string', required: true }, changes: { ...nodeChangesParameterSpec, required: true } } },
        { type: 'object', additionalProperties: false, properties: { op: { type: 'string', const: 'remove',
          required: true }, nodeId: { type: 'string', required: true } } },
        { type: 'object', additionalProperties: false, properties: { op: { type: 'string', const: 'configure',
          required: true }, nodeId: { type: 'string', required: true }, configuration: { type: 'object', required: true,
          additionalProperties: false, properties: { modelType: { type: 'string' }, model: { type: 'string' },
            params: parameterValues, voiceId: { type: 'string', description: '仅TTS，真实音色ID；用canvas_models view:voices查询。' },
            seniorParams: { type: 'object', additionalProperties: true,
              description: '音频高级标量字段，依seniorParamHints选项、范围、step和文本maxLength填写。' } } } } },
      ] } },
    },
  },
  canvas_edges: {
    name: 'canvas_edges',
    timeoutMs: 90000,
    description: '按ops顺序保存真实连线：add连接、edit改接并保留边ID、remove删除、reorder指定目标全部入边顺序。使用真实节点/端口/边ID；每项独立保存并传递新版本，失败或未知即停，completed列出已保存项，不回滚。不移动节点、不生成。',
    parameters: {
      canvasId: { type: 'string', required: true, description: '已有画布ID，正Long十进制字符串。' },
      expectedVersion: { type: 'string', required: true, description: '最新confirmed版本原样传入。' },
      ops: { type: 'array', required: true, description: '非空有序操作数组，不设置条数上限；受消息大小与执行时间限制。', items: { oneOf: [
        { type: 'object', additionalProperties: false, properties: { op: { type: 'string', const: 'add',
          required: true }, connection: { type: 'object', required: true, additionalProperties: false, properties: {
          sourceNodeId: { type: 'string', required: true }, targetNodeId: { type: 'string', required: true }, sourceHandle: {
            type: 'string' }, targetHandle: { type: 'string' } } } } },
        { type: 'object', additionalProperties: false, properties: { op: { type: 'string', const: 'edit',
          required: true }, edgeId: { type: 'string', required: true }, connection: { type: 'object', required: true,
          additionalProperties: false, properties: { sourceNodeId: { type: 'string', required: true }, targetNodeId: {
            type: 'string', required: true }, sourceHandle: { type: 'string' }, targetHandle: { type: 'string' } } } } },
        { type: 'object', additionalProperties: false, properties: { op: { type: 'string', const: 'remove',
          required: true }, edgeId: { type: 'string', required: true } } },
        { type: 'object', additionalProperties: false, properties: { op: { type: 'string', const: 'reorder',
          required: true }, targetNodeId: { type: 'string', required: true }, edgeIds: { type: 'array', required: true,
          items: { type: 'string' } } } },
      ] } },
    },
  },
  canvas_models: {
    name: 'canvas_models',
    timeoutMs: 90000,
    description: '只读当前账号image/video及audio（tts、text_to_audio、audio_to_audio）的模型和参数提示。默认view:models，续页固定catalogVersion；paramHints为默认父参数组合，不等同于已有节点当前值。view:voices仅audio的TTS，查询公共/我的音色或voiceId详情。高级标量字段由seniorParamHints声明；音色兼容元数据未声明时不推断兼容。不修改或生成。',
    parameters: {
      canvasId: { type: 'string', required: true, description: '已有画布ID，正Long十进制字符串。' },
      nodeType: { type: 'string', required: true, enum: ['image', 'video', 'audio'] },
      view: { type: 'string', enum: ['models', 'voices'], description: '默认models；voices不接受模型目录分页字段和modelType。' },
      voiceSource: { type: 'string', enum: ['public', 'my'], description: '仅voices列表，默认public；详情可用于限制来源。' },
      voiceId: { type: 'string', description: '仅voices详情，不与列表筛选或page混用。' },
      name: { type: 'string', description: '仅voices列表，按音色名称筛选。' },
      language: { type: 'string', description: '仅公共voices列表，语言筛选。' },
      gender: { type: 'string', description: '仅公共voices列表，性别筛选。' },
      page: { type: 'integer', description: '仅voices列表，1开始，默认1。' },
      modelType: { type: 'string', description: '原生真实模式value；省略选原生可用默认。' },
      model: { type: 'string', description: '当前模式内真实模型value；省略选原生可用默认。' },
      modeOffset: { type: 'number', description: '非负整数；续页必须带expectedCatalogVersion。' },
      modelOffset: { type: 'number', description: '非负整数；续页必须带expectedCatalogVersion。' },
      limit: { type: 'number', description: '各模式/模型页长度1–20整数，默认20。' },
      expectedCatalogVersion: { type: 'string', description: '第一页catalogVersion；任何offset大于0时必填。' },
    },
  },
  canvas_assets: {
    name: 'canvas_assets',
    timeoutMs: 90_000,
    description: '只读当前对话的文本、图片、视频、音频素材来源，统一返回assets及可信source；附件和media-generator成功回执各最多20条，可按类型过滤。不扫描工作区、不下载、上传、建节点或生成；工作区文件可直接通过导入工具引用。',
    parameters: { mediaType: { type: 'string', enum: ['text', 'image', 'video', 'audio'] }, sourceType: {
      type: 'string', enum: ['attachment', 'conversation_asset'] } },
  },
  canvas_asset_import: {
    name: 'canvas_asset_import',
    timeoutMs: 420_000,
    description: '将可信文本、图片、视频或音频保存为对应原生节点。attachment使用当前聊天附件；conversation_asset使用canvas_assets返回的引用；canvas_node复用授权节点；workspace_file读取当前会话工作区内文件。文本仅保存正文，媒体经校验后复用或转存OSS。需confirmed版本；saved为节点保存，assetRegistration独立报告入库。未知结果不得自动重发。不建边、不生成。',
    parameters: { canvasId: { type: 'string', required: true }, expectedVersion: { type: 'string', required: true },
      source: { type: 'object', required: true, additionalProperties: false, properties: { type: { type: 'string',
        enum: ['attachment', 'canvas_node', 'conversation_asset', 'workspace_file'], required: true }, attachmentId: {
        type: 'string' }, assetRef: { type: 'string', description: 'canvas_assets返回的本会话生成素材引用。' }, path: { type: 'string',
        description: '仅workspace_file使用；当前会话工作区内的普通文件路径。' }, canvasId: { type: 'string' }, nodeId: { type: 'string' },
      outputIndex: { type: 'integer', description: '来源节点产物序号，0开始。' } } },
      title: { type: 'string', description: '可选素材节点标题，最多100字符。' }, placement: nodePlacementParameterSpec },
  },
  canvas_run: {
    name: 'canvas_run',
    timeoutMs: 180_000,
    description: '运行nodeIds指定且依赖已就绪的普通image/video或audio（tts、text_to_audio、audio_to_audio）节点。预检后提交原生工作流，每批一个Job，results为逐节点回执；容量不足返回paused/nextIndex。expectedVersion为最新confirmed版本，未知版本为null。submitted仅表示提交；job_kill仅停止跟踪。累计超过30图/6视频须真实用户确认。',
    parameters: {
      canvasId: { type: 'string', required: true, description: '已有画布ID，正Long十进制字符串。' },
      nodeIds: { type: 'array', required: true, items: { type: 'string' },
        description: '非空且不重复的普通图片、视频或音频生成节点ID数组，不设置条数上限；受消息大小和执行时间限制。' },
      expectedVersion: { type: 'string', required: true, description: '最新confirmed保存版本原样传入。' },
    },
  },
  canvas_open: {
    name: 'canvas_open', timeoutMs: 90000, description: '在本对话右侧打开已有画布，可定位节点；不选中、不修改、不生成。回执区分侧栏打开、内容就绪和定位结果。',
    parameters: { canvasId: { type: 'string', required: true }, nodeId: { type: 'string' } },
  },
  canvas_list: {
    name: 'canvas_list', timeoutMs: 90000, description: '只读当前账号画布列表，按名称筛选及分页；不打开或修改画布。',
    parameters: { name: { type: 'string' }, page: { type: 'integer', description: '从1开始，默认1。' }, limit: {
      type: 'integer', description: '1–20，默认20。' } },
  },
  canvas_capabilities: {
    name: 'canvas_capabilities', timeoutMs: 90000, description: '只读当前画布可调用的专用处理、账号权限、参数选项及排版模式；不提交处理或保存。',
    parameters: { canvasId: { type: 'string', required: true }, kind: { type: 'string', enum: ['image_upscale',
      'video_upscale','image_layering','auto_matting'] }, model: { type: 'string', description: '查询所选分层模型的参数。' } },
  },
  canvas_layout: {
    name: 'canvas_layout', timeoutMs: 90000, description: '按原生算法保存指定节点的横排、竖排或宫格排版；原生规则可能扩展到同组其他成员，回执列出实际影响节点。不生成。',
    parameters: { canvasId: { type: 'string', required: true }, expectedVersion: { type: 'string', required: true },
      nodeIds: { type: 'array', required: true, items: { type: 'string' } }, mode: { type: 'string', required: true,
        enum: ['grid', 'horizontal', 'vertical'] } },
  },
  canvas_process: {
    name: 'canvas_process', timeoutMs: 180000,
    description: '对一个已有画布素材执行高清图片、高清视频、图像分层或自动抠图。保留来源，创建关联结果节点；submitted不是完成，job_output返回终态。结果未知不自动重提。',
    parameters: { canvasId: { type: 'string', required: true }, expectedVersion: { type: 'string', required: true },
      kind: { type: 'string', required: true, enum: ['image_upscale', 'video_upscale', 'image_layering', 'auto_matting'] },
      sourceNodeId: { type: 'string', required: true }, outputIndex: { type: 'integer', description: '来源素材序号，默认0。' },
      params: { type: 'object', additionalProperties: false, properties: { resolution: { type: 'string' }, model: {
        type: 'string', description: '仅分层，使用能力查询返回的真实值。' }, num_layers: { type: 'integer', description: '仅分层，使用可用选项，最多20。' } } } },
  },
} as const
