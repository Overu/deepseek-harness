import React from 'react';
import fileUtil from '@/utils/file';
import useFileUpload, { VIDEO_MAX_DURATION_SECONDS, type UploadSuccessMeta } from '@/hooks/useFileUpload';
import UploadPreview from '@/components/common/fileControl/UploadPreview';

const { convertToHtmlAccept } = fileUtil;

const iconMap = {
  image: 'icon-image-upload1',
  video: 'icon-video-upload',
  audio: 'icon-audio-upload',
};

interface LocalUploadProps {
  accept?: string;
  acceptedExtensions?: readonly string[];
  maxSize?: number;
  maxDuration?: number | null;
  extraTip?: string;
  nodeId?: string;
  uploading: boolean;
  onOk: (url: string, meta?: UploadSuccessMeta) => void;
  onDelete?: () => void;
  updateUploading: (uploading: boolean) => void;
}

const formatDurationTip = (seconds: number) => {
  if (seconds % 60 === 0) {
    return `${seconds / 60}分钟`;
  }
  return `${seconds}秒`;
};

const LocalUpload: React.FC<LocalUploadProps> = ({
  accept = 'image',
  acceptedExtensions,
  maxSize = 10,
  maxDuration,
  extraTip = '',
  nodeId,
  uploading,
  onOk,
  onDelete = () => {},
  updateUploading,
}) => {
  // 使用封装的文件上传hook
  const {
    mediaFile,
    fileInputRef,
    acceptConfig,
    isDragging,
    handleInputChange,
    handleDelete: hookHandleDelete,
    triggerFileInput,
    handleRetry,
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop,
  } = useFileUpload({
    type: accept,
    uploading,
    maxSize,
    maxDuration,
    acceptedExtensions,
    onUploadSuccess: onOk,
    updateUploading,
    assetLibrarySync: nodeId ? { nodeId } : undefined,
  });

  const handleDelete = () => {
    hookHandleDelete();
    onDelete();
  };

  const getIconClass = (accept: string): string => {
    if (accept.includes('image')) return iconMap.image;
    if (accept.includes('video')) return iconMap.video;
    if (accept.includes('audio')) return iconMap.audio;
    return 'icon-image-upload1'; // 默认图标
  };

  const videoDurationTip =
    accept === 'video' && maxDuration !== null ? `，时长不超过${formatDurationTip(maxDuration === undefined ? VIDEO_MAX_DURATION_SECONDS : maxDuration)}` : '';

  // 渲染拖拽区域内容
  const renderDraggerContent = () => {
    if (mediaFile) {
      return (
        <div className='h-full w-full'>
          <UploadPreview mediaFile={mediaFile} onDelete={handleDelete} onRetry={handleRetry} />
        </div>
      );
    } else {
      return (
        <>
          <div className={`iconfont text-[40px] text-[#4155F0] ${getIconClass(accept)}`}></div>
          <p className='text-sm text-gray-500 mt-2'>点击或拖拽文件到此区域上传</p>
          <p className='text-xs text-gray-400 mt-1'>{accept !== '*' && `支持${fileUtil.getAcceptDisplayText(accept)}，文件大小不超过${maxSize}MB${videoDurationTip}`}</p>
          {extraTip && <p className='text-xs text-gray-400 mt-1'>{extraTip}</p>}
        </>
      );
    }
  };

  return (
    <div className='h-full'>
      <input ref={fileInputRef} type='file' accept={convertToHtmlAccept(acceptConfig.accept)} onChange={handleInputChange} className='hidden' />
      <div
        className={`
          h-full w-full border-2 border-dashed rounded-lg
          flex flex-col items-center justify-center
          transition-colors cursor-pointer bg-black/45
          ${isDragging ? 'border-primary bg-primary/5' : 'border-gray-300 hover:border-primary'}
          ${mediaFile || uploading ? 'cursor-default' : ''}
        `}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onClick={triggerFileInput}
      >
        {renderDraggerContent()}
      </div>
    </div>
  );
};

export default LocalUpload;
