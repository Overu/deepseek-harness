import { useEffect, useState } from 'react';
import dayjs from 'dayjs';
import { ArrowDownWideNarrow, ArrowUpWideNarrow, LoaderCircle } from 'lucide-react';
import { getInvoiceConsumeItemList, InvoiceScope, type InvoiceConsumeItem } from '@/api/invoice';
import { Button } from '@/components/ui/button';
import { Pagination, PaginationContent } from '@/components/ui/pagination';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PAYMENT_FLOATING_Z_INDEX } from '../payLayer';
import { formatInvoiceAmount, getInvoicePayMethodLabel, getInvoicePayStatusLabel, getInvoiceProductSummaryLabel } from './invoiceUtils';
import { InvoiceInfoDialog } from './InvoiceDialogs';
import PaginationCustom from './PaginationCustom';
import { buildConsumeItemListParams } from './accountConsumeRecordParams';

interface PageObj {
  list: InvoiceConsumeItem[];
  current: number;
  total: number;
  size: number;
  loading: boolean;
  noData: boolean;
}

interface OptionState {
  orderType: string;
  sortAsc: boolean;
}

const ORDER_TYPE_OPTIONS = [
  { label: '全部', value: 'ALL' },
  { label: '订单消费', value: InvoiceScope.Order },
];

const invoiceStatusText: Record<string, string> = {
  UNINVOICED: '未开票',
  APPLYING: '开票中',
  INVOICED: '已开票',
  REISSUING: '重开中',
};

const getInvoiceStatusText = (item: InvoiceConsumeItem) => {
  const status = item.invoice_status || item.display_status;
  return invoiceStatusText[status] || status || '-';
};

const getActionText = (item: InvoiceConsumeItem) => {
  return item.can_reissue ? '重开' : '开票';
};

const canInvoice = (item: InvoiceConsumeItem, submittedIds: Set<number>) => {
  return !submittedIds.has(item.consume_item_id) && (item.can_apply || item.can_reissue);
};

