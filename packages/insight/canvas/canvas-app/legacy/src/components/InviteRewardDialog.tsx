import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, Loader2, X, CircleQuestionMark } from 'lucide-react';
import { toast } from 'sonner';
import { getInviteInfo, signInReward, signInClock, type ApiResponse, type InviteInfo, type SignInClockData } from '@/api/auth';
import { PublishWorkDialog } from '@/components/community/publishDialog/PublishWorkDialog';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { usePointStore } from '@/store/pointStore';
import { useUserStore } from '@/store/userStore';
import { copyToClipboard } from '@/utils';

const SIGN_IN_PANEL_BG =
  'https://web-gpt-assets-cdn.idealead.com/static-assets-tool/png/1.5x-2-cef7ec122e365e09.png?x-oss-process=image/auto-orient,1/resize,l_900,limit_1/format,webp';
const SIGN_IN_PANEL_BG2 =
  'https://web-gpt-assets-cdn.idealead.com/static-assets-tool/png/1.5x-2-3c72a078ca701549.png?x-oss-process=image/auto-orient,1/resize,l_900,limit_1/format,webp';
const SIGN_IN_BALANCE_REFRESH_DELAY_MS = 1000;
const SIGN_IN_DAYS = 7;
const DEFAULT_SIGN_IN_DAY = 1;

interface InviteRewardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSignInStatusChange?: (status: SignInClockData) => void;
}

interface SignInRewardResponse {
  code?: string | number;
  msg?: string;
  message?: string;
}

const waitForBalanceReady = () => new Promise(resolve => window.setTimeout(resolve, SIGN_IN_BALANCE_REFRESH_DELAY_MS));

const getSignInStatusData = (response: ApiResponse<SignInClockData>) => response.data || response.body || null;

const toPointNumber = (value?: string | number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const clampSignInDay = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), 0), SIGN_IN_DAYS);
};

const getNextSignInDay = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_SIGN_IN_DAY;
  return Math.min(Math.max(Math.trunc(parsed), DEFAULT_SIGN_IN_DAY), SIGN_IN_DAYS);
};

