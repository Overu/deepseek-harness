import { request as httpsRequest, type RequestOptions } from 'node:https'
import type { ClientRequest, IncomingMessage } from 'node:http'
import { BlockList, isIP } from 'node:net'

const fakeAddresses = new BlockList()
fakeAddresses.addSubnet('198.18.0.0', 15, 'ipv4')
export function isFakeAddress(address: string): boolean {
  return isIP(address) === 4 && fakeAddresses.check(address, 'ipv4')
}
type Address = { address: string; family: number }
type DnsRequest = (url: URL, options: RequestOptions, callback: (response: IncomingMessage) => void) => ClientRequest
const failure = () => new Error('Public image DNS resolution failed')
function hostnameOf(value: unknown): string {
  if (typeof value !== 'string') throw failure()
  const name = value.toLowerCase().replace(/\.$/u, '')
  if (name.length > 253 || isIP(name) || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/u.test(name)) throw failure()
  return name
}
function addressesOf(data: Buffer, hostname: string, type: number): Address[] {
  const result = JSON.parse(data.toString('utf8'))
  if (!result || result.Status !== 0 || result.TC !== undefined && result.TC !== false || !Array.isArray(result.Question) || result.Question.length !== 1 ||
    hostnameOf(result.Question[0]?.name) !== hostname || result.Question[0]?.type !== type ||
    result.Answer !== undefined && !Array.isArray(result.Answer)) throw failure()
  const answers = result.Answer ?? []
  if (answers.length > 128) throw failure()
  const aliases = new Map<string, string>(), records: (Address & { owner: string; type: number })[] = []
  for (const answer of answers) {
    if (!answer || !Number.isSafeInteger(answer.type) || answer.type < 1 || answer.type > 65535 ||
      typeof answer.data !== 'string' || !answer.data.trim() || answer.data.length > 8192) throw failure()
    const owner = hostnameOf(answer.name)
    if (answer.type === 5) {
      const target = hostnameOf(answer.data)
      if (aliases.has(owner) && aliases.get(owner) !== target) throw failure()
      aliases.set(owner, target); continue
    }
    if (answer.type !== 1 && answer.type !== 28) continue
    const family = answer.type === 1 ? 4 : 6
    if (isIP(answer.data) !== family) throw failure()
    records.push({ owner, type: answer.type, address: answer.data, family })
  }
  const owners = new Set([hostname]); let owner = hostname
  while (aliases.has(owner)) {
    owner = aliases.get(owner)!
    if (owners.has(owner)) throw failure()
    owners.add(owner)
  }
  if (records.some(record => !owners.has(record.owner))) throw failure()
  return records.filter(record => record.type === type).map(({ address, family }) => ({ address, family }))
}

/** Fake-IP fallback only: disclose a hostname to one fixed resolver, with its TLS authority pinned. */
export async function resolvePublicImageHost(hostname: string, caller: AbortSignal, request: DnsRequest = httpsRequest): Promise<Address[]> {
  if (caller.aborted) throw failure()
  const name = hostnameOf(hostname), lifetime = new AbortController()
  const signal = AbortSignal.any([caller, AbortSignal.timeout(8_000), lifetime.signal])
  async function query(type: number): Promise<Address[]> {
    const url = new URL('https://cloudflare-dns.com/dns-query')
    url.searchParams.set('name', name); url.searchParams.set('type', String(type))
    return new Promise((resolve, reject) => {
      let req: ClientRequest | undefined, response: IncomingMessage | undefined, settled = false
      const finish = (error?: unknown, addresses?: Address[]) => {
        if (settled) return
        settled = true; signal.removeEventListener('abort', abort)
        if (error) { response?.destroy(); req?.destroy(); reject(failure()) }
        else resolve(addresses!)
      }
      const abort = () => finish(failure())
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) { abort(); return }
      try {
        req = request(url, { method: 'GET', agent: false, family: 4, servername: 'cloudflare-dns.com', rejectUnauthorized: true,
          lookup: (_hostname, _options, callback) => callback(null, '1.1.1.1', 4),
          headers: { accept: 'application/dns-json', host: 'cloudflare-dns.com' } }, res => {
          response = res
          if (settled || res.statusCode !== 200 || Number(res.headers['content-length']) > 32 * 1024) { res.destroy(); finish(failure()); return }
          const chunks: Buffer[] = []; let bytes = 0
          res.on('data', chunk => {
            bytes += chunk.length
            if (bytes > 32 * 1024) finish(failure())
            else chunks.push(Buffer.from(chunk))
          })
          res.once('error', () => finish(failure())); res.once('aborted', () => finish(failure()))
          res.once('end', () => {
            if (settled) return
            try { finish(undefined, addressesOf(Buffer.concat(chunks), name, type)) }
            catch { finish(failure()) }
          })
        })
        req.once('error', () => finish(failure())); req.end()
        if (signal.aborted) abort()
      } catch { finish(failure()) }
    })
  }
  try {
    const addresses = (await Promise.all([query(1), query(28)])).flat()
    if (!addresses.length) throw failure()
    return addresses.filter((entry, index) => addresses.findIndex(other => other.address === entry.address) === index)
  } finally { lifetime.abort() }
}
