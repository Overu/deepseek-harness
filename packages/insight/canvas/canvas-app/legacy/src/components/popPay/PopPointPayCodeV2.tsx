import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Check, RotateCcw, X } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { toast } from 'sonner';
import { createAmountOrder, getAmountOrderStatus, refreshAmountOrder, type CreatePayOrderParams, type PaymentMethod } from '@/api/order';
import { Skeleton } from '@/components/ui/skeleton';
import { usePointStore } from '@/store/pointStore';
import paymentAgreementUrl from '@/assets/aggrements/shopPayment_zh_cn.html?url';
import { resolvePaymentMethod } from './paymentMethod';

interface OrderInfo {
  orderNo: string;
  payUrl: string;
  isQRCode: boolean;
}

type PayStatus = 'NEW' | 'PAYING' | 'SUCCESS' | 'FAIL' | 'CANCEL' | 'PAYMENT_TIMEOUT';

interface PayDisplayInfo {
  title?: string;
  priceText?: string;
  pointsText?: string;
}

interface PopPointPayCodeV2Props {
  createOrderPayload: CreatePayOrderParams;
  displayInfo?: PayDisplayInfo;
  onClose: (shouldClose?: boolean) => void;
}

const PAY_METHOD_META: Record<PaymentMethod, { icon: string; tip: string }> = {
  ALIPAY_PC: {
    icon: '//web-gpt-assets-cdn.idealead.com/base-platform/test/images/pay/zhifubao.png',
    tip: '支付宝扫码支付购买',
  },
  WX_NATIVE: {
    icon: '//web-gpt-assets-cdn.idealead.com/base-platform/test/images/pay/wx.png',
    tip: '微信扫码支付购买',
  },
};

const normalizeOrderInfo = (data: any): OrderInfo => ({
  orderNo: data?.orderNo || data?.order_no || '',
  payUrl: data?.payUrl || data?.pay_url || '',
  isQRCode: data?.isQRCode ?? data?.is_qr_code ?? true,
});

