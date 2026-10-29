import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { LoaderCircle, X } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createExternalTask, queryExternalTaskResult } from '@/api/tool';
import { syncCanvasVersionNumber } from '@/store/flowStore';
import type { CharacterInfo } from './types';
import { EMPTY_CHARACTER_INFO } from './types';

const POLL_INTERVAL_MS = 3000;

/** bbox: [minX, minY, maxX, maxY] */
const cropCharacterAvatar = async (imageUrl: string, bbox: number[]): Promise<string> => {
  const [minX, minY, maxX] = bbox;
  const diameter = maxX - minX;
  const cx = minX + diameter / 2;
  const cy = minY + diameter / 2;
  const radius = diameter / 2;

  const img = await loadImage(imageUrl);
  const canvas = document.createElement('canvas');
  const size = 64;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();

  const sx = cx - radius;
  const sy = cy - radius;
  ctx.drawImage(img, sx, sy, diameter, diameter, 0, 0, size, size);
  return canvas.toDataURL('image/png');
};

const loadImage = (url: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });

const getCharacterName = (index: number) => `角色${index + 1}`;

const hasCharacterResult = (result: unknown) => {
  if (!result || typeof result !== 'object') return false;
  const r = result as { maskUrls?: unknown; bboxInfo?: unknown };
  return Array.isArray(r.maskUrls) && r.maskUrls.length > 0 && Array.isArray(r.bboxInfo) && r.bboxInfo.length > 0;
};

const buildContextQuery = (canvasId: string, nodeId: string, imageUrl: string) => ({
  canvasId,
  nodeId,
  data: { imageUrlList: [imageUrl] },
});

interface UseCharacterSearchOptions {
  canvasId: string;
  nodeId: string;
  imageUrl: string;
  mode: string;
  characterInfo: CharacterInfo | undefined;
  onUpdateCharacterInfo: (info: CharacterInfo, selectedIndexes?: number[]) => void;
}

export const useCharacterSearch = ({ canvasId, nodeId, imageUrl, mode, characterInfo, onUpdateCharacterInfo }: UseCharacterSearchOptions) => {
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runningRef = useRef(false);
  const cancelledRef = useRef(false);
  const characterInfoRef = useRef(characterInfo);
  const onUpdateRef = useRef(onUpdateCharacterInfo);

  characterInfoRef.current = characterInfo;
  onUpdateRef.current = onUpdateCharacterInfo;

  const clearPoll = useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const applySuccess = useCallback((targetImageUrl: string, result: { maskUrls: string[]; bboxInfo: number[][] }) => {
    onUpdateRef.current(
      {
        imageUrl: targetImageUrl,
        status: 'success',
        maskUrls: result.maskUrls,
        bboxInfo: result.bboxInfo,
        selectedIndexes: [0],
      },
      [0]
    );
  }, []);

  const queryByContext = useCallback(
    async (targetImageUrl: string) => {
      return queryExternalTaskResult(buildContextQuery(canvasId, nodeId, targetImageUrl));
    },
    [canvasId, nodeId]
  );

  const pollByContext = useCallback(
    async (targetImageUrl: string) => {
      if (cancelledRef.current) return;

      try {
        const { code, data }: any = await queryByContext(targetImageUrl);
        syncCanvasVersionNumber(canvasId, data?.versionNumber);
        if (cancelledRef.current) return;

        if (code !== 'SUCCESS' || !data) {
          onUpdateRef.current({ imageUrl: targetImageUrl, status: 'failure', errorMsg: '查询角色识别结果失败' });
          runningRef.current = false;
          return;
        }

        if (data.status === 'SUCCESS' && hasCharacterResult(data.result)) {
          applySuccess(targetImageUrl, data.result);
          runningRef.current = false;
          return;
        }

        if (data.status === 'RUNNING') {
          pollTimerRef.current = setTimeout(() => pollByContext(targetImageUrl), POLL_INTERVAL_MS);
          return;
        }

        onUpdateRef.current({
          imageUrl: targetImageUrl,
          status: 'failure',
          errorMsg: data.message || '角色识别失败',
        });
        runningRef.current = false;
      } catch {
        if (!cancelledRef.current) {
          onUpdateRef.current({ imageUrl: targetImageUrl, status: 'failure', errorMsg: '角色识别失败' });
        }
        runningRef.current = false;
      }
    },
    [queryByContext, applySuccess, canvasId]
  );

  const createSearchTask = useCallback(
    async (targetImageUrl: string) => {
      const createRes: any = await createExternalTask({
        type: 'SEARCH_CHARACTER',
        canvasId,
        nodeId,
        data: { imageUrlList: [targetImageUrl] },
      });
      syncCanvasVersionNumber(canvasId, createRes.data?.versionNumber);

      if (cancelledRef.current) return;

      if (createRes.code !== 'SUCCESS') {
        onUpdateRef.current({ imageUrl: targetImageUrl, status: 'failure', errorMsg: createRes.msg || '角色识别任务创建失败' });
        runningRef.current = false;
        return;
      }

      pollTimerRef.current = setTimeout(() => pollByContext(targetImageUrl), POLL_INTERVAL_MS);
    },
    [canvasId, nodeId, pollByContext]
  );

  const startSearch = useCallback(async () => {
    if (!imageUrl || !canvasId || !nodeId) return;

    const cached = characterInfoRef.current;
    if (cached?.imageUrl === imageUrl && cached.status === 'success') {
      return;
    }
    if (runningRef.current) return;

    runningRef.current = true;
    cancelledRef.current = false;
    clearPoll();
    onUpdateRef.current({ imageUrl, status: 'loading' });

    try {
      const { code, data }: any = await queryByContext(imageUrl);
      if (cancelledRef.current) return;

      if (code !== 'SUCCESS') {
        onUpdateRef.current({ imageUrl, status: 'failure', errorMsg: '查询角色识别结果失败' });
        runningRef.current = false;
        return;
      }

      if (data?.status === 'SUCCESS' && hasCharacterResult(data.result)) {
        applySuccess(imageUrl, data.result);
        runningRef.current = false;
        return;
      }

      const hasTaskId = Boolean(data?.taskId);

      if (!hasTaskId) {
        await createSearchTask(imageUrl);
        return;
      }

      if (data.status === 'RUNNING') {
        pollTimerRef.current = setTimeout(() => pollByContext(imageUrl), POLL_INTERVAL_MS);
        return;
      }

      onUpdateRef.current({
        imageUrl,
        status: 'failure',
        errorMsg: data.message || '角色识别失败',
      });
      runningRef.current = false;
    } catch {
      if (!cancelledRef.current) {
        onUpdateRef.current({ imageUrl, status: 'failure', errorMsg: '角色识别失败' });
      }
      runningRef.current = false;
    }
  }, [canvasId, nodeId, imageUrl, clearPoll, queryByContext, applySuccess, createSearchTask, pollByContext]);

  useEffect(() => {
    if (mode !== 'multiple' || !imageUrl) {
      cancelledRef.current = true;
      clearPoll();
      runningRef.current = false;
      return;
    }

    const cached = characterInfoRef.current;
    if (cached?.imageUrl === imageUrl && cached.status === 'success') {
      return;
    }

    cancelledRef.current = false;
    startSearch();

    return () => {
      cancelledRef.current = true;
      clearPoll();
      runningRef.current = false;
    };
  }, [mode, imageUrl, canvasId, nodeId, startSearch, clearPoll]);

  useEffect(
    () => () => {
      cancelledRef.current = true;
      clearPoll();
    },
    [clearPoll]
  );

  return { characterInfo: characterInfo || EMPTY_CHARACTER_INFO };
};

