// src/components/PointDisplay.tsx
import React, { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { usePointStore } from '@/store/pointStore';
import { openGlobalDialog } from '@/components/popPay/payPop';
import { useAuth } from '@/contexts/AuthContext';
import { BadgeCheck } from 'lucide-react';
import vipImage from '@/assets/images/vip.png';
const pointLogo = '//web-gpt-assets-cdn.idealead.com/base-platform/test/images/pay/pointLogo.png';

// 移除 window 全局类型声明（不再需要）

interface PointDisplayProps {
  isNormal?: boolean;
  planName?: string;
}

const PointDisplay: React.FC<PointDisplayProps> = ({ isNormal = true, planName = '普通用户' }) => {
  const { point, pointLoading, giftPointVoList } = usePointStore(state => state);
  const { refreshUserPoint } = usePointStore(state => state.actions);
  const { authStatus } = useAuth();
  // 本地加载状态（可选）

  // 初始化加载积分（直接调用Store中的方法）
  useEffect(() => {
    if (authStatus.status !== 'logged_in') {
      return;
    }

    refreshUserPoint({ reason: 'display' });
  }, [authStatus.status, refreshUserPoint]);

  // 打开套餐订阅弹窗
  const handlePoint = async () => {
    await openGlobalDialog({ type: 'subscription', fullScreen: true });
  };

  // 数字格式化工具：增加千分位
  const formatNumber = (num: number | string) => {
    if (num === undefined || num === null) return '0';
    return Number(num).toLocaleString('en-US');
  };

  // 渲染相关逻辑
  return (
    <div className='relative group'>
      <Button variant='ghost' className='rounded-full bg-[#ffffff40] backdrop-blur-sm p-[2px] h-fit hover:bg-[#ffffff55]' disabled={pointLoading} onClick={handlePoint}>
        <div
          className='rounded-full inline-flex items-center justify-center gap-2 py-1 px-4'
          style={{
            background: 'linear-gradient(180deg, rgba(0, 0, 0, 0.2925) 0%, rgba(0, 0, 0, 0.09) 100%)',
          }}
        >
          {/* <Sparkles className='' /> */}
          <img src={pointLogo} className='w-4 h-4' />
          <span className=''>{pointLoading ? '···' : formatNumber(point)}</span>
        </div>
      </Button>
      {/* 浮动元素 - 鼠标悬停时显示 */}
      <div className='absolute top-[120%] right-0 transform mb-2 opacity-0 invisible transition-all duration-300 group-hover:opacity-100 group-hover:visible'>
        <div className='bg-[#262626] rounded-xl shadow-lg border border-white/10 min-w-[280px]'>
          <div className='p-3 pb-2'>
            {/* 会员状态栏 */}
            <div className='bg-[#333333] rounded-lg p-3 border border-white/10 flex items-center justify-between mb-3'>
              <div className='flex items-center gap-2'>
                {!isNormal && <img src={vipImage} alt='VIP' className='h-4 w-auto shrink-0' />}
                <span className='text-sm text-white/95 font-medium'>{planName}</span>
              </div>
              {isNormal ? (
                <Button
                  size='sm'
                  className='bg-[#4A6BFF] hover:bg-[#4A6BFF]/90 text-white h-7 px-3 text-xs rounded'
                  onClick={async e => {
                    e.preventDefault();
                    await openGlobalDialog({ type: 'subscription', fullScreen: true });
                  }}
                >
                  开通会员
                </Button>
              ) : (
                <a
                  href='#'
                  className='text-xs text-white/60 hover:text-white underline underline-offset-2'
                  onClick={async e => {
                    e.preventDefault();
                    await openGlobalDialog({ type: 'subscription', fullScreen: true });
                  }}
                >
                  去续费
                </a>
              )}
            </div>

            {/* 赛点信息 */}
            <div className='flex flex-col gap-2 pb-1'>
              <div className='flex items-center justify-between text-sm text-white/95'>
                <span>赛点总数</span>
                <span className='font-medium'>{pointLoading ? '···' : formatNumber(point)}</span>
              </div>
              {giftPointVoList.map(item => {
                // 格式化过期时间
                const expiredDate = new Date(item.expiredTime);
                const formattedDate = `${expiredDate.getFullYear()}.${String(expiredDate.getMonth() + 1).padStart(2, '0')}.${String(expiredDate.getDate()).padStart(2, '0')}`;

                return (
                  <div key={item.id} className='flex items-center justify-between text-[12px] text-white/65 mt-1 whitespace-nowrap'>
                    <span className='whitespace-nowrap'>{item.type === 'RECHARGE' ? '永久有效' : `${item.memberShipName}会员赛点数于${formattedDate}到期`}</span>
                    <span className='whitespace-nowrap'>{formatNumber(item.points)}点</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Footer: 订阅与消费记录 */}
          <div
            className='border-t border-white/10 p-3 flex items-center gap-2 text-sm text-white/80 hover:text-white cursor-pointer transition-colors rounded-b-xl'
            onClick={async e => {
              e.preventDefault();
              await openGlobalDialog({ type: 'detail' });
            }}
          >
            <BadgeCheck className='w-4 h-4' />
            <span>订阅与消费记录</span>
          </div>
        </div>
        {/* 三角形指示器 */}
        {/* <div className='absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent border-t-[#1a1a1a]'></div> */}
      </div>
    </div>
  );
};

export default PointDisplay;
