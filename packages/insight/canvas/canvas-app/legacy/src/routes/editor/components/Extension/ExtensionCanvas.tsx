import React from 'react';

interface ExtensionCanvasProps {
  canvasRef: React.Ref<HTMLCanvasElement>;
  containerRef: React.Ref<HTMLDivElement>;
  isReady: boolean;
}

export const ExtensionCanvas: React.FC<ExtensionCanvasProps> = ({ canvasRef, containerRef, isReady }) => {
  return (
    <div ref={containerRef} className='relative w-full h-full bg-[#1C1C1E] overflow-hidden' style={{ touchAction: 'none' }}>
      <canvas ref={canvasRef} className='absolute inset-0 select-none outline-none' />

      {!isReady && (
        <div className='absolute inset-0 flex items-center justify-center bg-background/50 backdrop-blur-sm z-50'>
          <div className='flex flex-col items-center gap-2'>
            <span className='loading loading-spinner loading-md text-primary' />
            <span className='text-sm font-medium text-muted-foreground animate-pulse'>加载图片并初始化布局...</span>
          </div>
        </div>
      )}
    </div>
  );
};
