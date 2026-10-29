import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { getMembershipPromoBanner, type MembershipPromoBanner as BannerData } from '@/api/membership';

interface MembershipPromoBannerProps {
  className?: string;
  /**
   * 倒计时结束回调（可选），例如到期自动隐藏 Banner
   */
  onCountdownEnd?: () => void;
  /**
   * 点击 Banner 回调（优先级高于 jumpUrl）
   */
  onClick?: () => void;
}

/** 时间片段：天/时/分/秒 */
interface CountdownParts {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  ended: boolean;
}

/**
 * 根据 endAt 计算剩余天/时/分/秒，不足补 0，endAt<=0 视为已结束
 */
const calcCountdownParts = (endAt: number): CountdownParts => {
  const totalMs = endAt - Date.now();
  if (!Number.isFinite(totalMs) || totalMs <= 0) {
    return { days: 0, hours: 0, minutes: 0, seconds: 0, ended: true };
  }

  const totalSeconds = Math.floor(totalMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return { days, hours, minutes, seconds, ended: false };
};

const pad2 = (n: number) => (n < 10 ? `0${n}` : String(n));

/**
 * 促销数字胶囊：单格两位数字 + 单位标签（天/时/分/秒）
 */
const CountdownTile = ({ value, label }: { value: number; label: string }) => {
  return (
    <div className='flex min-w-[52px] mobile:min-w-[42px] flex-col items-center justify-center gap-1 rounded-md bg-white/[0.10] p-4 text-center shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)] backdrop-blur-sm h-full'>
      <span className='mobile:text-3xl text-3xl font-black leading-none tracking-tight text-white tabular-nums'>{pad2(value)}</span>
      <span className='text-[14px] leading-none text-white/65'>{label}</span>
    </div>
  );
};

/**
 * 会员购买页顶部：活动广告 + 倒计时（天/时/分/秒）
 * - 内容与倒计时基准通过接口 getMembershipPromoBanner 拉取
 * - 现阶段默认使用 mock 数据，后端接口准备好后在 api/membership.ts 切换即可
 */
export default function MembershipPromoBanner({ className, onCountdownEnd, onClick }: MembershipPromoBannerProps) {
  const [banner, setBanner] = useState<BannerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [nowTick, setNowTick] = useState(() => Date.now());
  const intervalRef = useRef<number | null>(null);
  const firedEndRef = useRef(false);

  /* ------------- 拉取 Banner 数据 ------------- */
  useEffect(() => {
    let ignore = false;
    setLoading(true);
    setError('');

    getMembershipPromoBanner()
      .then(data => {
        if (ignore) return;
        setBanner(data);
      })
      .catch(err => {
        console.error('[MembershipPromoBanner] fetch failed:', err);
        if (!ignore) setError('活动信息加载失败');
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, []);

  /* ------------- 倒计时 1s 心跳 ------------- */
  useEffect(() => {
    // 1 秒推进一次（足够，避免不必要的重渲染）
    intervalRef.current = window.setInterval(() => {
      setNowTick(Date.now());
    }, 1000);

    return () => {
      if (intervalRef.current !== null) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, []);

  /* ------------- 衍生：倒计时片段 + 到期回调 ------------- */
  const countdown = useMemo<CountdownParts>(() => {
    if (!banner) return { days: 0, hours: 0, minutes: 0, seconds: 0, ended: true };
    return calcCountdownParts(banner.endAt);
    // 故意以 nowTick 为 dep，1s 重算一次
  }, [banner, nowTick]);

  // 只触发一次 onCountdownEnd
  useEffect(() => {
    if (countdown.ended && banner && !firedEndRef.current) {
      firedEndRef.current = true;
      onCountdownEnd?.();
    }
  }, [countdown.ended, banner, onCountdownEnd]);

  /* ------------- 事件：点击跳转 ------------- */
  const handleBannerClick = useCallback(() => {
    // if (onClick) {
    //   onClick();
    //   return;
    // }
    // if (banner?.jumpUrl) {
    //   window.open(banner.jumpUrl, '_blank', 'noopener,noreferrer');
    // }
  }, [banner, onClick]);

  const showCursorPointer = Boolean(onClick || banner?.jumpUrl);

  /* ------------- 加载态骨架 ------------- */
  if (loading) {
    return (
      <div className={cn('mx-auto w-full min-w-[min(1112px,100%)] max-w-full mobile:min-w-0', className)}>
        <Skeleton className='h-[128px] mobile:h-[112px] w-full rounded-xl bg-white/[0.08]' />
      </div>
    );
  }

  /* ------------- 错误兜底 / 空内容兜底：整块隐藏，不占位 ------------- */
  if (error || !banner) {
    return null;
  }

  // 判定「是否有可展示内容」：有任一显示字段不为空 或 倒计时还未结束 → 视为有数据，展示
  // 否则（标题/副标题/背景图/角标/跳转全空 且 活动已结束）→ 视为无广告数据，整个区域都隐藏（连 wrapper + mb-4 都不留）
  const hasAnyDisplayField = Boolean(banner.title || banner.subtitle || banner.backgroundImage || banner.badge || banner.jumpUrl);
  const countdownStillRunning = banner.endAt > Date.now() + 1000; // 留 1s 余量避免边界闪烁
  if (!hasAnyDisplayField && !countdownStillRunning) {
    return null;
  }

  const hasBgImage = Boolean(banner.backgroundImage);

  /* ---------- 左侧标题 + 副标题 + 角标 + 查看活动详情 ---------- */
  const renderLeft = () => {
    return (
      <div className='relative z-10 flex min-w-0 shrink flex-col items-start justify-center text-left mobile:gap-1 gap-1.5 h-full'>
        <div className='flex items-center gap-2'>
          <span className='mobile:text-xl text-2xl font-black leading-snug text-white drop-shadow-[0_2px_6px_rgba(0,0,0,0.25)]'>{banner.title}</span>
          {banner.badge && (
            <span className='inline-flex items-center gap-1 rounded-full bg-white/[0.18] px-2 py-0.5 text-[11px] leading-none text-white/90 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)]'>
              <Sparkles size={11} />
              {banner.badge}
            </span>
          )}
        </div>
        <p className='mobile:text-xl text-2xl leading-snug text-white/80 drop-shadow-[0_2px_4px_rgba(0,0,0,0.2)]'>{banner.subtitle}</p>
        {/* {showCursorPointer && (
          <span className='mt-2 inline-flex items-center gap-1 text-xs text-white/80 transition-all duration-200 ease-out group-hover:translate-x-0.5 group-hover:text-white'>
            查看活动详情 <ChevronRight size={12} />
          </span>
        )} */}
      </div>
    );
  };

  return (
    <div className={cn('mx-auto w-full min-w-[min(1112px,100%)] max-w-[1280px] mobile:min-w-0', className)}>
      <TooltipProvider delayDuration={150}>
        <div
          role={showCursorPointer ? 'button' : undefined}
          tabIndex={showCursorPointer ? 0 : undefined}
          onClick={showCursorPointer ? handleBannerClick : undefined}
          onKeyDown={e => {
            if (!showCursorPointer) return;
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              handleBannerClick();
            }
          }}
          className={cn(
            'group relative flex w-full justify-between overflow-hidden rounded-xl px-8 mobile:px-4',
            'h-[136px] mobile:h-[112px]',
            'bg-[linear-gradient(108deg,#0a2d7a_0%,#1a3bb0_38%,#7b4bd0_68%,#b14cc5_100%)]',
            showCursorPointer && 'cursor-pointer transition-transform duration-200 ease-out hover:-translate-y-0.5'
          )}
          style={hasBgImage ? { backgroundImage: `url(${banner.backgroundImage})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
        >
          {/* 渐变遮罩：保证文字可读（仅在传背景图时加重） */}
          {hasBgImage && <div className='absolute inset-0 bg-gradient-to-r from-black/55 via-black/25 to-black/55' />}

          {/* 左侧：有 content 直接渲染 content；否则回退到标题/副标题/角标/查看活动详情 */}
          {renderLeft()}

          {/* 右侧倒计时 */}
          <Tooltip>
            <TooltipTrigger asChild>
              <div className='relative z-10 ml-6 mobile:ml-3 shrink-0 h-full py-6'>
                {/* <div className='mb-1 flex items-center justify-end gap-1 mobile:text-[10px] text-[11px] text-white/75'>
                  <Clock size={11} />
                  <span>活动到期倒计时</span>
                </div> */}
                <div className='flex items-end gap-4 mobile:gap-1 h-full'>
                  <CountdownTile value={countdown.days} label='天' />
                  <CountdownTile value={countdown.hours} label='时' />
                  <CountdownTile value={countdown.minutes} label='分' />
                  <CountdownTile value={countdown.seconds} label='秒' />
                </div>
              </div>
            </TooltipTrigger>
            <TooltipContent className='max-w-[260px] text-xs'>
              <p>
                活动截止时间：
                {new Date(banner.endAt).toLocaleString()}
              </p>
              {countdown.ended && <p className='mt-1 text-white/70'>活动已结束，优惠以页面最终展示为准。</p>}
            </TooltipContent>
          </Tooltip>
        </div>
      </TooltipProvider>
    </div>
  );
}
