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

interface Dialog {
  open: boolean;
  title: string;
  content: string;
  onConfirm: () => void;
}

interface DialogProps {
  confirmDialog: Dialog;
  closeConfirmDialog: () => void;
}

const Dialog = ({ confirmDialog, closeConfirmDialog }: DialogProps) => {
  return (
    <AlertDialog open={confirmDialog.open} onOpenChange={open => !open && closeConfirmDialog()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{confirmDialog.title}</AlertDialogTitle>
          <AlertDialogDescription>{confirmDialog.content}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={closeConfirmDialog}>取消</AlertDialogCancel>
          <AlertDialogAction onClick={confirmDialog.onConfirm}>确定</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default Dialog;
