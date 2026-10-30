/** Prepare the isolated runtime for immutable GitHub Release creation. */
import { cp, mkdtemp, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const repository = resolve(import.meta.dirname, '../../..')
const runtime = resolve(import.meta.dirname)
const work = await mkdtemp(join(runtime, 'github-release-work-'))
for (const name of ['artifacts.ts', 'github-release.ts']) {
  await cp(join(repository, 'scripts', 'insight-release', name), join(work, name))
}

const output = process.env.GITHUB_OUTPUT
if (output === undefined || output === '') throw new Error('Insight GitHub Release runtime requires GITHUB_OUTPUT')
await writeFile(output, `entry=${join(work, 'github-release.ts')}\nloader=${join(runtime, 'node_modules/tsx/dist/loader.mjs')}\n`, { flag: 'a' })
