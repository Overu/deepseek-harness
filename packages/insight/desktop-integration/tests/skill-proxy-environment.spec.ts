import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ShellEnvRegistry } from '@deepseek-ai/dsh-shell-env'
import {
  INSIGHT_SKILL_PROXY_NODE_ENV,
  insightSkillProxyRuntimePaths,
  registerInsightSkillProxyEnvironment,
} from '../src/host/skill-proxy-environment.ts'

const execute = promisify(execFile)
const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(async (ctx) => { await ctx.fiber.dispose() }))
})

describe('Insight skill proxy shell environment', () => {
  it('rejects an existing path that is not named as the native Node runtime', () => {
    expect(() => insightSkillProxyRuntimePaths({ [INSIGHT_SKILL_PROXY_NODE_ENV]: import.meta.filename }))
      .toThrow(`requires ${INSIGHT_SKILL_PROXY_NODE_ENV}`)
  })

  it('runs the shipped client with the managed native Node executable without network access', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    new ShellEnvRegistry(ctx)
    const paths = insightSkillProxyRuntimePaths({ [INSIGHT_SKILL_PROXY_NODE_ENV]: process.execPath })
    registerInsightSkillProxyEnvironment(ctx, paths)

    const environment = ctx.shellEnv.collect({} as never)
    const result = await execute(environment.DSH_SKILL_PROXY_NODE!, [environment.DSH_SKILL_PROXY_CLIENT!, '--help'], {
      env: { ...process.env, ...environment },
    })

    expect(environment).toMatchObject({
      DSH_SKILL_PROXY_NODE: process.execPath,
      DSH_SKILL_PROXY_CLIENT: paths.client,
    })
    expect(result.stdout).toContain('skill-proxy-client.mjs CONNECTION GET|POST PATH')
  })
})
