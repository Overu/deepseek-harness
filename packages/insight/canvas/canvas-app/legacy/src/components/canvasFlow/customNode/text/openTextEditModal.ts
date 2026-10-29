import { openDialog } from '@/components/globalDialog';
import { TextEditModal, type TextEditModalProps } from './TextEditModal';

export function openTextEditModal(props: TextEditModalProps): Promise<string> {
  return openDialog<TextEditModalProps, string>(TextEditModal, props).catch(() => props.initialValue);
}
