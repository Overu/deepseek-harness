import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ShoppingCart, Sparkles, ChevronsDown, ChevronsUp, ChevronLeft, ChevronRight } from 'lucide-react';
import { queryMembershipPlans, type PaymentMethod } from '@/api/order';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useAuth } from '@/contexts/AuthContext';
import PopPointV2 from './PopPointV2';
import PopPointPayCodeV2 from './PopPointPayCodeV2';
import PopPackageCustomization from './PopPackageCustomization';
import MembershipPromoBanner from './MembershipPromoBanner';
import FrequentlyAskedQuestions from './FrequentlyAskedQuestions';
import { cn } from '@/lib/utils';
import { getDefaultPaymentMethod } from './paymentMethod';
import { useBreakpoint } from '@/hooks/useBreakpoint';

type PeriodKey = 'monthly' | 'yearly';

interface BenefitDescription {
  content_type: string;
  content?: {
    label?: string;
    desc?: string;
  }[];
  sort_order?: number;
}

interface MembershipPlan {
  membership_plan_id: number;
  membership_plan_code: string;
  membership_plan_name: string;
  membership_plan_rank?: number;
  duration_type?: string;
  duration_value?: number;
  original_price?: number;
  first_sub_price?: number;
  purchased_count?: number;
  points?: {
    points_total?: number;
    points_purchase_reward?: number;
    points_signin_reward_total?: number;
  };
  benefit_descriptions?: BenefitDescription[];
  display_config?: {
    cardBgColor?: string;
    tab_color?: {
      text?: string;
      bgColor?: string;
    };
  };
  final_price: number; // 最终价格
  sale_price?: number;
  discount_applied: boolean; // true 代表有折扣，false 代表没有
  discount_percent?: number; // 折扣百分比，如果有折扣的话
}

interface MembershipPlanGroup {
  membership_plan_code?: string;
  list?: MembershipPlan[];
}

interface MembershipPlansResponse {
  code?: number | string;
  data?: {
    groups?: MembershipPlanGroup[];
  };
}

interface PlanCardData {
  plan: MembershipPlan;
  yearlyPlan?: MembershipPlan;
}

type SubscriptionPlanPurchaseMode = 'dialog' | 'page';

interface SubscriptionPlanPurchaseProps {
  onClose?: () => void;
  mode?: SubscriptionPlanPurchaseMode;
}

const PERIODS: { key: PeriodKey; label: string; badge?: string }[] = [
  { key: 'monthly', label: '单月购买' },
  { key: 'yearly', label: '按年购买', badge: '' },
];

const getPriceInFen = (value?: number) => {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
};

const formatPriceFromFen = (value?: number) => {
  const yuan = getPriceInFen(value) / 100;
  return Number.isInteger(yuan) ? String(yuan) : yuan.toFixed(2).replace(/\.?0+$/, '');
};

const getOriginalPriceInFen = (plan?: MembershipPlan | null) => getPriceInFen(plan?.original_price);

const getSalePriceInFen = (plan?: MembershipPlan | null) => getPriceInFen(plan?.final_price ?? plan?.sale_price);

const getRegularPriceInFen = (plan?: MembershipPlan | null) => getPriceInFen(plan?.sale_price);

const formatDiscountPercent = (value?: number) => {
  const discount = getPriceInFen(value);
  return discount % 10 === 0 ? discount / 10 : discount;
};

const getPurchasedCount = (plan?: MembershipPlan | null) => {
  return Number.isFinite(Number(plan?.purchased_count)) ? Number(plan?.purchased_count) : 0;
};

const formatPoint = (value?: number) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return '-';
  }

  return numericValue.toLocaleString();
};

