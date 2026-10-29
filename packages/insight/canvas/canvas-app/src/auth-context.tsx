import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

export const AUTH_EXPIRED_EVENT = 'desktop-canvas-auth-expired'

type AuthStatus = { status: 'logged_in' | 'logged_out'; tokenExpired: boolean }

interface DesktopAuth {
  authStatus: AuthStatus
  isLoading: boolean
  refreshAuth: () => Promise<void>
  login: () => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<DesktopAuth | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  // The Host authenticates the iframe page and every API request; it owns the credential.
  const [authStatus, setAuthStatus] = useState<AuthStatus>({ status: 'logged_in', tokenExpired: false })
  useEffect(() => {
    const expired = () => setAuthStatus({ status: 'logged_out', tokenExpired: true })
    window.addEventListener(AUTH_EXPIRED_EVENT, expired)
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, expired)
  }, [])
  const value: DesktopAuth = {
    authStatus,
    isLoading: false,
    refreshAuth: async () => undefined,
    login: async () => undefined,
    logout: async () => { setAuthStatus({ status: 'logged_out', tokenExpired: false }) },
  }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): DesktopAuth {
  const value = useContext(AuthContext)
  if (!value) throw new Error('Canvas auth context is missing')
  return value
}
