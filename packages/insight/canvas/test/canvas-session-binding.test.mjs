import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import LocalJobRegistry from '@deepseek-ai/dsh-jobs-local'
import * as ToolJobs from '@deepseek-ai/dsh-tool-jobs'
import { createCanvasHostBridge } from '../src/host/canvas-bridge.ts'
import { registerCanvasBridgeSessionLifecycle } from '../src/host/index.ts'

const textResponse = text => [
  { type: 'block-start', index: 0, blockType: 'text' },
  { type: 'text-delta', index: 0, text },
  { type: 'block-end', index: 0, block: { type: 'text', text } },
  { type: 'finish', reason: { kind: 'stop' } },
]
const toolResponse = (callId, name) => {
  const id = ToolCallId(callId)
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: '{}' },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: '{}' } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}
class ScriptedAdapter extends LlmAdapter {
  constructor(script) { super(); this.script = script; this.requests = [] }
  async *stream(options) {
    this.requests.push(options)
    const response = this.script.shift()
    if (!response) throw new Error('scripted adapter exhausted')
    yield * response
  }
}

test('Canvas Job settlement wakes the owning Agent before its released bridge binding is reconsidered',
  { timeout: 5000 }, async t => {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  await mountAgentLoopTestDependencies(ctx)
  const jobsFiber = await ctx.plugin(LocalJobRegistry)
  await ctx.plugin(ToolJobs)
  const adapter = new ScriptedAdapter([
    textResponse('initial turn complete'),
    toolResponse('probe-call', 'canvas_probe'),
    textResponse('probe complete'),
  ])
  ctx.llm.registerAdapter(['mock'], adapter)
  const activeSessions = new Set()
  const bridge = createCanvasHostBridge({ isSessionActive: sessionId => activeSessions.has(sessionId) })
  t.after(() => bridge.dispose())
  registerCanvasBridgeSessionLifecycle(ctx, bridge, activeSessions)
  const harness = await mountAgentLoopTestHarness(ctx)
  const agent = await harness.create(SessionId('session'), { provider: 'mock', model: 'mock' })
  const registration = bridge.attachClient('https://shell.test', 'client', 'web-locks-v1'), events = []
  bridge.connectStream(registration.bridgeKey, 'https://shell.test', event => events.push(event))
  bridge.acceptClientEvent(registration.bridgeKey, 'https://shell.test', { type: 'session.sync', protocolVersion: 4,
    connectionId: registration.connectionId, revision: 1, sessionIds: ['session'] })
  let probes = 0
  ctx.tools.register(defineTool({
    name: 'canvas_probe', description: 'Read the retained Canvas binding.', parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(_args, exec) {
      assert.equal(exec.agent, agent)
      const waiting = bridge.ensureContext(String(agent.id), '2873', 'read', String(exec.callId))
      const command = events.at(-1)
      assert.equal(command.type, 'canvas.prepare')
      bridge.acceptClientEvent(registration.bridgeKey, 'https://shell.test', {
        type: 'canvas.prepare.ack', protocolVersion: 4, connectionId: registration.connectionId,
        sessionId: String(agent.id), canvasId: '2873', requestId: String(exec.callId), status: 'prepared',
        contextId: 'context', state: { phase: 'ready', capabilities: { read: true, edit: true, run: false }, version: '1' },
      })
      await waiting; probes++
      return 'retained'
    },
  }))
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'start' }], source: { kind: 'user' } }))
  await agent.whenIdle()
  const completion = Promise.withResolvers()
  ctx.jobs.start({ kind: 'canvas', label: 'test Canvas Job', owner: agent.id,
    run: () => ({ done: completion.promise, cancel() {} }) })
  bridge.acceptClientEvent(registration.bridgeKey, 'https://shell.test', { type: 'session.sync', protocolVersion: 4,
    connectionId: registration.connectionId, revision: 2, sessionIds: [] })
  const woke = Promise.withResolvers()
  const stop = ctx.on('agent/status', ({ agent: subject, status }) => {
    if (subject === agent && status === 'running') { stop(); woke.resolve() }
  })
  completion.resolve({ status: 'completed', result: 'ready' })
  await woke.promise
  await agent.whenIdle()
  assert.equal(probes, 1)
  assert.equal(adapter.requests.length, 3)
  await assert.rejects(bridge.ensureContext('session', '2873', 'read', 'after-idle'), { code: 'CLIENT_UNAVAILABLE' })
  const teardown = Promise.withResolvers()
  ctx.jobs.start({ kind: 'canvas', label: 'teardown Canvas Job', owner: agent.id,
    run: () => ({ done: teardown.promise, cancel() { teardown.resolve({ status: 'killed' }) } }) })
  bridge.acceptClientEvent(registration.bridgeKey, 'https://shell.test', { type: 'session.sync', protocolVersion: 4,
    connectionId: registration.connectionId, revision: 3, sessionIds: ['session'] })
  bridge.acceptClientEvent(registration.bridgeKey, 'https://shell.test', { type: 'session.sync', protocolVersion: 4,
    connectionId: registration.connectionId, revision: 4, sessionIds: [] })
  await jobsFiber.dispose()
  await assert.rejects(bridge.ensureContext('session', '2873', 'read', 'after-jobs-unload'), { code: 'CLIENT_UNAVAILABLE' })
  })
