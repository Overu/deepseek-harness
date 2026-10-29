import type { UserMessage } from '@/api/message';
import { formatChatTime } from '@/utils';
import { INTERACTION_CATEGORY_CODE, SYSTEM_CATEGORY_CODE } from './messageConstants';

export type MessageExtraJson = {
  receiver_user_id?: number | string | null;
  actor_user_id?: number | string | null;
  actor_name?: string | null;
  actor_avatar_url?: string | null;
  work_id?: number | string | null;
  work_title?: string | null;
  work_cover_url?: string | null;
  source_biz_type?: string | null;
  source_biz_id?: number | string | null;
  followed?: boolean | null;
  [key: string]: unknown;
};

export function parseMessageExtraJson(extraJson: UserMessage['extraJson'] | Partial<UserMessage>['extraJson']): MessageExtraJson | null {
  if (!extraJson) return null;

  if (typeof extraJson === 'string') {
    try {
      const parsed = JSON.parse(extraJson);
      return parsed && typeof parsed === 'object' ? (parsed as MessageExtraJson) : null;
    } catch (error) {
      console.warn('[MessageCenter] Failed to parse extraJson', error);
      return null;
    }
  }

  return typeof extraJson === 'object' ? (extraJson as MessageExtraJson) : null;
}

export function getMessageExtra(message: Pick<UserMessage, 'extraJson'> | Partial<UserMessage>) {
  return parseMessageExtraJson(message.extraJson);
}

export function getMessageCategoryCode(message: Partial<UserMessage>) {
  if (message.categoryCode) return message.categoryCode;

  const extra = getMessageExtra(message);
  return extra?.source_biz_type ? INTERACTION_CATEGORY_CODE : SYSTEM_CATEGORY_CODE;
}

export function normalizeMessage(message: UserMessage): UserMessage {
  const extraJson = parseMessageExtraJson(message.extraJson);
  const { rich_content: richContent, rich_content_format: richContentFormat, ...normalizedMessage } = message;

  return {
    ...normalizedMessage,
    richContent: message.richContent ?? richContent ?? null,
    richContentFormat: message.richContentFormat ?? richContentFormat ?? null,
    categoryCode: getMessageCategoryCode({ ...normalizedMessage, extraJson }),
    extraJson,
  };
}

export function normalizeMessages(items: UserMessage[]) {
  return items.map(normalizeMessage);
}

export function getMessageTime(value?: string | null) {
  return value ? formatChatTime(value) || value : '暂无时间';
}

export function getMessageBody(message: UserMessage) {
  return message.content || message.summary || '暂无消息内容';
}

export function isInteractionMessage(message: Partial<UserMessage>) {
  return getMessageCategoryCode(message) === INTERACTION_CATEGORY_CODE;
}

export function getExtraString(extra: MessageExtraJson | null, key: keyof MessageExtraJson) {
  const value = extra?.[key];
  if (value === null || value === undefined) return '';
  return String(value);
}

export function getExtraNumber(extra: MessageExtraJson | null, key: keyof MessageExtraJson) {
  const value = extra?.[key];
  if (value === null || value === undefined || value === '') return null;

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function getInteractionActionText(sourceBizType?: string | null) {
  switch (sourceBizType) {
    case 'WORK_LIKE':
      return '点赞了你的作品';
    case 'WORK_FAVORITE':
      return '收藏了你的作品';
    case 'USER_FOLLOW':
      return '关注了你';
    default:
      return '与你互动';
  }
}

export function getInteractionTitle(message: UserMessage) {
  const extra = getMessageExtra(message);
  const actorName = getExtraString(extra, 'actor_name') || '用户';
  const actionText = getInteractionActionText(getExtraString(extra, 'source_biz_type'));

  return `${actorName} ${actionText}`;
}

export function getInteractionSubtitle(message: UserMessage) {
  const extra = getMessageExtra(message);
  const actionText = getInteractionActionText(getExtraString(extra, 'source_biz_type'));

  return message.summary || actionText;
}

export function getMessageIdentityKey(message: Partial<UserMessage>) {
  if (message.userMessageId !== null && message.userMessageId !== undefined) return `user:${message.userMessageId}`;
  if (message.messageId !== null && message.messageId !== undefined) return `message:${message.messageId}`;

  const extra = getMessageExtra(message);
  const sourceBizType = getExtraString(extra, 'source_biz_type');
  const sourceBizId = getExtraString(extra, 'source_biz_id');

  if (sourceBizType && sourceBizId) {
    return `source:${sourceBizType}:${sourceBizId}`;
  }

  return null;
}

export function isSameUserMessage(message: UserMessage, target: Partial<UserMessage>) {
  if (target.userMessageId !== null && target.userMessageId !== undefined && message.userMessageId === target.userMessageId) return true;
  if (target.messageId !== null && target.messageId !== undefined && message.messageId === target.messageId) return true;

  const messageExtra = getMessageExtra(message);
  const targetExtra = getMessageExtra(target);
  const messageSourceBizType = getExtraString(messageExtra, 'source_biz_type');
  const messageSourceBizId = getExtraString(messageExtra, 'source_biz_id');
  const targetSourceBizType = getExtraString(targetExtra, 'source_biz_type');
  const targetSourceBizId = getExtraString(targetExtra, 'source_biz_id');

  return Boolean(messageSourceBizType && messageSourceBizId && messageSourceBizType === targetSourceBizType && messageSourceBizId === targetSourceBizId);
}
