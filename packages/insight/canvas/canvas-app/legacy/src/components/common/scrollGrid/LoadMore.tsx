import { Loader2 } from 'lucide-react';

interface LoadMoreProps {
  show: boolean;
  loadingMore: boolean;
  sentinelRef?: React.RefObject<HTMLDivElement | null> | null;
}

const LoadMore = ({ show, loadingMore, sentinelRef }: LoadMoreProps) => {
  if (!show) return null;

  return (
    <div ref={sentinelRef} className='col-span-full flex justify-center items-center h-20'>
      {loadingMore ? (
        <div className='flex justify-center py-4'>
          <Loader2 className='h-6 w-6 animate-spin text-muted-foreground' />
        </div>
      ) : (
        <div className='text-white/65'>加载更多...</div>
      )}
    </div>
  );
};

export default LoadMore;