const groupPlansByPeriod = (response: MembershipPlansResponse): Record<PeriodKey, PlanCardData[]> => {
  const groups = response.data?.groups || [];
  const result: Record<PeriodKey, PlanCardData[]> = { monthly: [], yearly: [] };
  const seenMonthlyId = new Set<number>();
  const seenYearlyId = new Set<number>();

  groups.forEach(group => {
    const list = Array.isArray(group.list) ? group.list : [];
    const monthlyPlan = list.find(plan => plan.duration_type === 'MONTH');
    const yearlyPlan = list.find(plan => plan.duration_type === 'YEAR');

    if (monthlyPlan) {
      if (seenMonthlyId.has(monthlyPlan.membership_plan_id)) {
        console.warn('[groupPlansByPeriod] 月付 membership_plan_id 重复，已自动忽略，请后端修正：', monthlyPlan.membership_plan_id, monthlyPlan);
      } else {
        seenMonthlyId.add(monthlyPlan.membership_plan_id);
        result.monthly.push({ plan: monthlyPlan, yearlyPlan });
      }
    }

    if (yearlyPlan) {
      if (seenYearlyId.has(yearlyPlan.membership_plan_id)) {
        console.warn('[groupPlansByPeriod] 年付 membership_plan_id 重复，已自动忽略，请后端修正：', yearlyPlan.membership_plan_id, yearlyPlan);
      } else {
        seenYearlyId.add(yearlyPlan.membership_plan_id);
        result.yearly.push({ plan: yearlyPlan, yearlyPlan });
      }
    }
  });

  return {
    monthly: result.monthly.sort((a, b) => (a.plan.membership_plan_rank || 0) - (b.plan.membership_plan_rank || 0)),
    yearly: result.yearly.sort((a, b) => (a.plan.membership_plan_rank || 0) - (b.plan.membership_plan_rank || 0)),
  };
};

const getYearlySaleTip = (selectedPeriod: PeriodKey, yearlyPlan?: MembershipPlan) => {
  if (selectedPeriod !== 'yearly') {
    return '';
  }

  return `按年付费，年总价${formatPriceFromFen(getSalePriceInFen(yearlyPlan))}元`;
};

