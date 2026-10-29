import { useEffect, useState } from 'react';
import dayjs from 'dayjs';
import { LoaderCircle } from 'lucide-react';
import { queryMembershipPurchaseRecords, type MembershipPurchaseRecord, type MembershipPurchaseRecordsResult } from '@/api/order';
import { Button } from '@/components/ui/button';
import { Pagination, PaginationContent } from '@/components/ui/pagination';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useUserStore } from '@/store/userStore';
import PaginationCustom from './PaginationCustom';

const PAGE_SIZE = 20;

interface PageObj {
  list: MembershipPurchaseRecord[];
  current: number;
  total: number;
  size: number;
  loading: boolean;
  noData: boolean;
}

type ApiResponse<T> = {
  code?: string | number;
  msg?: string;
  data?: T;
  body?: T;
  success?: boolean;
};

const formatDateTime = (value?: string) => {
  if (!value) return '-';
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format('YYYY.MM.DD HH:mm') : value;
};

const getResponseData = <T,>(response: ApiResponse<T>) => response.data || response.body;

export default function SubscriptionManagement() {
  const currentMembershipPlan = useUserStore(state => state.currentMembershipPlan);
  const planName = currentMembershipPlan?.membership_plan_name || '免费版';
  const [pageObj, setPageObj] = useState<PageObj>({
    list: [],
    current: 1,
    total: 0,
    size: PAGE_SIZE,
    loading: false,
    noData: false,
  });
  const [errorMessage, setErrorMessage] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const totalPages = Math.ceil(pageObj.total / pageObj.size);

  const handleChangePage = (page: number) => {
    if (page < 1 || page > totalPages || pageObj.current === page) return;
    setPageObj(prev => ({ ...prev, current: page }));
  };

  useEffect(() => {
    let ignore = false;

    const fetchPurchaseRecords = async () => {
      setPageObj(prev => ({ ...prev, list: [], loading: true, noData: false }));
      setErrorMessage('');

      try {
        const response = (await queryMembershipPurchaseRecords({
          page_no: pageObj.current,
          page_size: pageObj.size,
        })) as ApiResponse<MembershipPurchaseRecordsResult>;

        if (ignore) return;

        const data = getResponseData(response);
        const items = data?.items ?? [];
        const total = Number(data?.total) || 0;

        setPageObj(prev => ({
          ...prev,
          list: items,
          total,
          loading: false,
          noData: items.length === 0,
        }));
      } catch (error) {
        if (ignore) return;
        setPageObj(prev => ({
          ...prev,
          list: [],
          loading: false,
          noData: prev.list.length === 0,
        }));
        setErrorMessage(error instanceof Error ? error.message : '订阅记录获取失败');
      }
    };

    void fetchPurchaseRecords();

    return () => {
      ignore = true;
    };
  }, [pageObj.current, pageObj.size, refreshKey]);

  return (
    <div className='detail text-sm text-white flex flex-col gap-4'>
      <div className='flex items-center gap-2 text-white/70 min-h-10'>
        <span>当前会员：</span>
        <span className='font-semibold text-white'>{planName}</span>
      </div>

      <div className='border border-white/10 rounded-lg min-h-[532px] flex flex-col overflow-hidden'>
        <Table>
          <TableHeader className='[&_th]:whitespace-nowrap'>
            <TableRow className='bg-black/20'>
              <TableHead className='h-10'>套餐类型</TableHead>
              <TableHead className='h-10'>购买时间</TableHead>
              <TableHead className='h-10'>生效时间</TableHead>
              <TableHead className='h-10'>过期时间</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className='[&_td]:whitespace-nowrap'>
            {pageObj.list.map((item, index) => (
              <TableRow key={`${item.plan_name}-${item.purchase_time}-${index}`} className={index % 2 === 1 ? 'bg-black/20' : 'bg-white/10'}>
                <TableCell className='py-[14px] text-white/75'>{item.plan_name || '-'}</TableCell>
                <TableCell className='py-[14px] text-white/75'>{formatDateTime(item.purchase_time)}</TableCell>
                <TableCell className='py-[14px] text-white/75'>{formatDateTime(item.effective_time)}</TableCell>
                <TableCell className='py-[14px] text-white/75'>{formatDateTime(item.expiration_time)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {pageObj.loading && (
          <div className='grid flex-1 place-items-center p-8 text-white/65'>
            <LoaderCircle className='h-5 w-5 animate-spin' />
          </div>
        )}

        {!pageObj.loading && errorMessage && (
          <div className='grid flex-1 place-items-center p-8 text-center text-white/45'>
            <div>
              <p>{errorMessage}</p>
              <Button type='button' variant='ghost' className='mt-3 h-8 px-3 text-white hover:bg-white/10' onClick={() => setRefreshKey(key => key + 1)}>
                重新加载
              </Button>
            </div>
          </div>
        )}

        {!pageObj.loading && !errorMessage && pageObj.noData && <div className='grid flex-1 place-items-center text-sm text-white/45'>-- 暂无订阅记录 --</div>}
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
  );
}
