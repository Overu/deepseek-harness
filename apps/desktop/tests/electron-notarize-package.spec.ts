import { execFile } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'

const submissionId = '11111111-2222-3333-4444-555555555555'

interface FixturePaths {
  readonly root: string
  readonly artifact: string
  readonly notarytool: string
  readonly submissions: string
  readonly staples: string
  readonly preload: string
  readonly driver: string
  readonly bin: string
}

interface OwnedCommand {
  readonly completion: Promise<{ readonly stdout: string; readonly stderr: string }>
  readonly dispose: () => Promise<void>
  readonly pid: number | undefined
  readonly ready: Promise<void>
}

async function executable(path: string, source: string): Promise<void> {
  await writeFile(path, `#!/usr/bin/env node\n${source}`)
  await chmod(path, 0o755)
}

async function fixture(kind: 'app' | 'dmg'): Promise<FixturePaths> {
  const root = await mkdtemp(join(tmpdir(), 'electron-notarize-package-'))
  const bin = join(root, 'bin')
  const artifact = join(root, kind === 'app' ? 'Fixture.app' : 'Fixture.dmg')
  const submissions = join(root, 'submissions')
  const staples = join(root, 'staples')
  const notarytool = join(bin, 'fixture-notarytool')
  const preload = join(root, 'fast-timeouts.mjs')
  const driver = join(root, 'driver.mjs')
  try {
    if (kind === 'app') await mkdir(artifact, { recursive: true })
    else await writeFile(artifact, 'fixture disk image')
    await mkdir(bin)
    await executable(join(bin, 'codesign'), 'process.exit(0)\n')
    await executable(join(bin, 'ditto'), `
      const { writeFileSync } = await import('node:fs')
      writeFileSync(process.argv.at(-1), 'fixture archive')
    `)
    await executable(notarytool, `
      const { appendFileSync } = await import('node:fs')
      if (process.argv[2] === '--version') {
        process.stdout.write('notarytool fixture\\n')
      } else if (process.argv[2] === 'submit') {
        appendFileSync(process.env.SUBMISSIONS_FILE, 'submit\\n')
        process.stdout.write(JSON.stringify({ id: ${JSON.stringify(submissionId)}, status: process.env.NOTARY_STATUS }))
      } else if (process.argv[2] === 'log') {
        process.stdout.write('{}')
      } else {
        process.exitCode = 64
      }
    `)
    await executable(join(bin, 'xcrun'), `
      const { appendFileSync, existsSync, readFileSync } = await import('node:fs')
      if (process.argv[2] === '--find' && process.argv[3] === 'notarytool') {
        process.stdout.write(process.env.NOTARYTOOL_PATH)
        process.exit(0)
      }
      if (process.argv[2] !== 'stapler' || process.argv[3] !== 'staple') process.exit(64)
      const count = existsSync(process.env.STAPLES_FILE)
        ? readFileSync(process.env.STAPLES_FILE, 'utf8').trim().split('\\n').filter(Boolean).length
        : 0
      appendFileSync(process.env.STAPLES_FILE, 'staple\\n')
      if (count < Number(process.env.STAPLE_FAILURES)) {
        process.stderr.write('fixture stapler failure\\n')
        process.exitCode = 68
      }
    `)
    await writeFile(preload, `
      const schedule = globalThis.setTimeout
      globalThis.setTimeout = (callback, _delay, ...args) => schedule(callback, 0, ...args)
    `)
    await writeFile(driver, `
      const { notarize } = await import(${JSON.stringify(import.meta.resolve('@electron/notarize'))})
      await notarize({
        appPath: process.env.ARTIFACT_PATH,
        appleApiKey: process.env.APPLE_API_KEY,
        appleApiKeyId: 'FIXTUREKEY',
        appleApiIssuer: ${JSON.stringify(submissionId)},
        notarytoolPath: process.env.NOTARYTOOL_PATH,
      })
    `)
    await writeFile(join(root, 'AuthKey_FIXTUREKEY.p8'), 'fixture')
    return { root, artifact, notarytool, submissions, staples, preload, driver, bin }
  } catch (error) {
    await rm(root, { recursive: true, force: true })
    throw error
  }
}

