import React from 'react';
import { CircleProgress } from '@/components/ui/circle-progress';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';
import AudioPlayer from './AudioPlayer';
import type { MediaFile } from '@/hooks/useFileUpload';

interface MediaPreviewProps {
  mediaFile: MediaFile;
  onDelete: () => void;
  onRetry?: () => void;
}

const UploadPreview: React.FC<MediaPreviewProps> = ({ mediaFile, onDelete, onRetry = () => {} }) => {
  const isVideo = mediaFile.file.type.startsWith('video/');
  const isAudio = mediaFile.file.type.startsWith('audio/');
  const previewUrl = mediaFile.preview || mediaFile.url;

  return (
    <div className='relative w-full h-full rounded-2xl overflow-hidden shadow-md flex items-center justify-center cursor-default'>
      {mediaFile.status === 'done' && (
        <div
          className='absolute top-3 right-3 z-10 w-8 h-8 rounded-lg cursor-pointer flex items-center justify-center bg-black/45 backdrop-blur-md hover:bg-black/85 transition-all'
          onClick={e => {
            e.stopPropagation();
            onDelete();
          }}
        >
          <X size={18} color='#fff' />
        </div>
      )}
      <div className='w-full h-full flex items-center justify-center'>
        {isVideo ? (
          <div className='relative w-full h-full hover:cursor-zoom-in'>
            <video className='w-full h-full object-cover' muted playsInline src={previewUrl}></video>
            {previewUrl ? (
              <>
                <div className='absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-0 h-0 border-t-[16px] border-t-transparent border-l-[26px] border-l-white border-b-[16px] border-b-transparent opacity-80 transition-opacity duration-200 z-4 cursor-zoom-in'></div>
                <div className='absolute top-0 left-0 w-full h-full bg-black/20 opacity-0 hover:opacity-100 transition-opacity duration-200 z-5 cursor-pointer'></div>
              </>
            ) : null}
          </div>
        ) : isAudio ? (
          <div className='relative bg-[#1f1f1f] border border-white/25 h-full px-3 w-full'>
            <AudioPlayer url={mediaFile.url} height={314}></AudioPlayer>
          </div>
        ) : (
          <div className='flex items-center justify-center w-full h-full'>
            <img src={previewUrl} alt='media-preview' className='object-contain' />
          </div>
        )}
      </div>

      {/* 上传状态覆盖层 */}
      {mediaFile.status !== 'done' && (
        <div className='absolute inset-0 bg-black/45 backdrop-blur-[20px] flex items-center justify-center'>
          <div className='text-center'>
            <CircleProgress
              value={mediaFile.progress || 0}
              size={80}
              animate={mediaFile.status !== 'uploading'}
              strokeColor={mediaFile.status === 'error' ? '#ef4444' : undefined}
              format={percent => <span className='text-white text-base'>{percent ? `${parseInt(percent.toString())}%` : '0%'}</span>}
            />
            {mediaFile.status === 'error' && (
              <>
                <div className='absolute top-2 right-2'>
                  <button className='absolute top-1 right-1 rounded-lg w-8 h-8 flex items-center justify-center bg-black/45 text-white hover:bg-black/85' onClick={onDelete}>
                    <X size={20} />
                  </button>
                </div>
                <div className='mt-4 flex justify-center space-x-2'>
                  <Button size='sm' onClick={onRetry}>
                    重新上传
                  </Button>
                  <Button variant='outline' size='sm' onClick={onDelete}>
                    重新选择
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default UploadPreview;
