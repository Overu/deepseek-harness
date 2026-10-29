import { cp, mkdir, readdir, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** Copy the authoritative Host module tree after tsdown writes the thin entry. */
export async function copyRuntimeResources(root = dirname(dirname(fileURLToPath(import.meta.url)))) {
  const source = join(root, 'src', 'host')
  const output = join(root, 'lib', 'host')

  await rm(output, { recursive: true, force: true })
  await mkdir(output, { recursive: true })
  for (const entry of await readdir(source, { withFileTypes: true })) {
    await cp(join(source, entry.name), join(output, entry.name), { recursive: true })
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await copyRuntimeResources()
}
