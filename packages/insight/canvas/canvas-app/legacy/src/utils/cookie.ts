import Cookies from 'universal-cookie';

const COOKIE = 'channel_token';
const TEN_YEAR = 7 * 24 * 60 * 60 * 1000;

interface CookieConfig {
  path?: string;
  maxAge?: number;
  domain?: string;
}

const defaultConfig: CookieConfig = {
  path: '/',
  maxAge: TEN_YEAR,
};

const cookies = new Cookies();

export function saveCookie(value: string, name = COOKIE, cookiePath: CookieConfig = defaultConfig): void {
  if (name === COOKIE) {
    cookiePath = {
      ...cookiePath,
      domain: location.host.match('aistudio.') ? location.host : undefined,
    };
  }

  return cookies.set(name, value, cookiePath);
}

export function getCookie(name = COOKIE, cookiePath?: CookieConfig): string | undefined {
  const options = cookiePath ? { path: cookiePath.path, domain: cookiePath.domain } : undefined;

  return cookies.get(name, options as any);
}

export function removeCookie(name = COOKIE, domain?: string): void {
  if (name === COOKIE) {
    domain = location.host.match('aistudio.') ? location.host : undefined;
  }

  return cookies.remove(name, { domain });
}
