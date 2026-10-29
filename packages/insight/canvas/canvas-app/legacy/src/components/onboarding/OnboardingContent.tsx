import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { OnboardingStep } from './types';

export interface OnboardingContentProps {
  step: OnboardingStep;
  stepIndex: number;
  totalSteps: number;
  canGoPrevious?: boolean;
  canGoNext?: boolean;
  onClose: () => void;
  onNext: () => void;
  onPrevious?: () => void;
  className?: string;
}

const renderDefaultPreview = () => (
  <div className='relative h-full w-full overflow-hidden rounded-lg bg-black bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.22)_1px,transparent_0)] bg-[length:16px_16px]'>
    <div className='absolute left-[17%] top-[22%] h-[132px] w-[100px] rounded-md bg-[linear-gradient(135deg,#f7f2d8_0%,#55e5d2_42%,#6b8ff6_72%,#ffb36a_100%)] shadow-lg' />
    <div className='absolute left-[39%] top-[22%] h-[132px] w-[210px] overflow-hidden rounded-md bg-[#1f1f1f] shadow-lg'>
      <div className='h-full w-[48%] bg-[linear-gradient(135deg,#f7f2d8_0%,#55e5d2_44%,#6b8ff6_80%)]' />
      <div className='absolute right-0 top-0 h-full w-[58%] bg-[linear-gradient(135deg,#e5e7eb,#5b6b58)]' />
      <div className='absolute bottom-3 right-5 h-16 w-9 rounded-sm bg-white/80' />
    </div>
    <div className='absolute right-[9%] top-[23%] h-[132px] w-[132px] rounded-md bg-[linear-gradient(135deg,#e5e7eb,#465141)] shadow-lg' />
    <div className='absolute left-[34%] top-[34%] h-px w-[86px] rotate-[-12deg] bg-white/65' />
    <div className='absolute right-[25%] top-[36%] h-px w-[86px] rotate-[-12deg] bg-white/65' />
    <div className='absolute bottom-6 left-[39%] h-[160px] w-[230px] rounded-md bg-[#242424] p-2 shadow-lg'>
      <div className='mb-2 flex gap-2'>
        <div className='h-5 flex-1 rounded bg-white/18' />
        <div className='h-5 flex-1 rounded bg-white/10' />
        <div className='h-5 flex-1 rounded bg-white/10' />
      </div>
      <div className='h-[112px] rounded bg-[linear-gradient(90deg,#202124,#f1f1f1_48%,#d9d9d9)]' />
    </div>
  </div>
);

export function OnboardingContent({ step, stepIndex, totalSteps, onClose, onNext, className }: OnboardingContentProps) {
  const isLastStep = stepIndex >= totalSteps - 1;

  return (
    <div className={cn('relative w-[26rem] rounded-2xl bg-[#4355f4] p-2 text-white', className)}>
      <button
        type='button'
        aria-label='关闭新手引导'
        onClick={onClose}
        className='absolute right-4 top-4 z-10 flex items-center justify-center rounded-md bg-[#5d5d5d] p-1 text-white shadow-lg transition-colors hover:bg-[#6b6b6b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80'
      >
        <X className='h-4 w-4' strokeWidth={2.8} />
      </button>

      <div className='aspect-[1.77] w-full overflow-hidden rounded-lg bg-black'>
        {step.image ? <img src={step.image} alt='' className='h-full w-full object-cover object-top' draggable={false} /> : renderDefaultPreview()}
      </div>

      <div className='pt-4'>
        <h3 className='flex flex-wrap items-center gap-4 text-lg font-semibold leading-tight text-white'>{step.title}</h3>
        <p className='mt-1 text-sm font-normal text-white/88'>{step.description}</p>

        <div className='mt-4 flex items-center justify-between'>
          <div className='text-sm font-medium leading-none text-white'>
            {stepIndex + 1}/{totalSteps}
          </div>
          <button
            type='button'
            onClick={onNext}
            className='rounded-lg bg-white px-4 py-2 text-sm font-medium text-[#4355f4] transition-colors hover:bg-white/92 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-[#4355f4]'
          >
            {isLastStep ? '完成' : '下一步'}
          </button>
        </div>
      </div>
    </div>
  );
}
