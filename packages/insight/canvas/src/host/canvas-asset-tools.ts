import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { CanvasAgentError, parseCanvasAsset, parseNodeDraft, type CanvasOperationResult, type NodePlacement } from '../shared/canvas-agent-protocol.ts'
import { bridgeFingerprint, MAX_BRIDGE_INFLIGHT, MAX_BRIDGE_RECORDS } from '../shared/canvas-bridge-protocol.ts'
import { canvasToolContracts, canvasToolOutputSchema } from '../shared/canvas-tool-contracts.ts'
import { canvasAddress, type CanvasId } from '../shared/protocol.ts'
import { sessionAttachments } from './asset-resolver.ts'
import { conversationMedia } from './conversation-media-source.ts'
import { createCanvasAssetApi, type UploadedCanvasMedia, type AssetRegistration } from './canvas-assets.ts'
import { prepareCanvasAssetSource, defaultAssetSourceReaders, type AssetSourceReaders, type CanvasAssetSource, type PreparedAssetSource } from './canvas-asset-source.ts'
import { desktopGatewayProfile } from './canvas-api.ts'
import { argumentsObject, idOf, sessionOf, requestId, failure, reject } from './canvas-tools.ts'
import type { CanvasHostBridge } from './canvas-bridge.ts'

type AssetApi = ReturnType<typeof createCanvasAssetApi>
type ImportArgs = { canvasId: CanvasId; expectedVersion: string; source: CanvasAssetSource; title?: string; placement?: NodePlacement }
const output = { schema: canvasToolOutputSchema, render: (_args: unknown, value: string) => [{ type: 'text' as const, text: value }] }
function invalid(message: string): never { throw new CanvasAgentError('INVALID_ARGUMENT', message) }
function identifier(value: unknown): value is string { return typeof value === 'string' && !!value.trim() && value.length <= 200 }
function parseArgs(input: unknown): ImportArgs {
  const args = argumentsObject(input, ['canvasId', 'expectedVersion', 'source', 'title', 'placement', 'position'])
  if ('position' in args) invalid('请使用placement指定放置规则；精确坐标使用absolute模式')
  const canvasId = idOf(args)
  if (!identifier(args.expectedVersion) || args.expectedVersion.length > 100) invalid('必须传入可信画布版本')
  const draft = parseNodeDraft({ type: 'image', ...('title' in args ? { changes: { title: args.title } } : {}), ...('placement' in args ? { placement: args.placement } : {}) })
  if (draft.changes?.title !== undefined && !draft.changes.title.trim()) invalid('素材标题不能为空')
  const source = argumentsObject(args.source, ['type', 'attachmentId', 'assetRef', 'canvasId', 'nodeId', 'outputIndex', 'path'])
  let parsed: CanvasAssetSource
  if (source.type === 'workspace_file') {
    argumentsObject(source, ['type', 'path'])
    if (typeof source.path !== 'string' || !source.path.trim() || source.path.length > 4096) invalid('请提供当前工作区文件路径')
    parsed = { type: source.type, path: source.path }
  } else if (source.type === 'conversation_asset') {
    argumentsObject(source, ['type', 'assetRef'])
    if (typeof source.assetRef !== 'string' || !/^conversation-(image|video|audio)-[a-f0-9]{64}$/u.test(source.assetRef)) invalid('请使用canvas_assets返回的生成素材引用')
    parsed = { type: source.type, assetRef: source.assetRef }
  } else if (source.type === 'attachment') {
    argumentsObject(source, ['type', 'attachmentId'])
    if (!identifier(source.attachmentId)) invalid('请使用当前聊天附件的attachmentId')
    parsed = { type: source.type, attachmentId: source.attachmentId }
  } else if (source.type === 'canvas_node') {
    argumentsObject(source, ['type', 'canvasId', 'nodeId', 'outputIndex'])
    if (!identifier(source.nodeId) || source.nodeId.length > 100) invalid('请提供明确的来源画布与节点')
    if ('outputIndex' in source && (!Number.isSafeInteger(source.outputIndex) || Number(source.outputIndex) < 0 || Number(source.outputIndex) >= 20)) invalid('产物序号需为0–19')
    parsed = { type: source.type, canvasId: idOf(source), nodeId: source.nodeId, ...('outputIndex' in source ? { outputIndex: Number(source.outputIndex) } : {}) }
  } else invalid('不支持的素材来源类型')
  return { canvasId, expectedVersion: args.expectedVersion, source: parsed, ...(draft.changes?.title !== undefined ? { title: draft.changes.title.trim() } : {}), ...(draft.placement ? { placement: draft.placement } : {}) }
}

