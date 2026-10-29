import { useState, useEffect } from 'react';

const Skeleton = () => {
  const [gridCols, setGridCols] = useState(1);

  // 根据屏幕宽度动态计算网格列数和骨架屏数量
  useEffect(() => {
    const calculateGridCols = () => {
      const width = window.innerWidth;
      if (width < 768) return 1; // sm: grid-cols-1
      if (width < 1024) return 2; // md: grid-cols-2
      if (width < 1280) return 3; // lg: grid-cols-3
      if (width < 1536) return 4; // xl: grid-cols-4
      return 6; // 2xl: grid-cols-5
    };

    // 初始计算
    setGridCols(calculateGridCols());

    // 监听窗口大小变化
    const handleResize = () => {
      setGridCols(calculateGridCols());
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  const skeletonItems = Array.from({ length: gridCols }).map((_, index) => (
    <div key={index} className='w-full flex flex-col aspect-square rounded bg-white/25 p-2 backdrop-blur-3xl'>
      {/* 上部3/4区域为矩形，模拟项目缩略图 */}
      <div className='bg-[#585858] rounded w-full mb-2 flex-1 overflow-hidden'>
        <div className='w-full h-full flex items-center justify-center'>
          <div className='w-full h-full bg-gray-300/20 rounded animate-pulse'></div>
        </div>
      </div>
      <div className='flex flex-col'>
        {/* 项目名称区域 */}
        <div className='w-3/4 h-4 mb-1 bg-gray-300/20 rounded animate-pulse'></div>
        <div className='flex justify-between items-center'>
          {/* 时间区域 */}
          <div className='w-1/2 h-3 text-xs bg-gray-300/10 rounded animate-pulse'></div>
          {/* 操作按钮区域 */}
          <div className='flex space-x-2'>
            <div className='w-4 h-4 bg-gray-300/10 rounded-full animate-pulse'></div>
            <div className='w-4 h-4 bg-gray-300/10 rounded-full animate-pulse'></div>
            <div className='w-4 h-4 bg-gray-300/10 rounded-full animate-pulse'></div>
          </div>
        </div>
      </div>
    </div>
  ));

  return <div className='grid gap-2 w-full grid-cols md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6 opacity-50'>{skeletonItems}</div>;
};

export default Skeleton;
