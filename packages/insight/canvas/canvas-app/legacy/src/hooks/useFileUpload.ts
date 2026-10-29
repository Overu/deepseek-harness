import { getCanvasViewBinding } from '../../../src/canvas-service-binding';
import { markAgentEditorBusy } from '../../../src/agent-edit-guard';
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import { getFileType } from '@/utils/index';
import fileUtil from '@/utils/file';
import { getStagedProgressIncrement } from '@/utils/stagedProgress';
import { syncCanvasUploadToAssetLibrary, type CanvasAssetMediaType } from '@/components/canvasFlow/utils/canvasAssetSync';
import { uploadFile } from '@/services/upload/uploadFile';
import { UploadError } from '../../../../src/shared/upload/errors.ts';
import { getMediaDuration } from '@/services/upload/mediaMetadata';

const { isValidFileType } = fileUtil;

/** 音频仅允许 mp3 / wav / m4a / aac（扩展名 + 常见 MIME） */
export const AUDIO_ACCEPT = '.mp3,.wav,.m4a,.aac,audio/mpeg,audio/mp3,audio/wav,audio/wave,audio/x-wav,audio/mp4,audio/x-m4a,audio/m4a,audio/aac,audio/x-aac';

/** 视频最大时长（秒），含边界：恰好 5:00 允许 */
export const VIDEO_MAX_DURATION_SECONDS = 5 * 60;

export const getVideoDuration = async (file: File): Promise<number> => {
  const duration = await getMediaDuration(file);
  if (duration === undefined) {
    throw new Error('无法读取视频时长');
  }
  return duration;
};

export type UploadMediaType = 'audio' | 'video' | 'image';

const UPLOAD_ACCEPT_MAP: Record<UploadMediaType, string> = {
  audio: AUDIO_ACCEPT,
  video: 'video/*',
  image: 'image/*',
};

export const resolveUploadMediaType = (file: File): UploadMediaType | null => {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'audio';
  const byName = getFileType(file.name);
  if (byName === 'image' || byName === 'video' || byName === 'audio') return byName;
  return null;
};

export const isAvifFile = (file: File) => file.type === 'image/avif' || file.name.toLowerCase().endsWith('.avif');

/** 仅判断文件是否允许上传（不含大小限制与 toast） */
export const isAllowedUploadFile = (type: UploadMediaType, file: File): boolean => {
  if (type === 'image' && isAvifFile(file)) return false;
  return isValidFileType(file, UPLOAD_ACCEPT_MAP[type]);
};

export const UNSUPPORTED_MEDIA_FILE_TOAST = '暂不支持该格式文件';

export type UploadFileValidationResult = { valid: true } | { valid: false; message: string };

const DEFAULT_MAX_SIZE_MAP: Record<UploadMediaType, number> = {
  audio: 20,
  video: 200,
  image: 20,
};

const formatDurationLimit = (seconds: number) => {
  if (seconds % 60 === 0) {
    return `${seconds / 60}分钟`;
  }
  return `${seconds}秒`;
};

const isAcceptedFileExtension = (fileName: string, acceptedExtensions?: readonly string[]) => {
  if (!acceptedExtensions?.length) return true;

  const normalizedFileName = fileName.toLowerCase();
  return acceptedExtensions.some(extension => {
    const normalizedExtension = extension.toLowerCase();
    return normalizedFileName.endsWith(normalizedExtension.startsWith('.') ? normalizedExtension : `.${normalizedExtension}`);
  });
};

/** 校验媒体文件是否允许上传（不含 toast，供画布替换前预检复用） */
export const validateUploadFile = async (
  type: UploadMediaType,
  file: File,
  options?: { maxSize?: number; maxDuration?: number | null; acceptedExtensions?: readonly string[] }
): Promise<UploadFileValidationResult> => {
  const maxSize = options?.maxSize ?? DEFAULT_MAX_SIZE_MAP[type];
  const maxDuration = options?.maxDuration === undefined ? VIDEO_MAX_DURATION_SECONDS : options.maxDuration;

  if (file.size / 1024 / 1024 >= maxSize) {
    return { valid: false, message: `文件大小不能超过 ${maxSize}MB!` };
  }

  if (type === 'image' && isAvifFile(file)) {
    return { valid: false, message: '暂不支持上传 AVIF 格式图片，请转换为 PNG/JPG 等格式后重试。' };
  }

  if (options?.acceptedExtensions?.length && !isAcceptedFileExtension(file.name, options.acceptedExtensions)) {
    const formats = options.acceptedExtensions.map(extension => extension.replace(/^\./, '')).join('、');
    return { valid: false, message: `只允许上传 ${formats} 格式的文件` };
  }

  if (!options?.acceptedExtensions?.length && !isAllowedUploadFile(type, file)) {
    const typeErrorMsg = type === 'audio' ? '只允许上传 mp3、wav、m4a、aac 格式的音频文件' : `只允许上传 ${UPLOAD_ACCEPT_MAP[type]} 类型的文件!`;
    return { valid: false, message: typeErrorMsg };
  }

  if (type === 'video' && maxDuration !== null) {
    try {
      const duration = await getVideoDuration(file);
      if (duration > maxDuration) {
        return { valid: false, message: `视频时长不能超过${formatDurationLimit(maxDuration)}` };
      }
    } catch {
      return { valid: false, message: '无法读取视频时长，请确认文件是否有效' };
    }
  }

  return { valid: true };
};

