import { useState, useRef, useCallback } from 'react';
import { uploadFile } from '@/services/upload/uploadFile';
import fileUtil from '@/utils/file';
import { toast } from 'sonner';
import { useUploadStore } from '../store/uploadStore';
import { useEditorEngine } from './useEditorEngine';

const { isValidFileType } = fileUtil;

export type UploadStatus = 'idle' | 'uploading' | 'done' | 'error';

interface ImageUploadState {
  status: UploadStatus;
  progress: number;
  previewUrl: string | null;
}

interface UseImageUploadOptions {
  maxSizeMB?: number;
  accept?: string;
}

export function useImageUpload(options: UseImageUploadOptions = {}) {
  const { maxSizeMB = 20, accept = 'image/*' } = options;
  const engine = useEditorEngine();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { setUploadStatus } = useUploadStore();

  const [state, setState] = useState<ImageUploadState>({
    status: 'idle',
    progress: 0,
    previewUrl: null,
  });

  // 校验文件
  const validateFile = useCallback(
    (file: File): boolean => {
      // 检查文件大小
      const isLtSize = file.size / 1024 / 1024 < maxSizeMB;
      if (!isLtSize) {
        toast.error(`文件大小不能超过 ${maxSizeMB}MB!`);
        return false;
      }

      // 检查文件类型
      if (!isValidFileType(file, accept)) {
        toast.error(`只允许上传图片类型的文件!`);
        return false;
      }

      return true;
    },
    [maxSizeMB, accept]
  );

  // 上传并添加图片到画布
  const uploadAndAddToCanvas = useCallback(
    async (file: File) => {
      if (!validateFile(file)) {
        return;
      }

      // 创建本地预览
      const previewUrl = URL.createObjectURL(file);
      setState({
        status: 'uploading',
        progress: 0,
        previewUrl,
      });

      // 模拟进度条
      let progress = 0;
      const maxProgress = 99;
      const interval = setInterval(() => {
        const increment = Math.floor(Math.random() * 3) + 1;
        progress = Math.min(progress + increment, maxProgress);
        setState(prev => ({ ...prev, progress }));
      }, 200);

      setUploadStatus('uploading', '正在上传中...');

      try {
        // 上传图片
        const imageUrl = (await uploadFile(file)).url;

        clearInterval(interval);

        if (imageUrl) {
          // 添加图片到画布
          await engine.addImage(imageUrl);

          setState({
            status: 'done',
            progress: 100,
            previewUrl: null,
          });

          // 清理预览 URL
          URL.revokeObjectURL(previewUrl);

          // 重置状态
          setTimeout(() => {
            setState({
              status: 'idle',
              progress: 0,
              previewUrl: null,
            });
          }, 500);

          setUploadStatus('success', '上传成功');
        } else {
          throw new Error('上传失败');
        }
      } catch (error) {
        clearInterval(interval);
        URL.revokeObjectURL(previewUrl);

        setState({
          status: 'error',
          progress: 0,
          previewUrl: null,
        });

        setUploadStatus('error', '图片上传失败');
      }
    },
    [engine, validateFile]
  );

  // 处理文件选择
  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) {
        uploadAndAddToCanvas(files[0]);
      }
      // 重置 input 以允许选择相同文件
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    },
    [uploadAndAddToCanvas]
  );

  // 触发文件选择
  const triggerUpload = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  // 重置状态
  const reset = useCallback(() => {
    if (state.previewUrl) {
      URL.revokeObjectURL(state.previewUrl);
    }
    setState({
      status: 'idle',
      progress: 0,
      previewUrl: null,
    });
  }, [state.previewUrl]);

  return {
    fileInputRef,
    state,
    handleFileSelect,
    triggerUpload,
    reset,
    accept,
  };
}
