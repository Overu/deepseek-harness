/** Generate client display metadata from the externally synchronized bundled-skills directory. */
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { load } from 'js-yaml'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
/**
 * Read skill names and display labels without changing the synchronized directory.
 * @param {string} directory - Root of the synchronized skill assets.
 * @returns {Promise<Record<string, { displayName: string, shortDescription: string, entryPath: string }>>} Client labels keyed by invocation name.
 */
export async function generateSkillPresentations(directory) {
  const result = {}
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue
    const content = await readFile(join(directory, entry.name, 'SKILL.md'), 'utf8')
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(content)
    const metadata = frontmatter && load(frontmatter[1])
    if (!metadata || typeof metadata.name !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(metadata.name) || typeof metadata.description !== 'string' || !metadata.description.trim()) throw Error(`${entry.name}/SKILL.md: invalid name/description`)
    if (Object.hasOwn(result, metadata.name)) throw Error(`Duplicate skill name: ${metadata.name}`)
    const text = await readFile(join(directory, entry.name, 'ui.json'), 'utf8')
    if (Buffer.byteLength(text) > 8192) throw Error(`${entry.name}/ui.json exceeds 8 KiB`)
    const ui = JSON.parse(text)
    for (const [field, limit] of [['displayName', 60], ['shortDescription', 160]]) {
      const value = ui?.[field]
      if (typeof value !== 'string' || !value.trim() || [...value.trim()].length > limit || /[\u0000-\u001f\u007f\u0085\u2028\u2029]/u.test(value)) throw Error(`${entry.name}/ui.json: invalid ${field}`)
    }
    result[metadata.name] = { displayName: ui.displayName.trim(), shortDescription: ui.shortDescription.trim(), entryPath: `${entry.name}/SKILL.md` }
  }
  return result
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await generateSkillPresentations(join(root, 'bundled-skills'))
  await mkdir(join(root, 'build'), { recursive: true })
  await writeFile(join(root, 'build/skill-presentations.json'), JSON.stringify(result, null, 2) + '\n')
}