export default function AccountConsumeRecord() {
  const [selectOption, setSelectOption] = useState<OptionState>({
    orderType: 'ALL',
    sortAsc: false,
  });
  const [pageObj, setPageObj] = useState<PageObj>({
    list: [],
    current: 1,
    total: 0,
    size: 10,
    loading: false,
    noData: false,
  });
  const [refreshKey, setRefreshKey] = useState(0);
  const [submittedIds, setSubmittedIds] = useState<Set<number>>(new Set());
  const [invoiceDialogOpen, setInvoiceDialogOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<InvoiceConsumeItem | null>(null);

  const totalPages = Math.ceil(pageObj.total / pageObj.size);

  const handleChangePage = (page: number) => {
    if (page < 1 || page > totalPages || pageObj.current === page) return;
    setPageObj(prev => ({ ...prev, current: page }));
  };

  const changeOrderType = (value: string) => {
    setPageObj(prev => ({ ...prev, current: 1, total: 0, noData: false }));
    setSelectOption(prev => ({ ...prev, orderType: value }));
  };

  const changeTime = () => {
    setPageObj(prev => ({ ...prev, current: 1, total: 0, noData: false }));
    setSelectOption(prev => ({ ...prev, sortAsc: !prev.sortAsc }));
  };

  const openInvoiceDialog = (item: InvoiceConsumeItem) => {
    if (!canInvoice(item, submittedIds)) return;
    setSelectedItem(item);
    setInvoiceDialogOpen(true);
  };

  const handleApplied = (consumeItemId: number) => {
    setSubmittedIds(prev => {
      const next = new Set(prev);
      next.add(consumeItemId);
      return next;
    });
    setRefreshKey(prev => prev + 1);
  };

  useEffect(() => {
    let ignore = false;

    const fetchConsumeItems = async () => {
      setPageObj(prev => ({ ...prev, list: [], loading: true }));

      try {
        const response = await getInvoiceConsumeItemList(buildConsumeItemListParams(pageObj.current, pageObj.size, selectOption.orderType, selectOption.sortAsc));

        if (ignore) return;

        const data = response.data;
        const items = Array.isArray(data?.items) ? data.items : [];

        setPageObj(prev => ({
          ...prev,
          list: items,
          current: data?.page || prev.current,
          total: data?.total || 0,
          size: data?.page_size || prev.size,
          loading: false,
          noData: items.length === 0,
        }));
      } catch (error) {
        console.error('Failed to fetch invoice consume items:', error);
        if (!ignore) {
          setPageObj(prev => ({ ...prev, loading: false, noData: prev.list.length === 0 }));
        }
      }
    };

    void fetchConsumeItems();

    return () => {
      ignore = true;
    };
  }, [pageObj.current, pageObj.size, refreshKey, selectOption.orderType, selectOption.sortAsc]);

  return (
    <>
      <div className='detail flex flex-col gap-4'>
        <div className='flex gap-8 text-sm min-h-10'>
          <div className='flex flex-nowrap items-center'>
            <div className='shrink-0'>订单类型：</div>
            <Select value={selectOption.orderType} onValueChange={changeOrderType}>
              <SelectTrigger className='bg-transparent border-none outline-none focus:ring-0 focus:ring-offset-0 hover:bg-white/10 h-9'>
                <SelectValue placeholder='选择类型' />
              </SelectTrigger>
              <SelectContent style={{ zIndex: PAYMENT_FLOATING_Z_INDEX }}>
                {ORDER_TYPE_OPTIONS.map(option => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className='flex items-center gap-3 ml-auto'>
            <Button variant='ghost' className='p-2 hover:bg-white/10 h-9' onClick={changeTime}>
              {selectOption.sortAsc ? (
                <>
                  <ArrowUpWideNarrow className='w-5 h-5' />
                  时间升序
                </>
              ) : (
                <>
                  <ArrowDownWideNarrow className='w-5 h-5' />
                  时间倒序
                </>
              )}
            </Button>
          </div>
        </div>

        <div className='tab-content'>
          <div className='border border-white/10 rounded-lg min-h-[532px] flex flex-col overflow-hidden'>
            <Table>
              <TableHeader className='[&_th]:whitespace-nowrap'>
                <TableRow className='bg-black/20'>
                  <TableHead className='h-10 w-[190px]'>订单号</TableHead>
                  <TableHead className='h-10 w-[150px]'>支付时间</TableHead>
                  <TableHead className='h-10 w-[110px]'>支付金额/元</TableHead>
                  <TableHead className='h-10'>订单类型</TableHead>
                  <TableHead className='h-10'>支付渠道</TableHead>
                  <TableHead className='h-10'>支付状态</TableHead>
                  <TableHead className='h-10 w-[90px]'>开票</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className='[&_td]:whitespace-nowrap'>
                {pageObj.list.map((item, index) => {
                  const disabled = !canInvoice(item, submittedIds);

                  return (
                    <TableRow key={item.consume_item_id} className={index % 2 === 1 ? 'bg-black/20' : 'bg-white/10'}>
                      <TableCell className='py-[14px] leading-[19px]'>{item.order_no || item.source_no || '-'}</TableCell>
                      <TableCell className='text-white/65 py-[14px] leading-[19px]'>{item.pay_time ? dayjs(item.pay_time).format('YYYY.MM.DD HH:mm') : '-'}</TableCell>
                      <TableCell className='py-[14px] leading-[19px] font-semibold'>{formatInvoiceAmount(item.pay_amount)}</TableCell>
                      <TableCell className='py-[14px] leading-[19px] text-white/55'>{getInvoiceProductSummaryLabel(item.product_summary)}</TableCell>
                      <TableCell className='py-[14px] leading-[19px] text-white/55'>{getInvoicePayMethodLabel(item.pay_method)}</TableCell>
                      <TableCell className='py-[14px] leading-[19px] text-white/55'>{getInvoicePayStatusLabel(item.pay_status)}</TableCell>
                      <TableCell className='py-[14px] leading-[19px]'>
                        <button
                          type='button'
                          className='text-white underline underline-offset-2 transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:text-white/30 disabled:no-underline'
                          onClick={() => openInvoiceDialog(item)}
                          disabled={disabled}
                          title={getInvoiceStatusText(item)}
                        >
                          {getActionText(item)}
                        </button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>

            {pageObj.noData && !pageObj.loading && <div className='no-data text-center text-gray-400 py-8 grid items-center flex-1'>-- 暂无数据 --</div>}

            {pageObj.loading && (
              <div className='loading grid justify-center items-center p-8 flex-1'>
                <LoaderCircle className='animate-spin' />
              </div>
            )}
          </div>
        </div>

        <div className='pagination flex justify-center min-h-10'>
          {pageObj.total > 0 && (
            <Pagination>
              <PaginationContent className='w-full'>
                <PaginationCustom currentPage={pageObj.current} totalPages={totalPages} onPageChange={handleChangePage} />
              </PaginationContent>
            </Pagination>
          )}
        </div>
      </div>

      <InvoiceInfoDialog
        open={invoiceDialogOpen}
        item={selectedItem}
        mode={selectedItem?.can_reissue ? 'reissue' : 'apply'}
        onOpenChange={setInvoiceDialogOpen}
        onApplied={handleApplied}
      />
    </>
  );
}
