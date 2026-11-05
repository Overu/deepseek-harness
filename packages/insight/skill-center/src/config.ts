/** Request limits shared by the Host and browser skill directory. */
import z from '@deepseek-ai/schemastery'

/** Deployment policy for OSS directory requests. */
export interface Config {
  /** Catalogue IDs for first installation, or technical names for catalogue entries without an ID. */
  presetSkillIds: string[]
  /** Absolute previous application skill directories discovered read-only for compatibility. */
  legacySkillDirs: string[]
  /** Maximum time for the response headers and JSON body, in milliseconds. */
  catalogRequestTimeoutMs: number
  /** Maximum time for downloading one skill archive, in milliseconds. */
  packageRequestTimeoutMs: number
  /** Maximum compressed bytes accepted for one skill archive. */
  packageMaxDownloadBytes: number
  /** Maximum files and directories accepted from one skill archive. */
  packageMaxEntries: number
  /** Maximum uncompressed bytes accepted from one skill archive. */
  packageMaxExtractedBytes: number
  /** HTTPS origins from which the Host may download skill archives. */
  packageAllowedOrigins: string[]
}

/** Validated request budget projected to browser pages. */
export const Config: z<Partial<Config>, Config> = z.object({
  presetSkillIds: z.array(z.string().pattern(/\S/u)).default([]),
  legacySkillDirs: z.array(z.string().pattern(/^(?:\/|[a-z]:[\\/]|\\\\)/iu)).default([]),
  catalogRequestTimeoutMs: z.natural().min(1).max(2_147_483_647).default(15_000),
  packageRequestTimeoutMs: z.natural().min(1).max(2_147_483_647).default(120_000),
  packageMaxDownloadBytes: z.natural().min(1).max(1024 * 1024 * 1024).default(64 * 1024 * 1024),
  packageMaxEntries: z.natural().min(1).max(100_000).default(10_000),
  packageMaxExtractedBytes: z.natural().min(1).max(4 * 1024 * 1024 * 1024).default(256 * 1024 * 1024),
  packageAllowedOrigins: z.array(z.string()).default([
    'https://insight-desktop-updates.oss-cn-guangzhou.aliyuncs.com',
  ]),
})
