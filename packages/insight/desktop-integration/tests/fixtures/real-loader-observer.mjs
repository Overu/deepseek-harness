/** Observe the built Insight composition after the real profile Loader activates it. */
export const inject = ['insightAccount', 'llm', 'pluginManager', 'web', 'clientModules', 'agents', 'tools']

const requiredBundleNames = [
  '@insight-ai/desktop-integration',
  '@insight-ai/desktop-canvas-plugin',
  'dsh-memory-evolve',
  'dsh-prompt-enhance',
  '@insight-ai/skill-center',
]

/**
 * Read the protected composition through the live services without starting an external business request.
 * @param {import('@deepseek-ai/cordis').Context} ctx - the loaded profile context.
 * @returns {Promise<object>} the observed runtime inventory and management results.
 */
async function observeComposition(ctx) {
  const listedBundles = await ctx.pluginManager.listBundles()
  const plugins = await ctx.pluginManager.listPlugins()
  const registries = await ctx.pluginManager.registries()
  const bundles = requiredBundleNames.map((name) => {
    const bundle = listedBundles.find(candidate => candidate.name === name)
    const row = bundle?.rows[0]
    const plugin = row?.entryId === undefined ? undefined : plugins.find(candidate => candidate.entryId === row.entryId)
    return {
      name,
      readOnlyReason: bundle?.readOnlyReason,
      enabled: bundle?.enabled === true,
      topLevelPluginEntryId: plugin?.entryId,
      topLevelPluginReadOnlyReason: plugin?.readOnlyReason,
    }
  })
  const rejectedBundleChanges = []
  for (const bundle of bundles) {
    const entryId = bundle.topLevelPluginEntryId
    rejectedBundleChanges.push({
      name: bundle.name,
      disable: changeObservation(await ctx.pluginManager.setBundleEnabled(bundle.name, false)),
      remove: changeObservation(await ctx.pluginManager.removeBundle(bundle.name)),
      disablePlugin: entryId === undefined
        ? { application: 'missing-entry', changed: false, errorCode: undefined }
        : changeObservation(await ctx.pluginManager.setPluginEnabled(entryId, false)),
    })
  }

  const graph = ctx.clientModules.graph()
  const clientEntries = []
  for (const id of requiredBundleNames) {
    const entry = graph.entries.find(candidate => candidate.id === id)
    if (entry === undefined) {
      clientEntries.push({ id, status: 404, contentType: null })
      continue
    }
    const response = await ctx.clientModules.fetchBundle(new Request(new URL(entry.url, 'http://insight.test/')))
    clientEntries.push({ id, status: response.status, contentType: response.headers.get('content-type') })
  }

  return {
    bundles,
    rejectedBundleChanges,
    web: {
      configuredProvider: ctx.web.config.searchProvider.get(),
      registeredProvider: ctx.web.searchProviders.has('insight-enterprise-search'),
    },
    registry: registries.registry,
    clientEntries,
  }
}

/** Reduce a plugin manager change outcome to the facts the parent process asserts. */
function changeObservation(change) {
  return {
    application: change.application,
    changed: change.changed,
    errorCode: change.error?.code,
  }
}

