import { openDialog } from '@/components/globalDialog';
import { MessageCenterDialog, type MessageCenterDialogProps } from './MessageCenterDialog';

export function openMessageCenterDialog(props?: MessageCenterDialogProps) {
  return openDialog<MessageCenterDialogProps, void>(MessageCenterDialog, props).catch(() => undefined);
}
