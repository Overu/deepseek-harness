/** Renderer-safe desktop bridges for Insight authentication and account actions. */
import type {
  AccountSummary,
  AuthEnvironment,
  AuthCommandResult,
  CaptchaCommandResult,
  PasswordLoginInput,
  SessionView,
  SmsLoginInput,
} from './auth-contracts.ts'

/** Desktop IPC channels shared by the preload bridge and the Main-process handlers. */
export const INSIGHT_DESKTOP_IPC = {
  loginCurrent: 'insight:login:current',
  loginChanged: 'insight:login:changed',
  loginSendSmsCode: 'insight:login:send-sms-code',
  loginCaptcha: 'insight:login:captcha',
  loginSms: 'insight:login:sms',
  loginPassword: 'insight:login:password',
  loginResetLocal: 'insight:login:reset-local',
  loginSignOut: 'insight:login:sign-out',
  accountCurrent: 'insight:account:current',
  accountChanged: 'insight:account:changed',
  accountSignOut: 'insight:account:sign-out',
  accountInfo: 'insight:account:info',
} as const

/** Workspace entry state paired with the renderer-safe session state. */
export type InsightWorkspaceState =
  | { kind: 'idle' }
  | { kind: 'preparing' }
  | { kind: 'pre-release-data' }
  | { kind: 'failed'; message: string }

/** Complete renderer-safe state for the standalone Insight login window. */
export interface InsightLoginState {
  session: SessionView
  workspace: InsightWorkspaceState
}

/** API exposed only to the isolated Insight login renderer. */
export interface InsightLoginApi {
  current(): Promise<InsightLoginState>
  subscribe(listener: (state: InsightLoginState) => void): () => void
  sendSmsCode(phone: string): Promise<AuthCommandResult>
  captcha(): Promise<CaptchaCommandResult>
  loginSms(input: SmsLoginInput, agreed: boolean): Promise<AuthCommandResult>
  loginPassword(input: PasswordLoginInput, agreed: boolean): Promise<AuthCommandResult>
  resetLocal(): Promise<void>
  signOut(): Promise<void>
}

/** Product and runtime details safe to show in the signed-in workspace. */
export interface InsightAccountInfo {
  productName: string
  productVersion: string
  runtimeVersion: string
  platform: string
  environment: AuthEnvironment
}

/** API exposed to the authenticated workspace renderer. */
export interface InsightAccountApi {
  current(): Promise<AccountSummary | null>
  subscribe(listener: (summary: AccountSummary | null) => void): () => void
  signOut(): Promise<void>
  info(): Promise<InsightAccountInfo>
}

declare global {
  interface Window {
    insightAccount?: InsightAccountApi
  }
}
