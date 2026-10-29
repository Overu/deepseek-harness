import { useEffect, type ReactNode } from 'react';
import { FileText, ImageOff, Music } from 'lucide-react';

import RichTextViewer from '@/components/canvasFlow/components/richText/RichTextViewer';
import { ImagePreviewStage } from './ImagePreviewStage';
import type { FilePreviewItem } from './types';
import { VideoPreviewStage } from './VideoPreviewStage';

interface FilePreviewStageProps {
  item?: FilePreviewItem;
  imageAlt?: string;
  videoAutoPlay?: boolean;
  videoInitialMuted?: boolean;
  onItemReady?: (itemId: string) => void;
  onItemError?: (itemId: string) => void;
  renderAudio?: (item: FilePreviewItem) => ReactNode;
}

function EmptyStage() {
  return (
    <div className='flex h-full w-full flex-col items-center justify-center gap-3 bg-[#050505] text-white/45'>
      <ImageOff className='h-12 w-12' />
      <span className='text-sm'>暂无可预览资源</span>
    </div>
  );
}

function AudioStage({ item, renderAudio }: { item: FilePreviewItem; renderAudio?: (item: FilePreviewItem) => ReactNode }) {
  if (renderAudio) {
    return <>{renderAudio(item)}</>;
  }

  return (
    <div className='flex h-full w-full items-center justify-center bg-[#050505] px-8'>
      <div className='w-full max-w-xl rounded-lg border border-white/10 bg-white/10 p-6 text-white'>
        <div className='mb-4 flex items-center gap-3 text-white/80'>
          <Music className='h-5 w-5' />
          <span className='text-sm'>音频资源</span>
        </div>
        <audio src={item.url} controls className='w-full' />
      </div>
    </div>
  );
}

function TextStage({ item }: { item: FilePreviewItem }) {
  if (item.text) {
    return <RichTextViewer value={item.text} className='max-h-[600px] max-w-full min-w-96 w-fit rounded-lg bg-white/5 p-6 text-white/90' />;
  }

  return (
    <div className='flex h-full w-full items-center justify-center bg-[#050505] px-8'>
      <a
        href={item.url}
        target='_blank'
        rel='noreferrer'
        className='flex items-center gap-3 rounded-lg border border-white/10 bg-white/10 px-5 py-4 text-sm text-white/75 transition-colors hover:bg-white/15 hover:text-white'
      >
        <FileText className='h-5 w-5' />
        打开文本资源
      </a>
    </div>
  );
}

function UnknownStage({ item }: { item: FilePreviewItem }) {
  return (
    <div className='flex h-full w-full items-center justify-center bg-[#050505] px-8'>
      <a
        href={item.url}
        target='_blank'
        rel='noreferrer'
        className='rounded-lg border border-white/10 bg-white/10 px-5 py-4 text-sm text-white/75 transition-colors hover:bg-white/15 hover:text-white'
      >
        暂不支持预览该资源，点击打开
      </a>
    </div>
  );
}

export function FilePreviewStage({ item, imageAlt, videoAutoPlay = false, videoInitialMuted = false, onItemReady, onItemError, renderAudio }: FilePreviewStageProps) {
  useEffect(() => {
    if (item && item.type !== 'image' && item.type !== 'video') {
      onItemReady?.(item.id);
    }
  }, [item, onItemReady]);

  if (!item) return <EmptyStage />;

  if (item.type === 'image') {
    return (
      <ImagePreviewStage
        key={`${item.id}:${item.url}`}
        src={item.url}
        alt={imageAlt || item.name || '预览图片'}
        onReady={() => onItemReady?.(item.id)}
        onError={() => onItemError?.(item.id)}
      />
    );
  }

  if (item.type === 'video') {
    return (
      <VideoPreviewStage
        src={item.url}
        poster={item.thumbnailUrl}
        autoPlay={videoAutoPlay}
        initialMuted={videoInitialMuted}
        onReady={() => onItemReady?.(item.id)}
        onError={() => onItemError?.(item.id)}
      />
    );
  }

  if (item.type === 'audio') {
    return <AudioStage item={item} renderAudio={renderAudio} />;
  }

  if (item.type === 'text') {
    return <TextStage item={item} />;
  }

  return <UnknownStage item={item} />;
}
