/** Host-only account service definition and structured access failures for trusted plugins. */
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
