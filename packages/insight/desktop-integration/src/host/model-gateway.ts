/** Fixed Insight Gateway model route backed by the Desktop Main-owned account token. */
import type { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, LlmError, resolveImageAttachmentAccess } from '@deepseek-ai/dsh-llm'
import type {
  GenerateOptions,
  LlmModelInfo,
  LlmProviderInfo,
  LlmResolvedModelInfo,
  PreparedAdapterCall,
  ResolvedRetryPolicy,
  StreamChunk,
} from '@deepseek-ai/dsh-llm'
import type { ImageAttachmentRef, ImageRequestTarget } from '@deepseek-ai/dsh-attachment'
import { resolveAdapterOptions } from '@deepseek-ai/dsh-llm-deepseek'
import {
  PiAiAdapter,
  authContextFrom,
  credentialStoreFrom,
  resolveProfiles,
} from '@deepseek-ai/dsh-llm-pi-ai'
import type { PiAiAdapterOptions, ResolvedPiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '../host.ts'
import type { AuthEnvironment } from '../shared/auth-contracts.ts'
import { desktopServiceEnvironment } from '../shared/service-environment.ts'
import { InsightAccountAccessError } from './account-service.ts'

/** The fixed provider route exposed by Insight Desktop. */
export const INSIGHT_MODEL_PROVIDER = 'yinsai-gateway'

/** The default model for every new Insight Desktop conversation. */
export const INSIGHT_MODEL_ID = 'deepseek-flash'

/** Historical Gateway IDs accepted when replay opens an existing saved selection. */
const COMPATIBLE_MODEL_IDS = [INSIGHT_MODEL_ID, 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp'] as const

/** Map a Main-owned account-token failure into the LLM failure taxonomy. */
function credentialFailure(error: unknown, signal: AbortSignal): never {
  if (signal.aborted) throw new LlmError('模型请求已取消', 'ABORTED', { cause: error instanceof Error ? error : undefined })
  if (error instanceof InsightAccountAccessError) {
    if (error.reason === 'cancelled') throw new LlmError('模型请求已取消', 'ABORTED', { cause: error })
    if (error.reason === 'expired' || error.reason === 'disposed') {
      throw new LlmError('登录已失效，请重新登录后继续会话', 'AUTH', { cause: error })
    }
    throw new LlmError('暂时无法验证登录，请检查网络后重试', 'TRANSPORT', { cause: error })
  }
  throw new LlmError('暂时无法验证登录，请检查网络后重试', 'TRANSPORT', {
    cause: error instanceof Error ? error : undefined,
  })
}

/**
 * Own the static product profile and create an isolated PiAiAdapter for each request.
 * The token resolver closes over that request's signal, so concurrent streams never
 * share a token request or mutable request state.
 */
interface ActiveGatewayStream {
  /** Stop the upstream iterator and wait until its own cleanup settles. */
  close(): Promise<void>
}

/**
 * Fixed Gateway adapter whose operations belong to the desktop-integration lifecycle.
 *
 * Every request gets its own Pi adapter and credential resolver.  The wrapper also owns
 * active iterators because unregistering an LLM adapter only removes future routing; it
 * does not stop a prepared or already-dispatched stream that captured this adapter.
 */
export class InsightGatewayAdapter extends LlmAdapter {
  private readonly profiles: ReadonlyMap<string, ResolvedPiAiProviderProfile>
  private readonly options: Omit<PiAiAdapterOptions, 'profiles' | 'resolveApiKey'>
  private readonly lifetime = new AbortController()
  private readonly activeStreams = new Set<ActiveGatewayStream>()
  private readonly operations = new Set<Promise<void>>()
  private closed = false
  private closing: Promise<void> | undefined

  constructor(
    ctx: Context,
    environment: AuthEnvironment,
    private readonly account: { getAccessToken(signal?: AbortSignal): Promise<string> },
  ) {
    super()
    this.profiles = gatewayProfiles(environment)
    this.options = {
      auth: { credentials: credentialStoreFrom(ctx), authContext: authContextFrom(ctx) },
      resolveAttachments: () => ctx.get('attachments'),
      resolveImageAccess: (attachments, ref) => resolveImageAttachmentAccess(
        attachments,
        hostPath => ctx.get('fs')?.processPathFromHostPath(hostPath),
        ref,
      ),
    }
  }

  override providerInfo(provider: string): LlmProviderInfo {
    return this.delegate(this.lifetime.signal).providerInfo(provider)
  }

  override providerRetryPolicy(provider: string): ResolvedRetryPolicy | undefined {
    return this.delegate(this.lifetime.signal).providerRetryPolicy(provider)
  }

  override imageRequestTarget(provider: string, model: string, image: ImageAttachmentRef): ImageRequestTarget {
    return this.delegate(this.lifetime.signal).imageRequestTarget(provider, model, image)
  }

  override async listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    this.assertOpen()
    const signal = this.requestSignal()
    const models = this.delegate(signal).listModels(provider)
      .then(models => models.filter(model => model.id === INSIGHT_MODEL_ID))
    return await this.track(models)
  }

  override resolveModel(provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo> {
    this.assertOpen()
    const requestSignal = this.requestSignal(signal)
    return this.track(this.delegate(requestSignal).resolveModel(provider, model, requestSignal))
  }

  override async prepareCall(provider: string, model: string, signal?: AbortSignal): Promise<PreparedAdapterCall> {
    this.assertOpen()
    const requestSignal = this.requestSignal(signal)
    return await this.track(this.prepare(provider, model, requestSignal))
  }

  override stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    return this.streamWithLifetime(options)
  }

  /**
   * Stop admission, cancel every Gateway-owned request and await stream iterator cleanup.
   *
   * @returns when credential resolution and every upstream iterator this adapter started have settled.
   */
  async dispose(): Promise<void> {
    if (this.closing !== undefined) {
      await this.closing
      return
    }
    this.closed = true
    this.closing = this.close()
    await this.closing
  }

  /** Prepare a call while retaining the product profile but binding dispatch to its own signal. */
  private async prepare(provider: string, model: string, signal: AbortSignal): Promise<PreparedAdapterCall> {
    const prepared = await this.delegate(signal).prepareCall(provider, model, signal)
    this.assertOpen()
    return {
      ...prepared,
      stream: options => this.stream(options),
    }
  }

  /** Wrap the upstream iterator so teardown can close it even when its consumer is paused at a yield. */
  private async * streamWithLifetime(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.assertOpen()
    const signal = this.requestSignal(options.signal)
    const upstream = this.delegate(signal).stream({ ...options, signal })[Symbol.asyncIterator]()
    let close: Promise<void> | undefined
    const active: ActiveGatewayStream = {
      close: () => {
        close ??= Promise.resolve(upstream.return?.()).then(() => undefined)
        return close
      },
    }
    this.activeStreams.add(active)
    try {
      while (true) {
        const next = await upstream.next()
        if (next.done) return
        yield next.value
      }
    } finally {
      try {
        await active.close()
      } finally {
        this.activeStreams.delete(active)
      }
    }
  }

  /** Combine a caller cancellation with the adapter lifetime without sharing mutable request state. */
  private requestSignal(signal?: AbortSignal): AbortSignal {
    return signal === undefined ? this.lifetime.signal : AbortSignal.any([signal, this.lifetime.signal])
  }

  /** Refuse calls captured after plugin unload begins. */
  private assertOpen(): void {
    if (this.closed) throw new LlmError('模型服务正在停止', 'ABORTED')
  }

  /** Retain a pending non-stream operation until plugin teardown can observe its settlement. */
  private track<T>(operation: Promise<T>): Promise<T> {
    const settled = operation.then(() => undefined, () => undefined)
    this.operations.add(settled)
    void settled.finally(() => { this.operations.delete(settled) })
    return operation
  }

  /** Close the resources captured before new work admission was stopped. */
  private async close(): Promise<void> {
    this.lifetime.abort()
    const streams = [...this.activeStreams].map(stream => stream.close())
    const settled = await Promise.allSettled([...streams, ...this.operations])
    const failures: unknown[] = []
    for (const result of settled) {
      if (result.status === 'rejected') failures.push(result.reason)
    }
    if (failures.length > 0) throw new AggregateError(failures, 'Insight Gateway stream cleanup failed.')
  }

  /** Construct an adapter with one request's cancellation and no retained token state. */
  private delegate(signal: AbortSignal): PiAiAdapter {
    return new PiAiAdapter({
      ...this.options,
      profiles: () => this.profiles,
      resolveApiKey: async () => {
        try {
          return await this.account.getAccessToken(signal)
        } catch (error) {
          return credentialFailure(error, signal)
        }
      },
    })
  }
}

/** Resolve the fixed Gateway profile from the paired product service environment. */
function gatewayProfiles(environment: AuthEnvironment): ReadonlyMap<string, ResolvedPiAiProviderProfile> {
  const official = resolveAdapterOptions({})
  const flash = official.models.find(model => model.id === INSIGHT_MODEL_ID)
  if (flash === undefined) throw new Error('Insight Gateway requires the DeepSeek Flash capability catalog.')
  return resolveProfiles({
    [INSIGHT_MODEL_PROVIDER]: {
      api: 'openai-completions',
      baseURL: desktopServiceEnvironment(environment).modelBaseUrl,
      compat: {
        thinkingFormat: 'deepseek', maxTokensField: 'max_tokens', supportsDeveloperRole: false, supportsStore: false,
      },
      models: COMPATIBLE_MODEL_IDS.map(id => ({
        id,
        name: flash.name ?? 'DeepSeek-V4.1-Flash',
        contextWindow: flash.contextWindow ?? official.defaultContextWindow,
        maxTokens: flash.maxTokens ?? official.maxTokens,
        input: [...flash.inputModalities ?? ['text']],
        reasoningEfforts: { off: null, low: 'low', high: 'high', max: 'max' },
      })),
      streamIdleTimeoutMs: official.streamIdleTimeoutMs,
      maxRequestImageBytes: official.maxInlineRequestImageBytes,
      requestImageMaxBytes: flash.imageMaxBytes ?? official.maxInlineRequestImageBytes,
      retryPolicy: {
        mode: official.retryPolicy.mode,
        ...official.retryPolicy.mode === 'normal'
          ? { maxRetries: official.retryPolicy.maxRetries, retryableCodes: [...official.retryPolicy.retryableCodes] }
          : {},
        backoff: {
          initialDelayMs: official.retryPolicy.initialDelayMs,
          maxDelayMs: official.retryPolicy.maxDelayMs,
          jitterRatio: official.retryPolicy.jitterRatio,
        },
      },
    },
  })
}

/**
 * Create the fixed Insight Gateway adapter for one Desktop Host process.
 * @param ctx - Host context containing the trusted Main-account service.
 * @param environment - Product-selected paired service environment.
 * @returns adapter that never stores or exposes the account token.
 */
export function createInsightModelGatewayAdapter(ctx: Context, environment: AuthEnvironment): InsightGatewayAdapter {
  return new InsightGatewayAdapter(ctx, environment, ctx.insightAccount)
}
