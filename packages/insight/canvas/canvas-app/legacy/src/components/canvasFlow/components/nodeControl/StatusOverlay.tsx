import { CircleProgress } from '@/components/ui/circle-progress';
import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { useFlowStore } from '@/store/flowStore';
import { getStagedProgressFromElapsed } from '@/utils/stagedProgress';

interface ImageOverlayProps {
  status: 'running' | 'success' | 'failure' | 'interrupt';
  errorMsg?: string;
  type?: string;
  id: string;
}

const StatusOverlay: React.FC<ImageOverlayProps> = ({ status, errorMsg, type, id }) => {
  const [progress, setProgress] = useState(0);
  const [showError, setShowError] = useState(true); // 新增状态控制错误显示
  const { updateInputEdgesType } = useFlowStore(state => state.actions);

  const FAKE_PROGRESS_DURATION_MS: Record<string, number> = {
    text: 120000, // 2分钟内完成
    image: 180000, // 3分钟内完成
    audio: 180000, // 3分钟内完成
    video: 360000, // 6分钟内完成
    highDefinitionTool: 60000, // 1分钟内完成
    highDefinitionVideoTool: 120000, // 2分钟内完成
    multiViewTool: 60000, // 1分钟内完成
    imageLipSyncTool: 180000, // 3分钟内完成
    poseTransVideoTool: 180000, // 3分钟内完成
    storyboardTool: 120000, // 2分钟内完成
    panoramaTool: 180000, // 3分钟内完成
    default: 10000, // 默认10秒内完成
  };

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (status === 'running') {
      updateInputEdgesType(id, 'animated');
      setProgress(0);

      const duration = FAKE_PROGRESS_DURATION_MS[type || ''] ?? FAKE_PROGRESS_DURATION_MS.default;
      const startTime = Date.now();

      interval = setInterval(() => {
        setProgress(getStagedProgressFromElapsed(Date.now() - startTime, duration, 99));
      }, 50);
    } else {
      updateInputEdgesType(id, 'default');
      if (status === 'success') {
        setProgress(100);
      }

      if (status === 'failure') {
        setShowError(true);
      }
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [status, type, id, updateInputEdgesType]);

  // 修改判断条件，添加 showError 状态
  if (status !== 'running' && (status !== 'failure' || !showError)) {
    return null;
  }

  return (
    <div className='absolute z-[2] inset-0 bg-black/45 flex items-center justify-center rounded-2xl backdrop-blur-[20px] border-white/25 p-4'>
      {status == 'running' ? (
        <div className='flex flex-col items-center'>
          <CircleProgress value={progress} size={120} format={percent => <span className='text-white'>{`${percent}%`}</span>} />
        </div>
      ) : errorMsg ? (
        <div className='flex flex-col gap-2 items-center justify-center text-lg text-white w-full h-full relative'>
          <div className='bg-[#ff4d4f] rounded-md w-[88px] h-[30px] flex items-center justify-center'>温馨提示</div>
          <div className='w-full break-words overflow-hidden text-center'>{errorMsg}</div>
          {/* 添加关闭按钮 */}
          <button
            className='absolute top-1 right-1 rounded-lg w-8 h-8 flex items-center justify-center bg-black/45 text-white hover:bg-black/85'
            onClick={() => setShowError(false)}
          >
            <X size={20} />
          </button>
        </div>
      ) : (
        <div className='flex flex-col items-center justify-center w-full h-full relative'>
          <CircleProgress
            value={progress || 70}
            size={120}
            strokeColor='#ef4444'
            format={() => (
              <div className='flex items-center justify-center'>
                <X size={30} color='#fff' />
              </div>
            )}
          />
          {/* 添加关闭按钮 */}
          <button
            className='absolute top-1 right-1 rounded-lg w-8 h-8 flex items-center justify-center bg-black/45 text-white hover:bg-black/85'
            onClick={() => setShowError(false)}
          >
            <X size={20} />
          </button>
        </div>
      )}
    </div>
  );
};

export default StatusOverlay;
