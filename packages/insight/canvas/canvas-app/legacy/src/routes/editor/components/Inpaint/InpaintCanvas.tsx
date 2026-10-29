import React from 'react';

interface InpaintCanvasProps {
  canvasRef: React.Ref<HTMLCanvasElement>;
  maskCanvasRef: React.Ref<HTMLCanvasElement>;
  containerRef: React.Ref<HTMLDivElement>;
  isReady: boolean;
  cursorClassName?: string;
  onPointerDown: (event: React.PointerEvent<HTMLCanvasElement>) => void;
  onPointerMove: (event: React.PointerEvent<HTMLCanvasElement>) => void;
  onPointerUp: (event: React.PointerEvent<HTMLCanvasElement>) => void;
  onPointerLeave?: (event: React.PointerEvent<HTMLCanvasElement>) => void;
}

export const InpaintCanvas = ({
  canvasRef,
  maskCanvasRef,
  containerRef,
  isReady,
  cursorClassName,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerLeave,
}: InpaintCanvasProps) => {
  return (
    <div ref={containerRef} className='relative h-full w-full overflow-hidden bg-black' style={{ touchAction: 'none' }}>
      <canvas ref={canvasRef} className='absolute inset-0 select-none outline-none' />
      <canvas
        ref={maskCanvasRef}
        className={`absolute inset-0 select-none outline-none ${cursorClassName || ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={onPointerLeave}
      />

      {!isReady && (
        <div className='absolute inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm'>
          <div className='flex flex-col items-center gap-2'>
            <span className='loading loading-spinner loading-md text-primary' />
            <span className='text-sm font-medium text-white/70 animate-pulse'>加载图片...</span>
          </div>
        </div>
      )}
    </div>
  );
};
