/** Managed shell environment for the local Insight skill proxy. */
import { existsSync } from 'node:fs'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-shell-env'

/** Private Desktop-to-Host environment key naming the packaged native Node runtime. */
export const INSIGHT_SKILL_PROXY_NODE_ENV = 'DSH_INSIGHT_SKILL_PROXY_NODE'

/** Executable and client paths exposed only to managed model shell calls. */
export interface InsightSkillProxyRuntimePaths {
  /** Packaged native Node executable, never the Electron helper. */
  readonly node: string
  /** Integration-owned proxy client entry. */
  readonly client: string
}

/** Resolve and validate the runtime paths selected by Desktop Main. */
export function insightSkillProxyRuntimePaths(
  environment: NodeJS.ProcessEnv = process.env,
  packageManifest = fileURLToPath(import.meta.resolve('@insight-ai/desktop-integration/package.json')),
): InsightSkillProxyRuntimePaths {
  const node = environment[INSIGHT_SKILL_PROXY_NODE_ENV]
  const client = join(dirname(packageManifest), 'resources', 'skill-proxy-client.mjs')
  const nodeName = process.platform === 'win32' ? 'node.exe' : 'node'
  if (node === undefined || !isAbsolute(node) || basename(node).toLowerCase() !== nodeName || !existsSync(node)) {
    throw new Error(`Insight skill proxy requires ${INSIGHT_SKILL_PROXY_NODE_ENV} to name the packaged Node executable`)
  }
  if (!isAbsolute(client) || !existsSync(client)) {
    throw new Error('Insight skill proxy client resource is missing')
  }
  return { node, client }
}

/** Register the proxy runtime for trusted, per-execution DSH shell environments. */
export function registerInsightSkillProxyEnvironment(
  ctx: Context,
  paths: InsightSkillProxyRuntimePaths,
): () => void {
  return ctx.shellEnv.register({
    name: 'insight-skill-proxy',
    variables: {
      DSH_SKILL_PROXY_NODE: { description: 'Packaged Node.js executable for the Insight skill proxy.' },
      DSH_SKILL_PROXY_CLIENT: { description: 'Insight skill proxy client entry.' },
    },
    resolve: () => ({ DSH_SKILL_PROXY_NODE: paths.node, DSH_SKILL_PROXY_CLIENT: paths.client }),
  })
}
