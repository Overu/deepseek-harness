import { LoaderCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import pointImage from '@/assets/images/point.png';
import styles from '../index.module.less';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface SendButtonProps {
  isExcute: boolean;
  allowSend: boolean;
  caculatePoint: number;
  originalPoint?: number | null;
  onClick: () => void;
  pointLoading?: boolean;
  /** 禁用原因；传入则按钮禁用且 tooltip 常驻显示 */
  disabledReason?: ReactNode | { currentTextLen: number; maxPrompt: number };
}

const SendButton = ({ isExcute, allowSend, caculatePoint, originalPoint, onClick, pointLoading = false, disabledReason }: SendButtonProps) => {
  const disabled = !allowSend || Boolean(disabledReason);
  const tooltipContent =
    disabledReason && typeof disabledReason === 'object' && 'currentTextLen' in disabledReason && 'maxPrompt' in disabledReason ? (
      <span className='text-white/65'>
        <span className='text-[#F87171]'>{disabledReason.currentTextLen}</span>
        {'/'}
        {disabledReason.maxPrompt}字
      </span>
    ) : (
      disabledReason
    );

  const button = (
    <div
      className={`${styles.sendButton} ${disabled ? styles.locked : ''}`}
      onClick={() => {
        if (disabled) return;
        onClick();
      }}
    >
      {isExcute ? (
        <>
          <LoaderCircle size={14} className='animate-spin'></LoaderCircle>
          <div className='leading-4'>执行中</div>
        </>
      ) : (
        <>
          <div className='flex items-center gap-1 leading-none'>
            <img src={pointImage}></img>
            {pointLoading ? (
              <LoaderCircle size={14} className='animate-spin'></LoaderCircle>
            ) : (
              <>
                <div>{caculatePoint}</div>
                {originalPoint != null && (
                  <div className='text-white/50'>
                    {'/'}
                    <s>{originalPoint}</s>
                  </div>
                )}
              </>
            )}
          </div>
          <div className='text-white text-xs iconfont icon-send'></div>
        </>
      )}
    </div>
  );

  if (!disabledReason) return button;

  return (
    <TooltipProvider>
      <Tooltip open>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent side='top' className='bg-black border-white/10 text-white px-3 py-2 shadow-2xl rounded-xl'>
          {tooltipContent}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

export default SendButton;
