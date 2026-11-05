/** Request limits shared by the Host and browser skill directory. */
import z from '@deepseek-ai/schemastery'

/** Deployment policy for OSS directory requests. */
export interface Config {
  /** Maximum time for the response headers and JSON body, in milliseconds. */
  catalogRequestTimeoutMs: number
}

/** Validated request budget projected to browser pages. */
export const Config: z<Partial<Config>, Config> = z.object({
  catalogRequestTimeoutMs: z.natural().min(1).max(2_147_483_647).default(15_000),
})
