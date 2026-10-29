/** Authentication environment selected by the desktop distribution channel. */
export type AuthEnvironment = 'test' | 'production'

/** Account fields that may be sent to an untrusted renderer. */
export interface AccountSummary {
  displayName: string
  avatarUrl?: string
  maskedPhone: string
}

/** Authentication state safe to expose through desktop IPC. */
export type SessionView =
  | { kind: 'restoring' }
  | { kind: 'unauthenticated' }
  | { kind: 'authenticating'; method: 'sms' | 'password' }
  | { kind: 'authenticated'; account: AccountSummary }
  | { kind: 'offline' }
  | { kind: 'expired' }

/** SMS login fields supplied by the desktop renderer. */
export interface SmsLoginInput {
  phone: string
  code: string
}

/** Password login fields supplied by the desktop renderer. */
export interface PasswordLoginInput {
  phone: string
  password: string
  uuid: string
  imageCode: string
}

/** Captcha fields safe to expose to the desktop renderer. */
export interface CaptchaView {
  uuid: string
  image: string
}

/** Result of a mutating authentication command. */
export type AuthCommandResult =
  | { ok: true }
  | {
    ok: false
    reason: 'invalid-input' | 'rejected' | 'offline' | 'service-error'
    message: string
  }

/** Result of requesting a password-login captcha. */
export type CaptchaCommandResult =
  | { ok: true; captcha: CaptchaView }
  | {
    ok: false
    reason: 'offline' | 'service-error'
    message: string
  }
