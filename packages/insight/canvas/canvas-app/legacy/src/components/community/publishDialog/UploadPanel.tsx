import { useMemo, useState } from 'react';
import { ImagePlus, PenLine, UploadCloud, Video as VideoIcon } from 'lucide-react';
import { toast } from 'sonner';

import type { CommunityWorkType } from '@/api/community';
import { CoverCropDialog, type CoverCropResult, type CoverCropSource } from '@/components/community/coverCrop';
import type { PublishWorkDraft } from './types';
import { IMAGE_WORK_MAX_COUNT, IMAGE_WORK_MAX_SIZE_MB, VIDEO_WORK_MAX_SIZE_MB } from './constants';
import { CommunityMediaUploadDialog, type CommunityUploadTarget } from './CommunityMediaUploadDialog';
import { getPrimaryMediaCover } from './utils';
import { ImageWorkUploadArea } from './ImageWorkUploadArea';

interface UploadPanelProps {
  workType: CommunityWorkType;
  draft: PublishWorkDraft;
  mediaLocked?: boolean;
  onDraftChange: (patch: Partial<PublishWorkDraft>) => void;
}

const getUploadCopy = (workType: CommunityWorkType) => {
  if (workType === 'VIDEO') {
    return {
      title: '点击此处上传视频',
      description: `支持 mp4、mov、mkv，单个视频 ${VIDEO_WORK_MAX_SIZE_MB}M 内`,
    };
  }

  return {
    title: '点击此处上传图片',
    description: `支持图片格式：png、jpg、jpeg、webp\n大小${IMAGE_WORK_MAX_SIZE_MB}M以内，数量${IMAGE_WORK_MAX_COUNT}张以内`,
  };
};

