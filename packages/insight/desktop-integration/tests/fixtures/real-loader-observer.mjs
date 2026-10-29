/** Observe the built Integration service after the real profile Loader activates it. */
export const inject = ['insightAccount', 'llm']

/**
 * List the managed model only after the parent confirms the loaded service is active.
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
    if (message !== 'request-insight-token') return

    void ctx.llm.listModels('yinsai-gateway').then(
      models => {
        process.send?.({ kind: models.length === 1 && models[0].id === 'deepseek-flash'
          ? 'insight-loader-token' : 'insight-loader-error' })
      },
      () => { process.send?.({ kind: 'insight-loader-error' }) },
    )
  }

  ctx.effect(() => {
    process.on('message', receive)
    process.send?.({ kind: 'insight-loader-active' })
    return () => { process.off('message', receive) }
  })
}