interface CharacterMultiSelectProps {
  characterInfo: CharacterInfo;
  imageUrl: string;
  value: number[];
  onChange: (indexes: number[]) => void;
}

export const CharacterMultiSelect = memo(({ characterInfo, imageUrl, value, onChange }: CharacterMultiSelectProps) => {
  const [open, setOpen] = useState(false);
  const [avatars, setAvatars] = useState<Record<number, string>>({});

  const count = characterInfo.bboxInfo?.length ?? 0;
  const isLoading = characterInfo.status === 'loading';

  useEffect(() => {
    if (!imageUrl || !characterInfo.bboxInfo?.length) {
      setAvatars({});
      return;
    }
    let cancelled = false;
    const load = async () => {
      const next: Record<number, string> = {};
      await Promise.all(
        characterInfo.bboxInfo!.map(async (bbox, index) => {
          try {
            next[index] = await cropCharacterAvatar(imageUrl, bbox);
          } catch {
            next[index] = '';
          }
        })
      );
      if (!cancelled) setAvatars(next);
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [imageUrl, characterInfo.bboxInfo]);

  const triggerLabel = useMemo(() => {
    if (isLoading) return null;
    if (!value.length) return '选择角色';
    if (value.length === 1) return getCharacterName(value[0]);
    return `${value.length}个角色`;
  }, [value, isLoading]);

  const triggerAvatarIndex = value.length > 0 ? value[0] : null;
  const triggerAvatarUrl = triggerAvatarIndex !== null ? avatars[triggerAvatarIndex] : undefined;

  if (isLoading) {
    return (
      <div className='flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 text-white/65 text-sm'>
        <LoaderCircle size={14} className='animate-spin' />
        <span>检测角色中...</span>
      </div>
    );
  }

  if (characterInfo.status === 'failure') {
    return (
      <div className='flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 text-white/65 text-sm'>
        <span className='flex items-center justify-center w-4 h-4 rounded-full bg-[#F87171] shrink-0'>
          <X size={10} className='text-white' strokeWidth={3} />
        </span>
        <span>识别失败，请更换图片</span>
      </div>
    );
  }

  if (characterInfo.status !== 'success' || count === 0) {
    return null;
  }

  const toggleIndex = (index: number) => {
    if (value.includes(index)) {
      onChange(value.filter(i => i !== index));
    } else {
      onChange([...value, index].sort((a, b) => a - b));
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type='button' className='flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 text-white text-sm hover:bg-white/10 max-w-[140px]'>
          {triggerAvatarIndex !== null &&
            (triggerAvatarUrl ? (
              <img src={triggerAvatarUrl} alt='' className='w-5 h-5 rounded-full object-cover shrink-0' />
            ) : (
              <div className='w-5 h-5 rounded-full bg-white/10 shrink-0' />
            ))}
          <span className='truncate'>{triggerLabel}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className='w-48 p-2 bg-[#262626] border-white/10 nodrag' align='start'>
        <div className='flex flex-col gap-1'>
          {Array.from({ length: count }).map((_, index) => (
            <label key={index} className='flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-white/5 cursor-pointer'>
              <Checkbox checked={value.includes(index)} onCheckedChange={() => toggleIndex(index)} />
              {avatars[index] ? <img src={avatars[index]} alt='' className='w-7 h-7 rounded-full object-cover' /> : <div className='w-7 h-7 rounded-full bg-white/10' />}
              <span className='text-sm text-white'>{getCharacterName(index)}</span>
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
});

CharacterMultiSelect.displayName = 'CharacterMultiSelect';
