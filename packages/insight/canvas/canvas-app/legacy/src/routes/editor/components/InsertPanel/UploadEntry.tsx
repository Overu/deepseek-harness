import { Image } from 'lucide-react';
import { useImageUpload } from '../../hooks/useImageUpload';
import { CircleProgress } from '@/components/ui/circle-progress';
import fileUtil from '@/utils/file';

const { convertToHtmlAccept } = fileUtil;

/**
 * 图片上传入口组件
 */
export function UploadEntry() {
  const { fileInputRef, state, handleFileSelect, triggerUpload, accept } = useImageUpload();

  const isUploading = state.status === 'uploading';

  return (
    <div className='relative'>
      {/* 隐藏的文件输入 */}
      <input ref={fileInputRef} type='file' accept={convertToHtmlAccept(accept)} onChange={handleFileSelect} className='hidden' />

      {/* 上传按钮 */}
      <button
        onClick={triggerUpload}
        disabled={isUploading}
        className={`
          w-12 h-12 rounded-tr-md rounded-tl-md
          flex items-center justify-center
          transition-all duration-200
          ${isUploading ? 'bg-zinc-700 cursor-wait' : 'bg-zinc-800/95 hover:bg-zinc-700 cursor-pointer'}
          shadow-lg
        `}
        title='上传图片'
      >
        {isUploading ? (
          <div className='relative w-6 h-6 flex items-center justify-center'>
            <CircleProgress value={state.progress} size={24} strokeWidth={2} format={() => null} />
          </div>
        ) : (
          <Image size={18} className='text-zinc-300' />
        )}
      </button>
    </div>
  );
}
