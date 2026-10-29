import React from 'react';
import { useEditorState, type Editor } from '@tiptap/react';
import { Bold, Italic, List, ListOrdered, Minus, Copy, Maximize2, X, Pilcrow } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface TextNodeToolbarProps {
  editor: Editor | null;
  mode?: 'node' | 'modal';
  onOpenModal?: () => void;
  onCopyContent?: () => void;
  onCloseModal?: () => void;
  className?: string;
}

interface ToolbarButtonProps {
  tooltip: string;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  active?: boolean;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}

const ToolbarButton: React.FC<ToolbarButtonProps> = ({ tooltip, onClick, active, disabled, className, children }) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <button
        type='button'
        disabled={disabled}
        onClick={onClick}
        className={cn(
          'h-7 min-w-7 px-1.5 flex items-center justify-center rounded-md text-white/80 hover:text-white hover:bg-white/10 transition-colors text-xs font-medium cursor-pointer select-none disabled:opacity-50 disabled:cursor-not-allowed',
          active && 'bg-white/20 text-white',
          className
        )}
      >
        {children}
      </button>
    </TooltipTrigger>
    <TooltipContent>
      <p>{tooltip}</p>
    </TooltipContent>
  </Tooltip>
);

export const TextNodeToolbar: React.FC<TextNodeToolbarProps> = ({ editor, mode = 'node', onOpenModal, onCopyContent, onCloseModal, className }) => {
  const activeState = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) => {
      const heading1 = currentEditor?.isActive('heading', { level: 1 }) ?? false;
      const heading2 = currentEditor?.isActive('heading', { level: 2 }) ?? false;
      const heading3 = currentEditor?.isActive('heading', { level: 3 }) ?? false;
      const bold = currentEditor?.isActive('bold') ?? false;
      const italic = currentEditor?.isActive('italic') ?? false;
      const bulletList = currentEditor?.isActive('bulletList') ?? false;
      const orderedList = currentEditor?.isActive('orderedList') ?? false;
      return {
        heading1,
        heading2,
        heading3,
        bold,
        italic,
        bulletList,
        orderedList,
      };
    },
  });

  const handleMouseDown = (e: React.MouseEvent) => {
    // 阻止工具栏点击抢占编辑器焦点
    e.preventDefault();
  };

  const handleClearFormatting = () => {
    if (!editor) return;

    editor
      .chain()
      .focus()
      .command(({ tr, state }) => {
        if (state.selection.empty) {
          const { $from } = state.selection;
          tr.removeMark($from.start(), $from.end());
          tr.setStoredMarks([]);
        }
        return true;
      })
      .setParagraph()
      .clearNodes()
      .unsetAllMarks()
      .run();
  };

  const buttonGroups: ToolbarButtonProps[][] = [
    // 标题与正文清除格式组
    [
      {
        tooltip: '一级标题',
        active: activeState?.heading1,
        disabled: !editor,
        onClick: () => editor?.chain().focus().toggleHeading({ level: 1 }).run(),
        children: 'H1',
      },
      {
        tooltip: '二级标题',
        active: activeState?.heading2,
        disabled: !editor,
        onClick: () => editor?.chain().focus().toggleHeading({ level: 2 }).run(),
        children: 'H2',
      },
      {
        tooltip: '三级标题',
        active: activeState?.heading3,
        disabled: !editor,
        onClick: () => editor?.chain().focus().toggleHeading({ level: 3 }).run(),
        children: 'H3',
      },
      {
        tooltip: '清除格式',
        active: false,
        disabled: !editor,
        onClick: handleClearFormatting,
        children: <Pilcrow size={15} />,
      },
    ],
    // 样式标记组 (加粗、斜体)
    [
      {
        tooltip: '加粗',
        active: activeState?.bold,
        disabled: !editor,
        onClick: () => editor?.chain().focus().toggleBold().run(),
        children: <Bold size={15} />,
      },
      {
        tooltip: '斜体',
        active: activeState?.italic,
        disabled: !editor,
        onClick: () => editor?.chain().focus().toggleItalic().run(),
        children: <Italic size={15} />,
      },
    ],
    // 列表与分割线组
    [
      {
        tooltip: '无序列表',
        active: activeState?.bulletList,
        disabled: !editor,
        onClick: () => editor?.chain().focus().toggleBulletList().run(),
        children: <List size={16} />,
      },
      {
        tooltip: '有序列表',
        active: activeState?.orderedList,
        disabled: !editor,
        onClick: () => editor?.chain().focus().toggleOrderedList().run(),
        children: <ListOrdered size={16} />,
      },
      {
        tooltip: '插入分割线',
        disabled: !editor,
        onClick: () => editor?.chain().focus().setHorizontalRule().run(),
        children: <Minus size={16} />,
      },
    ],
    // 模式专属扩展操作组
    ...(mode === 'node'
      ? onOpenModal
        ? [
            [
              {
                tooltip: '放大编辑',
                onClick: (e: React.MouseEvent<HTMLButtonElement>) => {
                  e.stopPropagation();
                  onOpenModal();
                },
                children: <Maximize2 size={16} />,
              },
            ],
          ]
        : []
      : [
          [
            ...(onCopyContent
              ? [
                  {
                    tooltip: '复制内容',
                    onClick: (e: React.MouseEvent<HTMLButtonElement>) => {
                      e.stopPropagation();
                      onCopyContent();
                    },
                    children: <Copy size={16} />,
                  },
                ]
              : []),
            ...(onCloseModal
              ? [
                  {
                    tooltip: '关闭',
                    onClick: (e: React.MouseEvent<HTMLButtonElement>) => {
                      e.stopPropagation();
                      onCloseModal();
                    },
                    children: <X size={16} />,
                  },
                ]
              : []),
          ],
        ].filter(group => group.length > 0)),
  ];

  return (
    <TooltipProvider delayDuration={150}>
      <div
        className={cn('flex items-center nodrag select-none h-10 gap-0.5 p-1 rounded-lg bg-[#262626] border border-white/10 shadow-lg', className)}
        onMouseDown={handleMouseDown}
      >
        {buttonGroups.map((group, groupIdx) => (
          <React.Fragment key={groupIdx}>
            {groupIdx > 0 && <div className='w-[1px] h-4 bg-white/15 mx-1' />}
            {group.map((item, itemIdx) => (
              <ToolbarButton key={item.tooltip || itemIdx} {...item} />
            ))}
          </React.Fragment>
        ))}
      </div>
    </TooltipProvider>
  );
};

export default TextNodeToolbar;
