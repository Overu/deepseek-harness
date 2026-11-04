import { constants } from 'node:fs'
import { chmod, lstat, mkdir, open, unlink } from 'node:fs/promises'
import { execFile as executeFile } from 'node:child_process'
import { promisify } from 'node:util'
import { isAbsolute, join, relative, resolve } from 'node:path'

const execFile = promisify(executeFile)
const MAX_FILES = 100
const MAX_BYTES = 5 * 1024 * 1024
const CHANGE_MODES = new Set(['100644', '100755'])
const RESULT_KEYS = new Set(['mode', 'reply', 'pr_title', 'pr_body', 'kind', 'areas'])
const KINDS = new Set([
  'kind/feature',
  'kind/bug-fix',
  'kind/doc',
  'kind/testing',
  'kind/cleanup',
  'kind/dependency',
])
const AREA = /^area\/[a-z0-9]+(?:-[a-z0-9]+)*$/u
const REQUIRED_CHANGE_BODY_TEXT = [
  '**Interface changes**',
  '**Behavior changes**',
  '**Test design**',
  '**Test entries**',
  '**AI declaration**',
  '[v0.1.2](https://ai-declaration.md/en/0.1.2)',
  '| breakdown 问题拆解 |',
  '| design 方案设计 |',
  '| testing 验收测试 |',
  '| implementation 技术实现 |',
  '| review 评审处理 |',
]
const AI_DECLARATION_BADGE = /\[!\[AI-DECLARATION:[^\]]*\]\([^)]*\)\]\(https:\/\/ai-declaration\.md\)/u

/**
 * Runs a Git query without a shell or repository-wide environment mutation.
 *
 * @param {string} workdir Repository checkout.
 * @param {string[]} args Git arguments.
 * @returns {Promise<Buffer>} Command standard output.
 */
async function git(workdir, args) {
  const { stdout } = await execFile('/usr/bin/git', args, {
    cwd: workdir,
    encoding: 'buffer',
    maxBuffer: 16 * 1024 * 1024,
  })
  return stdout
}

/** @param {Buffer} output @returns {string[]} */
function nulPaths(output) {
  const entries = output.toString('utf8').split('\0')
  entries.pop()
  return entries
}

/** @param {unknown} value @returns {asserts value is Record<string, unknown>} */
function object(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected an object.')
  }
}

/** @param {unknown} value @param {string} name @returns {string} */
function text(value, name) {
  if (typeof value !== 'string') throw new Error(`${name} must be a string.`)
  return value
}

/** @param {string} value @param {string} name @param {number} maximum */
function limited(value, name, maximum) {
  if (value.length > maximum) throw new Error(`${name} exceeds ${maximum} characters.`)
  if (value.includes('<!-- issue-agent:')) throw new Error(`${name} contains a reserved Issue Agent control marker.`)
}

/** @param {string} value @returns {boolean} */
function canonicalBase64(value) {
  return /^[A-Za-z0-9+/]*={0,2}$/u.test(value)
    && value.length % 4 === 0
    && Buffer.from(value, 'base64').toString('base64') === value
}

/**
 * Rejects paths that could alter the Issue Agent's trusted controls or escape its checkout.
 *
 * @param {unknown} value Candidate relative path.
 * @returns {string} Validated path.
 */
function safePath(value) {
  const path = text(value, 'change path')
  if (path.length === 0 || isAbsolute(path) || path.includes('\\') || /[\0-\x1F\x7F]/u.test(path)) {
    throw new Error(`Unsafe change path: ${JSON.stringify(path)}.`)
  }
  const segments = path.split('/')
  if (segments.some(segment => segment.length === 0 || segment === '.' || segment === '..')) {
    throw new Error(`Unsafe change path: ${JSON.stringify(path)}.`)
  }
  const lower = segments.map(segment => segment.toLowerCase())
  if (lower.includes('.git') || lower.includes('.codex') || lower.includes('.agents')) {
    throw new Error(`Protected change path: ${JSON.stringify(path)}.`)
  }
  if (lower[0] === '.github' && ['workflows', 'actions', 'issue-agent'].includes(lower[1] ?? '')) {
    throw new Error(`Protected change path: ${JSON.stringify(path)}.`)
  }
  const name = lower.at(-1)
  if (name === 'agents.md' || name === 'claude.md' || name === '.gitmodules' || name === '.gitattributes' || name === '.lfsconfig' || name === '.env' || name?.startsWith('.env.')) {
    throw new Error(`Protected change path: ${JSON.stringify(path)}.`)
  }
  return path
}

/**
 * Reads a path with lstat so symlinks and special files cannot redirect writes.
 *
 * @param {string} path Filesystem path.
 * @returns {Promise<import('node:fs').Stats | undefined>} Metadata when present.
 */
async function tryLstat(path) {
  try {
    return await lstat(path)
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return undefined
    throw error
  }
}

/**
 * Validates existing parents and, when present, the target without resolving symlinks.
 *
 * @param {string} root Checkout root.
 * @param {string} path Validated relative path.
 * @returns {Promise<import('node:fs').Stats | undefined>} Target metadata.
 */
