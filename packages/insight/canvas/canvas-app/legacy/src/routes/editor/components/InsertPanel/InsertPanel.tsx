import { useState } from 'react';
import { UploadEntry } from './UploadEntry';
import { AssetHistory } from '../common/AssetHistory';
import { useEditorEngine } from '../../hooks/useEditorEngine';
import { toast } from 'sonner';
import { History } from 'lucide-react';

/**
 * 选入面板 - 编辑器左侧居中位置
 * 提供图片上传等选入功能入口
 */
export function InsertPanel() {
  const engine = useEditorEngine();
  const [showHistory, setShowHistory] = useState(false);

  // 处理历史资源选择
  const handleHistorySelect = async (type: string, url: string) => {
    if (type === 'image') {
      try {
        await engine.addImage(url);
        setShowHistory(false); // 选择后关闭列表
      } catch (error) {
        console.error('添加图片失败:', error);
        toast.error('添加图片失败');
      }
    } else {
      // TODO: 支持视频/音频类型
      toast.info(`暂不支持添加 ${type} 类型资源`);
    }
  };

  return (
    <div className='fixed left-4 top-1/2 -translate-y-1/2 flex flex-col z-10'>
      {/* 图片上传入口 */}
      <UploadEntry />

      {/* 历史列表快捷入口 */}
      <div className='relative' onMouseEnter={() => setShowHistory(true)} onMouseLeave={() => setShowHistory(false)}>
        {/* 历史图标按钮 */}
        <button
          className='w-12 h-12 rounded-br-md rounded-bl-md flex items-center justify-center
            bg-zinc-800/95 hover:bg-zinc-700 cursor-pointer
            shadow-lg transition-all duration-200'
          title='生成历史'
        >
          <History size={18} className='text-zinc-300' />
        </button>

        {/* Hover 时平滑显示历史列表 */}
        <div
          className={`absolute left-12 -translate-y-1/2 top-1/2 transition-all duration-300 transform origin-left
            ${showHistory ? 'opacity-100 scale-100 visible' : 'opacity-0 scale-95 invisible'}`}
        >
          {showHistory && <AssetHistory onAdd={handleHistorySelect} />}
        </div>
      </div>
    </div>
  );
}
