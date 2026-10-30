/** Observe the built Insight composition after the real profile Loader activates it. */
export const inject = ['insightAccount', 'llm', 'pluginManager', 'web', 'clientModules']

const requiredBundleNames = [
  '@insight-ai/desktop-integration',
  '@insight-ai/desktop-canvas-plugin',
  'dsh-memory-evolve',
  'dsh-prompt-enhance',
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
  }

  ctx.effect(() => {
    process.on('message', receive)
    process.send?.({ kind: 'insight-loader-active' })
    return () => { process.off('message', receive) }
  })
}
