import { memo, useEffect, useMemo, useState } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';
import { Bell, ChevronDown, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { communityApi } from '@/api/community';
import type { UserMessage } from '@/api/message';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { compressImage } from '@/utils';
import { FALLBACK_AVATAR_URL } from './messageConstants';
import { getExtraNumber, getExtraString, getInteractionSubtitle, getMessageBody, getMessageExtra, getMessageTime } from './messageUtils';

const isMailtoLink = (element: HTMLAnchorElement) => element.getAttribute('href')?.trim().toLowerCase().startsWith('mailto:') === true;

type OfficialMessageAction = (message: UserMessage, element: HTMLAnchorElement) => void;

const handleOfficialContentClick = (event: MouseEvent<HTMLElement>, message: UserMessage, onAction: OfficialMessageAction) => {
  if (!(event.target instanceof Element)) return;

  const anchor = event.target.closest<HTMLAnchorElement>('a');
  if (!anchor || !event.currentTarget.contains(anchor)) return;

  event.stopPropagation();
  if (isMailtoLink(anchor)) return;

  event.preventDefault();
  onAction(message, anchor);
};

const lineClampStyle = (lines: number) => ({
  display: '-webkit-box',
  WebkitLineClamp: lines,
  WebkitBoxOrient: 'vertical' as const,
  overflow: 'hidden',
});

type ApiResponse<T> = {
  code?: string | number;
  msg?: string;
  data?: T;
  body?: T;
  success?: boolean;
};

const isSuccessResponse = <T,>(response: ApiResponse<T>) => {
  return response.success === true || response.code === 'SUCCESS' || response.code === 200 || String(response.code) === '0' || String(response.code) === '200';
};

const getErrorMessage = (error: unknown, fallback = '操作失败') => {
  if (error && typeof error === 'object') {
    const maybeError = error as { msg?: unknown; message?: unknown };
    if (typeof maybeError.msg === 'string') return maybeError.msg;
    if (typeof maybeError.message === 'string') return maybeError.message;
  }

  return fallback;
};

export function EmptyState({ compact = false, interaction = false }: { compact?: boolean; interaction?: boolean }) {
  return (
    <div className={cn('flex flex-col items-center justify-center text-center text-muted-foreground', compact ? 'h-[176px]' : 'h-[320px]')}>
      <Bell className='mb-3 h-8 w-8 text-muted-foreground/45' />
      <div className='text-sm text-foreground/85'>暂无消息</div>
      <div className='mt-1 text-xs'>{interaction ? '有新互动时会在这里提醒你' : '有新公告时会在这里提醒你'}</div>
    </div>
  );
}

export function MessageUnreadDot({ className }: { className?: string }) {
  return <span className={cn('block h-1.5 w-1.5 shrink-0 rounded-full bg-[#ff4d4f]', className)} />;
}

export const OfficialPreviewItem = memo(function OfficialPreviewItem({
  message,
  onClick,
  onAction,
}: {
  message: UserMessage;
  onClick: (message: UserMessage) => void;
  onAction: OfficialMessageAction;
}) {
  return (
    <button
      className='group block w-full cursor-pointer border-b border-white/10 px-5 py-2.5 text-left transition-colors last:border-b-0 hover:bg-white/[0.04] focus:outline-none focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0'
      onClick={() => onClick(message)}
    >
      <div className='relative mb-1 flex items-start gap-2'>
        {message.readStatus === 0 && <MessageUnreadDot className='absolute -left-3 top-[2px] mt-[7px]' />}
        <div className='min-w-0 flex-1 text-sm break-all font-semibold text-foreground/95' style={lineClampStyle(1)}>
          {message.title || '温馨提示'}
        </div>
      </div>
      <div
        className='break-all text-xs text-foreground/65 [&_a]:cursor-pointer [&_a]:text-[#2098D1] [&_a]:underline-offset-4 [&_a:hover]:underline'
        style={lineClampStyle(3)}
        onClick={event => handleOfficialContentClick(event, message, onAction)}
        dangerouslySetInnerHTML={{ __html: getMessageBody(message) }}
      ></div>
      <div className='mt-1 text-xs text-foreground/25'>{getMessageTime(message.publishedAt || message.receivedAt)}</div>
    </button>
  );
});

export const OfficialMessageListItem = memo(function OfficialMessageListItem({
  message,
  expanded,
  selected,
  onSelect,
  onToggle,
  onAction,
}: {
  message: UserMessage;
  expanded: boolean;
  selected: boolean;
  onSelect: (message: UserMessage) => void;
  onToggle: (message: UserMessage) => void;
  onAction: OfficialMessageAction;
}) {
  const content = message.content || message.summary || '暂无消息内容';

  return (
    <div
      data-message-id={message.userMessageId}
      onClick={() => onSelect(message)}
      className={cn(
        'cursor-pointer rounded-md border border-border/70 bg-foreground/10 px-5 py-2 transition-colors hover:border-primary/55 sm:px-4',
        selected && 'border-primary/70 bg-primary/10'
      )}
    >
      <div className='flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4'>
        <div className='relative flex min-w-0 flex-1'>
          {message.readStatus === 0 && <MessageUnreadDot className='absolute -left-3 -top-[6px] mt-[7px]' />}
          <div className='min-w-0 flex-1 break-all text-sm font-semibold text-foreground' style={lineClampStyle(1)}>
            {message.title || '未命名消息'}
          </div>
        </div>
        <Button
          type='button'
          variant='ghost'
          size='sm'
          className='h-7 shrink-0 self-end px-2 text-xs text-muted-foreground hover:text-foreground focus-visible:ring-0 focus-visible:ring-offset-0 sm:self-auto'
          onClick={event => {
            event.stopPropagation();
            onToggle(message);
          }}
        >
          {expanded ? '收起' : '展开更多'}
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform duration-200 ease-out motion-reduce:transition-none', expanded && 'rotate-180')} />
        </Button>
      </div>
      <div className='mt-1 text-xs text-muted-foreground'>{getMessageTime(message.publishedAt || message.receivedAt)}</div>
      <div
        className={cn(
          'mt-1 text-sm leading-6 text-muted-foreground transition-[max-height,opacity] duration-300 ease-out motion-reduce:transition-none',
          expanded ? 'overflow-y-auto pr-1 opacity-100' : 'max-h-6 overflow-hidden opacity-80'
        )}
      >
        <div
          style={expanded ? undefined : lineClampStyle(1)}
          className='break-all [&_a]:cursor-pointer [&_a]:text-[#2098D1] [&_a]:underline-offset-4 [&_a:hover]:underline'
          onClick={event => handleOfficialContentClick(event, message, onAction)}
          dangerouslySetInnerHTML={{ __html: content }}
        ></div>
      </div>
    </div>
  );
});

interface InteractionMessageItemProps {
  message: UserMessage;
  compact?: boolean;
  selected?: boolean;
  onSelect?: (message: UserMessage) => void;
  onRead?: (message: UserMessage) => void;
}

export const InteractionMessageItem = memo(function InteractionMessageItem({ message, compact = false, selected = false, onSelect, onRead }: InteractionMessageItemProps) {
  const extra = useMemo(() => getMessageExtra(message), [message]);
  const actorName = getExtraString(extra, 'actor_name') || '用户';
  const actorAvatarUrl = getExtraString(extra, 'actor_avatar_url') || FALLBACK_AVATAR_URL;
  const actorUserId = getExtraNumber(extra, 'actor_user_id');
  const workId = getExtraNumber(extra, 'work_id');
  const workCoverUrl = getExtraString(extra, 'work_cover_url');
  const sourceBizType = getExtraString(extra, 'source_biz_type');
  const isFollowMessage = sourceBizType === 'USER_FOLLOW';
  const isWorkMessage = sourceBizType === 'WORK_LIKE' || sourceBizType === 'WORK_FAVORITE';
  const initialFollowed = extra?.followed === true;
  const [followed, setFollowed] = useState(initialFollowed);
  const [followSubmitting, setFollowSubmitting] = useState(false);

  useEffect(() => {
    setFollowed(initialFollowed);
  }, [initialFollowed, message.userMessageId]);

  const markRead = () => {
    onRead?.(message);
  };

  const handleSelect = () => {
    markRead();
    onSelect?.(message);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    handleSelect();
  };

  const goToUserCenter = () => {
    if (!actorUserId) return;
    markRead();
    window.open(`/usercenter?userId=${actorUserId}`, '_blank', 'noopener,noreferrer');
  };

  const goToWork = () => {
    if (!workId) return;
    markRead();
    window.open(`/community/works/${workId}`, '_blank', 'noopener,noreferrer');
  };

  const handleFollowClick = async () => {
    if (!actorUserId || followSubmitting) return;

    markRead();
    const nextFollowed = !followed;
    setFollowSubmitting(true);

    try {
      const response = (await communityApi.users.follow(actorUserId, nextFollowed)) as ApiResponse<string>;

      if (!isSuccessResponse(response)) {
        throw new Error(response.msg || '操作失败');
      }

      setFollowed(nextFollowed);
      toast.success(nextFollowed ? '已关注' : '已取消关注');
    } catch (error) {
      toast.error(getErrorMessage(error, nextFollowed ? '关注失败' : '取消关注失败'));
    } finally {
      setFollowSubmitting(false);
    }
  };

  const renderRightAction = () => {
    if (isFollowMessage) {
      return (
        <Button
          type='button'
          size='sm'
          disabled={!actorUserId || followSubmitting}
          className={cn(
            'h-9 w-[72px] shrink-0 rounded-md px-0 text-sm font-medium focus-visible:ring-0 focus-visible:ring-offset-0',
            followed ? 'bg-white/10 text-white/70 hover:bg-white/18 hover:text-white' : 'btn ins-btn-primary'
          )}
          onClick={event => {
            event.stopPropagation();
            void handleFollowClick();
          }}
        >
          {followSubmitting ? <Loader2 className='h-4 w-4 animate-spin' /> : followed ? '已关注' : '回关'}
        </Button>
      );
    }

    if (!isWorkMessage) return null;

    if (!workId) {
      return (
        <button
          type='button'
          disabled
          className={cn('shrink-0 cursor-not-allowed rounded-md bg-white/10 text-center text-xs font-medium text-white/45', compact ? 'h-12 w-16' : 'h-10 w-[76px]')}
        >
          作品已删除
        </button>
      );
    }

    if (!workCoverUrl) {
      return (
        <button
          type='button'
          className={cn('shrink-0 rounded-md bg-white/10 text-xs font-medium text-white/70 transition-colors hover:bg-white/16', compact ? 'h-12 w-16' : 'h-10 w-[76px]')}
          onClick={event => {
            event.stopPropagation();
            goToWork();
          }}
        >
          查看作品
        </button>
      );
    }

    return (
      <button
        type='button'
        className={cn('shrink-0 overflow-hidden rounded-md bg-white/10 transition-opacity hover:opacity-85', compact ? 'h-16 w-16' : 'h-10 w-10')}
        onClick={event => {
          event.stopPropagation();
          goToWork();
        }}
        aria-label='查看作品'
      >
        <img src={workCoverUrl} alt='作品封面' className='h-full w-full object-cover' loading='lazy' />
      </button>
    );
  };

  return (
    <article
      data-message-id={message.userMessageId}
      role='button'
      tabIndex={0}
      onClick={handleSelect}
      onKeyDown={handleKeyDown}
      className={cn(
        'relative flex w-full cursor-pointer items-center gap-3 text-left transition-colors focus:outline-none focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0',
        compact ? 'border-b border-white/10 px-5 py-3 last:border-b-0' : 'rounded-md border border-border/70 bg-foreground/10 px-4 py-3 hover:border-primary/55',
        selected && !compact && 'border-primary/70 bg-primary/10'
      )}
    >
      {message.readStatus === 0 && <MessageUnreadDot className={cn('absolute', compact ? 'left-3 top-3' : 'left-2 top-3')} />}
      <button
        type='button'
        className={cn('shrink-0 overflow-hidden rounded-full focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0', compact ? 'h-14 w-14' : 'h-10 w-10')}
        onClick={event => {
          event.stopPropagation();
          goToUserCenter();
        }}
        aria-label='查看用户主页'
      >
        <Avatar className='h-full w-full'>
          <AvatarImage src={compressImage(actorAvatarUrl, 96)} alt={actorName} />
          <AvatarFallback>{actorName.slice(0, 2)}</AvatarFallback>
        </Avatar>
      </button>
      <div className='min-w-0 flex-1'>
        <div className='break-all text-sm font-semibold text-foreground' style={lineClampStyle(1)}>
          {actorName}
        </div>
        <div className='mt-0.5 break-all text-xs text-muted-foreground' style={lineClampStyle(1)}>
          {getInteractionSubtitle(message)}
        </div>
        <div className='mt-1 text-xs text-muted-foreground/70'>{getMessageTime(message.publishedAt || message.receivedAt)}</div>
      </div>
      {renderRightAction()}
    </article>
  );
});