/** Replay malformed Gateway replies through the loaded Agent and capture its request history and tool effects. */
async function observeToolArgumentRetry(ctx) {
  const name = 'insight_retry_probe'
  const good = '{"ops":[{"params":{"gen_count":1}}]}'
  const malformed = '{"ops":[{"params":{"gen_count":1}}}},{"params":{"gen_count":1}}]}'
  const gateway = 'https://gapi-test.insight-aigc.com/insight-harness-llm-gateway/v1/chat/completions'
  const results = []
  let executions = []
  const unregister = ctx.tools.register({
    name,
    description: 'Record a test write.',
    parameters: { type: 'object', properties: { ops: { type: 'array' } }, required: ['ops'] },
    output: { schema: { type: 'string' }, render: (_args, text) => [{ type: 'text', text }] },
    async execute(args) { executions.push(args); return 'recorded' },
  })
  const fetch = globalThis.fetch
  try {
    for (const retrySucceeds of [true, false]) {
      const requests = []
      const countAtRequest = []
      executions = []
      globalThis.fetch = async (input, init) => {
        if (String(input instanceof Request ? input.url : input) !== gateway) return fetch(input, init)
        const request = JSON.parse(init.body)
        const call = (index, id, args) => ({ index, id, type: 'function', function: { name, arguments: args } })
        const replies = [
          [call(0, 'call_sibling', good), call(1, 'call_invalid', malformed)],
          [call(0, 'call_retry', retrySucceeds ? good : malformed)],
        ]
        let calls
        if (request.tools?.some(tool => tool.function?.name === name)) {
          requests.push(request)
          countAtRequest.push(executions.length)
          calls = replies[requests.length - 1]
        }
        const chunk = (delta, finish_reason) => ({ id: 'chatcmpl-fixture', model: 'deepseek-flash',
          object: 'chat.completion.chunk', created: 0, choices: [{ index: 0, delta, finish_reason }] })
        const frames = [
          chunk(calls ? { role: 'assistant', tool_calls: calls } : { role: 'assistant', content: 'Done.' }, null),
          chunk({}, calls ? 'tool_calls' : 'stop'),
        ]
        return new Response(frames.map(frame => `data: ${JSON.stringify(frame)}\n\n`).join('') + 'data: [DONE]\n\n', {
          headers: { 'content-type': 'text/event-stream' },
        })
      }
      const handle = await ctx.agents.create({
        sessionId: crypto.randomUUID(),
        meta: { cwd: process.cwd() },
        agentOptions: { provider: 'yinsai-gateway', model: 'deepseek-flash' },
      })
      const { agent } = handle
      const events = []
      const observe = ctx.on('session/event', (session, event) => {
        if (session === agent.session) events.push(event)
      }, { global: true })
      try {
        agent.followup({ id: crypto.randomUUID(), role: 'user', source: { kind: 'user' },
          content: [{ type: 'text', text: 'Record one test write.' }] })
        await agent.whenIdle()
        results.push({
          feedbackAtRequest: requests.map(request => request.messages.map(message => JSON.stringify(message.content))
            .findLast(content => content?.includes('Current runtime context'))?.includes('The previous tool call arguments could not be parsed as JSON.') ?? false),
          countAtRequest,
          executions,
          calls: events.filter(event => event.type === 'tool/call').map(event => event.data.callId),
          attempts: events.filter(event => event.type === 'assistant/attempt').length,
          context: events.filter(event => event.type === 'user/message' && event.data.source.kind === 'runtime-context')
            .flatMap(event => event.data.source.sections ?? []).filter(section => section.name === 'insight-tool-argument-retry'),
          turnEnd: events.findLast(event => event.type === 'turn/end')?.data.reason,
        })
      } finally {
        observe()
        await handle.dispose()
      }
    }
  } finally {
    globalThis.fetch = fetch
    unregister()
  }
  return results
}

/**
 * Receive explicit parent test commands after the complete profile reaches its ready state.
 * @param {import('@deepseek-ai/cordis').Context} ctx - the loaded profile context.
 * @returns {void}
 */
export function apply(ctx) {
  if (process.send === undefined || !process.connected) {
    throw new Error('The real Loader observer requires a connected IPC parent.')
  }

  const receive = message => {
    if (message === 'stop') {
      process.emit('SIGTERM')
      return
    }
    if (message === 'request-insight-token') {
      void ctx.llm.listModels('yinsai-gateway').then(
        models => {
          process.send?.({ kind: models.length === 1 && models[0].id === 'deepseek-flash'
            ? 'insight-loader-token' : 'insight-loader-error' })
        },
        error => { process.send?.({ kind: 'insight-loader-error', message: String(error) }) },
      )
      return
    }
    if (message === 'observe-insight-composition') {
      void observeComposition(ctx).then(
        observation => { process.send?.({ kind: 'insight-loader-composition', observation }) },
        error => { process.send?.({ kind: 'insight-loader-error', message: String(error) }) },
      )
    }
    if (message === 'observe-tool-argument-retry') {
      void observeToolArgumentRetry(ctx).then(
        observation => { process.send?.({ kind: 'insight-loader-tool-argument-retry', observation }) },
        error => { process.send?.({ kind: 'insight-loader-error', message: String(error) }) },
      )
    }
  }

  ctx.effect(() => {
    process.on('message', receive)
    process.send?.({ kind: 'insight-loader-active' })
    return () => { process.off('message', receive) }
  })
}
