import { get, post } from './request';
import { getCookie } from '@/utils/cookie';
import { clearStoredAccessToken, notifyAuthInvalidated, notifyLoginRequired, readStoredAccessToken } from '@/utils/authSession';

export interface MessageCategory {
  categoryCode: string;
  categoryName: string;
}

export interface UserMessage {
  userMessageId: number;
  messageId: number;
  categoryCode: string;
  messageType: string;
  title: string;
  summary?: string | null;
  content?: string | null;
  richContent?: string | null;
  richContentFormat?: string | null;
  rich_content?: string | null;
  rich_content_format?: string | null;
  senderType?: string | null;
  senderId?: number | null;
  jumpType?: string | null;
  jumpUrl?: string | null;
  detailEnabled?: number;
  priority?: number;
  publishedAt?: string | null;
  expiredAt?: string | null;
  extraJson?: string | Record<string, unknown> | null;
  readStatus: 0 | 1;
  readAt?: string | null;
  receivedAt?: string | null;
}

export interface MessageListData {
  items: UserMessage[];
  nextCursor?: number | null;
  hasMore: boolean;
  maxUserMessageId?: number | null;
  unreadCount: number;
  serverTime?: string;
}

export interface MessageListParams {
  type?: string;
  categoryCode?: string;
  cursor?: number | null;
  limit: number;
}

export interface MarkReadParams {
  type: 'BATCH' | 'ALL';
  categoryCode?: string;
  idList?: number[];
}

export type MessageSSEEvent =
  | {
      event: 'connected';
      data: {
        serverTime?: string;
        lastMessageId?: number;
        unreadCount?: number;
      };
      id?: number;
    }
  | {
      event: 'message.created';
      data: UserMessage;
      id?: number;
    }
  | {
      event: 'message.deleted';
      data: Partial<UserMessage>;
      id?: number;
    }
  | {
      event: 'message.updated';
      data: {
        unreadCount: number;
      };
      id?: number;
    };

const MESSAGE_ENDPOINTS = {
  TYPE: '/user-server/message/type',
  LIST: '/user-server/message/list',
  MARK_READ: '/user-server/message/markRead',
  SUBSCRIBE: '/user-server/message/subscribe',
} as const;

export const getMessageTypes = () => get<MessageCategory[]>(MESSAGE_ENDPOINTS.TYPE);

export const getMessageList = (params: MessageListParams, signal?: AbortSignal) => post<MessageListData>(MESSAGE_ENDPOINTS.LIST, params, { signal });

export const markMessageRead = (params: MarkReadParams) => post<Record<string, never>>(MESSAGE_ENDPOINTS.MARK_READ, params);

export class MessageSSEAuthError extends Error {
  status: number;

  constructor(status: number) {
    super('Message SSE auth expired');
    this.name = 'MessageSSEAuthError';
    this.status = status;
  }
}

function getFullUrl(path: string): string {
  const baseUrl = import.meta.env.DEV ? '' : import.meta.env.VITE_API_BASE_URL || '';
  return `${baseUrl}${path.startsWith('/') ? path : '/' + path}`;
}

function getMessageSSEHeaders(): HeadersInit {
  const headers: Record<string, string> = {
    Accept: 'text/event-stream',
    'Accept-Language': localStorage.getItem('locale') || 'zh-CN',
    'Cache-Control': 'no-cache',
  };

  const storedAccessToken = readStoredAccessToken();
  const token = storedAccessToken?.value || getCookie();

  if (token) {
    headers.token = token;
  }

  return headers;
}

function parseSSEEvent(eventText: string): MessageSSEEvent | null {
  const lines = eventText.split('\n');
  let event = 'message';
  let id: number | undefined;
  const dataLines: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line || line.startsWith(':')) {
      continue;
    }

    if (line.startsWith('id:')) {
      const parsedId = Number(line.slice(3).trim());
      if (!Number.isNaN(parsedId)) {
        id = parsedId;
      }
      continue;
    }

    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
      continue;
    }

    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trim());
    }
  }

  if (!dataLines.length) {
    return null;
  }

  try {
    const data = JSON.parse(dataLines.join('\n'));
    if (event === 'connected' || event === 'message.created' || event === 'message.deleted' || event === 'message.updated') {
      return { event, data, id } as MessageSSEEvent;
    }
  } catch (error) {
    console.warn('[Message SSE] Failed to parse event data', error);
  }

  return null;
}

export function subscribeMessageSSE(options: {
  lastMessageId?: number | null;
  signal?: AbortSignal;
  onEvent: (event: MessageSSEEvent) => void;
  onError?: (error: Error) => void;
  onClose?: () => void;
}) {
  const controller = new AbortController();
  const signal = options.signal || controller.signal;
  const url = new URL(getFullUrl(MESSAGE_ENDPOINTS.SUBSCRIBE), window.location.origin);

  if (options.lastMessageId) {
    url.searchParams.set('lastMessageId', String(options.lastMessageId));
  }

  const run = async () => {
    let buffer = '';

    try {
      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: getMessageSSEHeaders(),
        signal,
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          clearStoredAccessToken();
          notifyAuthInvalidated();
          notifyLoginRequired();
          throw new MessageSSEAuthError(response.status);
        }
        throw new Error(`Message SSE HTTP ${response.status}`);
      }

      if (!response.body) {
        throw new Error('Message SSE response body is null');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          const finalEvent = buffer.trim() ? parseSSEEvent(buffer) : null;
          if (finalEvent) {
            options.onEvent(finalEvent);
          }
          options.onClose?.();
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split(/\r?\n\r?\n/);
        buffer = events.pop() || '';

        for (const eventText of events) {
          const parsed = parseSSEEvent(eventText);
          if (parsed) {
            options.onEvent(parsed);
          }
        }
      }
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        options.onClose?.();
        return;
      }

      const normalized = error instanceof Error ? error : new Error(String(error));
      options.onError?.(normalized);
    }
  };

  run();

  return {
    abort: () => controller.abort(),
  };
}
