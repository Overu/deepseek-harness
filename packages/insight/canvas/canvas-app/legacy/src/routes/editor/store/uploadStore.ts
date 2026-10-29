import { create } from 'zustand';

export type UploadStatus = 'idle' | 'uploading' | 'success' | 'error';

interface UploadState {
  status: UploadStatus;
  message: string;
  setUploadStatus: (status: UploadStatus, message?: string) => void;
  reset: () => void;
}

export const useUploadStore = create<UploadState>(set => ({
  status: 'idle',
  message: '',
  setUploadStatus: (status, message = '') => set({ status, message }),
  reset: () => set({ status: 'idle', message: '' }),
}));
