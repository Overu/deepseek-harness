/** Tests for immutable Insight desktop build artifacts. */

import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import {
  createInsightDesktopBuildManifest,
  serializeInsightDesktopBuildManifest,
  verifyInsightDesktopBuildManifest,
  writeInsightDesktopBuildManifest,
  type CreateInsightDesktopBuildManifestInput,
} from './artifacts.ts'

const COMMIT = '0123456789abcdef0123456789abcdef01234567'
const MANIFEST = 'insight-desktop-build.json'

/** Create an isolated artifact directory, its one asset, and a valid build request. */
async function fixture(qualification: 'debug-signed' | 'distribution' = 'distribution'): Promise<{
  readonly directory: string
  readonly input: CreateInsightDesktopBuildManifestInput
}> {
  const directory = await mkdtemp(join(tmpdir(), 'insight-desktop-artifacts-'))
  onTestFinished(() => rm(directory, { recursive: true, force: true }))
  await writeFile(join(directory, 'Insight-1.0.10-rc.1-arm64.dmg'), 'immutable build bytes')
  return {
    directory,
    input: {
      artifactDirectory: directory,
      manifestFilename: MANIFEST,
      version: '1.0.10-rc.1',
      runtimeVersion: '1.0.9',
      sourceCommit: COMMIT,
      target: 'darwin-arm64',
      qualification,
      assetFilenames: ['Insight-1.0.10-rc.1-arm64.dmg'],
    },
  }
}

/** Create and write a normal manifest fixture. */
async function writtenFixture(qualification: 'debug-signed' | 'distribution' = 'distribution'): Promise<{
  readonly directory: string
  readonly input: CreateInsightDesktopBuildManifestInput
}> {
  const result = await fixture(qualification)
  const manifest = await createInsightDesktopBuildManifest(result.input)
  await writeInsightDesktopBuildManifest(result.directory, MANIFEST, manifest)
  return result
}

/** Verify an artifact directory using the fixture's intended selected release. */
function verifyFixture(directory: string, input: CreateInsightDesktopBuildManifestInput, purpose: 'github-release' | 'publish' = 'github-release') {
  return verifyInsightDesktopBuildManifest({
    artifactDirectory: directory,
    manifestFilename: MANIFEST,
    expected: { version: input.version, sourceCommit: input.sourceCommit, target: input.target },
    purpose,
  })
}

describe('Insight desktop artifact manifests', () => {
  it('accepts the first rc release and verifies its downloaded bytes', async () => {
    const { directory, input } = await writtenFixture()

    await expect(verifyFixture(directory, input)).resolves.toMatchObject({ version: '1.0.10-rc.1', qualification: 'distribution' })
  })

  it('rejects an asset that differs from the GitHub Release manifest', async () => {
    const { directory, input } = await writtenFixture()
    await writeFile(join(directory, input.assetFilenames[0]!), 'tampered build bytes')

    await expect(verifyFixture(directory, input, 'publish')).rejects.toThrow('Asset bytes do not match manifest')
  })

  it('rejects debug-signed artifacts from OSS publication', async () => {
    const { directory, input } = await writtenFixture('debug-signed')

    await expect(verifyFixture(directory, input, 'publish')).rejects.toThrow('debug-signed')
  })

  it('rejects unknown JSON fields before reading assets', async () => {
    const { directory, input } = await writtenFixture()
    const manifest = await createInsightDesktopBuildManifest(input)
    await writeFile(join(directory, MANIFEST), JSON.stringify({ ...manifest, unexpected: true }))

    await expect(verifyFixture(directory, input)).rejects.toThrow('unknown or missing fields')
  })

  it('rejects a different product or selected target', async () => {
    const { directory, input } = await writtenFixture()
    const manifest = await createInsightDesktopBuildManifest(input)
    await writeFile(join(directory, MANIFEST), JSON.stringify({ ...manifest, product: 'other' }))
    await expect(verifyFixture(directory, input)).rejects.toThrow('different product')

    await writeInsightDesktopBuildManifest(directory, MANIFEST, manifest)
    await expect(verifyInsightDesktopBuildManifest({
      artifactDirectory: directory,
      manifestFilename: MANIFEST,
      expected: { version: input.version, sourceCommit: input.sourceCommit, target: 'darwin-x64' },
      purpose: 'github-release',
    })).rejects.toThrow('identity does not match')
  })

  it('rejects unsafe, duplicate, empty, directory, and self-referential assets', async () => {
    const { directory, input } = await fixture()
    await writeFile(join(directory, 'empty.dmg'), '')
    await mkdir(join(directory, 'directory.dmg'))

    await expect(createInsightDesktopBuildManifest({ ...input, assetFilenames: ['../outside.dmg'] })).rejects.toThrow('basename')
    await expect(createInsightDesktopBuildManifest({ ...input, assetFilenames: [input.assetFilenames[0]!, input.assetFilenames[0]!] })).rejects.toThrow('duplicate')
    await expect(createInsightDesktopBuildManifest({ ...input, assetFilenames: ['empty.dmg'] })).rejects.toThrow('non-empty regular file')
    await expect(createInsightDesktopBuildManifest({ ...input, assetFilenames: ['directory.dmg'] })).rejects.toThrow('non-empty regular file')
    await expect(createInsightDesktopBuildManifest({ ...input, assetFilenames: [MANIFEST] })).rejects.toThrow('must not list itself')
  })

  it.skipIf(process.platform === 'win32')('rejects linked assets', async () => {
    const { directory, input } = await fixture()
    await symlink(input.assetFilenames[0]!, join(directory, 'linked.dmg'))

    await expect(createInsightDesktopBuildManifest({ ...input, assetFilenames: ['linked.dmg'] })).rejects.toThrow('directory or link')
  })

  it('rejects self-referential and oversized downloaded manifests', async () => {
    const { directory, input } = await writtenFixture()
    const manifest = await createInsightDesktopBuildManifest(input)
    const selfReferential = {
      ...manifest,
      assets: [{ ...manifest.assets[0]!, filename: MANIFEST }],
    }
    await writeFile(join(directory, MANIFEST), serializeInsightDesktopBuildManifest(selfReferential))
    await expect(verifyFixture(directory, input)).rejects.toThrow('must not list itself')

    await writeFile(join(directory, MANIFEST), ' '.repeat(256 * 1024 + 1))
    await expect(verifyFixture(directory, input)).rejects.toThrow('no larger')
  })
})
