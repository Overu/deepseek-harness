import * as z from 'zod';
import type { InvoiceEntity, InvoiceEntityParams, UpdateInvoiceEntityParams } from '@/api/invoice';

export const INVOICE_ENTITY_TYPE = {
  Personal: 1,
  Enterprise: 2,
} as const;

export const INVOICE_TYPE = {
  Normal: 1,
  Special: 2,
} as const;

export const INVOICE_DEFAULT_STATUS = {
  No: 0,
  Yes: 1,
} as const;

export const INVOICE_ENTITY_TYPE_VALUE = {
  Personal: '1',
  Enterprise: '2',
} as const;

export const INVOICE_TYPE_VALUE = {
  Normal: '1',
  Special: '2',
} as const;

export const INVOICE_DEFAULT_STATUS_VALUE = {
  No: '0',
  Yes: '1',
} as const;

export const INVOICE_ENTITY_TYPE_OPTIONS = [
  { label: '个人', value: INVOICE_ENTITY_TYPE_VALUE.Personal },
  { label: '企业', value: INVOICE_ENTITY_TYPE_VALUE.Enterprise },
] as const;

export const INVOICE_TYPE_OPTIONS = [
  { label: '增值税普通发票', value: INVOICE_TYPE_VALUE.Normal },
  { label: '增值税专用发票', value: INVOICE_TYPE_VALUE.Special },
] as const;

export interface InvoiceEntityFormValues {
  entity_type: '1' | '2';
  invoice_type: '1' | '2';
  entity_name: string;
  tax_no: string;
  receive_email: string;
  bank_name: string;
  bank_account: string;
  remark: string;
  is_default: '0' | '1';
}

export const INVOICE_ENTITY_FORM_DEFAULTS: InvoiceEntityFormValues = {
  entity_type: INVOICE_ENTITY_TYPE_VALUE.Enterprise,
  invoice_type: INVOICE_TYPE_VALUE.Normal,
  entity_name: '',
  tax_no: '',
  receive_email: '',
  bank_name: '',
  bank_account: '',
  remark: '',
  is_default: INVOICE_DEFAULT_STATUS_VALUE.No,
};

const emailRegex = /^[A-Za-z0-9._%+-]+@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/;
const bankAccountRegex = /^\d+$/;

export const invoiceEntityFormSchema = z
  .object({
    entity_type: z.enum(['1', '2']),
    invoice_type: z.enum(['1', '2']),
    entity_name: z.string().trim().min(1, { message: '请输入抬头名称' }).max(200, { message: '抬头名称不能超过200个字符' }),
    tax_no: z.string().trim().max(100, { message: '单位税号不能超过100个字符' }),
    receive_email: z.string().trim().min(1, { message: '请输入发票接收邮箱' }).max(200, { message: '邮箱不能超过200个字符' }).regex(emailRegex, {
      message: '请输入正确的邮箱格式',
    }),
    bank_name: z.string().trim().max(200, { message: '开户银行不能超过200个字符' }),
    bank_account: z.string().trim().max(100, { message: '银行账户不能超过100个字符' }),
    remark: z.string().trim().max(500, { message: '备注不能超过500个字符' }),
    is_default: z.enum(['0', '1']),
  })
  .superRefine((values, ctx) => {
    const isEnterprise = values.entity_type === INVOICE_ENTITY_TYPE_VALUE.Enterprise;
    const isSpecialInvoice = values.invoice_type === INVOICE_TYPE_VALUE.Special;

    if (!isEnterprise) {
      return;
    }

    if (!values.tax_no.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['tax_no'],
        message: '请输入单位税号',
      });
    }

    if (values.bank_account.trim() && !bankAccountRegex.test(values.bank_account.trim())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['bank_account'],
        message: '银行账户仅支持数字',
      });
    }

    if (isSpecialInvoice && !values.bank_name.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['bank_name'],
        message: '专票请填写开户银行',
      });
    }

    if (isSpecialInvoice && !values.bank_account.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['bank_account'],
        message: '专票请填写银行账户',
      });
    }
  });

const toStringValue = (value: unknown) => (value == null ? '' : String(value));

export const normalizeInvoiceEntityForm = (entity?: InvoiceEntity | null): InvoiceEntityFormValues => ({
  entity_type: toStringValue(entity?.entity_type || INVOICE_ENTITY_TYPE.Enterprise) as InvoiceEntityFormValues['entity_type'],
  invoice_type: toStringValue(entity?.invoice_type || INVOICE_TYPE.Normal) as InvoiceEntityFormValues['invoice_type'],
  entity_name: entity?.entity_name || '',
  tax_no: entity?.tax_no || '',
  receive_email: entity?.receive_email || '',
  bank_name: entity?.bank_name || '',
  bank_account: toStringValue(entity?.bank_account),
  remark: entity?.remark || '',
  is_default: toStringValue(entity?.is_default ?? INVOICE_DEFAULT_STATUS.No) as InvoiceEntityFormValues['is_default'],
});

