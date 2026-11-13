/** Account credentials and service addresses for trusted Host plugins. */
import { InsightAccount } from './host/account-service.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    insightAccount: InsightAccount
  }
}

/** Public Host-only service types for Insight Desktop integrations. */
export {
  InsightAccount,
  InsightAccountAccessError,
  type InsightAccountAccessFailure,
  type InsightAccountScheduler,
  type InsightAccountServiceOptions,
  type InsightAccountTransport,
} from './host/account-service.ts'
/** Fixed service bases shared by authenticated Host integrations. */
export { desktopServiceEnvironment, skillProxyServiceBaseUrl, uploadCenterServiceBaseUrl } from './shared/service-environment.ts'
/** Authenticated NDJSON transport shared by Host-only skill consumers. */
export { createInsightSkillProxyRequest, InsightSkillProxyError } from './host/skill-proxy-request.ts'
