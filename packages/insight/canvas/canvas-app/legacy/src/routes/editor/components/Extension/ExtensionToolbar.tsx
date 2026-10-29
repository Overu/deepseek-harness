import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import pointImage from '@/assets/images/point.png';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { Link, Unlink, Focus, X, Loader2 } from 'lucide-react';
import { calculateExternalTaskCost } from '@/api/tool';

const RatioIcon = ({ ratio }: { ratio: number | null }) => {
  const boxSize = 14;
  let w = boxSize;
  let h = boxSize;

  if (ratio) {
    if (ratio >= 1) {
      h = boxSize / ratio;
    } else {
      w = boxSize * ratio;
    }
  }

  return (
    <div className='flex items-center justify-center w-5 h-5 mr-1.5 shrink-0'>
      <div
        className='border border-white/90 rounded-[1px]'
        style={{
          width: `${Math.max(w, 2)}px`,
          height: `${Math.max(h, 2)}px`,
          borderStyle: ratio === null ? 'dashed' : 'solid',
        }}
      />
    </div>
  );
};

const ASPECT_RATIOS = [
  { value: 'custom', label: '自定义', ratio: null },
  { value: 'original', label: '原比例', ratio: null },
  { value: '1:1', label: '1:1', ratio: 1 },
  { value: '16:9', label: '16:9', ratio: 16 / 9 },
  { value: '9:16', label: '9:16', ratio: 9 / 16 },
  { value: '4:1', label: '4:1', ratio: 4 / 1 },
  { value: '1:4', label: '1:4', ratio: 1 / 4 },
  { value: '2:3', label: '2:3', ratio: 2 / 3 },
  { value: '3:2', label: '3:2', ratio: 3 / 2 },
  { value: '3:4', label: '3:4', ratio: 3 / 4 },
  { value: '5:4', label: '5:4', ratio: 5 / 4 },
  { value: '21:9', label: '21:9', ratio: 21 / 9 },
] as const;

interface ExtensionToolbarProps {
  maskSize: { width: number; height: number };
  onResizeMask: (w: number, h: number) => void;
  onApplyRatio?: (ratio: string) => void;
  onRecenter?: () => void;
  onSend: (resolution: string, aspectMode: string) => void;
  isLoading?: boolean;
}

export const ExtensionToolbar: React.FC<ExtensionToolbarProps> = ({ maskSize, onResizeMask, onApplyRatio, onRecenter, onSend, isLoading }) => {
  const [sizeMode, setSizeMode] = useState<string>('custom');
  const [resolution, setResolution] = useState<string>('1K');
  const [points, setPoints] = useState<number | string>(0);
  const [isPointsLoading, setIsPointsLoading] = useState(false);

  const fetchPoints = async (res: string) => {
    setIsPointsLoading(true);
    try {
      const { code, data }: any = await calculateExternalTaskCost({
        type: 'image_size_adaptation',
        resolution: res,
      });
      if (code === 'SUCCESS') {
        setPoints(data ?? 0);
      }
    } catch (error: any) {
      console.error('Fetch points error:', error);
      toast.error(error?.message || '服务连接失败，请重试');
    } finally {
      setIsPointsLoading(false);
    }
  };

  useEffect(() => {
    fetchPoints(resolution);
  }, [resolution]);

  const handleSizeModeChange = (newMode: string) => {
    setSizeMode(newMode);

    if (onApplyRatio) {
      onApplyRatio(newMode);
    }
  };

  return (
    <motion.div
      initial={{ y: 100, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className='fixed bottom-8 left-1/2 !-translate-x-1/2 z-50'
    >
      <div className='flex items-center gap-2 p-2 bg-background/95 backdrop-blur-lg border border-border/60 rounded-2xl shadow-2xl shadow-black/20'>
        <TooltipProvider delayDuration={300}>
          <div className='flex items-center gap-2 px-1'>
            <span className=' text-sm '>比例</span>
            <Select value={sizeMode} onValueChange={handleSizeModeChange}>
              <SelectTrigger className='h-8 w-[110px] text-xs border-none bg-muted-foreground/10 hover:bg-muted-foreground/25'>
                <SelectValue placeholder='尺寸' />
              </SelectTrigger>
              <SelectContent className='z-[44] bg-background/95 backdrop-blur-lg'>
                {ASPECT_RATIOS.map(item => (
                  <SelectItem key={item.value} value={item.value} className='justify-start py-2 h-9'>
                    <div className='flex items-center'>
                      <RatioIcon ratio={item.ratio} />
                      <span className='text-[13px] font-medium'>{item.label}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* 分辨率下拉框 */}
            <span className=' text-sm '>输出分辨率</span>
            <Select value={resolution} onValueChange={setResolution}>
              <SelectTrigger className='h-8 w-[60px] text-xs border-none bg-muted-foreground/10 hover:bg-muted-foreground/25 '>
                <SelectValue placeholder='1K' />
              </SelectTrigger>
              <SelectContent className='z-[44] bg-background/95 backdrop-blur-lg'>
                <SelectItem value='1K'>1K</SelectItem>
                <SelectItem value='2K'>2K</SelectItem>
                {/* <SelectItem value='4K'>4K</SelectItem> */}
              </SelectContent>
            </Select>
          </div>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant='ghost' size='icon' className='h-8 w-8 text-muted-foreground mr-1' onClick={onRecenter}>
                <Focus className='h-4 w-4' />
              </Button>
            </TooltipTrigger>
            <TooltipContent side='top' className='z-[45]'>
              居中视口
            </TooltipContent>
          </Tooltip>

          <div className='w-[1px] h-4 bg-white/60 mx-2' />

          <Button
            className='h-9 px-4 gap-2 font-medium btn ins-btn-primary rounded-md'
            disabled={isLoading || isPointsLoading}
            onClick={() => {
              onSend(resolution, sizeMode);
            }}
          >
            {isLoading ? (
              <>
                生成中...
                <Loader2 className='w-3.5 h-3.5 animate-spin' />
              </>
            ) : (
              <>
                {isPointsLoading ? (
                  <Loader2 className='w-3.5 h-3.5 animate-spin' />
                ) : (
                  <>
                    <img src={pointImage} alt='points' />
                    <span className='text-white text-xs -ml-1'>{points}</span>
                  </>
                )}
                <div className='text-white text-xs iconfont icon-send ml-1'></div>
              </>
            )}
          </Button>
        </TooltipProvider>
      </div>
    </motion.div>
  );
};