export const sanitizeInvoiceEntityForm = (values: InvoiceEntityFormValues): InvoiceEntityFormValues => ({
  entity_type: values.entity_type,
  invoice_type: values.entity_type === INVOICE_ENTITY_TYPE_VALUE.Personal ? INVOICE_TYPE_VALUE.Normal : values.invoice_type,
  entity_name: values.entity_name.trim(),
  tax_no: values.entity_type === INVOICE_ENTITY_TYPE_VALUE.Personal ? '' : values.tax_no.trim(),
  receive_email: values.receive_email.trim().toLowerCase(),
  bank_name: values.entity_type === INVOICE_ENTITY_TYPE_VALUE.Personal ? '' : values.bank_name.trim(),
  bank_account: values.entity_type === INVOICE_ENTITY_TYPE_VALUE.Personal ? '' : values.bank_account.trim(),
  remark: values.remark.trim(),
  is_default: values.is_default,
});

export const toInvoiceEntityParams = (values: InvoiceEntityFormValues): InvoiceEntityParams => {
  const sanitized = sanitizeInvoiceEntityForm(values);
  const params: InvoiceEntityParams = {
    entity_type: sanitized.entity_type,
    invoice_type: sanitized.invoice_type,
    entity_name: sanitized.entity_name,
    receive_email: sanitized.receive_email,
    is_default: sanitized.is_default,
  };

  if (sanitized.entity_type === INVOICE_ENTITY_TYPE_VALUE.Enterprise) {
    params.tax_no = sanitized.tax_no;
    params.bank_name = sanitized.bank_name;
    params.bank_account = sanitized.bank_account;
  }

  if (sanitized.remark) {
    params.remark = sanitized.remark;
  }

  return params;
};

export const toUpdateInvoiceEntityParams = (id: number, values: InvoiceEntityFormValues): UpdateInvoiceEntityParams => ({
  ...toInvoiceEntityParams(values),
  id,
});

export const hasInvoiceEntityFormChanged = (initialValues: InvoiceEntityFormValues, currentValues: InvoiceEntityFormValues) => {
  return JSON.stringify(sanitizeInvoiceEntityForm(initialValues)) !== JSON.stringify(sanitizeInvoiceEntityForm(currentValues));
};

export const getPreferredInvoiceEntity = (entities: InvoiceEntity[]) => {
  return entities.find(entity => Number(entity.is_default) === INVOICE_DEFAULT_STATUS.Yes) || entities[0] || null;
};

export const getInvoiceEntityDisplayName = (entity: InvoiceEntity) => {
  return `${entity.entity_name}${Number(entity.is_default) === INVOICE_DEFAULT_STATUS.Yes ? '（默认）' : ''}`;
};

export const getInvoiceEntityTypeLabel = (entityType?: number | string) => {
  return String(entityType) === INVOICE_ENTITY_TYPE_VALUE.Personal ? '个人' : '企业';
};

export const getInvoiceTypeLabel = (invoiceType?: number | string) => {
  return String(invoiceType) === INVOICE_TYPE_VALUE.Special ? '增值税专用发票' : '增值税普通发票';
};

const normalizeCode = (value?: string) => value?.trim() || '';

const INVOICE_PAY_METHOD_LABELS: Record<string, string> = {
  ALIPAY: '支付宝',
  ALIPAY_H5: '支付宝',
  ALIPAY_PC: '支付宝',
  WECHAT: '微信支付',
  WECHAT_PAY: '微信支付',
  WX: '微信支付',
  WX_H5: '微信支付',
  WX_NATIVE: '微信支付',
};

const INVOICE_PAY_STATUS_LABELS: Record<string, string> = {
  FAIL: '支付失败',
  FAILED: '支付失败',
  PAID: '支付成功',
  PAY_FAILED: '支付失败',
  PAY_SUCCESS: '支付成功',
  PAYING: '支付中',
  PENDING: '支付中',
  SUCCESS: '支付成功',
};

export const getInvoiceProductSummaryLabel = (productSummary?: string) => {
  return normalizeCode(productSummary) || '-';
};

export const getInvoicePayMethodLabel = (payMethod?: string) => {
  const normalized = normalizeCode(payMethod);
  if (!normalized) return '-';

  return INVOICE_PAY_METHOD_LABELS[normalized.toUpperCase()] || normalized;
};

export const getInvoicePayStatusLabel = (payStatus?: string) => {
  const normalized = normalizeCode(payStatus);
  if (!normalized) return '-';

  return INVOICE_PAY_STATUS_LABELS[normalized.toUpperCase()] || normalized;
};

export const formatInvoiceAmount = (amount?: number) => {
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount)) {
    return '-';
  }

  return Number.isInteger(numericAmount) ? String(numericAmount) : numericAmount.toFixed(2).replace(/\.?0+$/, '');
};
