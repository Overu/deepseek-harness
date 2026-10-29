import type { InvoiceConsumeItemListParams } from '@/api/invoice';

export const buildConsumeItemListParams = (pageNo: number, pageSize: number, orderType: string, sortAsc: boolean): InvoiceConsumeItemListParams => ({
  page_no: pageNo,
  page_size: pageSize,
  time_order: sortAsc ? 'ASC' : 'DESC',
  ...(orderType === 'ALL' ? {} : { invoice_scope: 'ORDER' }),
});
