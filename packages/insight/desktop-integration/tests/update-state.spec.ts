/** Durable Insight update state remains conservative across legacy data and concurrent writers. */

import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import { InsightUpdateStateStore } from '../src/desktop/update/state.ts'

const fingerprint = 'a'.repeat(86) + '=='
const otherFingerprint = 'b'.repeat(86) + '=='

async function fixture(): Promise<{ readonly root: string; readonly store: InsightUpdateStateStore; readonly updates: string }> {
  const root = await mkdtemp(join(tmpdir(), 'insight-update-state-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  return { root, store: new InsightUpdateStateStore(root), updates: join(root, 'updates') }
}

describe('InsightUpdateStateStore', () => {
  it('reads legacy schema-one preferences and skipped versions in place', async () => {
    const { updates, store } = await fixture()
    await mkdir(updates, { recursive: true })
    await writeFile(join(updates, 'preferences.json'), '{"schema":1,"candidateOptIn":true}\n')
    await writeFile(join(updates, 'skipped-version.json'), '{"schema":1,"version":"1.0.10-rc.1"}\n')
    await expect(store.readPreferences()).resolves.toEqual({ schema: 1, candidateOptIn: true })
    await expect(store.skippedVersion()).resolves.toBe('1.0.10-rc.1')
  })

  it('does not write a default preferences file and persists explicit candidate consent privately', async () => {
    const { updates, store } = await fixture()
    await expect(store.readPreferences()).resolves.toEqual({ schema: 1, candidateOptIn: false })
    await expect(stat(join(updates, 'preferences.json'))).rejects.toThrow()
    await store.enableCandidate()
    expect(await store.readPreferences()).toEqual({ schema: 1, candidateOptIn: true })
    expect((await stat(updates)).mode & 0o077).toBe(0)
    expect((await stat(join(updates, 'preferences.json'))).mode & 0o077).toBe(0)
  })

  it('records stable history and rejects replayed versions', async () => {
    const { store } = await fixture()
    await store.acceptRollout({ track: 'stable', version: '1.0.10', state: 'active', fingerprint })
    await expect(store.acceptRollout({ track: 'stable', version: '1.0.9', state: 'active', fingerprint })).rejects.toThrow('回放')
  })

  it('preserves a V2 final candidate floor while accepting a newer V3 rc candidate', async () => {
    const { updates, store } = await fixture()
    await store.acceptRollout({ track: 'candidate', target: 'darwin-arm64', version: '1.0.11', state: 'active', fingerprint })
    await store.acceptRollout({ track: 'candidate', target: 'darwin-arm64', version: '1.0.12-rc.1', state: 'active', fingerprint: otherFingerprint })
    await expect(store.acceptRollout({ track: 'candidate', target: 'darwin-arm64', version: '1.0.11-rc.2', state: 'active', fingerprint })).rejects.toThrow('回放')
    const history = JSON.parse(await readFile(join(updates, 'rollout-history.json'), 'utf8')) as { pointers: Record<string, { version: string }> }
    expect(history.pointers['candidate/darwin-arm64']?.version).toBe('1.0.12-rc.1')
  })

  it('writes the legacy candidate key used by the Shell', async () => {
    const { updates, store } = await fixture()
    await store.acceptRollout({ track: 'candidate', target: 'darwin-arm64', version: '1.0.10-rc.1', state: 'active', fingerprint })
    const history = JSON.parse(await readFile(join(updates, 'rollout-history.json'), 'utf8')) as { pointers: Record<string, unknown> }
    expect(history.pointers).toHaveProperty('candidate/darwin-arm64')
    expect(history.pointers).not.toHaveProperty('candidate-v3/darwin-arm64')
  })

  it('uses the newer candidate-v3 history alias to prevent replay, then preserves it', async () => {
    const { updates, store } = await fixture()
    await mkdir(updates, { recursive: true })
    const history = join(updates, 'rollout-history.json')
    await writeFile(history, JSON.stringify({ schema: 1, pointers: {
      'candidate-v3/darwin-arm64': { version: '1.0.10-rc.2', envelopeSha512: fingerprint, state: 'active' },
    } }))
    await expect(store.acceptRollout({ track: 'candidate', target: 'darwin-arm64', version: '1.0.10-rc.1', state: 'active', fingerprint })).rejects.toThrow('回放')
    await store.acceptRollout({ track: 'candidate', target: 'darwin-arm64', version: '1.0.10-rc.2', state: 'active', fingerprint })
    const next = JSON.parse(await readFile(history, 'utf8')) as { pointers: Record<string, unknown> }
    expect(next.pointers).toHaveProperty('candidate/darwin-arm64')
    expect(next.pointers).toHaveProperty('candidate-v3/darwin-arm64')
  })

  it('advances the legacy key when its alias has a later accepted candidate', async () => {
    const { updates, store } = await fixture()
    await mkdir(updates, { recursive: true })
    const history = join(updates, 'rollout-history.json')
    await writeFile(history, JSON.stringify({ schema: 1, pointers: {
      'candidate/darwin-arm64': { version: '1.0.10-rc.1', envelopeSha512: fingerprint, state: 'active' },
      'candidate-v3/darwin-arm64': { version: '1.0.10-rc.2', envelopeSha512: otherFingerprint, state: 'active' },
    } }))
    await store.acceptRollout({ track: 'candidate', target: 'darwin-arm64', version: '1.0.10-rc.2', state: 'active', fingerprint: otherFingerprint })
    const next = JSON.parse(await readFile(history, 'utf8')) as { pointers: Record<string, { version: string }> }
    expect(next.pointers['candidate/darwin-arm64']?.version).toBe('1.0.10-rc.2')
    expect(next.pointers['candidate-v3/darwin-arm64']?.version).toBe('1.0.10-rc.2')
  })

  it('keeps a withdrawn candidate in either history key authoritative', async () => {
    const { updates, store } = await fixture()
    await mkdir(updates, { recursive: true })
    await writeFile(join(updates, 'rollout-history.json'), JSON.stringify({ schema: 1, pointers: {
      'candidate/darwin-arm64': { version: '1.0.10-rc.1', envelopeSha512: otherFingerprint, state: 'rejected' },
      'candidate-v3/darwin-arm64': { version: '1.0.10-rc.1', envelopeSha512: fingerprint, state: 'active' },
    } }))
    await expect(store.acceptRollout({ track: 'candidate', target: 'darwin-arm64', version: '1.0.10-rc.1', state: 'active', fingerprint })).rejects.toThrow('重新激活')
  })

  it('allows a verified withdrawal but never reactivates it or replaces its fingerprint', async () => {
    const { store } = await fixture()
    const source = { track: 'candidate' as const, target: 'darwin-arm64', version: '1.0.10-rc.1', fingerprint }
    await store.acceptRollout({ ...source, state: 'active' })
    await store.acceptRollout({ ...source, state: 'rejected', fingerprint: otherFingerprint })
    await expect(store.acceptRollout({ ...source, state: 'active' })).rejects.toThrow()
    await expect(store.acceptRollout({ ...source, state: 'rejected', fingerprint })).rejects.toThrow('内容发生变化')
  })

  it('serializes concurrent writes for independent pointer keys', async () => {
    const { updates, store } = await fixture()
    await Promise.all([
      store.acceptRollout({ track: 'stable', version: '1.0.10', state: 'active', fingerprint }),
      store.acceptRollout({ track: 'candidate', target: 'darwin-arm64', version: '1.0.10-rc.1', state: 'active', fingerprint }),
    ])
    const history = JSON.parse(await readFile(join(updates, 'rollout-history.json'), 'utf8')) as { pointers: Record<string, unknown> }
    expect(Object.keys(history.pointers).sort()).toEqual(['candidate/darwin-arm64', 'stable'])
  })

  it('rejects damaged history without deleting or replacing it', async () => {
    const { updates, store } = await fixture()
    await store.enableCandidate()
    const history = join(updates, 'rollout-history.json')
    await writeFile(history, '{bad json')
    await expect(store.acceptRollout({ track: 'stable', version: '1.0.10', state: 'active', fingerprint })).rejects.toThrow('无效')
    await expect(readFile(history, 'utf8')).resolves.toBe('{bad json')
  })

  it('rejects malformed legacy preferences and skipped values without overwriting them', async () => {
    const { updates, store } = await fixture()
    await store.enableCandidate()
    const preferences = join(updates, 'preferences.json')
    const skipped = join(updates, 'skipped-version.json')
    await writeFile(preferences, '{"schema":1,"candidateOptIn":"yes"}')
    await writeFile(skipped, '{"schema":1,"version":"not-a-version"}')
    await expect(store.readPreferences()).rejects.toThrow()
    await expect(store.skippedVersion()).rejects.toThrow('合法语义版本')
    await expect(readFile(preferences, 'utf8')).resolves.toContain('"yes"')
  })
})
