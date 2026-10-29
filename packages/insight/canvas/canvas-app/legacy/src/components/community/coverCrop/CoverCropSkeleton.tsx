export function CoverCropPreviewSkeleton() {
  return (
    <div className='pointer-events-none absolute inset-0 z-50 overflow-hidden bg-[#151515]'>
      <div className='h-full w-full animate-pulse bg-[linear-gradient(110deg,#151515_0%,#202020_38%,#2b2b2b_50%,#202020_62%,#151515_100%)] bg-[length:220%_100%]' />
      <div className='absolute left-1/2 top-1/2 h-4 w-36 -translate-x-1/2 -translate-y-1/2 rounded bg-white/10' />
    </div>
  );
}

export function CoverCropTimelineSkeleton() {
  return (
    <div className='absolute inset-0 grid grid-cols-10 overflow-hidden rounded-md bg-[#101010] ring-1 ring-white/10'>
      {Array.from({ length: 10 }, (_, index) => (
        <div key={index} className='h-full w-full animate-pulse border-r border-black/20 bg-[linear-gradient(110deg,#141414_0%,#242424_50%,#141414_100%)] bg-[length:220%_100%]' />
      ))}
    </div>
  );
}