async function inspectPath(root, path) {
  const rootStat = await lstat(root)
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('workdir must be a real directory.')
  let current = root
  const segments = path.split('/')
  for (const [index, segment] of segments.entries()) {
    current = join(current, segment)
    const stat = await tryLstat(current)
    if (index === segments.length - 1) {
      if (stat && (!stat.isFile() || stat.isSymbolicLink())) throw new Error(`Change target is not a regular file: ${path}.`)
      return stat
    }
    if (stat === undefined) return undefined
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Change parent is not a real directory: ${path}.`)
  }
  throw new Error(`Invalid change path: ${path}.`)
}

/**
 * Reads one regular file without following a final symlink introduced after its parent check.
 *
 * @param {string} path File path.
 * @returns {Promise<Buffer>} File contents.
 */
async function readRegularFile(path) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const stat = await handle.stat()
    if (!stat.isFile()) throw new Error(`Change target is not a regular file: ${path}.`)
    return await handle.readFile()
  } finally {
    await handle.close()
  }
}

/**
 * Replaces a regular file without following a final symlink introduced after validation.
 *
 * @param {string} path File path.
 * @param {Buffer} content File contents.
 * @param {'100644' | '100755'} mode Requested Git mode.
 * @returns {Promise<void>}
 */
async function writeRegularFile(path, content, mode) {
  const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, mode === '100755' ? 0o755 : 0o644)
  try {
    const stat = await handle.stat()
    if (!stat.isFile()) throw new Error(`Change target is not a regular file: ${path}.`)
    await handle.writeFile(content)
  } finally {
    await handle.close()
  }
  await chmod(path, mode === '100755' ? 0o755 : 0o644)
}

/** @param {string} root @param {string} path */
function checkedTarget(root, path) {
  const target = resolve(root, path)
  if (relative(root, target).startsWith('..')) throw new Error(`Change path escapes workdir: ${path}.`)
  return target
}

/**
 * Validates model-produced PR metadata. It returns the original value after validation.
 *
 * @param {unknown} value Model result.
 * @returns {Record<string, unknown>} The validated result.
 */
export function validateResult(value) {
  object(value)
  if (Object.keys(value).some(key => !RESULT_KEYS.has(key)) || Object.keys(value).length !== RESULT_KEYS.size) {
    throw new Error('Result has unexpected or missing fields.')
  }
  const mode = text(value.mode, 'mode')
  if (mode !== 'reply' && mode !== 'change') throw new Error('mode must be reply or change.')
  const reply = text(value.reply, 'reply')
  if (reply.trim().length === 0) throw new Error('reply must not be empty.')
  limited(reply, 'reply', 48_000)
  const title = text(value.pr_title, 'pr_title')
  const body = text(value.pr_body, 'pr_body')
  limited(title, 'pr_title', 200)
  limited(body, 'pr_body', 40_000)
  if (!Array.isArray(value.areas) || value.areas.some(area => typeof area !== 'string' || !AREA.test(area)) || value.areas.length > 5) {
    throw new Error('areas must contain at most five canonical area labels.')
  }
  if (value.kind !== '' && (typeof value.kind !== 'string' || !KINDS.has(value.kind))) {
    throw new Error('kind must be a canonical kind label or empty.')
  }
  if (mode === 'reply') {
    if (title !== '' || body !== '' || value.kind !== '' || value.areas.length !== 0) {
      throw new Error('reply results must not include PR metadata.')
    }
    return value
  }
  if (title.trim().length === 0 || body.trim().length === 0 || value.kind === '' || value.areas.length === 0) {
    throw new Error('change results require PR title, body, kind, and areas.')
  }
  const headings = ['## Motivation', '## Changes', '## Testing', '## AI Usage']
  let previous = -1
  for (const heading of headings) {
    const position = body.indexOf(heading)
    if (position < 0 || position <= previous) throw new Error('pr_body must use the required sections in order.')
    previous = position
  }
  const start = body.indexOf('<!-- ai-declaration:start -->')
  const end = body.indexOf('<!-- ai-declaration:end -->')
  if (start < 0 || end <= start) throw new Error('pr_body must include AI declaration markers.')
  if (!AI_DECLARATION_BADGE.test(body) || REQUIRED_CHANGE_BODY_TEXT.some(required => !body.includes(required))) {
    throw new Error('pr_body must use the required AI declaration format.')
  }
  return value
}

/**
 * Validates JSON file changes before an unprivileged model result reaches a trusted checkout.
 *
 * @param {unknown} value Candidate changes.
 * @returns {Array<{ path: string, content: string | null, mode: '100644' | '100755' }>} Validated changes.
 */
export function validateChanges(value) {
  if (!Array.isArray(value) || value.length > MAX_FILES) throw new Error(`changes must contain at most ${MAX_FILES} files.`)
  const paths = new Set()
  let bytes = 0
  return value.map(entry => {
    object(entry)
    if (Object.keys(entry).length !== 3 || !['path', 'content', 'mode'].every(key => Object.hasOwn(entry, key))) {
      throw new Error('Each change must contain only path, content, and mode.')
    }
    const path = safePath(entry.path)
    if (paths.has(path)) throw new Error(`Duplicate change path: ${path}.`)
    paths.add(path)
    if (!CHANGE_MODES.has(entry.mode)) throw new Error(`Invalid change mode for ${path}.`)
    if (entry.content !== null && (typeof entry.content !== 'string' || !canonicalBase64(entry.content))) {
      throw new Error(`Invalid base64 content for ${path}.`)
    }
    if (typeof entry.content === 'string') {
      bytes += Buffer.from(entry.content, 'base64').byteLength
      if (bytes > MAX_BYTES) throw new Error(`Changes exceed ${MAX_BYTES} bytes.`)
    }
    return { path, content: entry.content, mode: entry.mode }
  })
}

/**
 * Ensures a response and file artifact agree about whether code changed.
 *
 * @param {unknown} result Model result.
 * @param {unknown} changes File changes.
 * @returns {{ result: Record<string, unknown>, changes: Array<{ path: string, content: string | null, mode: '100644' | '100755' }> }} Validated outcome.
 */
export function validateOutcome(result, changes) {
  const validResult = validateResult(result)
  const validChanges = validateChanges(changes)
  if (validResult.mode === 'reply' && validChanges.length > 0) throw new Error('reply results must not include file changes.')
  if (validResult.mode === 'change' && validChanges.length === 0) throw new Error('change results require file changes.')
  return { result: validResult, changes: validChanges }
}

/**
 * Collects tracked and non-ignored untracked regular-file changes as JSON-safe artifacts.
 *
 * @param {string} workdir Repository checkout.
 * @param {{ maxFiles?: number, maxBytes?: number }} [limits] Collection limits.
 * @returns {Promise<Array<{ path: string, content: string | null, mode: '100644' | '100755' }>>} Collected changes.
 */
export async function collectChanges(workdir, { maxFiles = MAX_FILES, maxBytes = MAX_BYTES } = {}) {
  if (!Number.isSafeInteger(maxFiles) || maxFiles < 0 || !Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new Error('Collection limits must be non-negative integers.')
  const [tracked, untracked] = await Promise.all([
    git(workdir, ['diff', 'HEAD', '--name-only', '--no-ext-diff', '--no-textconv', '-z']),
    git(workdir, ['ls-files', '--others', '--exclude-standard', '-z']),
  ])
  const paths = [...new Set([...nulPaths(tracked), ...nulPaths(untracked)])].sort()
  if (paths.length > maxFiles) throw new Error(`Changes exceed ${maxFiles} files.`)
  let bytes = 0
  const changes = []
  for (const candidate of paths) {
    const path = safePath(candidate)
    const target = checkedTarget(workdir, path)
    const stat = await inspectPath(workdir, path)
    if (!stat) {
      changes.push({ path, content: null, mode: '100644' })
      continue
    }
    const content = await readRegularFile(target)
    bytes += content.byteLength
    if (bytes > maxBytes) throw new Error(`Changes exceed ${maxBytes} bytes.`)
    changes.push({ path, content: content.toString('base64'), mode: (stat.mode & 0o111) === 0 ? '100644' : '100755' })
  }
  return changes
}

/** @param {string} root @param {string} path */
async function createParents(root, path) {
  let current = root
  for (const segment of path.split('/').slice(0, -1)) {
    current = join(current, segment)
    const stat = await tryLstat(current)
    if (stat) {
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Change parent is not a real directory: ${path}.`)
      continue
    }
    await mkdir(current)
    const created = await lstat(current)
    if (!created.isDirectory() || created.isSymbolicLink()) throw new Error(`Change parent is not a real directory: ${path}.`)
  }
}

