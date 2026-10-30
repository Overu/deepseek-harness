/** Prepare a minimal source runtime without running the repository install lifecycle. */
import { cp, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const repository = resolve(import.meta.dirname, '../../..')
const work = await mkdtemp(join(import.meta.dirname, 'work-'))
for (const name of ['artifacts.ts', 'oss.ts', 'publish-common.ts', 'publish.ts', 'publish-stable.ts', 'publish-cli.ts']) {
  await cp(join(repository, 'scripts', 'insight-release', name), join(work, name))
}
await cp(join(repository, 'packages/insight/desktop-integration/src/desktop/update/contract.ts'), join(import.meta.dirname, 'contract.ts'))
await cp(join(repository, 'packages/insight/desktop-integration/resources/update/update-signing-public.pem'), join(import.meta.dirname, 'update-signing-public.pem'))
const integration = join(import.meta.dirname, 'node_modules', '@insight-ai', 'desktop-integration')
await mkdir(integration, { recursive: true })
await writeFile(join(integration, 'package.json'), `${JSON.stringify({ name: '@insight-ai/desktop-integration', private: true, type: 'module', exports: { './desktop': './desktop.ts' } })}\n`)
await writeFile(join(integration, 'desktop.ts'), "export * from '../../../contract.ts'\n")
const output = process.env.GITHUB_OUTPUT
if (output === undefined || output === '') throw new Error('Insight release runtime requires GITHUB_OUTPUT')
await writeFile(output, `entry=${join(work, 'publish-cli.ts')}\nloader=${join(import.meta.dirname, 'node_modules/tsx/dist/loader.mjs')}\npublic_key=${join(import.meta.dirname, 'update-signing-public.pem')}\n`, { flag: 'a' })