export function UploadPanel({ workType, draft, mediaLocked = false, onDraftChange }: UploadPanelProps) {
  const [uploadTarget, setUploadTarget] = useState<CommunityUploadTarget | null>(null);
  const [coverCropOpen, setCoverCropOpen] = useState(false);
  const uploadCopy = getUploadCopy(workType);
  const primaryMedia = draft.mediaList[0];
  const primaryMediaCoverUrl = getPrimaryMediaCover(draft.mediaList, workType);
  const coverUrl = draft.usePrimaryMediaAsCover ? primaryMediaCoverUrl : draft.coverUrl;
  const primaryCoverLabel = workType === 'VIDEO' ? '使用视频首帧作为封面' : '使用首张图片作为封面';
  const coverCropSource = useMemo<CoverCropSource | null>(() => {
    if (!draft.usePrimaryMediaAsCover) {
      return draft.coverUrl ? { type: 'image', url: draft.coverUrl } : null;
    }

    return primaryMedia?.media_url
      ? {
          type: workType === 'VIDEO' ? 'video' : 'image',
          url: primaryMedia.media_url,
        }
      : null;
  }, [draft.coverUrl, draft.usePrimaryMediaAsCover, primaryMedia?.media_url, workType]);

  const handleUploadConfirm = (items: PublishWorkDraft['mediaList']) => {
    if (mediaLocked && uploadTarget === 'work') return;

    if (uploadTarget === 'cover') {
      onDraftChange({ coverUrl: items[0]?.media_url || '', usePrimaryMediaAsCover: false });
      return;
    }

    onDraftChange({ mediaList: items });
  };

  const handleEditCover = () => {
    if (!coverCropSource) {
      toast.warning('请先上传作品内容');
      return;
    }

    setCoverCropOpen(true);
  };

  const handleCoverCropConfirm = (result: CoverCropResult) => {
    onDraftChange({
      coverUrl: result.coverUrl,
      usePrimaryMediaAsCover: false,
    });
  };

  return (
    <div className='space-y-6'>
      <section className='space-y-3'>
        <h3 className='text-sm font-semibold text-white'>作品上传</h3>
        <div className='relative'>
          {primaryMedia ? (
            workType === 'IMAGE' ? (
              <ImageWorkUploadArea
                mediaList={draft.mediaList}
                readonly={mediaLocked}
                onMediaListChange={mediaList => onDraftChange({ mediaList })}
                onAddClick={() => {
                  if (!mediaLocked) setUploadTarget('work');
                }}
              />
            ) : (
              <div className='relative aspect-video w-full overflow-hidden rounded-md bg-black/45'>
                <video src={primaryMedia.media_url} className='h-full w-full object-cover' muted />
                {!mediaLocked && (
                  <button
                    type='button'
                    className='absolute right-3 top-3 inline-flex h-8 items-center gap-1 rounded-md bg-black/45 px-3 text-xs text-white backdrop-blur-sm'
                    onClick={() => setUploadTarget('work')}
                  >
                    <UploadCloud className='h-3.5 w-3.5' />
                    重新选择
                  </button>
                )}
              </div>
            )
          ) : (
            <button
              type='button'
              className='flex aspect-video w-full flex-col items-center justify-center rounded-md bg-black/45 text-center text-white transition-colors hover:bg-black/90 disabled:cursor-not-allowed disabled:opacity-70'
              disabled={mediaLocked}
              onClick={() => setUploadTarget('work')}
            >
              {workType === 'IMAGE' ? <ImagePlus className='mb-4 h-8 w-8 text-white/85' /> : <VideoIcon className='mb-4 h-8 w-8 text-white/85' />}
              <span className='text-base font-semibold'>{uploadCopy.title}</span>
              <span className='mt-2 whitespace-pre-line text-sm leading-5 text-white/45'>{uploadCopy.description}</span>
            </button>
          )}
          {mediaLocked && (
            <div className='pointer-events-auto absolute inset-0 flex items-center justify-center rounded-md bg-black/45 text-sm font-semibold text-white/85 backdrop-blur-[1px]'>
              作品内容不可修改
            </div>
          )}
        </div>
      </section>

      <section className='space-y-3'>
        <div className='flex items-center gap-3'>
          <h3 className='text-sm font-semibold text-white'>封面上传</h3>
          <label className='flex cursor-pointer select-none items-center gap-2 text-xs text-white/72'>
            <input
              type='checkbox'
              className='h-3.5 w-3.5 accent-[#4155ff]'
              checked={draft.usePrimaryMediaAsCover}
              onChange={event => onDraftChange({ usePrimaryMediaAsCover: event.target.checked })}
            />
            {primaryCoverLabel}
          </label>
        </div>

        <div className='group relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-md bg-black/45'>
          {coverUrl ? (
            <>
              <img src={coverUrl} alt='封面预览' className='h-full w-full object-cover' />
              <div className='pointer-events-none absolute inset-0 bg-black/45 opacity-0 transition-opacity duration-200 group-hover:opacity-100' />
              <button
                type='button'
                className='absolute right-3 top-3 inline-flex h-8 items-center gap-1 rounded-md bg-black/55 px-3 text-xs text-white opacity-0 backdrop-blur-sm transition-opacity duration-200 group-hover:opacity-100 focus-visible:opacity-100'
                onClick={handleEditCover}
              >
                <PenLine className='h-3.5 w-3.5' />
                编辑封面
              </button>
              <button
                type='button'
                className='absolute inline-flex flex-col items-center gap-2 text-sm font-semibold text-white opacity-0 transition-opacity duration-200 group-hover:opacity-100 focus-visible:opacity-100'
                onClick={() => setUploadTarget('cover')}
              >
                <UploadCloud className='h-8 w-8' />
                重新上传
              </button>
            </>
          ) : (
            <button type='button' className='inline-flex flex-col items-center gap-2 text-sm font-semibold text-white/75' onClick={() => setUploadTarget('cover')}>
              <UploadCloud className='h-8 w-8' />
              上传封面
            </button>
          )}
        </div>
      </section>

      {uploadTarget && (
        <CommunityMediaUploadDialog
          open={Boolean(uploadTarget)}
          target={uploadTarget}
          workType={workType}
          selectedMediaList={uploadTarget === 'work' ? draft.mediaList : []}
          selectedCoverUrl={uploadTarget === 'cover' ? draft.coverUrl : ''}
          onOpenChange={open => {
            if (!open) setUploadTarget(null);
          }}
          onConfirm={handleUploadConfirm}
        />
      )}

      <CoverCropDialog open={coverCropOpen} source={coverCropSource} onOpenChange={setCoverCropOpen} onConfirm={handleCoverCropConfirm} />
    </div>
  );
}
