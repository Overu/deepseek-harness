import { motion } from 'framer-motion';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import BalanceDetail from './components/BalanceDetail';
import AccountConsumeRecord from './components/AccountConsumeRecord';
import SubscriptionManagement from './components/SubscriptionManagement';

const DETAIL_TAB_TRIGGER_CLASS =
  'h-7 flex-1 rounded-md border border-transparent bg-transparent px-3 py-0 text-sm font-medium text-white/70 shadow-none transition-colors hover:bg-white/10 hover:text-white data-[state=active]:!bg-white/[0.18] data-[state=active]:!text-white data-[state=active]:!shadow-none data-[state=active]:border-white/10';

interface PopPointDetailProps {
  onClose?: () => void;
}

export default function PopPointDetail({ onClose }: PopPointDetailProps) {
  return (
    <motion.div
      className='point-detail relative max-h-[calc(100vh-32px)] w-[1060px] max-w-[calc(100vw-32px)] overflow-y-auto transition-all duration-200'
      // className="min-h-[784px]"
    >
      {/* 内容容器 */}
      <div
        className='w-full bg-black/40 overflow-hidden'
        style={{
          backgroundImage: 'url(//web-gpt-assets-cdn.idealead.com/base-platform/test/images/pay/tableBg.png)',
          borderRadius: '10px',
          backgroundRepeat: 'no-repeat',
          backgroundSize: '100% 100%',
        }}
      >
        {/* head */}
        <div className='h-12 flex justify-between items-center mx-6 relative'>
          <div className='text-base text-white font-bold mt-4'>订阅与消费记录</div>
          {onClose && (
            <Button
              type='button'
              variant='ghost'
              size='icon'
              className='mt-4 h-8 w-8 text-white/70 hover:bg-white/10 hover:text-white'
              onClick={onClose}
              aria-label='关闭订阅与消费记录'
            >
              <X className='h-5 w-5' />
            </Button>
          )}
        </div>
        {/* body */}
        <motion.div className='relative p-6'>
          <div className='body'>
            <Tabs defaultValue='point' className='w-full'>
              <TabsList className='h-[34px] w-full rounded-lg bg-[#07103f]/80 p-[3px] text-white/70'>
                <TabsTrigger value='point' className={DETAIL_TAB_TRIGGER_CLASS}>
                  赛点收支详情
                </TabsTrigger>
                <TabsTrigger value='subscription' className={DETAIL_TAB_TRIGGER_CLASS}>
                  订阅管理
                </TabsTrigger>
                <TabsTrigger value='account' className={DETAIL_TAB_TRIGGER_CLASS}>
                  账号消费记录
                </TabsTrigger>
              </TabsList>
              <TabsContent value='point' className='mt-4'>
                <BalanceDetail></BalanceDetail>
              </TabsContent>
              <TabsContent value='subscription' className='mt-4'>
                <SubscriptionManagement />
              </TabsContent>
              <TabsContent value='account' className='mt-4'>
                <AccountConsumeRecord></AccountConsumeRecord>
              </TabsContent>
            </Tabs>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}
