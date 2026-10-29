import { createRoot } from 'react-dom/client';
// 确保组件引入正确（默认导出，直接引入即可，无需额外类型处理）
// import PointInsufficientDialog from '@/components/popPay/PointInsufficientDialog';
import { usePointStore } from '@/store/pointStore';
import { openGlobalDialog } from '@/components/popPay/payPop';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { PAYMENT_CONTENT_Z_INDEX, PAYMENT_LAYER_Z_INDEX, PAYMENT_OVERLAY_Z_INDEX } from './payLayer';

// 全局弹窗状态
interface PointDialogState {
  open: boolean;
  costPoint: number;
}

interface PointInsufficientDialogProps {
  open: boolean;
  onClose: () => void;
}

let dialogState: PointDialogState = {
  open: false,
  costPoint: 500,
};
// 明确类型注解，避免 TS 推断歧义
let dialogRoot: ReturnType<typeof createRoot> | null = null;
let dialogContainer: HTMLDivElement | null = null;

// eslint-disable-next-line react-refresh/only-export-components
const PointInsufficientDialog = ({ open, onClose }: PointInsufficientDialogProps) => {
  const { point, needPoint } = usePointStore(state => state);

  const handleRecharge = () => {
    dialogState.open = false;
    destroyPointDialog();
    requestAnimationFrame(() => {
      openGlobalDialog({ type: 'subscription' });
    });
  };

  // 弹窗关闭时同步清理 DOM
  const handleDialogClose = () => {
    onClose();
  };

  return (
    <AlertDialog open={open} onOpenChange={handleDialogClose}>
      <AlertDialogContent
        data-payment-layer='true'
        overlayProps={{ 'data-payment-layer': 'true' }}
        overlayStyle={{ zIndex: PAYMENT_OVERLAY_Z_INDEX }}
        style={{ zIndex: PAYMENT_CONTENT_Z_INDEX }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>赛点余额不足，无法发起任务</AlertDialogTitle>
          <AlertDialogDescription>
            您的账户余额为<span className='text-[#4155f0]'>{point}</span>赛点，本次任务预估消耗
            <span className='text-[#4155f0]'>{needPoint}</span>赛点，请先充值
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={handleDialogClose}>取消</AlertDialogCancel>
          <AlertDialogAction className='bg-[#4155f0]/80 text-white hover:bg-[#4155f0]' onClick={handleRecharge}>
            好的，去充值
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

// 创建弹窗 DOM 容器
function createDialogContainer() {
  if (dialogContainer) return dialogContainer;

  dialogContainer = document.createElement('div');
  dialogContainer.style.position = 'fixed';
  dialogContainer.dataset.paymentLayer = 'true';
  dialogContainer.style.zIndex = String(PAYMENT_LAYER_Z_INDEX);
  document.body.appendChild(dialogContainer);
  return dialogContainer;
}

// 渲染弹窗（此处是运行时调用组件，无类型问题）
function renderDialog() {
  if (!dialogContainer) dialogContainer = createDialogContainer();
  if (!dialogRoot) dialogRoot = createRoot(dialogContainer);

  // 重点：这里是运行时渲染组件（值的使用），TS 不会报错
  dialogRoot.render(
    <PointInsufficientDialog
      open={dialogState.open}
      onClose={() => {
        dialogState.open = false;
        renderDialog();
      }}
    />
  );
}

// 暴露的公共方法
export function openPointInsufficientDialog(costPoint = 500) {
  dialogState = {
    open: true,
    costPoint,
  };
  renderDialog();
}

export function closePointInsufficientDialog() {
  dialogState.open = false;
  renderDialog();
}

export function destroyPointDialog() {
  if (dialogRoot) {
    dialogRoot.unmount();
    dialogRoot = null;
  }
  if (dialogContainer && dialogContainer.parentNode) {
    document.body.removeChild(dialogContainer);
    dialogContainer = null;
  }
}