/** 拆分合法/非法媒体文件，供画布拖拽与粘贴复用 */
export const partitionUploadMediaFiles = (files: File[]) => {
  const valid: File[] = [];
  let hasRejected = false;
  for (const file of files) {
    const type = resolveUploadMediaType(file);
    if (type && isAllowedUploadFile(type, file)) {
      valid.push(file);
    } else {
      hasRejected = true;
    }
  }
  return { valid, hasRejected };
};

export interface MediaFile {
  file: File;
  url?: string;
  preview?: string;
  progress?: number;
  status: 'preview' | 'uploading' | 'done' | 'error';
}

export interface UploadSuccessMeta {
  file: File;
  preview?: string;
  duration?: number;
}

interface UseFileUploadOptions {
  type: 'audio' | 'video' | 'image' | 'text' | string;
  uploading?: boolean;
  tempFile?: File;
  maxSize?: number;
  maxDuration?: number | null;
  acceptedExtensions?: readonly string[];
  onUploadSuccess?: (url: string, meta?: UploadSuccessMeta) => void;
  updateUploading?: (uploading: boolean) => void;
  assetLibrarySync?: { nodeId: string };
}

const useFileUpload = ({ type, uploading, tempFile, maxSize, maxDuration, acceptedExtensions, onUploadSuccess, updateUploading, assetLibrarySync }: UseFileUploadOptions) => {
  const [mediaFile, setMediaFile] = useState<MediaFile | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const uploadAbortControllerRef = useRef<AbortController | null>(null);

  const clearProgressInterval = useCallback(() => {
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }
  }, []);

  // 1. 使用 useMemo 稳定配置对象，避免 handleFileSelect 频繁更新
  const acceptConfig = useMemo(() => {
    const config: Record<string, { accept: string; maxSize: number; maxDuration?: number | null }> = {
      audio: { accept: AUDIO_ACCEPT, maxSize: maxSize || 20 },
      video: {
        accept: acceptedExtensions?.join(',') || 'video/*',
        maxSize: maxSize || 200,
        maxDuration: maxDuration === undefined ? VIDEO_MAX_DURATION_SECONDS : maxDuration,
      },
      image: { accept: 'image/*', maxSize: maxSize || 20 },
      text: { accept: '*', maxSize: maxSize || 20 },
    };
    return config[type] || { accept: '*', maxSize: maxSize || 20 };
  }, [type, maxSize, maxDuration, acceptedExtensions]);

  const selectionMarker = useRef(`upload-selection:${crypto.randomUUID()}`).current;
  const detachedRef = useRef(false);
  // 2. 稳定 handleFileSelect
  const handleFileSelect = useCallback(
    async (file: File) => {
      if (detachedRef.current) return;
      let accepted = false;
      markAgentEditorBusy(selectionMarker, true);
      try {
      const isMediaType = type === 'audio' || type === 'video' || type === 'image';
      if (isMediaType) {
        const validation = await validateUploadFile(type, file, {
          maxSize: acceptConfig.maxSize,
          maxDuration: acceptConfig.maxDuration,
          acceptedExtensions,
        });
        if (!validation.valid) {
          toast.error(validation.message);
          return;
        }
      } else if (!isValidFileType(file, acceptConfig.accept)) {
        toast.error(`只允许上传 ${acceptConfig.accept} 类型的文件!`);
        return;
      }

      if (detachedRef.current) return;
      const newFile: MediaFile = {
        file,
        status: 'preview',
      };

      if (file.type.startsWith('image/')) {
        newFile.preview = URL.createObjectURL(file);
      }

      accepted = true;
      setMediaFile(newFile);
      } finally { if (!accepted) markAgentEditorBusy(selectionMarker, false); }
    },
    [acceptConfig, acceptedExtensions, type]
  );

  // 3. 核心修复：handleAutoUpload 不再直接依赖 mediaFile 变量
  const handleAutoUpload = useCallback(
    async (targetFile: File) => {
      clearProgressInterval();
      uploadAbortControllerRef.current?.abort();
      const abortController = new AbortController();
      uploadAbortControllerRef.current = abortController;
      const activityId = `upload:${assetLibrarySync?.nodeId ?? 'canvas'}:${crypto.randomUUID()}`;
      markAgentEditorBusy(activityId, true);
      markAgentEditorBusy(selectionMarker, false);
      const removeCleanup = getCanvasViewBinding()?.onRelease(() => abortController.abort());
      updateUploading?.(true);

      // 立即更新状态为上传中，进度从 0 开始
      setMediaFile(prev => (prev ? { ...prev, status: 'uploading', progress: 0 } : null));

      try {
        // 模拟进度条：使用函数式更新，确保不依赖外部 mediaFile
        progressIntervalRef.current = setInterval(() => {
          setMediaFile(prev => {
            if (!prev || prev.status !== 'uploading') return prev;
            const increment = getStagedProgressIncrement(prev.progress || 0, 95);
            const nextProgress = Math.min((prev.progress || 0) + increment, 95);
            return { ...prev, progress: nextProgress };
          });
        }, 30);

        const fileType = getFileType(targetFile.name);
        if (fileType !== 'video' && fileType !== 'audio' && fileType !== 'image') {
          throw new Error('Unsupported file type');
        }
        const result = await uploadFile(targetFile, {
          signal: abortController.signal,
        });
        const url = result.url;
        const duration = fileType === 'video' || fileType === 'audio' ? await getMediaDuration(targetFile) : undefined;

        clearProgressInterval();
        if (abortController.signal.aborted || detachedRef.current) return;

        if (url) {
          setMediaFile(prev => (prev ? { ...prev, url, progress: 100, status: 'done' } : null));
          const nodeId = assetLibrarySync?.nodeId;
          if (nodeId && (type === 'image' || type === 'video' || type === 'audio')) {
            syncCanvasUploadToAssetLibrary(url, nodeId, type as CanvasAssetMediaType, { duration: result.duration });
          }
          onUploadSuccess?.(url, {
            file: targetFile,
            preview: targetFile.type.startsWith('image/') ? URL.createObjectURL(targetFile) : undefined,
            duration,
          });
        } else {
          throw new Error('Upload failed');
        }
      } catch (error) {
        clearProgressInterval();
        setMediaFile(prev => (prev ? { ...prev, status: 'error' } : null));
        if (!(error instanceof UploadError && error.code === 'CANCELLED')) {
          toast.error(error instanceof Error ? error.message : '上传失败');
        }
      } finally {
        if (uploadAbortControllerRef.current === abortController) {
          uploadAbortControllerRef.current = null;
        }
        removeCleanup?.();
        markAgentEditorBusy(activityId, false);
        updateUploading?.(false);
      }
    },
    [clearProgressInterval, onUploadSuccess, updateUploading, assetLibrarySync, type]
  );

  // 4. 精准触发 useEffect：仅在 status 为 preview 时启动一次上传
  useEffect(() => {
    if (mediaFile?.status === 'preview' && !mediaFile.url) {
      handleAutoUpload(mediaFile.file);
    }
  }, [mediaFile?.status, mediaFile?.file, handleAutoUpload]);

  useEffect(() => {
    detachedRef.current = false;
    const cleanup = () => {
      detachedRef.current = true;
      markAgentEditorBusy(selectionMarker, false);
      clearProgressInterval(); uploadAbortControllerRef.current?.abort();
    };
    const unregister = getCanvasViewBinding()?.onRelease(cleanup);
    return () => { unregister?.(); cleanup(); };
  }, [clearProgressInterval, selectionMarker]);

  // 处理外部传入的临时文件
  useEffect(() => {
    if (tempFile) {
      handleFileSelect(tempFile);
    }
  }, [tempFile, handleFileSelect]);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files?.[0]) {
        handleFileSelect(files[0]);
      }
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    [handleFileSelect]
  );

  const handleDelete = useCallback(() => {
    markAgentEditorBusy(selectionMarker, false);
    uploadAbortControllerRef.current?.abort();
    if (mediaFile?.preview) {
      URL.revokeObjectURL(mediaFile.preview);
    }
    setMediaFile(null);
  }, [mediaFile]);

  const triggerFileInput = useCallback(() => {
    if (fileInputRef.current && !uploading && !mediaFile) {
      fileInputRef.current.click();
    }
  }, [mediaFile, uploading]);

  const handleRetry = useCallback(() => {
    if (mediaFile?.file && mediaFile.status === 'error') {
      void handleAutoUpload(mediaFile.file);
    }
  }, [mediaFile?.file, mediaFile?.status, handleAutoUpload]);

  // 拖拽逻辑保持不变，但建议包裹 useCallback
  const handleDragEvents = useMemo(
    () => ({
      handleDragEnter: (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
      },
      handleDragLeave: (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
      },
      handleDragOver: (e: React.DragEvent) => {
        e.preventDefault();
      },
      handleDrop: (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        if (e.dataTransfer.files?.[0]) handleFileSelect(e.dataTransfer.files[0]);
      },
    }),
    [handleFileSelect]
  );

  return {
    mediaFile,
    fileInputRef,
    acceptConfig,
    isDragging,
    handleInputChange,
    handleDelete,
    handleRetry,
    triggerFileInput,
    ...handleDragEvents,
  };
};

export default useFileUpload;
