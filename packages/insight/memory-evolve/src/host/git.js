/** Resolve Git for background queries without opening the macOS installer. */
import { spawnSync } from 'node:child_process'
import { accessSync, constants, realpathSync, statSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'

/** @returns {string | undefined} The canonical path of an executable file. */
function executablePath(path) {
  try {
    accessSync(path, constants.X_OK)
    return statSync(path).isFile() ? realpathSync(path) : undefined
  } catch {
    return undefined
  }
}

/**
 * Resolve the Git command for a local background query.
 * @param {string} cwd - Working directory used for relative PATH entries.
 * @returns {string | undefined} The command to run, or undefined when unavailable.
 */
export function resolveGit(cwd) {
  if (process.platform !== 'darwin') return 'git'
  for (const entry of (process.env.PATH ?? '/usr/bin:/bin').split(':')) {
    const candidate = resolve(cwd, entry, 'git')
    const executable = executablePath(candidate)
    if (!executable) continue
    if (executable !== '/usr/bin/git') return candidate
    const developer = spawnSync('/usr/bin/xcode-select', ['-p'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 1000 })
    if (developer.status !== 0 || !isAbsolute(developer.stdout.trim())) continue
    const installed = join(developer.stdout.trim(), 'usr/bin/git')
    const git = executablePath(installed)
    if (git && git !== '/usr/bin/git') return installed
  }
  return undefined
}