export function SubscriptionPlanPurchase({ onClose, mode = 'dialog' }: SubscriptionPlanPurchaseProps) {
  const { authStatus } = useAuth();
  const [payWayData] = useState<PaymentMethod>(() => getDefaultPaymentMethod());
  const [selectedPeriod, setSelectedPeriod] = useState<PeriodKey>('monthly');
  const [plansByPeriod, setPlansByPeriod] = useState<Record<PeriodKey, PlanCardData[]>>({ monthly: [], yearly: [] });
  const [selectedPlan, setSelectedPlan] = useState<MembershipPlan | null>(null);
  const [payVisible, setPayVisible] = useState(false);
  const [pointVisible, setPointVisible] = useState(false);
  const [customizationVisible, setCustomizationVisible] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedPlanIds, setExpandedPlanIds] = useState<Set<number>>(new Set());
  const isMobile = useBreakpoint(768);
  const planScrollerRef = useRef<HTMLDivElement>(null);
  const [planScrollState, setPlanScrollState] = useState({ canScrollLeft: false, canScrollRight: false, hasOverflow: false });

  const toggleExpand = (id: number) => {
    setExpandedPlanIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  useEffect(() => {
    let ignore = false;

    const fetchPlans = async () => {
      setLoading(true);
      setError('');

      try {
        const response = (await queryMembershipPlans()) as unknown as MembershipPlansResponse;

        if (ignore) {
          return;
        }

        setPlansByPeriod(groupPlansByPeriod(response));
      } catch (fetchError) {
        console.error('Failed to query membership plans:', fetchError);
        if (!ignore) {
          setError('套餐加载失败，请稍后重试');
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    };

    fetchPlans();

    return () => {
      ignore = true;
    };
  }, []);

  const currentPlans = plansByPeriod[selectedPeriod];

  /* ---------- 卡片等高：观测当前周期卡片高度，统一对齐到最高卡片 ---------- */
  const cardRefs = useRef<Map<number, HTMLElement>>(new Map());
  const roRef = useRef<ResizeObserver | null>(null);
  const [planCardsEqualHeight, setPlanCardsEqualHeight] = useState<number | null>(null);

  const recomputeEqualHeight = useCallback(() => {
    if (cardRefs.current.size === 0) {
      setPlanCardsEqualHeight(null);
      return;
    }
    let maxHeight = 0;
    cardRefs.current.forEach(el => {
      const h = el.getBoundingClientRect().height;
      if (h > maxHeight) maxHeight = h;
    });
    // 最小高度兜底（桌面 640 / 移动 560），保证内容不足时仍有基本高度
    const floor = isMobile ? 560 : 640;
    const finalHeight = Math.max(floor, Math.ceil(maxHeight));
    setPlanCardsEqualHeight(prev => (prev === finalHeight ? prev : finalHeight));
  }, [isMobile]);

  const attachCardResizeObserver = useCallback(() => {
    // 销毁旧 observer
    if (roRef.current) {
      roRef.current.disconnect();
      roRef.current = null;
    }
    if (typeof ResizeObserver === 'undefined' || cardRefs.current.size === 0) {
      recomputeEqualHeight();
      return;
    }
    const ro = new ResizeObserver(() => {
      recomputeEqualHeight();
    });
    cardRefs.current.forEach(el => ro.observe(el));
    roRef.current = ro;
    // 立即观测一次
    recomputeEqualHeight();
  }, [recomputeEqualHeight]);

  // 注册卡片 DOM：在 map 里通过 ref callback 写入
  const setPlanCardRef = useCallback(
    (id: number) => (el: HTMLElement | null) => {
      if (!el) {
        cardRefs.current.delete(id);
        return;
      }
      cardRefs.current.set(id, el);
    },
    []
  );

  // 周期 / 列表变化 / 权益区展开变化 → 重新挂载观测
  useEffect(() => {
    attachCardResizeObserver();
    return () => {
      roRef.current?.disconnect();
      roRef.current = null;
    };
  }, [attachCardResizeObserver, currentPlans.length, selectedPeriod, expandedPlanIds, isMobile]);

  const selectedPeriodMeta = PERIODS.find(period => period.key === selectedPeriod) || PERIODS[0];
  const showPlanScrollButtons = !loading && !error && currentPlans.length > 0 && planScrollState.hasOverflow;

  const updatePlanScrollState = useCallback(() => {
    const scroller = planScrollerRef.current;
    if (!scroller) {
      setPlanScrollState({ canScrollLeft: false, canScrollRight: false, hasOverflow: false });
      return;
    }

    const maxScrollLeft = scroller.scrollWidth - scroller.clientWidth;
    setPlanScrollState({
      canScrollLeft: scroller.scrollLeft > 1,
      canScrollRight: scroller.scrollLeft < maxScrollLeft - 1,
      hasOverflow: maxScrollLeft > 1,
    });
  }, []);

  useEffect(() => {
    const frameId = window.requestAnimationFrame(updatePlanScrollState);
    window.addEventListener('resize', updatePlanScrollState);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener('resize', updatePlanScrollState);
    };
  }, [currentPlans.length, isMobile, selectedPeriod, updatePlanScrollState]);

  const scrollPlans = (direction: 'left' | 'right') => {
    const scroller = planScrollerRef.current;
    if (!scroller) {
      return;
    }

    scroller.scrollBy({
      left: direction === 'left' ? -374 : 374,
      behavior: 'smooth',
    });
  };

  const handleBuyPoints = () => {
    setPointVisible(true);
  };

  const handleBuyPlan = (plan: MembershipPlan) => {
    if (getSalePriceInFen(plan) <= 0) {
      return;
    }

    setSelectedPlan(plan);
    setPayVisible(true);
  };

  return (
    <section
      className={cn(
        'relative flex flex-col px-16 py-6 text-white w-screen h-screen mobile:p-4 overflow-y-auto',
        mode === 'dialog' ? 'bg-[linear-gradient(180deg,#171717_0%,#111_48%,#0d0d0f_100%)] shadow-[0_24px_80px_rgba(0,0,0,0.52)]' : ''
      )}
    >
      {/* 内容区：可纵向滚动（顶部 Banner + 标题/Tab/卡片区 + FAQ 全部一起滚动；底部免责声明固定不参与滚动） */}
      <div className='flex-1  [scrollbar-color:rgba(255,255,255,0.22)_transparent] [scrollbar-width:thin] [-webkit-overflow-scrolling:touch]'>
        {/* 顶部促销活动 Banner + 倒计时（宽度随下方卡片区对齐） */}
        <MembershipPromoBanner className='mb-4 mobile:mb-3' />

        <div className='text-center'>
          <h2 className='m-0 text-xl mobile:text-2xl font-semibold leading-snug text-white/95'>选择适合你的套餐</h2>
          {authStatus.status === 'logged_in' && (
            <p className='mt-2 inline-flex items-center gap-1.5 text-[13px] text-white/50'>
              选择适合你的套餐，或者直接
              <button
                type='button'
                className='inline-flex items-center gap-1 p-0 text-[13px] transition-all duration-200 ease-out hover:-translate-y-px'
                style={{
                  background: 'linear-gradient(270deg, #A9FDFD 4%, #609FFF 100%), linear-gradient(90deg, #70E0FF 0%, #A9FFEA 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                  color: 'transparent',
                }}
                onClick={handleBuyPoints}
              >
                <ShoppingCart size={14} color='#609FFF' />
                购买加油包
              </button>
            </p>
          )}
        </div>

        <div className='mx-auto grid min-h-0 w-fit min-w-[min(1112px,100%)] max-w-full flex-1 grid-rows-[auto_minmax(0,1fr)] mobile:w-full mobile:min-w-0'>
          <div className='relative my-[18px] mb-3.5 flex items-center justify-center mobile:flex-col mobile:items-stretch mobile:gap-2.5'>
            <div className='mx-auto grid grid-cols-2 mobile:grid-cols-3 rounded-md bg-black/40 p-[3px] mobile:w-full' role='tablist' aria-label='会员购买周期'>
              {PERIODS.map(period => (
                <button
                  key={period.key}
                  type='button'
                  role='tab'
                  aria-selected={selectedPeriod === period.key}
                  className={cn(
                    'inline-flex items-center justify-center gap-2 rounded-[5px] border-0 text-sm bg-transparent px-24 py-2 text-white/60 transition-all duration-200 ease-out hover:text-white/90 mobile:px-4',
                    selectedPeriod === period.key && 'bg-white/[0.14] text-white/95 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.05)]'
                  )}
                  onClick={() => setSelectedPeriod(period.key)}
                >
                  {period.label}
                  {period.badge && <span className='rounded-full bg-[#ff7b532e] px-[7px] py-[3px] text-[11px] leading-none text-[#ffad7d]'>{period.badge}</span>}
                </button>
              ))}
              <button
                type='button'
                className={cn(
                  'hidden mobile:inline-flex items-center justify-center gap-2 rounded-[5px] border-0 text-sm bg-transparent px-24 py-2 text-white/60 transition-all duration-200 ease-out hover:text-white/90 mobile:px-4'
                )}
                onClick={() => setCustomizationVisible(true)}
              >
                套餐定制
              </button>
            </div>

            <Button
              className='absolute right-0 mobile:hidden h-[30px] rounded-md text-xs text-white/75 hover:bg-white/[0.08] hover:text-white mobile:static mobile:w-full'
              variant='ghost'
              onClick={() => setCustomizationVisible(true)}
            >
              套餐定制
            </Button>
          </div>

          <div className='relative flex min-h-0 w-full items-stretch justify-center overflow-x-auto'>
            {loading && (
              <div className='flex mobile:flex-col w-max items-stretch gap-3.5 px-0.5 pb-2.5 pt-0.5'>
                {Array.from({ length: 4 }).map((_, index) => (
                  <article
                    key={index}
                    className='relative flex w-[360px] shrink-0 flex-col self-stretch rounded-lg border border-white/10 bg-[#242424] bg-[linear-gradient(180deg,rgba(255,255,255,0.06),transparent_42%)] px-4 py-4 mobile:w-[calc(100vw-56px)]'
                  >
                    <header className='flex justify-between gap-2.5'>
                      <div>
                        <Skeleton className='h-4 w-20 rounded-full bg-white/[0.12]' />
                        <Skeleton className='mt-5 h-10 w-24 rounded-md bg-white/[0.10]' />
                      </div>
                      <Skeleton className='h-5 w-14 rounded-full bg-white/[0.08]' />
                    </header>

                    <div className='flex h-32 flex-col justify-end'>
                      <div className='mb-3 rounded-md bg-white/[0.07] px-3 py-3'>
                        <Skeleton className='h-3 w-16 rounded-full bg-white/[0.10]' />
                        <Skeleton className='mt-3 h-4 w-40 rounded-full bg-white/[0.12]' />
                      </div>
                    </div>

                    <Skeleton className='h-8 w-full rounded-md bg-white/[0.12]' />

                    <div className='mt-6 flex-1 space-y-5'>
                      {Array.from({ length: 4 }).map((_, rowIndex) => (
                        <div key={rowIndex} className='flex items-center gap-2'>
                          <Skeleton className='h-3 w-3 shrink-0 rounded-full bg-white/[0.12]' />
                          <Skeleton className={cn('h-3 rounded-full bg-white/[0.08]', rowIndex % 2 === 0 ? 'w-44' : 'w-32')} />
                        </div>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            )}

            {!loading && error && <div className='flex items-center justify-center gap-2 py-24 text-[13px] text-white/60'>{error}</div>}

            {!loading && !error && currentPlans.length === 0 && (
              <div className='flex items-center justify-center gap-2 py-24 text-[13px] text-white/60'>当前周期暂无可购买套餐</div>
            )}

            {!loading && !error && currentPlans.length > 0 && (
              <AnimatePresence mode='wait'>
                <motion.div
                  key={selectedPeriod}
                  ref={planScrollerRef}
                  className='flex max-w-full self-stretch overflow-x-auto px-0.5 pb-2.5 pt-0.5 mobile:px-0 mobile:w-full [scrollbar-color:rgba(255,255,255,0.22)_transparent]'
                  onScroll={updatePlanScrollState}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
                >
                  <div className='flex w-max mobile:flex-col mobile:w-full items-stretch gap-3.5'>
                    {currentPlans.map((card, index) => {
                      const { plan, yearlyPlan } = card;
                      const salePriceInFen = getSalePriceInFen(plan);
                      const regularPriceInFen = getRegularPriceInFen(plan);
                      const originalPriceInFen = getOriginalPriceInFen(plan);
                      const benefitDescriptions = Array.isArray(plan.benefit_descriptions) ? plan.benefit_descriptions : [];
                      const tabColor = plan.display_config?.tab_color;
                      const yearlySaleTip = getYearlySaleTip(selectedPeriod, yearlyPlan);
                      const purchasedCount = getPurchasedCount(plan);
                      const periodLabel = selectedPeriod === 'monthly' ? '月' : '年';
                      const discountLabel = plan.discount_applied ? `首${periodLabel}${formatDiscountPercent(plan.discount_percent)}折` : '';

                      return (
                        <motion.article
                          key={`${selectedPeriod}-${plan.membership_plan_code}-${plan.membership_plan_id}-${index}`}
                          ref={setPlanCardRef(plan.membership_plan_id)}
                          className={cn(
                            'relative flex w-[360px] mobile:w-full shrink-0 flex-col self-stretch rounded-lg border border-white/10 bg-[#242424] bg-[linear-gradient(180deg,rgba(255,255,255,0.06),transparent_42%)] px-4 py-4 transition-[border-color,box-shadow,height] duration-200 ease-out hover:-translate-y-px hover:border-[#b4e0ff57] hover:shadow-[0_16px_36px_rgba(0,0,0,0.36)]',
                            'min-h-[640px] mobile:min-h-[560px]'
                          )}
                          style={{
                            background: plan.display_config?.cardBgColor || undefined,
                            height: planCardsEqualHeight ? `${planCardsEqualHeight}px` : undefined,
                          }}
                          initial={{ opacity: 0, y: 18 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.3, delay: index * 0.04, ease: [0.22, 1, 0.36, 1] }}
                        >
                          <header className='relative z-[1] flex h-32 flex-col gap-2.5 mobile:h-auto'>
                            <div className='flex items-center justify-between'>
                              <span className='inline-flex mobile:text-sm items-center gap-1.5 font-semibold text-white/95'>
                                <Sparkles size={14} />
                                {plan.membership_plan_name}
                              </span>
                              <div className='flex h-fit gap-1.5'>
                                {discountLabel && <mark className='rounded-full bg-[#ff7b532e] px-2 py-1 text-xs leading-none text-[#ffad7d]'>{discountLabel}</mark>}
                                {tabColor?.text && (
                                  <mark className='rounded-full px-2 py-1 text-xs leading-none text-white' style={{ background: tabColor.bgColor || 'rgba(255,255,255,0.14)' }}>
                                    {tabColor.text}
                                  </mark>
                                )}
                              </div>
                            </div>
                            <div>
                              <div className='mt-3 flex items-baseline gap-0.5 text-white'>
                                <span className='text-lg font-semibold'>￥</span>
                                <strong className='text-[34px] font-bold leading-none'>{formatPriceFromFen(salePriceInFen)}</strong>
                                <em className='text-xs not-italic text-white/70'>/{periodLabel}</em>
                                {originalPriceInFen > salePriceInFen && <del className='mr-1 text-xs text-white/40'>￥{formatPriceFromFen(originalPriceInFen)}</del>}
                              </div>
                              {plan.discount_applied && (
                                <p className='mt-0.5 text-xs bg-[linear-gradient(90deg,#E45B31_0%,#ffffff_55%)] bg-clip-text text-transparent'>
                                  首次购买首{periodLabel}仅 {formatPriceFromFen(salePriceInFen)} 元，后续恢复 {formatPriceFromFen(regularPriceInFen)} 元/{periodLabel}
                                </p>
                              )}
                              {yearlySaleTip && <p className='mt-0.5 text-xs text-white/45'>{yearlySaleTip}</p>}
                            </div>
                          </header>

                          <div className='h-32 flex flex-col justify-end'>
                            <div className='relative z-[1] my-0.5 mb-3 flex items-end justify-between rounded-md bg-white/[0.07] px-3 py-2.5'>
                              <div className='min-w-0'>
                                <span className='block text-xs text-white/45'>积分总额</span>
                                <strong className='mt-1 block whitespace-nowrap text-sm  font-semibold leading-tight text-white/90'>
                                  {formatPoint(plan.points?.points_total)}
                                  <span className='font-normal text-xs'> 赛点</span>
                                </strong>
                              </div>
                              <span className='px-2 pb-0.5 text-sm font-semibold text-white/60'>=</span>
                              <div className='min-w-0'>
                                <span className='block text-xs text-white/45'>固定积分</span>
                                <strong className='mt-1 block whitespace-nowrap text-sm font-semibold leading-tight text-white/90'>
                                  {formatPoint(plan.points?.points_purchase_reward)}
                                  <span className='font-normal text-xs'> 赛点</span>
                                </strong>
                              </div>
                              <span className='px-2 pb-0.5 text-sm font-semibold text-white/60'>+</span>
                              <div className='min-w-0'>
                                <span className='block text-xs text-white/45'>打卡总计可得</span>
                                <strong className='mt-1 block whitespace-nowrap text-sm font-semibold leading-tight text-white/90'>
                                  {formatPoint(plan.points?.points_signin_reward_total)}
                                  <span className='font-normal text-xs'> 赛点</span>
                                </strong>
                              </div>
                            </div>
                          </div>

                          <Button
                            className='relative z-[1] h-9 w-full rounded-md mobile:rounded-xl border-0 bg-[linear-gradient(180deg,#f6f8fa_0%,#cfd6dc_100%)] text-xs font-semibold text-[#121212] transition-[filter,transform] duration-150 ease-out hover:bg-[linear-gradient(180deg,#fff_0%,#e7edf1_100%)] hover:drop-shadow-[0_6px_14px_rgba(255,255,255,0.16)] active:scale-[0.98]'
                            disabled={salePriceInFen <= 0}
                            onClick={() => handleBuyPlan(plan)}
                          >
                            {salePriceInFen <= 0 ? '暂不可购买' : discountLabel || (purchasedCount > 0 ? '继续购买' : '立即购买')}
                          </Button>

                          {isMobile && (
                            <div
                              className='flex items-center gap-2 mt-6 cursor-pointer text-white/40 hover:text-white/70 transition-colors'
                              onClick={() => toggleExpand(plan.membership_plan_id)}
                            >
                              <div className='h-px bg-white/10 flex-1' />
                              <span className='text-xs flex items-center gap-1'>
                                {expandedPlanIds.has(plan.membership_plan_id) ? (
                                  <>
                                    点击收起详细权益 <ChevronsUp size={12} />
                                  </>
                                ) : (
                                  <>
                                    点击展开详细权益 <ChevronsDown size={12} />
                                  </>
                                )}
                              </span>
                              <div className='h-px bg-white/10 flex-1' />
                            </div>
                          )}

                          <AnimatePresence initial={false}>
                            {(!isMobile || expandedPlanIds.has(plan.membership_plan_id)) && (
                              <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.2, ease: 'easeOut' }}
                                className='overflow-hidden'
                              >
                                <div className='relative z-[1] mt-3.5 flex-1'>
                                  <TooltipProvider>
                                    {benefitDescriptions.map((section, sIdx) => {
                                      if (!Array.isArray(section.content)) {
                                        return null;
                                      }

                                      return (
                                        <div key={`${section.content_type}-${sIdx}`} className={sIdx < benefitDescriptions.length - 1 ? 'border-white/20 border-b mb-3 pb-3' : ''}>
                                          {section.content.map((item, rowIndex) => {
                                            if (!item.label) {
                                              return null;
                                            }

                                            const labelNode = <span className='break-words text-xs text-white/50'>{item.label}</span>;

                                            return (
                                              <div
                                                key={`${section.content_type}-${item.label}-${rowIndex}`}
                                                className='flex items-start gap-2 py-1 text-xs leading-normal text-white/70'
                                              >
                                                <Check className='mt-0.5 shrink-0 text-[#c5deffb8]' size={13} />
                                                {item.desc ? (
                                                  <Tooltip>
                                                    <TooltipTrigger asChild>{labelNode}</TooltipTrigger>
                                                    <TooltipContent className='z-[1002] max-w-[260px] text-xs'>
                                                      <p>{item.desc}</p>
                                                    </TooltipContent>
                                                  </Tooltip>
                                                ) : (
                                                  labelNode
                                                )}
                                              </div>
                                            );
                                          })}
                                        </div>
                                      );
                                    })}
                                  </TooltipProvider>
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </motion.article>
                      );
                    })}
                  </div>
                </motion.div>
              </AnimatePresence>
            )}

            {showPlanScrollButtons && (
              <>
                <Button
                  type='button'
                  variant='ghost'
                  size='icon'
                  className='fixed left-4 top-1/2 z-20 h-8 w-8 -translate-y-1/2 rounded-md bg-white/10 text-white/95 backdrop-blur-sm hover:bg-white/20 hover:text-white focus-visible:ring-2 focus-visible:ring-white/45 disabled:bg-white/[0.1] disabled:text-white/30'
                  disabled={!planScrollState.canScrollLeft}
                  aria-label='向左滚动套餐列表'
                  onClick={() => scrollPlans('left')}
                >
                  <ChevronLeft size={16} />
                </Button>
                <Button
                  type='button'
                  variant='ghost'
                  size='icon'
                  className='fixed right-4 top-1/2 z-20 h-8 w-8 -translate-y-1/2 rounded-md bg-white/10 text-white/95 backdrop-blur-sm hover:bg-white/20 hover:text-white focus-visible:ring-2 focus-visible:ring-white/45 disabled:bg-white/[0.1] disabled:text-white/30'
                  disabled={!planScrollState.canScrollRight}
                  aria-label='向右滚动套餐列表'
                  onClick={() => scrollPlans('right')}
                >
                  <ChevronRight size={16} />
                </Button>
              </>
            )}
          </div>
          {/* 关闭：grid-rows（TabBar + 卡片区）容器（L360 打开的 grid div） */}
        </div>

        <div className='text-center text-xs text-white/50'>所售为虚拟商品，一经付费，不支持提现或退款</div>

        {/* 常见问题 FAQ：放在卡片区之后、免责声明之前，纵向滚动区域内 */}
        <FrequentlyAskedQuestions className='mt-2 mobile:mt-0' />
      </div>

      <Dialog open={payVisible} onOpenChange={setPayVisible}>
        <DialogContent className='w-[385px] border-none bg-transparent p-0 shadow-none' showCloseButton={false}>
          {selectedPlan && (
            <PopPointPayCodeV2
              createOrderPayload={{
                productType: 'SUBSCRIBE_MEMBERSHIP',
                paymentMethod: payWayData,
                membershipPlanId: selectedPlan.membership_plan_id,
              }}
              displayInfo={{
                title: `${selectedPlan.membership_plan_name}会员（${selectedPeriodMeta.label}）`,
                priceText: `¥${formatPriceFromFen(getSalePriceInFen(selectedPlan))}`,
              }}
              onClose={shouldClose => {
                setPayVisible(false);
                if (shouldClose === true) {
                  onClose?.();
                }
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={pointVisible} onOpenChange={setPointVisible}>
        <DialogContent className='w-auto max-w-none gap-0 border-none bg-transparent p-0 shadow-none' overlayClassName='bg-black/80' showCloseButton={false}>
          <PopPointV2 insufficientPoints={false} onClose={() => setPointVisible(false)} />
        </DialogContent>
      </Dialog>

      <PopPackageCustomization open={customizationVisible} onClose={() => setCustomizationVisible(false)} />
    </section>
  );
}

export default function PopSubscriptionV2({ onClose }: { onClose?: () => void }) {
  return <SubscriptionPlanPurchase onClose={onClose} />;
}