export function InviteRewardDialog({ open, onOpenChange, onSignInStatusChange }: InviteRewardDialogProps) {
  const [inviteInfo, setInviteInfo] = useState<InviteInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [signInStatus, setSignInStatus] = useState<SignInClockData | null>(null);
  const [signInStatusLoading, setSignInStatusLoading] = useState(false);
  const [signInSubmitting, setSignInSubmitting] = useState(false);
  const [publishDialogOpen, setPublishDialogOpen] = useState(false);
  const requestedRef = useRef(false);
  const signInStatusRequestRef = useRef(0);
  const currentMembershipPlan = useUserStore(state => state.currentMembershipPlan);
  const { refreshUserPoint } = usePointStore(state => state.actions);
  const baseSignInPoints = useMemo(() => {
    return toPointNumber(currentMembershipPlan?.benefits?.find(benefit => benefit.benefit_code === 'SIGN_IN_POINTS')?.string_value);
  }, [currentMembershipPlan?.benefits]);
  const rewardSteps = useMemo(
    () =>
      Array.from({ length: SIGN_IN_DAYS }, (_, index) => {
        const day = index + 1;
        return {
          day,
          label: `${day}天`,
          points: String(day === SIGN_IN_DAYS ? baseSignInPoints * 2 : baseSignInPoints),
          highlight: day === SIGN_IN_DAYS,
        };
      }),
    [baseSignInPoints]
  );

  const loadInviteInfo = useCallback(
    async (force = false) => {
      if (inviteInfo || loading || (requestedRef.current && !force)) return;

      requestedRef.current = true;
      setLoading(true);
      setErrorMessage('');
      try {
        const response: any = await getInviteInfo();
        const nextInfo = response.data || response.body;
        if (response.code === 'SUCCESS' && nextInfo) {
          setInviteInfo(nextInfo);
          return;
        }
        setErrorMessage(response.msg || '邀请信息获取失败，请稍后重试');
      } catch (error: any) {
        setErrorMessage(error.msg || error.message || '邀请信息获取失败，请稍后重试');
      } finally {
        setLoading(false);
      }
    },
    [inviteInfo, loading]
  );

  const loadSignInStatus = useCallback(async () => {
    const requestId = signInStatusRequestRef.current + 1;
    signInStatusRequestRef.current = requestId;
    setSignInStatusLoading(true);

    try {
      const response = await signInClock();
      if (signInStatusRequestRef.current !== requestId) return null;

      const nextStatus = response.code === 'SUCCESS' ? getSignInStatusData(response) : null;
      if (!nextStatus) {
        return null;
      }

      setSignInStatus(nextStatus);
      onSignInStatusChange?.(nextStatus);
      return nextStatus;
    } catch {
      if (signInStatusRequestRef.current === requestId) {
        setSignInStatus(null);
      }
      return null;
    } finally {
      if (signInStatusRequestRef.current === requestId) {
        setSignInStatusLoading(false);
      }
    }
  }, [onSignInStatusChange]);

  useEffect(() => {
    if (open) {
      void loadInviteInfo();
      void loadSignInStatus();
    } else if (!inviteInfo) {
      requestedRef.current = false;
    }
  }, [inviteInfo, loadInviteInfo, loadSignInStatus, open]);

  const handleSignIn = async () => {
    if (signInSubmitting || signInStatusLoading || signInStatus?.signedToday || !signInStatus?.canSignIn) return;

    setSignInSubmitting(true);
    try {
      const response = (await signInReward()) as SignInRewardResponse;
      if (response.code !== 'SUCCESS') {
        toast.error(response.msg || '打卡失败，请稍后重试');
        return;
      }

      toast.success('打卡成功');
      const nextStatus = await loadSignInStatus();
      if (!nextStatus && signInStatus) {
        const optimisticStatus = {
          ...signInStatus,
          signedToday: true,
          canSignIn: false,
          signInRedDot: false,
          signInDay: getNextSignInDay(signInStatus.nextSignInDay),
        };
        setSignInStatus(optimisticStatus);
        onSignInStatusChange?.(optimisticStatus);
      }
      void waitForBalanceReady().then(() => refreshUserPoint({ reason: 'manual' }));
    } catch (error: unknown) {
      const errorLike = error as { msg?: string; message?: string } | null;
      toast.error(errorLike?.msg || errorLike?.message || '打卡失败，请稍后重试');
    } finally {
      setSignInSubmitting(false);
    }
  };

  const copyText = async (text: string, successMessage: string) => {
    if (!text) return;
    await copyToClipboard(text);
    toast.success(successMessage);
  };

  const inviteLink = inviteInfo?.inviteLink || '';
  const inviteCode = inviteInfo?.inviteCode || '';
  const inviteCount = inviteInfo?.inviteCount ?? 0;
  const completedSignInDay = clampSignInDay(signInStatus?.signInDay, 0);
  const nextSignInDay = getNextSignInDay(signInStatus?.nextSignInDay);
  const canClaimToday = Boolean(signInStatus?.canSignIn && !signInStatus?.signedToday);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          showCloseButton={false}
          overlayClassName='bg-black/80 backdrop-blur-[56px]'
          className='max-h-[calc(100vh-24px)] w-[calc(100vw-24px)] max-w-[940px] gap-0 overflow-hidden rounded-lg border-0 bg-[#242424] p-0 text-white shadow-2xl sm:rounded-lg'
        >
          <div className='flex max-h-[calc(100vh-24px)] flex-col bg-[#242424]'>
            <header className='flex h-[62px] shrink-0 items-center justify-between px-6'>
              <DialogTitle className='text-base font-semibold text-white'>获取赛点</DialogTitle>
              <button
                type='button'
                className='rounded-sm p-1 text-white/80 transition-colors hover:text-white focus:outline-none focus:ring-2 focus:ring-white/70'
                onClick={() => onOpenChange(false)}
                aria-label='关闭'
              >
                <X className='h-5 w-5' />
              </button>
            </header>

            <div className='min-h-0 overflow-y-auto px-6 pb-6'>
              <div className='grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]'>
                <section
                  className='flex min-h-60 flex-col rounded-lg bg-white/10 px-4 py-5'
                  style={{
                    backgroundImage: `url("${SIGN_IN_PANEL_BG}")`,
                    backgroundPosition: 'center',
                    backgroundRepeat: 'repeat',
                  }}
                >
                  <h3 className='text-base font-semibold text-white/90'>社区发布</h3>
                  <p className='mt-5 text-sm leading-7 text-white/60'>
                    把你的作品<span className='font-semibold text-white/80'>发布到社区</span>后将会获得大量奖励支持，若作品70%以上由因赛AI完成，最高可获得2w积分的奖励。
                  </p>
                  <Button type='button' className='mt-auto ml-auto h-9 rounded-md bg-[#4054f4] px-5 text-white hover:bg-[#5366ff]' onClick={() => setPublishDialogOpen(true)}>
                    发布作品
                  </Button>
                </section>

                <section
                  className='min-w-0 overflow-hidden rounded-lg border border-white/10 px-4 py-5 sm:px-5'
                  style={{
                    backgroundImage: `url("${SIGN_IN_PANEL_BG2}")`,
                    backgroundPosition: 'center',
                    backgroundRepeat: 'repeat',
                    backgroundSize: 'cover',
                  }}
                >
                  <div className='flex items-start justify-between gap-4'>
                    <div className='flex items-baseline gap-2'>
                      <h3 className='text-base font-semibold text-white/90'>每日领取</h3>
                      <span className='text-[11px] font-medium text-white/70'>每日零点刷新</span>
                    </div>
                    <TooltipProvider delayDuration={120}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type='button'
                            className='rounded-full text-white/80 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60'
                            aria-label='查看签到规则'
                          >
                            <CircleQuestionMark size={22} />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent
                          side='bottom'
                          align='end'
                          sideOffset={8}
                          className='z-[1001] max-w-80 overflow-visible rounded-xl border border-white/15 bg-black px-5 py-4 text-left text-[15px] leading-7 text-white shadow-[0_12px_28px_rgba(0,0,0,0.45)]'
                        >
                          <div className='space-y-5'>
                            <p>
                              <span className='font-semibold'>规则1：</span>
                              每日签到即可领取赛点，连续签到满 7 天，第 7 天享双倍赛点奖励。
                            </p>
                            <p>
                              <span className='font-semibold'>规则2：</span>
                              签到奖励随会员等级提升同步加码，等级越高每日赛点越多，日积月累稳步领跑。
                            </p>
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>

                  <div className='mt-9 pb-1'>
                    <div className='relative'>
                      <div className='relative grid grid-cols-7 gap-1'>
                        {rewardSteps.map((step, index, arr) => {
                          const isCompleted = step.day <= completedSignInDay;
                          const isCurrent = canClaimToday && step.day === nextSignInDay;

                          return (
                            <div key={step.label} className='flex min-w-0 flex-col items-center relative z-10'>
                              {index < arr.length - 1 && (
                                <div
                                  className='absolute top-[21px] h-[2px] rounded-full bg-white/25'
                                  style={{
                                    left: 'calc(50% + 28px)',
                                    width: 'max(0px, calc(100% + 4px - 56px))',
                                  }}
                                />
                              )}
                              <div
                                className={cn(
                                  'flex h-11 w-11 rounded-full p-[1px] shadow-[0_8px_16px_rgba(0,0,0,0.25)] bg-[linear-gradient(0deg,#ffffff66_0%,#ffffff33_24%,#ffffff99_46%,#ffffff1a_68%,#ffffff33_100%)]',
                                  step.highlight && 'bg-white/50'
                                )}
                              >
                                <div
                                  className={cn(
                                    'flex h-full w-full items-center justify-center rounded-full bg-black/70 text-sm font-bold text-white',
                                    isCompleted &&
                                      'bg-[linear-gradient(180deg,#3970ff00_0%,#83bbff1f_34%,#b7c6ff4d_71%,#faddb599_100%),linear-gradient(180deg,#000000cc_0%,#00000029_100%)]',
                                    step.highlight &&
                                      'bg-[radial-gradient(31%_31%_at_50%_107%,#ffffff_53%,#ffffff00_100%),linear-gradient(270deg,#faddb5_0%,#b7c6ff_34%,#83bbff_71%,#3970ff_100%)] shadow-[inset_0px_-6px_10px_0px_rgba(255,255,255,0.8),inset_0px_4px_10px_0px_#BDD4FF,inset_0px_0px_10px_0px_rgba(222,254,255,0.8)] border-none text-[#1d2c4c]'
                                  )}
                                >
                                  {isCompleted ? (
                                    <Check className='h-7 w-7' strokeWidth={2.5} stroke='url(#checkGradient)'>
                                      <linearGradient id='checkGradient' x1='100%' y1='0%' x2='0%' y2='0%'>
                                        <stop offset='0%' stopColor='#faddb5' />
                                        <stop offset='34%' stopColor='#b7c6ff' />
                                        <stop offset='71%' stopColor='#83bbff' />
                                        <stop offset='100%' stopColor='#3970ff' />
                                      </linearGradient>
                                    </Check>
                                  ) : signInStatusLoading && !signInStatus ? (
                                    <Loader2 className='h-5 w-5 animate-spin' />
                                  ) : (
                                    step.points
                                  )}
                                </div>
                              </div>

                              {isCurrent ? (
                                <button
                                  type='button'
                                  className='text-nowrap mt-2 h-7 font-medium rounded-full px-4 text-sm text-black/80 transition-opacity disabled:cursor-not-allowed disabled:opacity-60'
                                  style={{
                                    background:
                                      'radial-gradient(31% 31% at 50% 107%, #ffffff 53%, #ffffff00 100%), linear-gradient(270deg, #faddb5 0%, #b7c6ff 34%, #83bbff 71%, #3970ff 100%)',
                                  }}
                                  disabled={signInSubmitting || signInStatusLoading}
                                  onClick={handleSignIn}
                                >
                                  {signInSubmitting ? '领取中' : '领取'}
                                </button>
                              ) : (
                                <span className='mt-3 text-sm font-semibold text-white/70'>{step.label}</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </section>
              </div>

              <section
                className='mt-4 rounded-lg bg-white/10 px-4 py-5 sm:px-5'
                style={{
                  backgroundImage: `url("${SIGN_IN_PANEL_BG}")`,
                  backgroundPosition: 'center',
                  backgroundRepeat: 'repeat',
                  backgroundSize: 'cover',
                }}
              >
                <div className='flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between'>
                  <h3 className='text-base font-semibold text-white/90'>邀请好友</h3>
                  <span className='text-sm font-medium text-white/90'>
                    你已成功邀请 <span className='text-xl text-[#7db7ff]'>{inviteCount}</span> 人
                  </span>
                </div>

                <ol className='mt-5 list-decimal space-y-2 pl-4 text-xs leading-5 text-white/60 sm:text-[13px]'>
                  <li>
                    复制下方链接邀请好友注册：好友注册成功后，您和好友都会获得 <span className='font-semibold text-white'>500 赛点。</span>
                  </li>
                  <li>
                    邀请的好友在 1 个月内成功订阅任意套餐（试用套餐除外），您将会获得 <span className='font-semibold text-white'>30,000 赛点。</span>
                  </li>
                  <li>
                    每位用户<span className='font-semibold text-white'>每月最多可邀请 100 名</span>好友注册，每月超过上限后将停止赠送赛点，次月清零。
                  </li>
                  <li>
                    请勿自邀或通过其他不正当方式参与活动，一经发现，平台将<span className='font-semibold text-white'>追回已赠送的赛点，并冻结账号使用。</span>
                  </li>
                </ol>

                <div className='mt-5 space-y-3'>
                  <div className='flex flex-col gap-3 rounded-lg bg-black/40 p-1 pl-4 sm:flex-row sm:items-center'>
                    <div className='min-w-0 flex-1 text-xs leading-5 text-white/90'>
                      <div>复制链接到浏览器打开，免费领取掂商平台赛点积分！我的专属邀请链接：</div>
                      {loading ? (
                        <div className='mt-1 flex items-center gap-2 text-white/60'>
                          <Loader2 className='h-3.5 w-3.5 animate-spin' />
                          邀请链接加载中
                        </div>
                      ) : (
                        <div className='mt-1 break-all text-white'>{inviteLink || '暂无邀请链接'}</div>
                      )}
                    </div>
                    <Button
                      type='button'
                      className='h-10 shrink-0 rounded-lg bg-[#4054f4] px-5 text-white hover:bg-[#5366ff]'
                      disabled={!inviteLink || loading}
                      onClick={() => copyText(inviteLink, '邀请链接已复制')}
                    >
                      <Copy className='h-4 w-4' />
                      复制链接
                    </Button>
                  </div>

                  <div className='flex flex-col gap-3 rounded-lg bg-black/40 p-1 pl-4 sm:flex-row sm:items-center'>
                    <div className='min-w-0 flex-1 break-all text-sm font-medium text-white/90'>{loading ? '邀请码加载中' : inviteCode || '暂无邀请码'}</div>
                    <Button
                      type='button'
                      className='h-10 shrink-0 rounded-lg bg-[#4054f4] px-5 text-white hover:bg-[#5366ff]'
                      disabled={!inviteCode || loading}
                      onClick={() => copyText(inviteCode, '邀请码已复制')}
                    >
                      <Copy className='h-4 w-4' />
                      复制邀请码
                    </Button>
                  </div>
                </div>

                {errorMessage && (
                  <div className='mt-3 flex items-center justify-between gap-3 rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-100'>
                    <span>{errorMessage}</span>
                    <button type='button' className='shrink-0 text-white underline-offset-4 hover:underline' onClick={() => loadInviteInfo(true)}>
                      重试
                    </button>
                  </div>
                )}
              </section>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <PublishWorkDialog open={publishDialogOpen} onOpenChange={setPublishDialogOpen} />
    </>
  );
}
