/** External archive service fixture; installation and RPC remain the shipped implementation. */
import { strToU8, zipSync } from 'fflate'

const archiveUrl = 'https://insight-desktop-updates.oss-cn-guangzhou.aliyuncs.com/desktop/skills/install-fixture.zip'
const identityArchiveUrl = 'https://insight-desktop-updates.oss-cn-guangzhou.aliyuncs.com/desktop/skills/identity-fixture.zip'
const presetNames = new Map([
  ['https://insight-desktop-updates.oss-cn-guangzhou.aliyuncs.com/desktop/skills/preset-14-fixture.zip', 'wrong-preset-name'],
  ['https://insight-desktop-updates.oss-cn-guangzhou.aliyuncs.com/desktop/skills/preset-15-fixture.zip', 'preset-15'],
  ['https://insight-desktop-updates.oss-cn-guangzhou.aliyuncs.com/desktop/skills/preset-16-fixture.zip', 'preset-16'],
])

/**
 * Replace only this scenario's public archive response inside its isolated Host process.
 * @param {import('@deepseek-ai/cordis').Context} ctx - Loader-owned fixture lifetime.
 */
export function apply(ctx) {
  const original = globalThis.fetch
  let release = 0
  const fetcher = async (input, options) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url !== archiveUrl && url !== identityArchiveUrl && !presetNames.has(url)) return original(input, options)
    options?.signal?.throwIfAborted()
    release++
    const name = presetNames.get(url)
      ?? (url === identityArchiveUrl ? 'influencer-integration' : 'browser-installed-expert')
    const bytes = zipSync({
      'fixture/SKILL.md': strToU8(`---\nname: ${name}\ndescription: Browser installation fixture\n---\n\nInstalled through the real Remote API.\n\nArchive release ${release}.\n`),
    })
    const response = new Response(new Uint8Array(bytes), { headers: { 'Content-Length': String(bytes.byteLength) } })
    Object.defineProperty(response, 'url', { value: url })
    return response
  }
  ctx.effect(() => {
    globalThis.fetch = fetcher
    return () => { globalThis.fetch = original }
  })
  ctx.provide('skillDownloadFixture', true)
}
