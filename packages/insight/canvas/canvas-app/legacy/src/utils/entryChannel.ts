const ANNOUNCEMENT_CACHE_KEY = 'insight_announcement_cache';
const ENTRY_CHANNEL_KEY = 'entry_channel';
const SUPPORTED_ENTRY_CHANNELS = new Set(['dynsight', 'inflow']);

export type EntryChannel = 'dynsight' | 'inflow';

const ENTRY_BRAND_META: Record<EntryChannel, { title: string; iconHref: string }> = {
  dynsight: {
    title: 'DynSight 掂商',
    iconHref: '/GameAI.png',
  },
  inflow: {
    title: 'InFlow 影流',
    iconHref: '/inflowLogo.svg',
  },
};

export function getEntryChannelFromSearch(search: string): EntryChannel | null {
  const channel = new URLSearchParams(search).get('channel');
  if (!channel || !SUPPORTED_ENTRY_CHANNELS.has(channel)) return null;

  return channel as EntryChannel;
}

function getEntryChannelFromPath(pathname = typeof window === 'undefined' ? '' : window.location.pathname): EntryChannel | null {
  if (pathname === '/' || pathname.startsWith('/s/')) return 'dynsight';
  if (pathname === '/portal.html') return 'inflow';

  return null;
}

function getStoredEntryChannel(): EntryChannel | null {
  if (typeof localStorage === 'undefined') return null;

  try {
    const channel = localStorage.getItem(ENTRY_CHANNEL_KEY);
    if (channel && SUPPORTED_ENTRY_CHANNELS.has(channel)) return channel as EntryChannel;

    const cache = JSON.parse(localStorage.getItem(ANNOUNCEMENT_CACHE_KEY) || '{"channel":null}');
    if (cache?.channel && SUPPORTED_ENTRY_CHANNELS.has(cache.channel)) return cache.channel as EntryChannel;
  } catch {
    return null;
  }

  return null;
}

function getCurrentEntryChannel(
  search = typeof window === 'undefined' ? '' : window.location.search,
  pathname = typeof window === 'undefined' ? '' : window.location.pathname
): EntryChannel {
  return getEntryChannelFromSearch(search) ?? getEntryChannelFromPath(pathname) ?? getStoredEntryChannel() ?? 'dynsight';
}

export function recordEntryChannel(channel: EntryChannel | null) {
  if (!channel || !SUPPORTED_ENTRY_CHANNELS.has(channel)) return false;

  try {
    localStorage.setItem(ENTRY_CHANNEL_KEY, channel);

    let cache: { channel: EntryChannel | null; shownIds?: unknown[] } = { channel: null, shownIds: [] };
    try {
      cache = JSON.parse(localStorage.getItem(ANNOUNCEMENT_CACHE_KEY) || '{"channel":null,"shownIds":[]}');
    } catch {
      cache = { channel: null, shownIds: [] };
    }

    cache.channel = channel;
    cache.shownIds = Array.isArray(cache.shownIds) ? cache.shownIds : [];
    localStorage.setItem(ANNOUNCEMENT_CACHE_KEY, JSON.stringify(cache));
  } catch {
    return false;
  }

  return true;
}

export function syncEntryChannelFromSearch(search = typeof window === 'undefined' ? '' : window.location.search) {
  const channel = getEntryChannelFromSearch(search) ?? getEntryChannelFromPath();
  const didRecord = recordEntryChannel(channel);
  applyEntryBrandMeta(channel ?? getCurrentEntryChannel(search));

  return didRecord;
}

export function applyEntryBrandMeta(channel: EntryChannel = getCurrentEntryChannel()) {
  if (typeof document === 'undefined') return;

  const meta = ENTRY_BRAND_META[channel];
  document.title = meta.title;

  const icon = getOrCreateFaviconLink();
  icon.type = 'image/svg+xml';
  icon.href = meta.iconHref;
}

function getOrCreateFaviconLink() {
  const existing = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
  if (existing) return existing;

  const icon = document.createElement('link');
  icon.rel = 'icon';
  document.head.appendChild(icon);

  return icon;
}