/**
 * Applies validated file data to a clean checkout without executing repository code.
 *
 * @param {string} workdir Clean repository checkout.
 * @param {unknown} changes File changes.
 * @returns {Promise<void>}
 */
export async function applyChanges(workdir, changes) {
  const validChanges = validateChanges(changes)
  const workdirStat = await lstat(workdir)
  if (!workdirStat.isDirectory() || workdirStat.isSymbolicLink()) throw new Error('workdir must be a real directory.')
  const status = await git(workdir, ['status', '--porcelain', '--untracked-files=all'])
  if (status.byteLength !== 0) throw new Error('Refusing to apply changes to a dirty checkout.')
  const root = resolve(workdir)
  const planned = await Promise.all(validChanges.map(async change => {
    const target = checkedTarget(root, change.path)
    await inspectPath(root, change.path)
    return { ...change, target }
  }))
  for (const change of planned) {
    const current = await inspectPath(root, change.path)
    if (change.content === null) {
      if (current) await unlink(change.target)
      continue
    }
    await createParents(root, change.path)
    const target = await inspectPath(root, change.path)
    if (target && (!target.isFile() || target.isSymbolicLink())) throw new Error(`Change target is not a regular file: ${change.path}.`)
    await writeRegularFile(change.target, Buffer.from(change.content, 'base64'), change.mode)
  }
}