function ownedCommand(
  root: string,
  command: string,
  args: readonly string[],
  options: { readonly cwd: string; readonly env: NodeJS.ProcessEnv },
  timeout: number,
  readyMarker?: string,
): OwnedCommand {
  const completion = Promise.withResolvers<{ stdout: string; stderr: string }>()
  const child = execFile(command, [...args], {
    ...options,
    encoding: 'utf8',
    killSignal: 'SIGKILL',
    maxBuffer: 1024 * 1024,
    timeout,
  }, (error, stdout, stderr) => {
    if (error === null) completion.resolve({ stdout, stderr })
    else completion.reject(error)
  })
  let closed = false
  const close = new Promise<void>((resolve) => {
    child.once('close', () => { closed = true; resolve() })
  })
  let disposal: Promise<void> | undefined
  const dispose = () => {
    disposal ??= (async () => {
      if (!closed) child.kill('SIGKILL')
      await close
      await rm(root, { recursive: true, force: true })
    })()
    return disposal
  }
  onTestFinished(dispose)
  const ready = readyMarker === undefined ? Promise.resolve() : new Promise<void>((resolve, reject) => {
    let output = ''
    const stream = child.stdout
    if (stream === null) {
      reject(new Error('fixture child has no stdout stream'))
      return
    }
    const onData = (chunk: Buffer | string) => {
      output += String(chunk)
      if (!output.includes(readyMarker)) return
      stream.off('data', onData)
      resolve()
    }
    stream.on('data', onData)
    child.once('close', () => {
      stream.off('data', onData)
      if (!output.includes(readyMarker)) reject(new Error('fixture child exited before readiness'))
    })
  })
  return { completion: completion.promise, dispose, pid: child.pid, ready }
}

async function lines(path: string): Promise<number> {
  try { return (await readFile(path, 'utf8')).trim().split('\n').filter(Boolean).length } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return 0
    throw error
  }
}

const scenarios = [
  ['recovers on the fourth application stapling attempt', 'app', 'Accepted', 3, true, 4],
  ['stops after four failed application stapling attempts', 'app', 'Accepted', 4, false, 4],
  ['does not staple an application when notarization is rejected', 'app', 'Rejected', 0, false, 0],
  ['notarizes and staples a disk image through the custom tool', 'dmg', 'Accepted', 0, true, 1],
] as const

for (const [name, kind, status, failures, succeeds, expectedStaples] of scenarios) {
  it.skipIf(process.platform === 'win32')(name, async ({ task }) => {
    const { root, artifact, notarytool, submissions, staples, preload, driver, bin } = await fixture(kind)
    const owned = ownedCommand(root, process.execPath, ['--import', preload, driver], {
      cwd: root,
      env: {
        PATH: `${bin}${delimiter}${dirname(process.execPath)}${delimiter}/usr/bin:/bin`,
        ARTIFACT_PATH: artifact,
        APPLE_API_KEY: join(root, 'AuthKey_FIXTUREKEY.p8'),
        NOTARYTOOL_PATH: notarytool,
        NOTARY_STATUS: status,
        STAPLE_FAILURES: String(failures),
        SUBMISSIONS_FILE: submissions,
        STAPLES_FILE: staples,
      },
    }, task.timeout)
    try {
      if (succeeds) await expect(owned.completion).resolves.toMatchObject({ stderr: '' })
      else await expect(owned.completion).rejects.toThrow()
      expect(await lines(submissions)).toBe(1)
      expect(await lines(staples)).toBe(expectedStaples)
    } finally {
      await owned.dispose()
    }
  })
}

it.skipIf(process.platform === 'win32')('terminates a ready child before deleting its private root', async ({ task }) => {
  const root = await mkdtemp(join(tmpdir(), 'electron-notarize-owned-child-'))
  const owned = ownedCommand(root, process.execPath, ['--input-type=module', '--eval', `
    process.stdout.write('ready\\n', () => setInterval(() => {}, 1_000))
  `], { cwd: root, env: { PATH: `${dirname(process.execPath)}${delimiter}/usr/bin:/bin` } }, task.timeout, 'ready\n')
  const completion = owned.completion.catch((error: unknown) => error)
  try {
    await owned.ready
    const pid = owned.pid
    if (pid === undefined) throw new Error('fixture child has no process ID')
    await owned.dispose()
    expect(await completion).toBeInstanceOf(Error)
    try {
      process.kill(pid, 0)
      throw new Error('fixture child remains alive after disposal')
    } catch (error) {
      expect(error).toMatchObject({ code: 'ESRCH' })
    }
    await expect(stat(root)).rejects.toMatchObject({ code: 'ENOENT' })
  } finally {
    await owned.dispose()
  }
})
