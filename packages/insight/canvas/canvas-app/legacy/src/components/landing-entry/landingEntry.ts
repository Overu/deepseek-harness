import { recordEntryChannel } from '@/utils/entryChannel';

type EntryTarget = 'dynsight' | 'inflow';
type AuthStatus = 'logged_in' | 'logged_out';

interface LocationLike {
  hostname: string;
  origin: string;
}

const TEST_DYNSIGHT_HOST = 'test-base-platform.insight-aigc.com';
const TEST_DYNSIGHT_ORIGIN = 'https://dynsight-test.insight-aigc.com';
const PROD_DYNSIGHT_ORIGIN = 'https://dynsight.insight-aigc.com';

const getLocation = (locationLike?: LocationLike) => locationLike ?? (typeof window === 'undefined' ? undefined : window.location);

const appendStoredInviteCode = (href: string) => {
  if (typeof window === 'undefined') return href;

  const sCode = localStorage.getItem('sCode');
  if (!sCode) return href;

  const url = new URL(href);
  url.searchParams.set('sCode', sCode);
  return url.toString();
};

// TODO: 需要明确定义不同的尺寸的判定标准，目前有多处不一致的处理
export function isLandingMobile() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(max-width: 1024px)').matches;
}

export function resolveDynSightOrigin(locationLike?: LocationLike) {
  const currentLocation = getLocation(locationLike);
  const currentHostname = currentLocation?.hostname ?? '';
  const currentOrigin = currentLocation?.origin ?? PROD_DYNSIGHT_ORIGIN;

  if (currentHostname === TEST_DYNSIGHT_HOST || currentHostname === 'localhost') {
    return currentOrigin;
  }

  return PROD_DYNSIGHT_ORIGIN;
}

export function resolveDynSightHomeHref(locationLike?: LocationLike) {
  const currentLocation = getLocation(locationLike);
  const currentHostname = currentLocation?.hostname ?? '';

  if (currentHostname === 'localhost' || currentHostname === '127.0.0.1') {
    return appendStoredInviteCode(`${currentLocation?.origin ?? PROD_DYNSIGHT_ORIGIN}/home`);
  }

  if (currentHostname === TEST_DYNSIGHT_HOST || currentHostname.endsWith('-test.insight-aigc.com')) {
    return appendStoredInviteCode(`${TEST_DYNSIGHT_ORIGIN}/home`);
  }

  return appendStoredInviteCode(`${PROD_DYNSIGHT_ORIGIN}/home`);
}

export function resolveDynSightLoginHref(locationLike?: LocationLike) {
  return `${resolveDynSightOrigin(locationLike)}/login?channel=dynsight`;
}

export function getLandingDesktopUnlockParam() {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('desktopUnlock') === '1';
}

export function clearLandingDesktopUnlockParam() {
  if (typeof window === 'undefined') return;

  const url = new URL(window.location.href);
  if (!url.searchParams.has('desktopUnlock')) return;

  url.searchParams.delete('desktopUnlock');
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
}

export function startDynSightFromLanding(authStatus?: AuthStatus) {
  if (typeof window === 'undefined') return;

  recordEntryChannel('dynsight');

  if (!isLandingMobile() && authStatus === 'logged_in') {
    window.location.href = '/home';
    return;
  }

  const redirectPath = isLandingMobile() ? '/?desktopUnlock=1' : '/home';
  sessionStorage.setItem('redirectPath', redirectPath);
  window.location.href = '/login?channel=dynsight';
}

export function getDesktopLoginCopyHref(target: EntryTarget = 'dynsight') {
  if (target === 'inflow') {
    return `${resolveDynSightOrigin()}/login?channel=inflow`;
  }

  return resolveDynSightLoginHref();
}
