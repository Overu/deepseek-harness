import { useState, useEffect } from 'react';
import { accountFlow } from '@/api/order';
import { LoaderCircle, ArrowUpWideNarrow, ArrowDownWideNarrow } from 'lucide-react';
import { Pagination, PaginationContent } from '@/components/ui/pagination';
import { usePointStore } from '@/store/pointStore';
import { PAYMENT_FLOATING_Z_INDEX } from '../payLayer';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';

import dayjs from 'dayjs';
import { GiftPointsExpirationPopover } from './GiftPointsExpirationPopover';
import PaginationCustom from './PaginationCustom';

// 赛点流水类型
interface FlowItem {
  flowName: string;
  flowTime: string;
  flowType: string;
  remark: string;
  flowPoints: number;
  jobId?: string | null;
  id: number;
  expirationTime?: string | null;
}

// 分页数据类型
interface PageObj {
  list: FlowItem[];
  current: number;
  total: number;
  size: number;
  loading: boolean;
  noData: boolean;
}

interface optionPops {
  flowType: string;
  bizType: string;
  sort: boolean | string;
}

const formatOptionalDateTime = (value?: string | null) => {
  if (!value) return '';
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format('YYYY-MM-DD HH:mm') : '';
};

export default function BalanceDetail() {
  const { rechargeBalance, giftBalance } = usePointStore(state => state);
  const { refreshUserPoint } = usePointStore(state => state.actions);
  const [selectOption, setSelectOption] = useState<optionPops>({
    flowType: 'ALL',
    bizType: 'ALL',
    sort: false,
  });
  const [pageObj, setPageObj] = useState<PageObj>({
    list: [],
    current: 1,
    total: 0,
    size: 10,
    loading: false,
    noData: false,
  });

  // 计算总页数
  const totalPages = Math.ceil(pageObj.total / pageObj.size);

  const flowType = [
    {
      label: '全部',
      value: 'ALL',
    },
    {
      label: '功能使用',
      value: 'FUNCTION_USAGE',
    },
    {
      label: '社区赛点奖励',
      value: 'COMMUNITY_POINTS',
    },
    {
      label: '邀请奖励',
      value: 'INVITE_REWARD',
    },
    {
      label: '自助充值',
      value: 'SELF_RECHARGE',
    },
    {
      label: '平台赠送',
      value: 'PLATFORM_GIFT',
    },
    {
      label: '管理后台充值',
      value: 'PLATFORM_RECHARGE',
    },
    {
      label: '失败返还',
      value: 'REFUND',
    },
    {
      label: '过期清零',
      value: 'CLEAR_EXPIRED',
    },
    // {
    //   label: '清除过期会员',
    //   value: 'CLEAR_EXPIRED'
    // },
  ]; // 全部、消耗、获得
  // 模块配置
  const flowName = [
    {
      label: '全部',
      value: 'ALL',
    },
    {
      label: 'AI员工',
      value: 'AI_EMPLOYEE',
    },
    {
      label: 'AI工作流',
      value: 'WORKFLOW',
    },
    {
      label: '运营',
      value: 'OPERATION',
    },
    {
      label: '充值',
      value: 'RECHARGE',
    },
    {
      label: '其他',
      value: 'OTHER',
    },
  ]; // 全部、消耗、获得

  // 分页变更
  const handleChangePage = (page: number) => {
    // 边界值校验：不能小于1，不能大于总页数
    if (page < 1 || page > totalPages || pageObj.current === page) return;
    setPageObj(prev => ({ ...prev, current: page }));
  };

  // 切换标签
  const changeTab = (model: string, value: string) => {
    setPageObj(prev => ({ ...prev, current: 1, total: 0, noData: false }));

    if (model == 'flowType') {
      setSelectOption(prev => ({ ...prev, flowType: value }));
    }
    if (model == 'bizType') {
      setSelectOption(prev => ({ ...prev, bizType: value }));
    }
  };
  const changeTime = (value: boolean | string) => {
    setPageObj(prev => ({ ...prev, current: 1, total: 0, noData: false }));
    setSelectOption(prev => ({ ...prev, sort: value }));
  };

  // 获取流水记录
  const fetchAccountFlow = async () => {
    // console.log('get', selectOption)
    setPageObj(prev => ({ ...prev, list: [], loading: true }));
    try {
      const params = {
        flowType: selectOption.flowType == 'ALL' ? '' : selectOption.flowType,
        bizType: selectOption.bizType == 'ALL' ? '' : selectOption.bizType,
        pageQueryVO: {
          page: pageObj.current,
          size: pageObj.size,
          pageSortList: [
            {
              field: 'create_time',
              // order: selectOption.sort?'desc':'asc'
              order: selectOption.sort ? 'asc' : 'desc',
            },
          ],
        },
      };

      const { code, data }: any = await accountFlow(params);
      if (code === 'SUCCESS') {
        setPageObj({
          list: data.dataList || [],
          current: pageObj.current,
          total: data.total || 0,
          size: pageObj.size,
          loading: false,
          noData: (data.total || 0) === 0,
        });
      }
    } catch (error) {
      console.error('Failed to fetch account flow:', error);
      setPageObj(prev => ({ ...prev, loading: false }));
    }
  };

  // 类型映射配置
  const typeNameMap: Record<string, string> = {
    SELF_RECHARGE: '自助充值',
    PLATFORM_GIFT: '平台赠送',
    PLATFORM_RECHARGE: '管理后台充值',
    FUNCTION_USAGE: '功能使用',
    COMMUNITY_POINTS: '社区赛点奖励',
    INVITE_REWARD: '邀请奖励',
    RECEIVE: '套餐使用',
    RECHARGE: '充值',
    ADMIN_DEDUCT: '退款扣点',
    GIFT_CUSTOM: '平台自定义赠送',
    CLEAR_EXPIRED: '过期清零',
    SUBSCRIBE_MEMBERSHIP: '会员赠送',
    WITHHOLD: '功能使用',
    REFUND: '失败返还',
  };

  const getType = (type: string) => {
    return typeNameMap[type] || type;
  };
  // 模块类型映射配置
  const moduleNameMap: Record<string, string> = {
    OPERATION: '运营',
    RECHARGE: '充值',
    AI_EMPLOYEE: 'AI员工',
    WORKFLOW: 'AI工作流',
    VIDEO_UPSCALE: '高清视频',
    IMAGE_UPSCALE: '高清图片',
    MULTI_ANGLES: '万物多视角',
    OTHER: '其他',
  };

  const getTypeName = (name: string) => {
    return moduleNameMap[name] || name;
  };

  // 依赖变化时重新请求数据
  useEffect(() => {
    void refreshUserPoint({ reason: 'display' });
  }, [refreshUserPoint]);

  useEffect(() => {
    fetchAccountFlow();
  }, [selectOption, pageObj.current]);

  return (
    <div className='detail flex flex-col gap-4'>
      <div className='flex gap-8 justify-between min-h-10'>
        <div className='flex items-baseline'>
          <span className='text-sm'>剩余赛点：</span>
          <span className='text-xl font-bold'>{rechargeBalance + giftBalance}</span>
          <GiftPointsExpirationPopover fallbackGiftBalance={giftBalance} />
        </div>
        <div className='flex'>
          <div className='flex flex-nowrap items-center text-sm'>
            <div className='shrink-0'>类型：</div>
            <Select value={selectOption.flowType} onValueChange={value => changeTab('flowType', value)}>
              <SelectTrigger className='bg-transparent border-none outline-none focus:ring-0 focus:ring-offset-0 hover:bg-white/10 h-9'>
                <SelectValue placeholder='选择类型' />
              </SelectTrigger>
              <SelectContent style={{ zIndex: PAYMENT_FLOATING_Z_INDEX }}>
                {flowType.map((option: any) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className='flex flex-nowrap items-center text-sm'>
            <div className='shrink-0'>模块：</div>
            <Select value={selectOption.bizType} onValueChange={value => changeTab('bizType', value)}>
              <SelectTrigger className='bg-transparent border-none outline-none focus:ring-0 focus:ring-offset-0 hover:bg-white/10 h-9'>
                <SelectValue placeholder='选择模块' />
              </SelectTrigger>
              <SelectContent style={{ zIndex: PAYMENT_FLOATING_Z_INDEX }}>
                {flowName.map((option: any) => (
                  // <SelectItem key={option.value} value={option.value} disabled={modelDisabled(option.value)}>
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className='flex items-center gap-3 ml-auto'>
            <Button variant='ghost' className='p-2 hover:bg-white/10 h-9' onClick={() => changeTime(!selectOption.sort)}>
              {selectOption.sort ? (
                <>
                  <ArrowUpWideNarrow className='w-5 h-5'></ArrowUpWideNarrow>时间升序
                </>
              ) : (
                <>
                  <ArrowDownWideNarrow className='w-5 h-5'></ArrowDownWideNarrow>时间倒序
                </>
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* 标签内容 */}
      <div className='tab-content'>
        {/* 列表内容 */}
        <div className='border border-white/10 rounded-lg min-h-[532px] flex flex-col'>
          <Table>
            <TableHeader className='[&_th]:whitespace-nowrap'>
              <TableRow className='bg-black/20'>
                <TableHead className='w-[180px] h-10'>时间</TableHead>
                <TableHead className='w-[90px] h-10'>赛点变动</TableHead>
                <TableHead className='w-[120px] h-10'>类型</TableHead>
                <TableHead className='h-10'>所属模块</TableHead>
                <TableHead className='w-[300px] h-10'>备注说明</TableHead>
                <TableHead className='h-10'>任务 ID</TableHead>
                <TableHead className='h-10'>到期时间</TableHead>
              </TableRow>
            </TableHeader>
            {pageObj.list.length >= 0 && (
              <TableBody className='[&_td]:whitespace-nowrap'>
                {pageObj.list.map((item, index) => (
                  <TableRow key={item.id} className={`${index % 2 === 1 ? 'bg-black/20' : 'bg-white/10'}`}>
                    <TableCell className='text-white/65 py-[14px]'>{dayjs(item.flowTime).format('YYYY-MM-DD HH:mm')}</TableCell>
                    <TableCell className='py-[14px]'>{item.flowPoints > 0 ? `+${item.flowPoints}` : item.flowPoints}</TableCell>
                    {/* <TableCell className='py-[14px]'>{item.flowType == 'RECEIVE' ? '套餐购买' : '功能使用'}</TableCell> */}
                    <TableCell className='py-[14px]'>{getType(item.flowType)}</TableCell>
                    <TableCell className='py-[14px]'>{getTypeName(item.flowName)}</TableCell>
                    <TableCell className='text-white/65 py-[14px]'>{item.remark}</TableCell>
                    <TableCell className='text-white/65 py-[14px]'>{item.jobId}</TableCell>
                    <TableCell className='text-white/65 py-[14px]'>{formatOptionalDateTime(item.expirationTime)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            )}
          </Table>

          {/* 无数据状态 */}
          {pageObj.noData && !pageObj.loading && <div className='no-data text-center text-gray-400 py-8 grid items-center flex-1'>-- 暂无数据 --</div>}

          {/* 加载状态 */}
          {pageObj.loading && (
            <div className='loading grid justify-center items-center p-8 flex-1'>
              <LoaderCircle className='animate-spin'></LoaderCircle>
            </div>
          )}
        </div>
      </div>

      {/* 分页 */}
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
