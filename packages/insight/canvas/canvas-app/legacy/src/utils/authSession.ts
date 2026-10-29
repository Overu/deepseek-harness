export interface StoredAccessToken {
  value: string;
  writtenAt?: number;
  expiration?: number;
}

const ACCESS_TOKEN_KEY = 'accessToken';
const AUTH_LOGOUT_DEBUG_KEY = 'authLogoutDebugLogs';
const AUTH_LOGOUT_DEBUG_LIMIT = 10;
const INVALIDATION_LISTENERS = new Set<() => void>();
const LOGIN_REQUIRED_LISTENERS = new Set<() => void>();
const ACCESS_TOKEN_LISTENERS = new Set<() => void>();

export interface StoredAccessTokenSnapshot {
  exists: boolean;
  writtenAt: number | null;
  ageMs: number | null;
}

export interface AuthLogoutDebugRecord {
  timestamp: string;
  pathname: string;
  search: string;
  reason: string;
  requestUrl?: string;
  authRedirect: 'route' | 'always' | 'never';
  responseCode?: string | number;
  responseMsg?: string;
  traceId?: string;
  isRefreshing: boolean;
  queueSize: number;
  refreshFailedAt: number | null;
  lastRefreshSucceededAt: number | null;
  retriedAfterRefresh: boolean;
  tokenSnapshot: StoredAccessTokenSnapshot;
}

export const readStoredAccessToken = (): StoredAccessToken | null => {
  try {
    const raw = localStorage.getItem(ACCESS_TOKEN_KEY);

    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as StoredAccessToken;

    if (!parsed?.value) {
      localStorage.removeItem(ACCESS_TOKEN_KEY);
      return null;
    }

    return parsed;
  } catch {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    return null;
  }
};

export const notifyStoredAccessTokenChanged = () => {
  ACCESS_TOKEN_LISTENERS.forEach(listener => listener());
};

export const writeStoredAccessToken = (value: string) => {
  localStorage.setItem(
    ACCESS_TOKEN_KEY,
    JSON.stringify({
      value,
      writtenAt: Date.now(),
    })
  );
  notifyStoredAccessTokenChanged();
};

export const clearStoredAccessToken = () => {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem('isLoggedIn');
};

export const getStoredAccessTokenSnapshot = (): StoredAccessTokenSnapshot => {
  const storedAccessToken = readStoredAccessToken();

  if (!storedAccessToken) {
    return {
      exists: false,
      writtenAt: null,
      ageMs: null,
    };
  }

  const writtenAt = typeof storedAccessToken.writtenAt === 'number' ? storedAccessToken.writtenAt : null;

  return {
    exists: true,
    writtenAt,
    ageMs: writtenAt ? Date.now() - writtenAt : null,
  };
};

export const appendAuthLogoutDebugRecord = (record: AuthLogoutDebugRecord) => {
  try {
    const raw = sessionStorage.getItem(AUTH_LOGOUT_DEBUG_KEY);
    const existing = raw ? (JSON.parse(raw) as AuthLogoutDebugRecord[]) : [];
    const next = [...existing, record].slice(-AUTH_LOGOUT_DEBUG_LIMIT);
    sessionStorage.setItem(AUTH_LOGOUT_DEBUG_KEY, JSON.stringify(next));
  } catch (error) {
    console.warn('Failed to write auth logout debug record', error);
  }
};

export const readAuthLogoutDebugRecords = (): AuthLogoutDebugRecord[] => {
  try {
    const raw = sessionStorage.getItem(AUTH_LOGOUT_DEBUG_KEY);
    return raw ? (JSON.parse(raw) as AuthLogoutDebugRecord[]) : [];
  } catch {
    return [];
  }
};

export const subscribeAuthInvalidation = (listener: () => void) => {
  INVALIDATION_LISTENERS.add(listener);

  return () => {
    INVALIDATION_LISTENERS.delete(listener);
  };
};

export const notifyAuthInvalidated = () => {
  INVALIDATION_LISTENERS.forEach(listener => listener());
};

export const subscribeStoredAccessTokenChanged = (listener: () => void) => {
  ACCESS_TOKEN_LISTENERS.add(listener);

  return () => {
    ACCESS_TOKEN_LISTENERS.delete(listener);
  };
};

export const subscribeLoginRequired = (listener: () => void) => {
  LOGIN_REQUIRED_LISTENERS.add(listener);

  return () => {
    LOGIN_REQUIRED_LISTENERS.delete(listener);
  };
};

export const notifyLoginRequired = () => {
  LOGIN_REQUIRED_LISTENERS.forEach(listener => listener());
};
