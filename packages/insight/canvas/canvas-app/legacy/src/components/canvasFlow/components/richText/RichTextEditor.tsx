import React, { useEffect, useRef } from 'react';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import { StarterKit } from '@tiptap/starter-kit';
import { DOMParser as ProseMirrorDOMParser, DOMSerializer } from 'prosemirror-model';
import { markdownToHtml, htmlToMarkdown, isMarkdownText, hasSemanticHtml } from './markdown';
import { usePreventWheelZoom } from '@/hooks/usePreventWheelZoom';
import styles from './index.module.less';
import { cn } from '@/lib/utils';

interface RichTextEditorProps {
  value: string;
  onChange: (markdown: string) => void;
  onBlur?: () => void;
  onFocus?: () => void;
  onEditorReady?: (editor: Editor | null) => void;
  autoFocus?: boolean;
  className?: string;
  placeholder?: string;
}

export const RichTextEditor: React.FC<RichTextEditorProps> = ({ value, onChange, onBlur, onFocus, onEditorReady, autoFocus = true, className, placeholder = '请输入内容...' }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const isInternalChangeRef = useRef(false);
  const lastMarkdownRef = useRef(value || '');
  const onBlurRef = useRef(onBlur);
  const onFocusRef = useRef(onFocus);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onBlurRef.current = onBlur;
  }, [onBlur]);

  useEffect(() => {
    onFocusRef.current = onFocus;
  }, [onFocus]);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  usePreventWheelZoom(containerRef);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3],
        },
        bulletList: {
          HTMLAttributes: {
            class: 'list-disc pl-5 my-1',
          },
        },
        orderedList: {
          HTMLAttributes: {
            class: 'list-decimal pl-5 my-1',
          },
        },
      }),
    ],
    content: markdownToHtml(value || ''),
    autofocus: autoFocus ? 'end' : false,
    editorProps: {
      attributes: {
        class: cn('outline-none min-h-full w-full select-text cursor-text', styles.richTextContent),
        'data-placeholder': placeholder,
      },
      clipboardTextSerializer: (slice, view) => {
        try {
          const schema = view.state.schema;
          const domSerializer = DOMSerializer.fromSchema(schema);
          const domFragment = domSerializer.serializeFragment(slice.content);
          const tempDiv = document.createElement('div');
          tempDiv.appendChild(domFragment);
          return htmlToMarkdown(tempDiv.innerHTML);
        } catch {
          return '';
        }
      },
      handleKeyDown: (_view, event) => {
        // 阻止按键冒泡到画布，防止触发画布全局快捷键（如 Backspace/Delete 删节点，空格拖动画布等）
        event.stopPropagation();
        return false;
      },
      handlePaste: (view, event) => {
        const htmlData = event.clipboardData?.getData('text/html');
        const text = event.clipboardData?.getData('text/plain');

        // 场景 1: 如果剪贴板不包含语义化富文本 HTML（例如从纯文本/IDE 复制），但具有 Markdown 语法特征，则解析为 Markdown 富文本
        if (!hasSemanticHtml(htmlData || '') && text && isMarkdownText(text)) {
          event.preventDefault();
          const html = markdownToHtml(text);
          try {
            const pmParser = ProseMirrorDOMParser.fromSchema(view.state.schema);
            const domNode = new window.DOMParser().parseFromString(html, 'text/html');
            const slice = pmParser.parseSlice(domNode.body);
            const tr = view.state.tr.replaceSelection(slice);
            view.dispatch(tr);
            return true;
          } catch (e) {
            console.error('Failed to parse pasted markdown slice', e);
          }
        }
        // 场景 2: 如果剪贴板包含语义化 HTML（如网页/飞书/Word 复制的富文本），TipTap 默认 paste 会自动保留并解析对应富文本节点
        return false;
      },
    },
    onUpdate: ({ editor: currentEditor }) => {
      isInternalChangeRef.current = true;
      const html = currentEditor.getHTML();
      const markdown = htmlToMarkdown(html);
      lastMarkdownRef.current = markdown;
      onChangeRef.current(markdown);
    },
    onFocus: () => {
      onFocusRef.current?.();
    },
    onBlur: () => {
      onBlurRef.current?.();
    },
  });

  // 同步外部传入的 value（避免内部输入时循环重置光标）
  useEffect(() => {
    if (!editor) return;

    if (isInternalChangeRef.current) {
      isInternalChangeRef.current = false;
      return;
    }

    if (value !== lastMarkdownRef.current) {
      lastMarkdownRef.current = value || '';
      const newHtml = markdownToHtml(value || '');
      if (editor.getHTML() !== newHtml) {
        editor.commands.setContent(newHtml, { emitUpdate: false });
      }
    }
  }, [value, editor]);

  // 将 editor 实例回传给父级工具栏
  useEffect(() => {
    onEditorReady?.(editor);
    return () => {
      onEditorReady?.(null);
    };
  }, [editor, onEditorReady]);

  return (
    <div ref={containerRef} className={cn('w-full h-full p-4 overflow-y-auto nowheel nodrag select-text', styles.textNodeTextarea, className)}>
      <EditorContent editor={editor} className='w-full h-full' />
    </div>
  );
};

export default RichTextEditor;
