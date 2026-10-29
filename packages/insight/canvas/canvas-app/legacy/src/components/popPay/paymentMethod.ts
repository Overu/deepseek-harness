import type { PaymentMethod } from '@/api/order';

export const getDefaultPaymentMethod = (mode = import.meta.env.MODE): PaymentMethod => {
  return mode === 'production' ? 'ALIPAY_PC' : 'WX_NATIVE';
};

export const resolvePaymentMethod = (paymentMethod?: PaymentMethod, mode?: string): PaymentMethod => {
  return paymentMethod || getDefaultPaymentMethod(mode);
};