export default function PopPointPayCodeV2({ createOrderPayload, displayInfo, onClose }: PopPointPayCodeV2Props) {
  const [payStatus, setPayStatus] = useState<PayStatus>('NEW');
  const [orderInfo, setOrderInfo] = useState<OrderInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [showAgreementMask, setShowAgreementMask] = useState(true);
  const [orderError, setOrderError] = useState('');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasCreatedRef = useRef(false);
  const hasShownSuccessToastRef = useRef(false);
  const successCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { refreshUserPoint } = usePointStore(state => state.actions);

  const resolvedPayload = useMemo<CreatePayOrderParams>(
    () => ({
      ...createOrderPayload,
      paymentMethod: resolvePaymentMethod(createOrderPayload.paymentMethod),
    }),
    [createOrderPayload]
  );

  const paymentMethod = resolvePaymentMethod(resolvedPayload.paymentMethod);
  const payMeta = PAY_METHOD_META[paymentMethod];
  const priceText = displayInfo?.priceText || '以订单金额为准';

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const pollOrderStatus = useCallback(
    async (orderNo: string) => {
      if (!orderNo) {
        return;
      }

      try {
        const { code, data }: any = await getAmountOrderStatus({ orderNo });
        if (code !== 'SUCCESS') {
          return;
        }

        const status = data?.status as PayStatus;
        setPayStatus(status);
        clearTimer();

        if (status === 'NEW' || status === 'PAYING') {
          timerRef.current = setTimeout(() => pollOrderStatus(orderNo), 2000);
          return;
        }

        if (status === 'SUCCESS' && !hasShownSuccessToastRef.current) {
          hasShownSuccessToastRef.current = true;
          toast.success('支付成功', { duration: 2200 });
          await refreshUserPoint({ reason: 'payment-success' });
          successCloseTimerRef.current = setTimeout(() => onClose(true), 1200);
        }

        if (status === 'FAIL') {
          toast.error('支付失败，请重新发起支付');
          setOrderError('支付失败，请重新发起支付');
        }
      } catch (error) {
        console.error('Failed to fetch order status:', error);
      }
    },
    [clearTimer, onClose, refreshUserPoint]
  );

  const createOrder = useCallback(async () => {
    if (hasCreatedRef.current || loading) {
      return;
    }

    hasCreatedRef.current = true;
    setOrderError('');
    setLoading(true);
    try {
      const { code, data, msg, message }: any = await createAmountOrder(resolvedPayload);
      if (code === 'SUCCESS') {
        const nextOrderInfo = normalizeOrderInfo(data);
        if (!nextOrderInfo.orderNo || !nextOrderInfo.payUrl) {
          throw new Error('Invalid order response');
        }

        setOrderInfo(nextOrderInfo);
        setPayStatus('NEW');
        pollOrderStatus(nextOrderInfo.orderNo);
        return;
      }

      toast.error(msg || message || '创建订单失败');
      setOrderError(msg || message || '创建订单失败');
      setPayStatus('FAIL');
      hasCreatedRef.current = false;
    } catch (error) {
      console.error('Failed to create order:', error);
      toast.error('创建订单失败');
      setOrderError('创建订单失败，请重新发起支付');
      setPayStatus('FAIL');
      hasCreatedRef.current = false;
    } finally {
      setLoading(false);
    }
  }, [loading, pollOrderStatus, resolvedPayload]);

  const handleRefreshOrder = async () => {
    if (!orderInfo?.orderNo) {
      return;
    }

    setOrderError('');
    setLoading(true);
    try {
      const { code, data }: any = await refreshAmountOrder({
        paymentMethod,
        orderNo: orderInfo.orderNo,
      });

      if (code === 'SUCCESS') {
        const nextOrderInfo = normalizeOrderInfo(data);
        if (!nextOrderInfo.orderNo || !nextOrderInfo.payUrl) {
          throw new Error('Invalid refresh response');
        }

        setOrderInfo(nextOrderInfo);
        setPayStatus('NEW');
        pollOrderStatus(nextOrderInfo.orderNo);
        return;
      }

      setOrderError('刷新订单失败，请稍后重试');
    } catch {
      toast.error('刷新订单失败');
      setOrderError('刷新订单失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  const handleAgreeAndPay = () => {
    setShowAgreementMask(false);
    createOrder();
  };

  const handleRetryCreateOrder = () => {
    hasCreatedRef.current = false;
    setPayStatus('NEW');
    setOrderInfo(null);
    createOrder();
  };

  useEffect(() => {
    return () => {
      clearTimer();
      if (successCloseTimerRef.current) {
        clearTimeout(successCloseTimerRef.current);
        successCloseTimerRef.current = null;
      }
    };
  }, [clearTimer]);

  return (
    <motion.div
      className='relative w-full min-h-[420px] rounded-lg bg-[#1f1f1f] px-8 py-7 text-white'
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
    >
      <button
        type='button'
        className='absolute right-4 top-4 rounded-md p-1 text-white/55 transition-colors hover:bg-white/10 hover:text-white'
        onClick={() => onClose(false)}
        aria-label='关闭'
      >
        <X size={20} />
      </button>

      {payStatus === 'SUCCESS' ? (
        <div className='flex min-h-[360px] flex-col items-center justify-center'>
          <div className='flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500 shadow-[0_0_60px_rgba(16,185,129,0.38)]'>
            <Check className='h-11 w-11 text-white' />
          </div>
          <p className='mt-6 text-2xl font-semibold text-white'>支付成功</p>
          <p className='mt-2 text-xs text-white/55'>您可在消费记录页面进行相关详情查询</p>
        </div>
      ) : (
        <div className='flex flex-col items-center'>
          {loading ? (
            <article className='flex flex-col items-center text-center'>
              <Skeleton className='mt-3 h-8 w-28 rounded-full bg-white/[0.12]' />
              <Skeleton className='mt-3 h-3 w-20 rounded-full bg-white/[0.08]' />
            </article>
          ) : (
            <div className='text-center'>
              {/* <p className='text-sm text-white/55'>{title}</p> */}
              <div className='mt-2 text-[28px] font-bold leading-none text-white'>{priceText}</div>
              {displayInfo?.pointsText && <p className='mt-2 text-xs text-white/45'>{displayInfo.pointsText}</p>}
            </div>
          )}

          <div className='relative mt-6 flex h-[265px] w-[265px] items-center justify-center rounded-lg bg-white'>
            {loading && (
              <div className='absolute inset-0 z-[2] flex flex-col items-center justify-center rounded-lg bg-[#f3f5f9] px-8'>
                <article className='grid w-full grid-cols-3 gap-2'>
                  {Array.from({ length: 3 }).map((_, index) => (
                    <Skeleton key={index} className='h-16 rounded-md bg-slate-300/80' />
                  ))}
                </article>
                <Skeleton className='mt-5 h-28 w-28 rounded-md bg-slate-300/80' />
                <Skeleton className='mt-5 h-3 w-32 rounded-full bg-slate-300/80' />
              </div>
            )}

            {orderInfo?.payUrl &&
              (orderInfo.isQRCode ? (
                <QRCodeSVG value={orderInfo.payUrl} size={paymentMethod === 'ALIPAY_PC' ? 235 : 250} marginSize={1} />
              ) : (
                <iframe id='formRequest' srcDoc={orderInfo.payUrl} width='255' height='255' className='overflow-hidden' title='支付表单' />
              ))}

            {!showAgreementMask && orderError && payStatus !== 'PAYMENT_TIMEOUT' && (
              <div className='absolute inset-0 z-[3] flex flex-col items-center justify-center rounded-lg bg-black/78 px-6 text-center text-white'>
                <span className='text-sm'>{orderError}</span>
                <button type='button' className='mt-4 rounded-full bg-[#4155F0] px-5 py-2 text-sm text-white' onClick={handleRetryCreateOrder}>
                  重新发起支付
                </button>
              </div>
            )}

            {payStatus === 'PAYMENT_TIMEOUT' && (
              <button type='button' className='absolute inset-0 z-[3] flex flex-col items-center justify-center rounded-lg bg-black/75 text-white' onClick={handleRefreshOrder}>
                <RotateCcw className='h-10 w-10' />
                <span className='mt-2 text-sm'>二维码超时，请点击刷新</span>
              </button>
            )}

            {showAgreementMask && (
              <div className='absolute inset-0 z-[4] flex flex-col items-center justify-center rounded-lg bg-black/90 px-6 text-center'>
                <div className='text-base font-medium text-white/95'>支付前请阅读</div>
                <button type='button' className='mt-2 text-sm text-[#6C97DF]' onClick={() => window.open(paymentAgreementUrl, '_blank')}>
                  《付费服务协议》
                </button>
                <button type='button' className='mt-6 rounded-full bg-[#4155F0] px-6 py-2 text-sm text-white' onClick={handleAgreeAndPay}>
                  同意并支付
                </button>
              </div>
            )}
          </div>

          {loading ? (
            <article className='mt-4 flex items-center gap-2'>
              <Skeleton className='h-6 w-6 rounded-full bg-white/[0.10]' />
              <Skeleton className='h-4 w-32 rounded-full bg-white/[0.10]' />
            </article>
          ) : (
            <div className='mt-4 flex items-center text-sm text-white/86'>
              <img src={payMeta.icon} alt='' className='h-6 w-6' />
              <span className='ml-2'>{payMeta.tip}</span>
            </div>
          )}

          {!showAgreementMask && (
            <div className='mt-1 text-sm text-[#AAA7B6]'>
              您已同意
              <button type='button' className='text-[#6C97DF]' onClick={() => window.open(paymentAgreementUrl, '_blank')}>
                《付费服务协议》
              </button>
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
}
