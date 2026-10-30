/** Run one artifact-plane Office probe without exposing local paths or document data. */
import { copyFile, mkdtemp, open, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'

const [mode, runtime, fixtureRoot, resolverModule] = process.argv.slice(2)
if (!['asar', 'physical'].includes(mode) || runtime === undefined || fixtureRoot === undefined
  || (mode === 'asar' && resolverModule === undefined)) {
  throw new Error('office diagnostic driver: expected mode, runtime, fixture root, and ASAR resolver')
}

// Match the Desktop provider rather than the kit defaults.
const OPTIONS = {
  timeoutMs: 60_000,
  maxInputBytes: 50 * 1024 * 1024,
  maxOutputBytes: 100 * 1024 * 1024,
  maxImageResolution: 192,
  maxArchiveEntries: 10_000,
  maxUncompressedBytes: 250 * 1024 * 1024,
  maxFontFiles: 20_000,
  maxFontFileBytes: 256 * 1024 * 1024,
  maxLoadedFontBytes: 512 * 1024 * 1024,
}

let phase = 'setup'
let phaseStarted = Date.now()
function event(kind, fields = {}) {
  process.stdout.write(`${JSON.stringify({ event: kind, phase, ...fields })}\n`)
}
function begin(next) {
  phase = next
  phaseStarted = Date.now()
  event('phase-start')
}
function complete(fields = {}) {
  event('phase-complete', { elapsedMs: Date.now() - phaseStarted, ...fields })
}
function failureKind(error) {
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
  if (code === 'timeout') return { kind: 'engine-timeout', code }
  if (code === 'unavailable') return { kind: 'unavailable', code }
  if (phase === 'resolver' || phase === 'kit') return { kind: 'resolution' }
  if (phase === 'dispose' || phase === 'cleanup') return { kind: 'cleanup' }
  return { kind: 'conversion', ...(typeof code === 'string' ? { code } : {}) }
}

const temporary = await mkdtemp(join(tmpdir(), 'insight-office-probe-'))
let converter
let hooks
let failed = false
try {
  if (mode === 'asar') {
    begin('resolver')
    const resolver = await import(resolverModule)
    hooks = resolver.installOfficeEngineResolution(runtime)
    if (hooks === undefined) throw new Error('ASAR resolver was not installed')
    complete()
  }

  begin('kit')
  const require = createRequire(join(runtime, 'package.json'))
  const kit = await import(pathToFileURL(require.resolve('@deepseek-ai/libreoffice-kit')).href)
  converter = await kit.createConverter(OPTIONS)
  complete({ backend: converter.backend })

  for (const extension of ['docx', 'xlsx']) {
    begin(extension)
    const inputPath = join(temporary, `input.${extension}`)
    const outputPath = join(temporary, `output-${extension}.pdf`)
    await copyFile(join(fixtureRoot, `input.${extension}`), inputPath)
    const result = await converter.render({ inputPath, outputPath })
    const output = await open(outputPath, 'r')
    try {
      const header = Buffer.alloc(5)
      if ((await output.read(header, 0, header.length, 0)).bytesRead !== header.length || header.toString() !== '%PDF-') {
        throw new Error('Office probe produced an invalid PDF header')
      }
    } finally { await output.close() }
    complete({ backend: result.backend })
  }
} catch (error) {
  failed = true
  event('phase-failure', failureKind(error))
} finally {
  if (converter !== undefined) {
    begin('dispose')
    try {
      await converter.dispose()
      complete()
    }
    catch (error) { failed = true; event('phase-failure', failureKind(error)) }
  }
  begin('cleanup')
  let cleanupFailed = false
  try { hooks?.deregister() }
  catch (error) { cleanupFailed = true; failed = true; event('phase-failure', failureKind(error)) }
  try { await rm(temporary, { recursive: true, force: true, maxRetries: 4, retryDelay: 50 }) }
  catch (error) { cleanupFailed = true; failed = true; event('phase-failure', failureKind(error)) }
  if (!cleanupFailed) complete()
}

if (failed) process.exitCode = 1
