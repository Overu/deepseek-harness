/** Tests for the isolated Insight macOS package credential adapter. */

import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseEnv } from 'node:util'
import { describe, expect, it, onTestFinished } from 'vitest'
import { prepareInsightMacOSConfiguration, quoteDotenvValue, removeInsightMacOSConfiguration } from './prepare-macos.ts'

/** Allocate a per-case Actions-like root and register its cleanup immediately. */
async function fixture(): Promise<{ readonly root: string; readonly runnerTemp: string; readonly workspace: string }> {
  const root = await mkdtemp(join(tmpdir(), 'insight-macos-configuration-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const runnerTemp = join(root, 'runner-temp')
  const workspace = join(root, 'workspace')
  await Promise.all([mkdir(runnerTemp), mkdir(workspace)])
  return { root, runnerTemp, workspace }
}

describe('Insight macOS package configuration', () => {
  it('isolates P12 and notarization credentials while preserving dotenv special characters', async () => {
    const { root, runnerTemp, workspace } = await fixture()
    const output = join(root, 'github-output')
    const environment = join(root, 'github-environment')
    const prepared = await prepareInsightMacOSConfiguration({
      runnerTemp,
      workspace,
      target: 'mac-arm64',
      skipNotarization: false,
      certificateBase64: Buffer.from('test p12 bytes').toString('base64'),
      certificatePassword: 'space $ # slash\\ apostrophe\'',
      teamId: '8P39WV82RX',
      signingIdentity: 'Insight AI (8P39WV82RX)',
      appleApiKey: '-----BEGIN PRIVATE KEY-----\nprivate test key\n-----END PRIVATE KEY-----',
      appleApiKeyId: 'A1B2C3D4E5',
      appleApiIssuer: '7d0ea660-497c-4c36-956e-7f5fd3c59e55',
      outputFile: output,
      environmentFile: environment,
    })

    const secretSettings = parseEnv(await readFile(join(prepared.packagingConfigDirectory, 'secrets', 'macos-signing.env'), 'utf8'))
    const certificatePath = secretSettings.CSC_LINK
    const apiKeyPath = secretSettings.APPLE_API_KEY
    if (certificatePath === undefined || apiKeyPath === undefined) throw new Error('Expected macOS signing dotenv paths')
    expect(secretSettings.CSC_KEY_PASSWORD).toBe('space $ # slash\\ apostrophe\'')
    expect(secretSettings.CSC_LINK).toBe(join(prepared.temporaryDirectory, 'signing-certificate.p12'))
    expect(secretSettings.APPLE_API_KEY).toBe(join(prepared.temporaryDirectory, 'notarization-api-key.p8'))
    expect(await readFile(certificatePath)).toEqual(Buffer.from('test p12 bytes'))
    expect(await readFile(apiKeyPath, 'utf8')).toContain('private test key')
    const temporaryDirectoryStats = await stat(prepared.temporaryDirectory)
    expect(typeof temporaryDirectoryStats.mode).toBe('number')
    expect(temporaryDirectoryStats.mode & 0o077).toBe(0)
    expect(await readFile(output, 'utf8')).toContain(`artifact_directory=${join(workspace, 'apps', 'desktop', '.desktop-build', 'targets', 'mac-arm64', 'artifacts')}`)
    expect(await readFile(output, 'utf8')).not.toContain('private test key')
    expect(await readFile(output, 'utf8')).not.toContain('space $ #')
    expect(await readFile(environment, 'utf8')).toContain(`DSH_PACKAGING_CONFIG_DIR=${prepared.packagingConfigDirectory}`)
    await removeInsightMacOSConfiguration(runnerTemp, prepared.temporaryDirectory)
    await expect(stat(prepared.temporaryDirectory)).rejects.toThrow()
  })

  it('uses the unnotarized artifact directory only for explicit debug packaging', async () => {
    const { runnerTemp, workspace } = await fixture()
    const prepared = await prepareInsightMacOSConfiguration({
      runnerTemp, workspace, target: 'mac-x64', skipNotarization: true,
      certificateBase64: Buffer.from('x').toString('base64'), certificatePassword: 'password',
      teamId: '8P39WV82RX', signingIdentity: 'Insight AI (8P39WV82RX)', appleApiKey: 'pem', appleApiKeyId: 'A1B2C3D4E5', appleApiIssuer: 'issuer',
    })
    expect(prepared.artifactDirectory).toContain('mac-x64/unnotarized-artifacts')
  })

  it('rejects unrepresentable dotenv credentials and unsafe cleanup paths', async () => {
    expect(quoteDotenvValue('')).toBe('""')
    await expect(Promise.resolve().then(() => quoteDotenvValue('bad"quote'))).rejects.toThrow('double quote')
    const { root, runnerTemp } = await fixture()
    await expect(removeInsightMacOSConfiguration(runnerTemp, root)).rejects.toThrow('refuses to remove')
  })
})