/** Source identity and uploads stay in Host; native Client Store owns node creation and persistence. */
export function registerCanvasAssetTools(ctx: Context, bridge: CanvasHostBridge, api: AssetApi = createCanvasAssetApi(), readers: Partial<AssetSourceReaders> = {}): void {
  const receipts = new Map<string, { fingerprint: string; pending: boolean; promise: Promise<object> }>()
  const uploads = new Map<string, { pending: boolean; promise: Promise<UploadedCanvasMedia> }>()
  const lifetime = new AbortController()
  ctx.effect(() => () => { lifetime.abort(); receipts.clear(); uploads.clear() }, 'desktop-canvas: asset receipts')
  async function importAsset(args: ImportArgs, exec: ToolRunContext, request: string): Promise<object> {
    const session = sessionOf(exec), environment = desktopGatewayProfile().api
    const signal = AbortSignal.any([exec.signal, lifetime.signal])
    let asset: (Partial<UploadedCanvasMedia> & { status: 'uploaded' | 'reused' | 'not_applicable' }) | undefined
    let dispatchAttempted = false, uploadAttempted = false
    let prepared: PreparedAssetSource | undefined
    try {
      if (signal.aborted) throw new CanvasAgentError('CANCELLED_BEFORE_DISPATCH', '素材导入已取消，尚未执行')
      const identity = await api.getIdentity(signal)
      const target = await bridge.ensureContext(session, args.canvasId, 'edit', request + ':prepare', signal)
      if (target.readiness.version === null) throw new CanvasAgentError('VERSION_UNAVAILABLE', '画布版本不可用，请先读取核对')
      if (target.readiness.version !== args.expectedVersion) throw new CanvasAgentError('VERSION_CONFLICT', '画布版本已变化，请先读取核对，不自动替换版本')
      const source = await prepareCanvasAssetSource(ctx, bridge, args.source, { ...exec, signal }, request, { ...defaultAssetSourceReaders, ...readers })
      if ('needsOutput' in source) return { status: 'needs_input', requestId: request, canvasId: args.canvasId, missing: ['source.outputIndex'], message: '来源节点有多个产物，请明确要复用哪一个', outputCount: source.needsOutput }
      prepared = source
      if (source.input) asset = source.input.mediaType === 'text' ? { status: 'not_applicable' } : { url: source.input.url, status: 'reused' }
      else {
        const file = source.file!
        const digest = 'ref' in file ? createHash('sha256').update(file.data).digest('hex') : file.sha256
        const key = JSON.stringify([environment, identity.userId, session, source.mediaType, digest])
        let upload = uploads.get(key); const reused = !!upload
        if (!upload) {
          if (uploads.size >= MAX_BRIDGE_RECORDS || [...uploads.values()].filter(value => value.pending).length >= MAX_BRIDGE_INFLIGHT) throw new CanvasAgentError('BRIDGE_OVERLOADED', '素材上传缓存或在途数量已达上限')
          const promise = api.uploadMedia(file, identity, signal)
          upload = { pending: true, promise }; uploads.set(key, upload)
          void promise.then(() => { upload!.pending = false }, cause => {
            upload!.pending = false
            if (cause instanceof CanvasAgentError && cause.code !== 'ASSET_UPLOAD_UNKNOWN') uploads.delete(key)
          })
        }
        uploadAttempted = true
        asset = { ...await upload.promise, status: reused ? 'reused' : 'uploaded' }
      }
      const current = await api.getIdentity(signal)
      if (current.userId !== identity.userId || desktopGatewayProfile().api !== environment) throw new CanvasAgentError('AUTH_REQUIRED', '桌面账号或环境已变化，本次没有向画布添加节点')
      const nativeAsset = parseCanvasAsset({ ...(source.input ?? { ...(source.mediaType === 'image' ? {} : { mediaType: source.mediaType }), url: asset.url }), ...(args.title !== undefined ? { title: args.title } : {}), ...(args.placement ? { placement: args.placement } : {}) })
      dispatchAttempted = true
      const result = await bridge.dispatch(target, request + ':asset-add', { action: 'asset.add', expectedVersion: args.expectedVersion, asset: nativeAsset }, signal)
      if (result.status === 'saved') {
        if (result.affectedNodeIds.length !== 1) throw new CanvasAgentError('SUBMISSION_UNKNOWN', '素材已提交，但保存回执没有唯一节点标识')
        let assetRegistration: AssetRegistration | { status: 'not_applicable' }
        if (nativeAsset.mediaType === 'text') assetRegistration = { status: 'not_applicable' }
        else {
          try {
            const registrationIdentity = await api.getIdentity(signal)
            if (registrationIdentity.userId !== identity.userId || desktopGatewayProfile().api !== environment) throw new CanvasAgentError('AUTH_REQUIRED', '账号已变化，节点已保存但未登记素材')
            const duration = source.file && !('ref' in source.file) ? source.file.duration : undefined
            assetRegistration = await api.registerMedia(nativeAsset.url, args.canvasId, result.affectedNodeIds[0], registrationIdentity, signal, nativeAsset.mediaType ?? 'image', duration)
          } catch (cause) { assetRegistration = { status: 'rejected', error: failure(cause) } }
        }
        return { ...result, requestId: request, address: canvasAddress(args.canvasId), asset, assetRegistration }
      }
      const receipt: CanvasOperationResult = result.status === 'submission_unknown' ? { ...result, error: { ...result.error, retry: 'never_auto' } } : result
      return { ...receipt, requestId: request, address: canvasAddress(args.canvasId), asset }
    } catch (cause) {
      if ((cause instanceof CanvasAgentError && cause.code === 'ASSET_UPLOAD_UNKNOWN') || (uploadAttempted && !asset && !(cause instanceof CanvasAgentError))) return { status: 'upload_unknown', requestId: request, canvasId: args.canvasId, address: canvasAddress(args.canvasId), error: { code: 'ASSET_UPLOAD_UNKNOWN', message: '素材上传结果未确认，请勿自动重复上传', retry: 'never_auto' } }
      if (dispatchAttempted && (!(cause instanceof CanvasAgentError) || cause.code === 'SUBMISSION_UNKNOWN')) return { status: 'submission_unknown', phase: 'save', canvasId: args.canvasId, version: null, affectedNodeIds: [], requestId: request, address: canvasAddress(args.canvasId), asset, error: { code: 'SUBMISSION_UNKNOWN', message: '素材节点保存结果未确认，请读取核对，不要重复新增', retry: 'never_auto' } }
      return { ...reject(request, cause, args.canvasId), ...(asset ? { asset } : {}) }
    } finally {
      // Local cleanup must not replace an already confirmed upload/save receipt.
      await prepared?.cleanup().catch(() => { ctx.logger.warn('Canvas asset snapshot cleanup failed') })
    }
  }
  ctx.tools.register(defineTool({ ...canvasToolContracts.canvas_assets, output,
    async execute(input, exec) {
      const request = requestId('canvas_assets', exec)
      try {
        const args = argumentsObject(input, ['mediaType', 'sourceType'])
        if (args.mediaType !== undefined && !['text', 'image', 'video', 'audio'].includes(String(args.mediaType)) || args.sourceType !== undefined && !['attachment', 'conversation_asset'].includes(String(args.sourceType))) invalid('素材筛选条件不合法')
        const attachments = sessionAttachments(exec).filter(item => item.mediaType && (!args.mediaType || item.mediaType === args.mediaType)).map(item => ({
          mediaType: item.mediaType!, name: (item.ref.name ?? 'attachment').slice(0, 200), bytes: item.ref.bytes, origin: 'user_attachment',
          source: { type: 'attachment', attachmentId: String(item.ref.attachmentId) },
        }))
        let generated: Awaited<ReturnType<typeof conversationMedia>> = [], generatedSourceError: ReturnType<typeof failure> | undefined
        if (args.sourceType !== 'attachment') {
          try { generated = await conversationMedia(ctx, exec) }
          catch (cause) { if (args.sourceType === 'conversation_asset' || !attachments.length) throw cause; generatedSourceError = failure(cause) }
        }
        const remote = generated.filter(item => !args.mediaType || item.mediaType === args.mediaType).map(({ url: _url, assetRef, ...item }) => ({
          ...item, name: 'generated-' + item.mediaType + '-' + (item.outputIndex + 1), source: { type: 'conversation_asset', assetRef },
        }))
        const local = args.sourceType === 'conversation_asset' ? [] : attachments
        const total = local.length + remote.length
        return JSON.stringify({ status: total ? 'available' : 'needs_input', requestId: request, scope: 'current_session_assets',
          assets: [...local.slice(0, 20), ...remote.slice(0, 20)], total, truncated: local.length > 20 || remote.length > 20,
          totals: { attachment: local.length, conversation_asset: remote.length }, ...(generatedSourceError ? { generatedSourceError } : {}),
          ...(total ? {} : { missing: ['asset'], message: '当前对话未找到符合条件的可信素材来源' }) })
      } catch (cause) { return JSON.stringify(reject(request, cause)) }
    }
  }))
  ctx.tools.register(defineTool({ ...canvasToolContracts.canvas_asset_import, output,
    async execute(input, exec) {
      const request = requestId('canvas_asset_import', exec)
      try {
        sessionOf(exec); const args = parseArgs(input), fingerprint = bridgeFingerprint(args), old = receipts.get(request)
        if (old) { if (old.fingerprint !== fingerprint) throw new CanvasAgentError('DUPLICATE_REQUEST_MISMATCH', '相同素材调用的参数不同'); return JSON.stringify(await old.promise) }
        if (lifetime.signal.aborted) throw new CanvasAgentError('CLIENT_UNAVAILABLE', '素材工具已卸载')
        if (receipts.size >= MAX_BRIDGE_RECORDS || [...receipts.values()].filter(value => value.pending).length >= MAX_BRIDGE_INFLIGHT) throw new CanvasAgentError('BRIDGE_OVERLOADED', '素材工具回执或在途数量已达上限')
        const promise = importAsset(args, exec, request), record = { fingerprint, pending: true, promise }; receipts.set(request, record)
        void promise.then(() => { record.pending = false }, () => { record.pending = false })
        return JSON.stringify(await promise)
      } catch (cause) { return JSON.stringify(reject(request, cause)) }
    }
  }))
}
