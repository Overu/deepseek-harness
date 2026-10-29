import { useCallback, useEffect, useState } from 'react';
import { Loader2, ArrowUpWideNarrow, ArrowDownWideNarrow } from 'lucide-react';
import { toast } from 'sonner';
import dayjs from 'dayjs';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Pagination, PaginationContent } from '@/components/ui/pagination';
import PaginationCustom from '@/components/popPay/components/PaginationCustom';
// import { openGlobalDialog } from '@/components/popPay/payPop';
import { redeemCode, getRedeemRecords, type RedeemRecord, type ApiResponse } from '@/api/activity';

interface RedeemCodeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const PAGE_SIZE = 5;

const formatDateTime = (value?: string | null) => {
  if (!value) return '-';
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format('YYYY.MM.DD HH:mm') : value;
};

const getResponseData = <T,>(response: ApiResponse<T>) => (response.data ?? response.body) as T | undefined;

const getResponseMessage = (response: ApiResponse<unknown>) => response.message ?? response.msg ?? '';

export function RedeemCodeDialog({ open, onOpenChange }: RedeemCodeDialogProps) {
  /* ===== 兑换输入区状态 ===== */
  const [inputValue, setInputValue] = useState('');
  const [redeeming, setRedeeming] = useState(false);
  /** 按钮下方的 inline 错误文案（截图3红色提示） */
  const [redeemError, setRedeemError] = useState('');

  /* ===== 历史记录列表状态 ===== */
  const [recordsPage, setRecordsPage] = useState(1);
  const [recordsList, setRecordsList] = useState<RedeemRecord[]>([]);
  const [recordsTotal, setRecordsTotal] = useState(0);
  const [sortOrder, setSortOrder] = useState('desc');
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [recordsError, setRecordsError] = useState('');

  const totalPages = Math.max(1, Math.ceil(recordsTotal / PAGE_SIZE));

  /* ===== 加载历史兑换记录 ===== */
  const loadRecords = useCallback(
    async (page: number) => {
      setRecordsLoading(true);
      setRecordsError('');
      try {
        const response: any = (await getRedeemRecords(page, PAGE_SIZE, sortOrder)) as ApiResponse<{ list: RedeemRecord[]; total: number }>;
        const pageData = getResponseData<{ list: RedeemRecord[]; total: number }>(response);
        if (pageData) {
          setRecordsList(Array.isArray(pageData.list) ? pageData.list : []);
          setRecordsTotal(Number(pageData.total) || 0);
        }
      } catch (err: unknown) {
        const errObj = err as { msg?: string; message?: string };
        setRecordsError(errObj?.message || errObj?.msg || '兑换记录获取失败，请稍后重试');
        setRecordsList([]);
        setRecordsTotal(0);
      } finally {
        setRecordsLoading(false);
      }
    },
    [sortOrder]
  );

  /* ===== 弹窗打开时：清空状态 + 加载第一页 ===== */
  useEffect(() => {
    if (open) {
      setInputValue('');
      setRedeemError('');
      setRecordsPage(1);
      void loadRecords(1);
    }
  }, [open, loadRecords]);

  /* ===== 排序切换 ===== */
  const handleChangeSortOrder = () => {
    const order = sortOrder === 'desc' ? 'asc' : 'desc';
    setSortOrder(order);
  };

  /* ===== 分页切换 ===== */
  const handleChangePage = (page: number) => {
    if (page < 1 || page > totalPages || page === recordsPage) return;
    setRecordsPage(page);
    void loadRecords(page);
  };

  /* ===== 发起兑换 ===== */
  const handleRedeem = useCallback(async () => {
    if (redeeming) return;

    const raw = inputValue.trim();
    if (!raw) {
      setRedeemError('请输入有效的活动校验码');
      return;
    }

    setRedeeming(true);
    setRedeemError('');

    try {
      const response = (await redeemCode(raw)) as ApiResponse<{ redeemId?: string | null }>;
      // request.ts 成功判断：code === 0/200/SUCCESS 均进入此处
      const successMsg = getResponseMessage(response) || '恭喜兑换成功！';

      toast.success(successMsg, {
        duration: 5000,
      });

      // 清空输入 + 刷新历史记录
      setInputValue('');
      void loadRecords(recordsPage);
    } catch (err: unknown) {
      // silentError=true 关闭了自动 toast，手动展示 inline 错误
      const errObj = err as { msg?: string; message?: string };
      const msg = errObj?.message || errObj?.msg || '兑换失败，请稍后重试';
      setRedeemError(msg);
    } finally {
      setRedeeming(false);
    }
  }, [redeeming, inputValue, onOpenChange, loadRecords, recordsPage]);

  /* ===== 键盘 Enter 快捷兑换 ===== */
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void handleRedeem();
    }
  };

  // toast.success(`恭喜您兑换成功！已发放【专业版】+【10赛点】，会员权益即时生效，可前往会员中心查看`, {
  //   duration: 10000,
  //   // description: '会员权益即时生效，赛点已到账',
  //   // action: {
  //   //   label: '查看权益',
  //   //   onClick: async () => {
  //   //     onOpenChange(false);
  //   //     try {
  //   //       await openGlobalDialog({ type: 'detail' });
  //   //     } catch {
  //   //       // ignore
  //   //     }
  //   //   },
  //   // },
  // });

  /* ===== 渲染 ===== */
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton
        overlayClassName='bg-black/80'
        className='max-h-[calc(100vh-24px)] w-[calc(100vw-24px)] max-w-[880px] gap-0 overflow-hidden rounded-lg border-0 bg-[#262626] p-0 text-white shadow-2xl sm:rounded-lg'
      >
        <div className='flex flex-col'>
          {/* 头部 */}
          <header className='flex h-[56px] shrink-0 items-center border-b border-white/10 px-6'>
            <DialogTitle className='text-base font-semibold text-white'>活动兑换码</DialogTitle>
          </header>

          {/* 主体 */}
          <div className='min-h-0 flex-1 overflow-y-auto px-6 py-5'>
            {/* ===== 兑换输入区 ===== */}
            <div className='mt-4 mb-6 flex items-center justify-center p-10 sm:gap-3 sm:py-10 sm:px-0'>
              <div>
                <div className='flex items-stretch gap-2 rounded-lg w-[400px] p-1 bg-black/45'>
                  <Input
                    value={inputValue}
                    onChange={e => {
                      setInputValue(e.target.value);
                      if (redeemError) setRedeemError('');
                    }}
                    onKeyDown={handleKeyDown}
                    placeholder='请输入活动兑换码'
                    disabled={redeeming}
                    className='h-11 flex-1 border-0 rounded-none pl-4 pr-3 text-sm text-white placeholder:text-white/35 focus-visible:outline-none focus-visible:ring-0 bg-transparent'
                  />
                  <button
                    type='button'
                    onClick={() => void handleRedeem()}
                    disabled={redeeming || !inputValue.trim()}
                    className='inline-flex h-11 shrink-0 items-center justify-center rounded-md bg-[#4054f4] px-5 text-sm font-medium text-white transition-colors hover:bg-[#5366ff] disabled:cursor-not-allowed disabled:opacity-50'
                  >
                    {redeeming ? (
                      <>
                        <Loader2 className='mr-1.5 h-4 w-4 animate-spin' />
                        兑换中
                      </>
                    ) : (
                      '立即兑换'
                    )}
                  </button>
                </div>
                {/* inline 错误提示（截图3红色文案） */}
                {redeemError && <p className='mt-2 text-xs text-[#ff6b6b] leading-relaxed'>{redeemError}</p>}
              </div>
            </div>

            {/* ===== 兑换历史记录区 ===== */}
            <section>
              <div className='mb-3 flex items-center justify-between'>
                <h3 className='text-sm font-semibold text-white/90'>兑换历史记录</h3>
                <button
                  type='button'
                  onClick={handleChangeSortOrder}
                  className='flex items-center gap-1 text-xs text-white/55 transition-colors hover:text-white/85'
                  title='按时间降序'
                >
                  {sortOrder === 'desc' ? <ArrowUpWideNarrow className='h-3.5 w-3.5' /> : <ArrowDownWideNarrow className='h-3.5 w-3.5' />}
                  {sortOrder === 'desc' ? '按时间降序' : '按时间升序'}
                </button>
              </div>

              {/* 表格 */}
              <div className='overflow-x-auto rounded-lg border border-white/10 min-h-[280px]'>
                <Table>
                  <TableHeader>
                    <TableRow className='bg-black/20 hover:bg-black/20'>
                      <TableHead className='h-10 px-3 text-xs font-medium text-white/70 whitespace-nowrap'>兑换时间</TableHead>
                      <TableHead className='h-10 px-3 text-xs font-medium text-white/70 whitespace-nowrap'>历史兑换活动</TableHead>
                      <TableHead className='h-10 px-3 text-xs font-medium text-white/70 whitespace-nowrap'>奖励</TableHead>
                      <TableHead className='h-10 px-3 text-xs font-medium text-white/70 whitespace-nowrap'>会员类型</TableHead>
                      <TableHead className='h-10 px-3 text-xs font-medium text-white/70 whitespace-nowrap'>生效时间</TableHead>
                      <TableHead className='h-10 px-3 text-xs font-medium text-white/70 whitespace-nowrap'>到期时间</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recordsLoading && recordsList.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className='py-10 text-center text-sm text-white/55'>
                          <Loader2 className='mx-auto h-5 w-5 animate-spin' />
                        </TableCell>
                      </TableRow>
                    )}

                    {!recordsLoading && recordsError && (
                      <TableRow>
                        <TableCell colSpan={6} className='py-10 text-center text-sm text-white/55'>
                          {recordsError}
                        </TableCell>
                      </TableRow>
                    )}

                    {!recordsLoading && !recordsError && recordsList.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className='py-10 text-center text-sm text-white/45'>
                          -- 暂无数据 --
                        </TableCell>
                      </TableRow>
                    )}

                    {!recordsLoading &&
                      recordsList.map((item, idx) => (
                        <TableRow key={item.id ?? `${item.code}-${idx}`} className={idx % 2 === 1 ? 'bg-black/15 hover:bg-black/25' : 'bg-white/5 hover:bg-white/10'}>
                          <TableCell className='px-3 py-3 text-xs text-white/75 whitespace-nowrap'>{formatDateTime(item.redeemTime)}</TableCell>
                          <TableCell className='px-3 py-3 text-xs text-white/75 whitespace-nowrap max-w-[140px] truncate' title={item.activityName}>
                            {item.activityName || '-'}
                          </TableCell>
                          <TableCell className='px-3 py-3 text-xs text-white/75 whitespace-nowrap'>
                            {item.pointsAmount != null ? (
                              <span className={item.pointsAmount >= 0 ? 'text-[#86efac]' : 'text-[#fca5a5]'}>
                                {item.pointsAmount >= 0 ? '+' : ''}
                                {item.pointsAmount}
                              </span>
                            ) : (
                              '-'
                            )}
                          </TableCell>
                          <TableCell className='px-3 py-3 text-xs text-white/75 whitespace-nowrap max-w-[140px] truncate' title={item.membershipPlanName ?? ''}>
                            {item.membershipPlanName || '-'}
                          </TableCell>
                          <TableCell className='px-3 py-3 text-xs text-white/75 whitespace-nowrap'>{formatDateTime(item.membershipEffectiveTime)}</TableCell>
                          <TableCell className='px-3 py-3 text-xs text-white/75 whitespace-nowrap'>{formatDateTime(item.membershipExpireTime)}</TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              </div>

              {/* 分页 */}
              {/* {recordsTotal > 0 && ( */}
              <div className='mt-4 flex items-center justify-center'>
                <Pagination>
                  <PaginationContent className='w-full'>
                    <PaginationCustom currentPage={recordsPage} totalPages={totalPages} onPageChange={handleChangePage} />
                  </PaginationContent>
                </Pagination>
              </div>
              {/* )} */}
            </section>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default RedeemCodeDialog;
