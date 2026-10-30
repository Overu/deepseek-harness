import { describe, expect, it, onTestFinished } from 'vitest'
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collectInsightArtifacts, type CollectInsightArtifactsInput } from './collect.ts'
import { verifyInsightDesktopBuildManifest } from './artifacts.ts'

async function fixture(): Promise<CollectInsightArtifactsInput> {
  const root = await mkdtemp(join(tmpdir(), 'insight-collect-test-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const artifactDirectory = join(root, 'artifacts')
  await mkdir(artifactDirectory)
  for (const name of ['insight-1.0.10-rc.1-mac-arm64.dmg', 'insight-1.0.10-rc.1-mac-arm64.zip',
    'insight-1.0.10-rc.1-mac-arm64.zip.blockmap', 'nightly-mac.yml']) {
    await writeFile(join(artifactDirectory, name), `packaged bytes: ${name}`)
  }
  await mkdir(join(artifactDirectory, 'mac-arm64'))
  await writeFile(join(artifactDirectory, 'private-stage.log'), 'do not upload unrelated files')
  return { artifactDirectory, temporaryDirectory: join(root, 'stage'), version: '1.0.10-rc.1',
    runtimeVersion: '0.2.2-alpha.2', sourceCommit: 'a'.repeat(40), target: 'darwin-arm64', qualification: 'distribution' }
}

describe('Insight Release asset collection', () => {
  it('stages only the completed target assets and makes metadata names unique across architectures', async () => {
    const input = await fixture()
    const result = await collectInsightArtifacts(input)
    expect((await readdir(result.directory)).sort()).toEqual([
      'insight-1.0.10-rc.1-darwin-arm64.yml',
      'insight-1.0.10-rc.1-mac-arm64.dmg',
      'insight-1.0.10-rc.1-mac-arm64.zip',
      'insight-1.0.10-rc.1-mac-arm64.zip.blockmap',
      'insight-build-darwin-arm64.json',
    ])
    expect(await readFile(join(result.directory, 'insight-1.0.10-rc.1-darwin-arm64.yml'), 'utf8'))
      .toBe(await readFile(join(input.artifactDirectory, 'nightly-mac.yml'), 'utf8'))
    const manifest = await verifyInsightDesktopBuildManifest({ artifactDirectory: result.directory,
      manifestFilename: result.manifestFilename, expected: input, purpose: 'publish' })
    expect(manifest.runtimeVersion).toBe('0.2.2-alpha.2')
    expect(await readFile(join(input.artifactDirectory, 'private-stage.log'), 'utf8')).toBe('do not upload unrelated files')
  })

  it('rejects a missing target artifact and removes partial staging while retaining the source', async () => {
    const input = await fixture()
    await rm(join(input.artifactDirectory, 'insight-1.0.10-rc.1-mac-arm64.zip'))
    await expect(collectInsightArtifacts(input)).rejects.toThrow()
    expect(await readdir(input.temporaryDirectory)).toEqual([])
    expect(await readFile(join(input.artifactDirectory, 'insight-1.0.10-rc.1-mac-arm64.dmg'), 'utf8'))
      .toContain('packaged bytes')
  })

  it.skipIf(process.platform === 'win32')('rejects a linked installer before treating it as a Release attachment', async () => {
    const input = await fixture()
    const installer = join(input.artifactDirectory, 'insight-1.0.10-rc.1-mac-arm64.dmg')
    await rm(installer)
    await symlink(join(input.artifactDirectory, 'private-stage.log'), installer)
    await expect(collectInsightArtifacts(input)).rejects.toThrow('Invalid packaged asset')
    expect(await readdir(input.temporaryDirectory)).toEqual([])
  })
})
