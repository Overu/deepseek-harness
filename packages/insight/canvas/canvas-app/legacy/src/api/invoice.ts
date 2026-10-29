import { request } from './request';

/** 主体类型：1-个人，2-企业 */
export enum InvoiceEntityType {
  Personal = 1,
  Enterprise = 2,
}

/** 发票类型：1-普票，2-专票 */
export enum InvoiceType {
  Normal = 1,
  Special = 2,
}

/** 是否默认抬头：0-否，1-是 */
export enum InvoiceDefaultStatus {
  No = 0,
  Yes = 1,
}

/** 发票范围：ORDER-订单消费 */
export enum InvoiceScope {
  Order = 'ORDER',
}

/** 发票状态：UNINVOICED-未开票 */
export enum InvoiceStatus {
  Uninvoiced = 'UNINVOICED',
}

/** 展示状态：UNINVOICED-未开票 */
export enum InvoiceDisplayStatus {
  Uninvoiced = 'UNINVOICED',
}

/** 消费来源类型：ORDER-订单 */
export enum InvoiceSourceType {
  Order = 'ORDER',
}

type InvoiceEntityTypeValue = 1 | 2 | '1' | '2';
type InvoiceTypeValue = 1 | 2 | '1' | '2';
type InvoiceDefaultStatusValue = 0 | 1 | '0' | '1';

export interface InvoiceApiResponse<T> {
  code: string;
  msg: string;
  data: T;
  success: boolean;
}

export interface InvoiceEntity {
  id: number;
  entity_type: InvoiceEntityType; // 主体类型：1-个人，2-企业
  invoice_type: InvoiceType; // 发票类型：1-普票，2-专票
  entity_name: string; // 发票抬头名称，最长200字符
  tax_no?: string; // 纳税人识别号，最长100字符
  receive_email?: string; // 接收发票邮箱，最长200字符
  bank_name?: string; // 开户银行，专票必填，最长200字符
  bank_account?: string | number; // 银行账号，专票必填；长数字请使用字符串避免精度丢失
  remark?: string; // 备注，最长500字符
  is_default: InvoiceDefaultStatus; // 是否默认抬头：0-否，1-是
}

export interface InvoiceEntityParams {
  entity_type: InvoiceEntityTypeValue; // 主体类型：1-个人，2-企业
  invoice_type: InvoiceTypeValue; // 发票类型：1-普票，2-专票
  entity_name: string; // 发票抬头名称，最长200字符
  tax_no?: string; // 纳税人识别号，最长100字符
  receive_email?: string; // 接收发票邮箱，最长200字符
  bank_name?: string; // 开户银行，专票必填，最长200字符
  bank_account?: string | number; // 银行账号，专票必填，最长100字符
  remark?: string; // 备注，最长500字符
  is_default?: InvoiceDefaultStatusValue; // 是否默认抬头：0-否，1-是；不传默认0
}

export interface UpdateInvoiceEntityParams extends InvoiceEntityParams {
  id: number; // 发票抬头ID
}

export interface InvoiceEntityIdParams {
  id: number; // 发票抬头ID
}

export interface InvoiceConsumeItemListParams {
  page_no: number;
  page_size: number;
  user_id?: number;
  invoice_scope?: InvoiceScope | `${InvoiceScope}`; // 发票范围：ORDER-订单消费
  time_order?: 'ASC' | 'DESC'; // 支付时间排序：ASC-升序，DESC-倒序
  consume_year_month?: string; // 消费年月，如 2026-06
  invoice_status?: InvoiceStatus | `${InvoiceStatus}`; // 发票状态
  display_status?: InvoiceDisplayStatus | `${InvoiceDisplayStatus}`; // 页面展示状态
  source_no?: string; // 来源单号，如订单号
  start_pay_time?: string; // 支付开始时间，如 2026-06-01 00:00:00
  end_pay_time?: string; // 支付结束时间，如 2026-06-30 23:59:59
}

