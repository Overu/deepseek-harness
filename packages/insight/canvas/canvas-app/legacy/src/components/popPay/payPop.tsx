import { openDialog } from '@/components/globalDialog';
import { PayDialog, type PayDialogProps } from './PayDialog';

// 定义弹窗配置类型（保持类型安全）
export interface GlobalDialogOptions {
  title?: string;
  type?: string;
  fullScreen?: boolean;
  insufficientPoints?: boolean;
  description?: string;
  cancelText?: string;
  confirmText?: string;
  onConfirm?: () => void;
  onCancel?: () => void;
}

let closeCurrentDialog: (() => void) | null = null;

const registerClose = (close: () => void) => {
  closeCurrentDialog = close;

  return () => {
    if (closeCurrentDialog === close) {
      closeCurrentDialog = null;
    }
  };
};

export const closeGlobalDialog = () => {
  closeCurrentDialog?.();
};

// 全局调用方法（核心）
export const openGlobalDialog = (options: GlobalDialogOptions): Promise<boolean> => {
  // 先关闭已有支付弹窗（保持原来的单例语义）
  closeGlobalDialog();

  return openDialog<PayDialogProps, boolean>(PayDialog, { options, registerClose }).catch(() => false);
};
