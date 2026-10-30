import { Plugin, PluginKey } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';

export interface MentionItem {
  id: string;
  name: string;
  avatar?: string;
  /** 编辑器与下拉中缩略图展示方式；缺省视为 image */
  mediaKind?: 'image' | 'video' | 'audio';
}

export interface MentionPluginState {
  active: boolean;
  query: string;
  range: { from: number; to: number } | null;
}

export const mentionPluginKey = new PluginKey<MentionPluginState>('mentionPlugin');

export const createMentionPlugin = (onStateChange: (state: MentionPluginState, view: EditorView) => void) => {
  return new Plugin({
    key: mentionPluginKey,
    state: {
      init: () => ({ active: false, query: '', range: null }),
      apply(tr, prev) {
        const meta = tr.getMeta(mentionPluginKey);
        if (meta) return { ...prev, ...meta };

        const { selection } = tr;
        if (!selection.empty) return { active: false, query: '', range: null };

        const $pos = selection.$from;
        // 非文本 inline 节点（如 mention）应中断 @ 查询，不能成为 query 的一部分。
        const textBefore = $pos.parent.textBetween(Math.max(0, $pos.parentOffset - 20), $pos.parentOffset, undefined, ' ');

        const match = /@([^\s@\u200b]*)$/.exec(textBefore);
        if (match) {
          const query = match[1];
          const from = $pos.pos - match[0].length;
          const to = $pos.pos;
          return { active: true, query, range: { from, to } };
        }

        return { active: false, query: '', range: null };
      },
    },
    view() {
      return {
        update: view => {
          const state = mentionPluginKey.getState(view.state);
          if (state) {
            onStateChange(state, view);
          }
        },
      };
    },
    props: {
      handleKeyDown(view, event) {
        const state = mentionPluginKey.getState(view.state);
        if (!state?.active) return false;

        // 我们通常让 React 组件通过 ref 处理这些按键，这里保持透传
        if (['ArrowUp', 'ArrowDown', 'Enter', 'Escape'].includes(event.key)) {
          return false;
        }
        return false;
      },
    },
  });
};
