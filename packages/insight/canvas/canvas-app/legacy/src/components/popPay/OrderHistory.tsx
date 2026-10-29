import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Pagination, PaginationContent, PaginationEllipsis, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from '@/components/ui/pagination';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getOrderList } from '@/api/order';

// 订单数据类型定义
interface OrderItem {
  orderNo: string;
  productName: string;
  orderTime: string;
  payMethod: 'WX_NATIVE' | 'ALIPAY_PC';
  points?: number;
  payAmount: number;
}

// 分页数据类型
interface PageObj {
  list: OrderItem[];
  loading: boolean;
  page: number;
  size: number;
  total: number;
  noData: boolean;
}

export default function OrderHistory() {
  const [timeOrder, setTimeOrder] = useState<'DESC' | 'ASC'>('DESC');
  const [pageObj, setPageObj] = useState<PageObj>({
    list: [],
    loading: false,
    page: 1,
    size: 7,
    total: 0,
    noData: false,
  });

  const timeOrderObj = {
    DESC: '由近及远',
    ASC: '由远及近',
  };

  const payMethodObj = {
    WX_NATIVE: '微信支付',
    ALIPAY_PC: '支付宝支付',
  };

  // 格式化日期
  const formatDate = (originVal: string) => {
    const dt = new Date(originVal);
    const y = dt.getFullYear();
    const m = (dt.getMonth() + 1).toString().padStart(2, '0');
    const d = dt.getDate().toString().padStart(2, '0');
    const hh = dt.getHours().toString().padStart(2, '0');
    const mm = dt.getMinutes().toString().padStart(2, '0');
    const ss = dt.getSeconds().toString().padStart(2, '0');
    return `${y}.${m}.${d} ${hh}:${mm}:${ss}`;
  };

  // 格式化金额
  const showTotal = (value: number) => {
    return (value / 100).toFixed(2);
  };

  // 获取订单列表
  const fetchOrderList = async () => {
    if (pageObj.loading) return;

    setPageObj(prev => ({ ...prev, loading: true }));
    try {
      const params = {
        pageNo: pageObj.page,
        pageSize: pageObj.size,
        timeOrder,
      };
      const { code, data }: any = await getOrderList(params);
      if (code === 'SUCCESS' && data) {
        console.log('list obj', data);
        setPageObj({
          list: data.records || [],
          loading: false,
          page: pageObj.page,
          size: pageObj.size,
          total: data.total || 0,
          noData: (data.total || 0) === 0,
        });
      }
    } catch (error) {
      console.error('Failed to fetch order list:', error);
      setPageObj(prev => ({ ...prev, loading: false }));
    }
  };

  // 排序变更
  const handleChange = (value: string) => {
    setTimeOrder(value as 'DESC' | 'ASC');
    setPageObj(prev => ({ ...prev, page: 1 }));
  };

  // 分页变更
  const handleCurrentChange = (page: number) => {
    if (pageObj.page === page) return;
    setPageObj(prev => ({ ...prev, page }));
  };

  // 依赖变化时重新获取数据
  useEffect(() => {
    fetchOrderList();
  }, [pageObj.page, timeOrder]);

  // if (!visible) return null;

  return (
    <motion.div className='modal-content relative mx-auto rounded-xl overflow-hidden w-full h-full'>
      {/* 头部 */}
      <div className='header flex items-center w-full h-16'>可查询您的所有购买记录</div>

      {/* 主体内容 */}
      <div className='body flex flex-col items-center'>
        {/* 筛选区域 */}
        <div className='filter w-full'>
          <div className='time-order flex items-center h-[38px] rounded-md mt-7.5'>
            <div className='left w-[116px] text-center text-lg font-medium tracking-[2px] relative'>
              排序方式
              <div className='absolute right-0 top-1/2 h-3 w-px bg-[rgba(181,181,181,0.4)] -translate-y-1/2' />
            </div>
            <div className='right flex items-center justify-center w-[145px]'>
              <Select value={timeOrder} onValueChange={handleChange}>
                <SelectTrigger className='w-full text-lg font-medium '>
                  <SelectValue placeholder='选择排序方式' />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(timeOrderObj).map(([key, value]) => (
                    <SelectItem key={key} value={key}>
                      {value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {/* 列表区域 */}
        <div className='list h-full w-full mt-4 relative overflow-auto'>
          {/* 表格 */}
          <div className='h-[300px] w-[1400px] relative'>
            {/* 表头 */}
            <div className='row title flex items-center h-[41px] rounded-md bg-[#6150fc] font-medium tracking-[2px] text-white'>
              <div className='col col1 w-[500px] text-center'>订单号</div>
              <div className='col col2 w-[200px] text-center'>购买商品</div>
              <div className='col col3 w-[300px] text-center'>支付时间</div>
              <div className='col col4 w-[250px] text-center'>支付方式</div>
              <div className='col col5 w-[150px] text-center'>购买赛点</div>
              <div className='col col6 w-[300px] text-center'>购买金额（单位/元）</div>
            </div>

            {/* 加载状态 */}
            {pageObj.loading && (
              <div className='loading flex items-center justify-center absolute inset-0 z-1 bg-[rgba(255,255,255,0.3)] p-12.5'>{/* <LoadingIcon className="loading" /> */}</div>
            )}

            {/* 无数据状态 */}
            {pageObj.noData && !pageObj.loading && <div className='no-data text-lg text-[#ccc] p-12.5 text-center'>--暂无数据--</div>}

            {/* 列表内容 */}
            {!pageObj.loading && !pageObj.noData && (
              <>
                {pageObj.list.map((item, index) => (
                  <div key={index} className='row flex items-center h-[76px] text-[#aaa7b6] text-lg border-b border-[rgba(181,181,181,0.4)]'>
                    <div className='col col1 w-[500px] text-center relative'>
                      {item.orderNo}
                      <div className='absolute right-0 top-1/2 h-4 w-px bg-[rgba(181,181,181,0.4)] -translate-y-1/2' />
                    </div>
                    <div className='col col2 w-[200px] text-center font-medium text-black relative'>
                      {item.productName}
                      <div className='absolute right-0 top-1/2 h-4 w-px bg-[rgba(181,181,181,0.4)] -translate-y-1/2' />
                    </div>
                    <div className='col col3 w-[300px] text-center relative'>
                      {formatDate(item.orderTime)}
                      <div className='absolute right-0 top-1/2 h-4 w-px bg-[rgba(181,181,181,0.4)] -translate-y-1/2' />
                    </div>
                    <div className='col col4 w-[250px] text-center relative'>
                      {payMethodObj[item.payMethod]}
                      <div className='absolute right-0 top-1/2 h-4 w-px bg-[rgba(181,181,181,0.4)] -translate-y-1/2' />
                    </div>
                    <div className='col col5 w-[150px] text-center relative'>
                      {item.points || '-'}
                      <div className='absolute right-0 top-1/2 h-4 w-px bg-[rgba(181,181,181,0.4)] -translate-y-1/2' />
                    </div>
                    <div className='col col6 w-[300px] text-center'>{showTotal(item.payAmount)}</div>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>

        {/* 分页 */}
        {pageObj.list.length > 0 && (
          <div className='pagination mt-4'>
            <Pagination>
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious href='#' />
                </PaginationItem>
                <PaginationItem>
                  <PaginationLink href='#'>1</PaginationLink>
                </PaginationItem>
                <PaginationItem>
                  <PaginationEllipsis />
                </PaginationItem>
                <PaginationItem>
                  <PaginationNext href='#' />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          </div>
        )}
      </div>
    </motion.div>
  );
}
