/** Admitted canvas tool and HTTP work, drained before its bridge and result store close. */
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { CanvasAgentError } from '../shared/canvas-agent-protocol.ts'

/** One plugin instance owns cancellation and completion of its admitted operations. */
export class CanvasActivities {
  private readonly lifetime = new AbortController()
  private readonly pending = new Set<Promise<unknown>>()
  private readonly responses = new Map<ServerResponse, IncomingMessage>()
  private readonly registrations = new Set<() => void>()
  private readonly releaseFailures: unknown[] = []
  private disposal: Promise<void> | undefined

  /**
   * Register a tool whose accepted executions finish before disposal settles.
   * @param ctx - Context owning the registration.
   * @param definition - Native tool declaration.
   * @returns the exact registration disposer.
   */
  tool(ctx: Context, definition: ToolDefinition): () => void {
    const release = ctx.tools.register({ ...definition,
      execute: (input, exec) => this.run(() => definition.execute(input, {
        ...exec, signal: AbortSignal.any([exec.signal, this.lifetime.signal]),
      })),
    })
    this.registrations.add(release)
    return release
  }

  /**
   * Register an HTTP handler and retain its open responses until they close.
   * @param ctx - Context owning the registration.
   * @param route - Authenticated canvas route.
   * @returns the exact registration disposer.
   */
  route(ctx: Context, route: WebRoute): () => void {
    const release = ctx.webServer.register({ ...route, handler: (req, res) => {
      if (this.lifetime.signal.aborted) { res.writeHead(503); res.end(); return }
      this.responses.set(res, req)
      res.once('close', () => this.responses.delete(res))
      return this.run(() => route.handler(req, res))
    } })
    this.registrations.add(release)
    return release
  }

  /**
   * Stop admission, cancel active work and await every admitted handler.
   * @returns when the instance no longer owns an active operation or response.
   */
  dispose(): Promise<void> {
    this.stop()
    this.disposal ??= this.drain()
    return this.disposal
  }

  /** Stop external admission and abort requests while completion resources remain available. */
  stop(): void {
    if (this.lifetime.signal.aborted) return
    this.lifetime.abort()
    for (const release of this.registrations) {
      try { release() } catch (error) { this.releaseFailures.push(error) }
    }
    this.registrations.clear()
    for (const [response, request] of this.responses) { response.destroy(); request.destroy() }
    this.responses.clear()
  }

  /**
   * Retain completion work started by an admitted handler or its result observer.
   * @param pending - Work that may finish after its tool receipt or Job settles.
   * @returns the same outcome after releasing this instance's completion ownership.
   */
  async track<T>(pending: Promise<T>): Promise<T> {
    this.pending.add(pending)
    try { return await pending } finally { this.pending.delete(pending) }
  }

  /**
   * Wait for handlers and completion writes after their consumers stop producing work.
   * @returns when all tracked operations settle, rejecting if registrations could not be released.
   */
  async drain(): Promise<void> {
    while (this.pending.size > 0) await Promise.allSettled([...this.pending])
    if (this.releaseFailures.length) {
      throw new AggregateError(this.releaseFailures, 'Canvas registrations could not be released')
    }
  }

  private async run<T>(work: () => T | Promise<T>): Promise<T> {
    if (this.lifetime.signal.aborted) throw new CanvasAgentError('CLIENT_UNAVAILABLE', '画布插件正在关闭')
    return this.track(Promise.resolve().then(work))
  }
}

/**
 * Register a canvas tool, optionally under the plugin's shared operation owner.
 * @param ctx - Registration owner.
 * @param activities - Production instance operation owner; omitted by isolated tool tests.
 * @param definition - Native tool declaration.
 * @returns registration disposer.
 */
export function registerCanvasTool(ctx: Context, activities: CanvasActivities | undefined, definition: ToolDefinition): () => void {
  return activities ? activities.tool(ctx, definition) : ctx.tools.register(definition)
}

/**
 * Register a canvas route, optionally under the plugin's shared operation owner.
 * @param ctx - Registration owner.
 * @param activities - Production instance operation owner; omitted by isolated handler tests.
 * @param route - Native HTTP route.
 * @returns registration disposer.
 */
export function registerCanvasRoute(ctx: Context, activities: CanvasActivities | undefined, route: WebRoute): () => void {
  return activities ? activities.route(ctx, route) : ctx.webServer.register(route)
}
