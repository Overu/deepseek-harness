import React from 'react';

const ToneCardSkeleton: React.FC = () => {
  return (
    <div className='rounded-xl bg-[#2b2b2b] border border-transparent p-3 flex items-center gap-3'>
      <div className='relative h-11 w-11 rounded-md bg-white/10 shrink-0 overflow-hidden'>
        <div className='absolute inset-0 animate-pulse bg-white/10' />
      </div>

      <div className='min-w-0 flex-1'>
        <div className='h-4 w-2/3 rounded bg-white/10 animate-pulse' />
        <div className='mt-2 flex gap-1 flex-wrap'>
          <div className='h-4 w-10 rounded bg-white/10 animate-pulse' />
          <div className='h-4 w-12 rounded bg-white/10 animate-pulse' />
          <div className='h-4 w-9 rounded bg-white/10 animate-pulse' />
        </div>
      </div>

      <div className='flex items-center gap-2 shrink-0'>
        <div className='h-8 w-8 rounded-md bg-white/10 animate-pulse' />
        <div className='h-8 w-8 rounded-md bg-white/10 animate-pulse' />
        <div className='h-8 w-16 rounded-md bg-white/10 animate-pulse' />
      </div>
    </div>
  );
};

export const ToneCardSkeletonGrid: React.FC<{ count?: number }> = ({ count = 8 }) => {
  return (
    <div className='grid grid-cols-2 gap-3 opacity-60'>
      {Array.from({ length: count }).map((_, idx) => (
        <ToneCardSkeleton key={idx} />
      ))}
    </div>
  );
};

export default ToneCardSkeleton;
