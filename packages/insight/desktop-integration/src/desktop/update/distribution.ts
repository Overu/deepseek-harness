/** Load public update trust material shipped inside the signed Insight application. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createPublicKey } from 'node:crypto'
import { z } from 'zod'

const distributionSchema = z.object({ schema: z.literal(1), updateOrigin: z.url() }).strict()

/**
 * Read the fixed distribution origin and Ed25519 verification key from product resources.
 * @param directory - Main-owned product resource directory inside the installed application.
 * @returns Public verification material; malformed configuration stops update initialization.
 */
export async function readInsightUpdateDistribution(directory: string): Promise<{ origin: string; publicKeyPem: string }> {
  const [document, publicKeyPem] = await Promise.all([
    readFile(join(directory, 'update-distribution.json'), 'utf8'),
    readFile(join(directory, 'update-signing-public.pem'), 'utf8'),
  ])
  const config = distributionSchema.parse(JSON.parse(document))
  const origin = new URL(config.updateOrigin)
  if (origin.protocol !== 'https:' || origin.username !== '' || origin.password !== '' || origin.pathname !== '/' || origin.search !== '' || origin.hash !== '') {
    throw new Error('Insight update origin must be a bare HTTPS origin')
  }
  if (createPublicKey(publicKeyPem).asymmetricKeyType !== 'ed25519') throw new Error('Insight update verification requires an Ed25519 key')
  return { origin: origin.origin, publicKeyPem }
}
