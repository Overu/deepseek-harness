import { useMemo } from 'react';
import { ChevronsDown } from 'lucide-react';
import fileUtil from '@/utils/file';
import useFileUpload from '@/hooks/useFileUpload';
import UploadPreview from '@/components/common/fileControl/UploadPreview';

const { convertToHtmlAccept } = fileUtil;

/** 上传校验使用的媒体类型（工具节点 UI type 需映射到 image/video/audio） */
const resolveUploadMediaType = (type: string) => {
  if (type === 'panoramaTool') return 'image';
  return type;
};

interface UploadContentProps {
  type: string;
  selected: boolean;
  nodeId?: string;
  tempFile?: File;
  onOk?: (url: string, meta?: { file: File; preview?: string }) => void;
  onClick: () => void;
}

const UploadContent = ({ type, selected, nodeId, tempFile, onOk = () => {}, onClick }: UploadContentProps) => {
  const uploadMediaType = resolveUploadMediaType(type);
  const { mediaFile, fileInputRef, acceptConfig, handleInputChange, handleDelete, handleRetry, triggerFileInput } = useFileUpload({
    type: uploadMediaType,
    onUploadSuccess: onOk,
    tempFile,
    assetLibrarySync: nodeId ? { nodeId } : undefined,
  });

  // 根据 type 确定显示的文本
  const getTips = () => {
    switch (type) {
      case 'audio':
        return {
          localEntry: '本地上传音频',
          localTip: '不能超过20M',
          assetEntry: '从资产库上传音频',
        };
      case 'video':
        return {
          localEntry: '本地上传视频',
          localTip: '不能超过200M',
          assetEntry: '从资产库上传视频',
        };
      case 'panoramaTool':
        return {
          localEntry: '本地上传全景图',
          localTip: '不能超过20M',
          assetEntry: '从资产库上传全景图',
        };
      case 'image':
        return {
          localEntry: '本地上传图片',
          localTip: '不能超过20M',
          assetEntry: '从资产库上传图片',
        };
      case 'text':
      default:
        return {
          icon: 'icon-text',
          localEntry: '点击此处输入文本',
        };
    }
  };

  const tips = getTips();
  const typeText = useMemo(() => {
    if (type == 'image') return '图片';
    if (type == 'video') return '视频';
    if (type == 'audio') return '音频';
    if (type == 'text') return '文本';
    if (type == 'panoramaTool') return '全景图';
  }, [type]);

  const handleClick = () => {
    if (type == 'text') {
      onClick();
    } else if (!mediaFile && fileInputRef.current) {
      triggerFileInput();
    }
  };

  return (
    <div className='w-full h-full'>
      <input ref={fileInputRef} type='file' accept={convertToHtmlAccept(acceptConfig.accept)} onChange={handleInputChange} className='hidden' />
      {mediaFile ? (
        <div className='w-full h-full flex items-center justify-center bg-black rounded-2xl'>
          <UploadPreview mediaFile={mediaFile} onDelete={handleDelete} onRetry={handleRetry} />
        </div>
      ) : (
        <div className={`w-full h-full p-6 flex flex-col justify-between rounded-2xl gap-10`}>
          <div className='z-[1] flex-1 mb-8 w-full flex flex-col items-center justify-center'>
            <div
              className={`peer group w-60 h-16 mb-4 pl-4 rounded-[10px] bg-white/10 flex items-center justify-between gap-3 cursor-pointer duration-200 ring-white ${selected ? 'opacity-20' : ''} hover:bg-white/20 hover:ring-2 hover:opacity-100`}
              onClick={handleClick}
            >
              <div className={`iconfont text-3xl ${tips.icon ? tips.icon : 'icon-upload1'}`}></div>
              <div className='flex-1 border-l border-white/65 flex flex-col items-center justify-center'>
                <div className='text-base text-white'>{tips.localEntry}</div>
                <div className='hidden text-sm text-white/65 group-hover:block'>{tips.localTip}</div>
              </div>
            </div>
            {type !== 'text' ? (
              <div
                className={`peer w-60 h-16 rounded-[10px] pl-4 bg-white/10 flex items-center justify-between gap-3 cursor-pointer duration-200 ring-white ${selected ? 'opacity-20' : ''} hover:bg-white/20 hover:ring-2 hover:opacity-100`}
                onClick={onClick}
              >
                <div className={`iconfont text-3xl icon-folder-upload`}></div>
                <div className='flex-1 text-base text-white border-l border-white/65 text-center'>{tips.assetEntry}</div>
              </div>
            ) : null}
            <div className='absolute bottom-6 left-0 right-0 peer-hover:opacity-20 flex items-center justify-center gap-2 duration-200'>
              <div className='text-white'>由此输入你的指令AI生成{typeText}</div>
              <ChevronsDown size={18} color='#fff' />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default UploadContent;