export interface InvoiceConsumeItem {
  consume_item_id: number;
  source_type: InvoiceSourceType | string; // 来源类型：ORDER-订单
  source_id: number;
  source_no: string;
  consume_year_month: string;
  order_id?: number;
  order_no?: string;
  user_id: number;
  pay_time: string;
  pay_amount: number;
  pay_method?: string; // 支付渠道，后端枚举补充中，前端按原值兜底展示
  pay_status?: string; // 支付状态，后端枚举补充中，前端按原值兜底展示
  invoice_status: InvoiceStatus | string;
  display_status: InvoiceDisplayStatus | string;
  product_summary?: string; // 商品/订单摘要，用于消费记录订单类型展示
  current_application_id?: number;
  can_apply: boolean;
  can_reissue: boolean;
}

export interface InvoiceConsumeItemListData {
  items: InvoiceConsumeItem[];
  total: number;
  page: number;
  page_size: number;
}

export interface ApplyInvoiceApplicationParams {
  invoice_entity_id: number; // 发票抬头ID
  consume_item_ids: number[]; // 消费明细ID列表
  invoice_scope: InvoiceScope | `${InvoiceScope}`; // 发票范围：ORDER-订单消费
  contact_phone: string | number; // 联系电话，建议使用字符串
  remark?: string; // 申请备注
}

export interface ReissueInvoiceApplicationParams {
  original_application_id: number; // 原发票申请ID
  invoice_entity_id: number; // 新发票抬头ID
  invoice_scope: InvoiceScope | `${InvoiceScope}`; // 发票范围：ORDER-订单消费
  contact_phone: string | number; // 联系电话，建议使用字符串
  remark?: string; // 重开原因或备注
}

export interface InvoiceApplicationData {
  application_id: number;
  application_no: string;
}

export interface InvoiceApplicationIdParams {
  application_id: number; // 发票申请ID
}

export interface InvoiceDownloadUrlData {
  application_id: number;
  pdf_url: string;
}

const invoiceRequest = <T>(url: string, params?: unknown) => {
  return request<T>(url, params) as unknown as Promise<InvoiceApiResponse<T>>;
};

/** 新增发票抬头 */
export const addInvoiceEntity = (params: InvoiceEntityParams) => {
  return invoiceRequest<number>('/receipt-service/api/invoice/entity/add', params);
};

/** 更新发票抬头 */
export const updateInvoiceEntity = (params: UpdateInvoiceEntityParams) => {
  return invoiceRequest<boolean>('/receipt-service/api/invoice/entity/update', params);
};

/** 设置默认发票抬头 */
export const setDefaultInvoiceEntity = (params: InvoiceEntityIdParams) => {
  return invoiceRequest<boolean>('/receipt-service/api/invoice/entity/setDefault', params);
};

/** 查询发票抬头列表 */
export const getInvoiceEntityList = () => {
  return invoiceRequest<InvoiceEntity[]>('/receipt-service/api/invoice/entity/list', {});
};

/** 删除发票抬头 */
export const deleteInvoiceEntity = (params: InvoiceEntityIdParams) => {
  return invoiceRequest<boolean>('/receipt-service/api/invoice/entity/delete', params);
};

/** 查询可开票/可重开发票的消费明细列表 */
export const getInvoiceConsumeItemList = (params: InvoiceConsumeItemListParams) => {
  return invoiceRequest<InvoiceConsumeItemListData>('/receipt-service/api/invoice/consume-item/list', params);
};

/** 提交正常开票申请 */
export const applyInvoiceApplication = (params: ApplyInvoiceApplicationParams) => {
  return invoiceRequest<InvoiceApplicationData>('/receipt-service/api/invoice/application/apply', params);
};

/** 提交重开发票申请 */
export const reissueInvoiceApplication = (params: ReissueInvoiceApplicationParams) => {
  return invoiceRequest<InvoiceApplicationData>('/receipt-service/api/invoice/application/reissue', params);
};

/** 下载发票PDF，后端通常返回二进制文件流 */
export const downloadInvoicePdf = (params: InvoiceApplicationIdParams) => {
  return request('/receipt-service/api/invoice/application/download', params);
};

/** 查询发票PDF下载地址 */
export const getInvoiceDownloadUrl = (params: InvoiceApplicationIdParams) => {
  return invoiceRequest<InvoiceDownloadUrlData>('/receipt-service/api/invoice/application/downloadUrl', params);
};
