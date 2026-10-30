import { Schema, type NodeSpec, type DOMOutputSpec, Fragment, Node, Slice } from 'prosemirror-model';
import type { MentionItem } from './mentionPlugin';
import { getMentionAvatarSrc } from './utils';

const nodes: { [key: string]: NodeSpec } = {
  doc: {
    content: 'block+',
  },
  paragraph: {
    content: 'inline*',
    group: 'block',
    parseDOM: [{ tag: 'p' }],
    toDOM() {
      return ['p', 0];
    },
  },
  text: {
    group: 'inline',
  },
  mention: {
    attrs: {
      id: { default: '' },
      label: { default: '' },
      avatar: { default: '' },
      mediaKind: { default: 'image' },
    },
    group: 'inline',
    inline: true,
    selectable: true,
    draggable: true,
    atom: true,
    parseDOM: [
      {
        tag: 'span[data-mention-id]',
        getAttrs: (dom: HTMLElement) => ({
          id: dom.getAttribute('data-mention-id'),
          label: dom.getAttribute('data-mention-label'),
          avatar: dom.getAttribute('data-mention-avatar') || '',
          mediaKind: dom.getAttribute('data-mention-media') || 'image',
        }),
      },
    ],
    toDOM(node): DOMOutputSpec {
      const { id, label, avatar, mediaKind } = node.attrs;

      const domAttrs = {
        'data-mention-id': id,
        'data-mention-label': label,
        'data-mention-avatar': avatar,
        'data-mention-media': mediaKind || 'image',
        contenteditable: 'false',
        class: 'mention-tag inline-flex items-center px-2 h-6 gap-1 mx-1 rounded-full bg-white/10 text-white text-sm cursor-grab active:cursor-grabbing select-none transition-all',
      };

      const content: any[] = ['span', domAttrs];
      const kind = mediaKind || 'image';

      if (avatar) {
        content.push([
          'img',
          {
            src: getMentionAvatarSrc(avatar, kind),
            class: 'w-4 h-4 rounded-full object-cover pointer-events-none',
          },
        ]);
      }

      content.push(`${label}`);

      return content as unknown as DOMOutputSpec;
    },
  },
};

export const schema = new Schema({
  nodes,
  marks: {},
});

const serializeFragmentToRaw = (fragment: Fragment): string => {
  let output = '';
  fragment.descendants((node, pos) => {
    if (node.isText) {
      // 兼容 IME：解析时可能注入零宽字符作为 atom 前的"落点"，序列化时需忽略
      output += (node.text ?? '').replace(/\u200b/g, '');
    } else if (node.type.name === 'mention') {
      output += `{{@${node.attrs.label}}}`;
    } else if (node.type.name === 'paragraph') {
      if (pos > 0) output += '\n';
    }
    return true;
  });
  return output;
};

/**
 * 序列化：Doc -> String ({{@名称}})
 */
export const serializeToRaw = (doc: Node): string => serializeFragmentToRaw(doc.content);

/** 复制时将 mention 节点写入纯文本剪贴板，便于经普通输入框中转后再识别。 */
export const serializeToClipboardText = (slice: Slice): string => serializeFragmentToRaw(slice.content);

/**
 * 反序列化：String -> Doc
 */
export const parseRawToDoc = (text: string, mentions: MentionItem[]): Node => {
  const lines = text.split('\n');
  const paragraphs = lines.map(line => {
    const inlineContent: Node[] = [];
    // 正则匹配 {{@内容}}
    const parts = line.split(/({{@(?:(?!}}).)+}})/g);

    for (const part of parts) {
      if (!part) continue;
      if (part.startsWith('{{@') && part.endsWith('}}')) {
        const label = part.slice(3, -2); // {{@ 是3位，}} 是2位
        // 根据名称反向寻找用户对象以获取 ID 和头像
        const mention = mentions.find(u => u.name === label);
        if (mention) {
          // 兼容 IME：在 mention atom 前始终注入零宽字符，为 IME composition 提供稳定文本落点。
          // ProseMirror 自动合并相邻文本节点（如 "hello"+"\u200b" → "hello\u200b"）。
          // 序列化时零宽字符会被过滤掉，不影响外部 value。
          inlineContent.push(schema.text('\u200b'));
          inlineContent.push(
            schema.nodes.mention.create({
              id: mention.id,
              label: mention.name,
              avatar: mention.avatar || '',
              mediaKind: mention.mediaKind || 'image',
            })
          );
        } else {
          // 如果找不到（比如被删了），降级为普通文本
          inlineContent.push(schema.text(part));
        }
      } else {
        inlineContent.push(schema.text(part));
      }
    }
    return schema.nodes.paragraph.create(null, inlineContent.length > 0 ? inlineContent : undefined);
  });

  return schema.nodes.doc.create(null, paragraphs.length > 0 ? paragraphs : [schema.nodes.paragraph.create()]);
};

/** 将剪贴板纯文本还原为可插入当前编辑位置的内容片段。 */
export const parseClipboardText = (text: string, mentions: MentionItem[]): Slice => Slice.maxOpen(parseRawToDoc(text, mentions).content);
