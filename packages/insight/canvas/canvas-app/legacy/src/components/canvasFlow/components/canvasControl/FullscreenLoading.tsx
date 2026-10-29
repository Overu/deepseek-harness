import React from 'react';

interface FullscreenLoadingProps {
  loading: boolean;
}

const FullscreenLoading: React.FC<FullscreenLoadingProps> = ({ loading }) => {
  if (!loading) return null;

  return (
    <div className='absolute inset-0 bg-black flex flex-col items-center justify-center z-[1001]'>
      <div className='animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500 mb-4'></div>
      <p className='text-white text-lg'>加载中</p>
    </div>
  );
};

export default FullscreenLoading;
