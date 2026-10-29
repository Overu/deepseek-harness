import React, { useState, useRef, useCallback } from 'react';
import type { Editor } from '@tiptap/react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { OpenDialogInjectedProps } from '@/components/globalDialog';
import { TextNodeToolbar } from './TextNodeToolbar';
import { RichTextEditor } from '../../components/richText/RichTextEditor';
import { toast } from 'sonner';

export interface TextEditModalProps {
  title?: string;
  initialValue: string;
  onUpdateValue?: (value: string) => void;
}

export const TextEditModal: React.FC<TextEditModalProps & OpenDialogInjectedProps<string>> = ({ title = '文本', initialValue, onUpdateValue, resolve }) => {
  const [open, setOpen] = useState(true);
  const [editor, setEditor] = useState<Editor | null>(null);
  const currentValueRef = useRef(initialValue);
  const settledRef = useRef(false);

  const handleClose = useCallback(() => {
    if (settledRef.current) return;
    settledRef.current = true;
    setOpen(false);
    resolve(currentValueRef.current);
  }, [resolve]);

  const handleChange = useCallback(
    (markdown: string) => {
      currentValueRef.current = markdown;
      onUpdateValue?.(markdown);
    },
    [onUpdateValue]
  );

  const handleCopyContent = useCallback(async () => {
    try {
      const textToCopy = currentValueRef.current || '';
      await navigator.clipboard.writeText(textToCopy);
      toast.success('已复制内容到剪贴板');
    } catch {
      toast.error('复制失败');
    }
  }, []);

  return (
    <Dialog open={open} onOpenChange={nextOpen => !nextOpen && handleClose()}>
      <DialogContent
        className='flex flex-col h-[min(85dvh,640px)] w-[min(92vw,860px)] max-w-none overflow-hidden rounded-2xl border border-white/10 bg-[#262626] p-0 shadow-2xl [&>button]:hidden'
        overlayClassName='bg-black/60 backdrop-blur-xs'
      >
        {/* 顶部标题与工具栏 */}
        <DialogHeader className='flex flex-row items-center justify-between border-b border-white/10 px-5 py-3 space-y-0'>
          <DialogTitle className='text-sm sm:text-base font-semibold text-white/90 truncate max-w-[200px]'>{title}</DialogTitle>
          <div className='flex items-center gap-2'>
            <TextNodeToolbar editor={editor} mode='modal' onCopyContent={handleCopyContent} onCloseModal={handleClose} />
          </div>
        </DialogHeader>

        {/* 主体富文本编辑区 */}
        <div className='flex-1 min-h-0 overflow-y-auto px-4 py-3 bg-[#1e1e1e]'>
          <RichTextEditor value={initialValue} onChange={handleChange} onEditorReady={setEditor} autoFocus className='min-h-full text-base' placeholder='请输入文本内容...' />
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default TextEditModal;
