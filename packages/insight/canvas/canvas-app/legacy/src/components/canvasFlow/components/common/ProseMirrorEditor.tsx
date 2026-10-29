import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { EditorState, Plugin, TextSelection, NodeSelection, Transaction } from 'prosemirror-state';
import { EditorView, Decoration, DecorationSet } from 'prosemirror-view';
import { history, undo, redo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap, splitBlock } from 'prosemirror-commands';
import { dropCursor } from 'prosemirror-dropcursor';
import { schema, serializeToRaw, parseRawToDoc, serializeToClipboardText, parseClipboardText } from '@/lib/schema';
import { createMentionPlugin, mentionPluginKey } from '@/lib/mentionPlugin';
import type { MentionPluginState, MentionItem } from '@/lib/mentionPlugin';
import MentionDropdown, { type MentionDropdownHandle } from './MentionDropdown';
import { usePreventWheelZoom } from '@/hooks/usePreventWheelZoom';
import { useFlowStore } from '@/store/flowStore';

/**
 * 尾随零宽字符插件：确保 mention 节点后面始终有文本节点，
 * 防止 mention（atom + inline-flex + contenteditable=false）作为段落最后一个节点时
 * 浏览器无法正确放置光标导致光标跳行。
 */
const createTrailingZWSPlugin = (): Plugin => {
  return new Plugin({
    appendTransaction(_transactions: readonly Transaction[], _oldState, newState) {
      const insertPositions: number[] = [];

      newState.doc.descendants((node, pos) => {
        if (!node.isTextblock) return true;
        if (node.lastChild?.type.name === 'mention') {
          insertPositions.push(pos + node.content.size + 1);
        }
        return false;
      });

      if (insertPositions.length === 0) return null;

      const tr = newState.tr;
      for (let i = insertPositions.length - 1; i >= 0; i--) {
        tr.insert(insertPositions[i], schema.text('\u200b'));
      }
      return tr;
    },
  });
};

/** 占位符插件：文档为空时在首段显示 placeholder */
const createPlaceholderPlugin = (getPlaceholderText: () => string): Plugin => {
  return new Plugin({
    props: {
      decorations(state) {
        const placeholderText = getPlaceholderText();
        if (!placeholderText?.trim()) return null;
        const { doc, selection } = state;
        const { $from } = selection;
        const first = doc.firstChild;
        const empty = doc.childCount === 1 && first && first.isTextblock && first.content.size === 0;
        if (!empty) return null;
        const from = $from.before();
        const to = $from.after();
        const deco = Decoration.node(from, to, {
          'data-placeholder': placeholderText,
          style: 'opacity: 0.45; font-size: 14px',
        });
        return DecorationSet.create(doc, [deco]);
      },
    },
  });
};

interface Props {
  value: string; // 外部传入的值
  mentions: MentionItem[];
  onSearch?: (query: string) => void;
  onChange?: (value: string) => void;
  autoFocus?: boolean;
  placeholder?: string;
}

const ProseMirrorEditor: React.FC<Props> = ({ value, mentions, onSearch, onChange, autoFocus = false, placeholder }) => {
  const readOnly = useFlowStore(state => state.readOnly);
  const readOnlyRef = useRef(readOnly);
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const dropdownRef = useRef<MentionDropdownHandle>(null);
  const lastValueRef = useRef<string>(value);
  const latestExternalValueRef = useRef<string>(value);
  const pendingExternalValueRef = useRef<string | null>(null);
  const pendingReparseValueRef = useRef<string | null>(null);
  const placeholderTextRef = useRef<string>(placeholder ?? '');
  const mentionsRef = useRef(mentions);

  // 标记编辑器是否在 value effect 上一次运行之后发生了内容变更。
  // 用于防止 React 渲染时序导致旧 value prop 被存为 pending。
  const editorChangedRef = useRef(false);

  const onChangeRef = useRef(onChange);
  const onSearchRef = useRef(onSearch);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    onSearchRef.current = onSearch;
  }, [onSearch]);

  useEffect(() => {
    mentionsRef.current = mentions;
  }, [mentions]);

  useEffect(() => {
    readOnlyRef.current = readOnly;
    viewRef.current?.setProps({ editable: () => !readOnly });
  }, [readOnly]);

  useEffect(() => {
    placeholderTextRef.current = placeholder ?? '';
    const view = viewRef.current;
    if (!view) return;
    view.dispatch(view.state.tr.setMeta('placeholder:refresh', true));
  }, [placeholder]);

  const [mentionState, setMentionState] = useState<MentionPluginState>({ active: false, query: '', range: null });
  const [dropdownAnchor, setDropdownAnchor] = useState({ top: 0, left: 0 });
  /** 当前 mention 输入会话内是否允许展示空候选（含「无」）；blur/不可见时重置 */
  const [allowEmptyMentionDropdown, setAllowEmptyMentionDropdown] = useState(false);
  const resetMentionTypingSessionRef = useRef(() => setAllowEmptyMentionDropdown(false));
  const markMentionTypingSessionRef = useRef(() => setAllowEmptyMentionDropdown(true));

  const resetMentionTypingSession = useCallback(() => {
    setAllowEmptyMentionDropdown(false);
  }, []);

  const markMentionTypingSession = useCallback(() => {
    setAllowEmptyMentionDropdown(true);
  }, []);

  useEffect(() => {
    resetMentionTypingSessionRef.current = resetMentionTypingSession;
    markMentionTypingSessionRef.current = markMentionTypingSession;
  }, [resetMentionTypingSession, markMentionTypingSession]);

  // 容器不可见时结束会话（兜底：取消选中未触发 blur）
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      entries => {
        const entry = entries[0];
        if (entry?.intersectionRatio === 0) {
          resetMentionTypingSessionRef.current();
        }
      },
      { threshold: [0, 0.01] }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // 下拉候选直接由编辑器自身的 query 同步过滤完整 mentions 得出，
  // 单一数据源，避免跨组件异步回传（suggestions/searchQuery）导致的偶发空列表竞态。
  const dropdownItems = useMemo(() => {
    const q = (mentionState.query ?? '').replace(/\u200b/g, '').toLowerCase();
    return mentions.filter(u => u.name.toLowerCase().includes(q));
  }, [mentions, mentionState.query]);

  const showMentionDropdown = mentionState.active && (dropdownItems.length > 0 || allowEmptyMentionDropdown);

  const replaceDocPreserveSelection = useCallback(
    (raw: string) => {
      const view = viewRef.current;
      if (!view) return;

      const newDoc = parseRawToDoc(raw, mentions);
      if (newDoc.eq(view.state.doc)) return;

      const { state } = view;
      const tr = state.tr.replaceWith(0, state.doc.content.size, newDoc.content);
      tr.setMeta('addToHistory', false);
      tr.setMeta('prompt:external', true);

      const mappedSelection = state.selection.map(tr.doc, tr.mapping);
      tr.setSelection(mappedSelection);

      view.dispatch(tr);
      lastValueRef.current = raw;
      editorChangedRef.current = false;
    },
    [mentions]
  );

  // 使用 Ref 保证 blur 等闭包始终访问最新的 replaceDocPreserveSelection
  const replaceDocRef = useRef(replaceDocPreserveSelection);
  useEffect(() => {
    replaceDocRef.current = replaceDocPreserveSelection;
  }, [replaceDocPreserveSelection]);

  const handleMentionStateChange = useCallback((state: MentionPluginState, view: EditorView) => {
    setMentionState(state);
    if (state.active && state.range) {
      // 先触发外部搜索回调，保证即使下面取锚点坐标失败也不会被跳过。
      if (onSearchRef.current) onSearchRef.current(state.query);

      // 取锚点坐标可能因 range 位置在文档异步重解析后失效而抛错，
      // 此处容错：失败时保留上一次锚点，不影响下拉的显示与内容。
      try {
        const container = containerRef.current;
        if (!container) return;
        const coords = view.coordsAtPos(state.range.from);
        const containerRect = container.getBoundingClientRect();

        setDropdownAnchor({
          top: coords.bottom - containerRect.top + container.scrollTop + 8,
          left: coords.left - containerRect.left + container.scrollLeft,
        });
      } catch {
        // ignore: 锚点计算失败时沿用上一次位置
      }
    }
  }, []);

  // 处理受控 Value
  useEffect(() => {
    if (!viewRef.current) return;
    const view = viewRef.current;
    latestExternalValueRef.current = value;
    const currentRaw = serializeToRaw(view.state.doc);

    if (value === currentRaw) {
      editorChangedRef.current = false;
      lastValueRef.current = value;
      pendingExternalValueRef.current = null;
      return;
    }

    if (view.hasFocus()) {
      if (editorChangedRef.current) {
        return;
      }
      pendingExternalValueRef.current = value;
      return;
    }

    if (value !== lastValueRef.current) {
      replaceDocPreserveSelection(value);
    }
  }, [value, replaceDocPreserveSelection]);

  // mentions 异步更新时重新解析文档
  useEffect(() => {
    if (!viewRef.current) return;
    const view = viewRef.current;
    const currentRaw = serializeToRaw(view.state.doc);
    const nextDoc = parseRawToDoc(currentRaw, mentions);
    if (nextDoc.eq(view.state.doc)) return;

    if (view.hasFocus()) {
      pendingReparseValueRef.current = currentRaw;
      return;
    }

    replaceDocPreserveSelection(currentRaw);
  }, [mentions, replaceDocPreserveSelection]);

  // 同步名称和删除逻辑
  useEffect(() => {
    if (!viewRef.current) return;
    const view = viewRef.current;
    const mentionMap = new Map<string, MentionItem>();
    mentions.forEach(u => mentionMap.set(u.id, u));

    const finalTr = view.state.tr;
    let hasChanges = false;
    const updates: {
      pos: number;
      node: any;
      newLabel: string;
      newAvatar: string;
      newMediaKind: string;
    }[] = [];
    const deletions: { from: number; to: number }[] = [];

    view.state.doc.descendants((node, pos) => {
      if (node.type.name === 'mention') {
        const currentUser = mentionMap.get(node.attrs.id);
        if (!currentUser) {
          deletions.push({ from: pos, to: pos + node.nodeSize });
          hasChanges = true;
        } else if (
          currentUser.name !== node.attrs.label ||
          (currentUser.avatar || '') !== (node.attrs.avatar || '') ||
          (currentUser.mediaKind || 'image') !== (node.attrs.mediaKind || 'image')
        ) {
          updates.push({
            pos,
            node,
            newLabel: currentUser.name,
            newAvatar: currentUser.avatar || '',
            newMediaKind: currentUser.mediaKind || 'image',
          });
          hasChanges = true;
        }
      }
      return true;
    });

    if (hasChanges) {
      for (let i = deletions.length - 1; i >= 0; i--) {
        finalTr.delete(deletions[i].from, deletions[i].to);
      }
      updates.forEach(({ pos, node, newLabel, newAvatar, newMediaKind }) => {
        const mappedPos = finalTr.mapping.map(pos);
        finalTr.setNodeMarkup(mappedPos, undefined, {
          ...node.attrs,
          label: newLabel,
          avatar: newAvatar,
          mediaKind: newMediaKind,
        });
      });
      if (finalTr.docChanged) {
        view.dispatch(finalTr);
        const newRaw = serializeToRaw(view.state.doc);
        if (newRaw !== lastValueRef.current) {
          lastValueRef.current = newRaw;
          onChangeRef.current?.(newRaw);
        }
      }
    }
  }, [mentions]);

  const insertMention = useCallback(
    (mention: MentionItem) => {
      const view = viewRef.current;
      const pluginState = view ? mentionPluginKey.getState(view.state) : null;
      const range = pluginState?.active ? pluginState.range : mentionState.range;
      if (!view || !range) return;

      const { from, to } = range;
      const tr = view.state.tr.replaceWith(
        from,
        to,
        schema.nodes.mention.create({
          id: mention.id,
          label: mention.name,
          avatar: mention.avatar || '',
          mediaKind: mention.mediaKind || 'image',
        })
      );

      tr.insertText(' ');
      tr.setMeta(mentionPluginKey, { active: false, query: '', range: null });

      view.dispatch(tr);
      view.focus();
    },
    [mentionState]
  );

  // 初始化
  useEffect(() => {
    if (!editorRef.current) return;

    const initialDoc = parseRawToDoc(value, mentions);
    const placeholderPlugin = createPlaceholderPlugin(() => placeholderTextRef.current);
    const trailingZWSPlugin = createTrailingZWSPlugin();
    const state = EditorState.create({
      doc: initialDoc,
      schema,
      plugins: [
        history(),
        dropCursor({ color: '#3b82f6', width: 2, class: 'drop-cursor' }),
        keymap({ 'Mod-z': undo, 'Mod-y': redo, ...baseKeymap }),
        createMentionPlugin(handleMentionStateChange),
        placeholderPlugin,
        trailingZWSPlugin,
      ].filter(Boolean),
    });

    const view = new EditorView(editorRef.current, {
      state,
      editable: () => !readOnlyRef.current,
      clipboardTextSerializer: serializeToClipboardText,
      transformPasted(slice) {
        const raw = serializeToClipboardText(slice);
        return /{{@(?:(?!}}).)+}}/.test(raw) ? parseClipboardText(raw, mentionsRef.current) : slice;
      },
      dispatchTransaction(transaction) {
        const newState = view.state.apply(transaction);
        view.updateState(newState);

        if (transaction.docChanged && !transaction.getMeta('prompt:external') && onChangeRef.current && !readOnlyRef.current) {
          editorChangedRef.current = true;
          const currentRaw = serializeToRaw(newState.doc);
          if (currentRaw !== lastValueRef.current) {
            lastValueRef.current = currentRaw;
            onChangeRef.current(currentRaw);
          }
        }
      },
      handleKeyDown(view, event) {
        if (event.key !== 'Escape') {
          markMentionTypingSessionRef.current();
        }

        const pluginState = mentionPluginKey.getState(view.state);
        if (pluginState?.active && dropdownRef.current) {
          return dropdownRef.current.onKeyDown(event);
        }

        const { selection } = view.state;

        if (event.key === 'Enter' && event.shiftKey) {
          event.preventDefault();
          return splitBlock(view.state, view.dispatch, view);
        }

        // Backspace 删除 mention 兜底：当 mention 成为段落末尾时，尾随 ZWS 插件会强制补一个 \u200b。
        // 若光标停在该 ZWS 后，默认回退只会删 ZWS，但下一次事务又被补回，导致 mention 无法删除。
        // 这里在满足条件时一次性删除 mention + ZWS。
        if (event.key === 'Backspace') {
          // NodeSelection 直接删除当前 mention
          if (selection instanceof NodeSelection && selection.node.type.name === 'mention') {
            view.dispatch(view.state.tr.delete(selection.from, selection.to));
            return true;
          }

          if (selection instanceof TextSelection && selection.empty) {
            const $from = selection.$from;

            // 光标紧贴在 mention 之后：直接删 mention
            if ($from.nodeBefore?.type.name === 'mention') {
              const from = $from.pos - $from.nodeBefore.nodeSize;
              view.dispatch(view.state.tr.delete(from, $from.pos));
              return true;
            }

            // 光标在尾随 ZWS 后：删 mention + ZWS
            const nb = $from.nodeBefore;
            if (nb?.isText && nb.text === '\u200b') {
              const zwsStart = $from.pos - nb.nodeSize; // nodeSize 通常为 text.length
              const $beforeZWS = view.state.doc.resolve(zwsStart);
              if ($beforeZWS.nodeBefore?.type.name === 'mention') {
                const mentionNode = $beforeZWS.nodeBefore;
                const mentionStart = zwsStart - mentionNode.nodeSize;
                view.dispatch(view.state.tr.delete(mentionStart, $from.pos));
                return true;
              }
            }
          }
        }

        if (event.key === 'ArrowLeft') {
          if (selection instanceof NodeSelection && selection.node.type.name === 'mention') {
            let targetPos = selection.from;
            const $pos = view.state.doc.resolve(targetPos);
            const nb = $pos.nodeBefore;
            if (nb?.isText && nb.text?.endsWith('\u200b')) {
              targetPos -= 1;
            }
            view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, targetPos)));
            return true;
          }
          if (selection instanceof TextSelection && selection.empty) {
            const $from = selection.$from;
            if ($from.nodeBefore?.type.name === 'mention') {
              let targetPos = $from.pos - $from.nodeBefore.nodeSize;
              const $target = view.state.doc.resolve(targetPos);
              const nb = $target.nodeBefore;
              if (nb?.isText && nb.text?.endsWith('\u200b')) {
                targetPos -= 1;
              }
              view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, targetPos)));
              return true;
            }
          }
        }

        if (event.key === 'ArrowRight') {
          if (selection instanceof NodeSelection && selection.node.type.name === 'mention') {
            const targetPos = selection.to;
            view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, targetPos)));
            return true;
          }
          if (selection instanceof TextSelection && selection.empty) {
            const $from = selection.$from;
            if ($from.nodeAfter?.type.name === 'mention') {
              const targetPos = $from.pos + $from.nodeAfter.nodeSize;
              view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, targetPos)));
              return true;
            }
            if ($from.nodeAfter?.isText && $from.nodeAfter.text === '\u200b') {
              const afterZWSPos = $from.pos + $from.nodeAfter.nodeSize;
              const $afterZWS = view.state.doc.resolve(afterZWSPos);
              if ($afterZWS.nodeAfter?.type.name === 'mention') {
                const targetPos = afterZWSPos + $afterZWS.nodeAfter.nodeSize;
                view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, targetPos)));
                return true;
              }
            }
          }
        }

        return false;
      },
      handleDOMEvents: {
        beforeinput: () => {
          markMentionTypingSessionRef.current();
          return false;
        },
        compositionstart: view => {
          markMentionTypingSessionRef.current();
          const { $from } = view.state.selection;
          const nodeAfter = $from.nodeAfter;

          if (nodeAfter?.type.name === 'mention') {
            const domSel = window.getSelection();
            if (domSel && domSel.isCollapsed && domSel.anchorNode) {
              const { anchorNode, anchorOffset } = domSel;

              if (anchorNode.nodeType === Node.ELEMENT_NODE) {
                let textNode: ChildNode | null = null;
                for (let i = anchorOffset - 1; i >= 0; i--) {
                  const child = anchorNode.childNodes[i];
                  if (child.nodeType === Node.TEXT_NODE) {
                    textNode = child;
                    break;
                  }
                }

                if (textNode) {
                  domSel.collapse(textNode, (textNode as Text).length);
                } else {
                  const newTextNode = document.createTextNode('\u200b');
                  const refChild = anchorNode.childNodes[anchorOffset];
                  if (refChild) {
                    anchorNode.insertBefore(newTextNode, refChild);
                  } else {
                    anchorNode.appendChild(newTextNode);
                  }
                  domSel.collapse(newTextNode, newTextNode.length);
                }
              }
            }
          }

          return false;
        },
        compositionend: () => {
          pendingExternalValueRef.current = null;
          return false;
        },
        blur: () => {
          resetMentionTypingSessionRef.current();
          pendingExternalValueRef.current = null;
          pendingReparseValueRef.current = null;

          const view = viewRef.current;
          if (!view) return false;

          const pluginState = mentionPluginKey.getState(view.state);
          const currentRaw = serializeToRaw(view.state.doc);
          // mention 下拉打开时跳过重解析，避免 blur 破坏 @ 触发范围
          if (pluginState?.active) return false;
          replaceDocRef.current(currentRaw);

          return false;
        },
        dragstart: (_, event) => {
          event.stopPropagation();
          return false;
        },
        dragover: (_, event) => {
          event.stopPropagation();
          return false;
        },
        dragenter: (_, event) => {
          event.stopPropagation();
          return false;
        },
        dragleave: (_, event) => {
          event.stopPropagation();
          return false;
        },
        drop: (_, event) => {
          event.stopPropagation();
          return false;
        },
      },
    });

    viewRef.current = view;

    if (autoFocus) {
      view.focus();
    }

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []); // 保持 []，不因为回调改变而重启编辑器

  usePreventWheelZoom(editorRef);

  return (
    <div
      ref={containerRef}
      className={`relative w-full nodrag nopan nowheel prose-mirror-editor${readOnly ? ' select-text' : ''}`}
      data-placeholder-editor={placeholder ? true : undefined}
      data-prompt-copyable={readOnly ? true : undefined}
    >
      {placeholder && (
        <style>{`
          .prose-mirror-editor[data-placeholder-editor] .ProseMirror p[data-placeholder] {
            position: relative;
          }
          .prose-mirror-editor[data-placeholder-editor] .ProseMirror p[data-placeholder]::before {
            content: attr(data-placeholder);
            position: absolute;
            left: 0;
            top: 0;
            color: hsl(var(--muted-foreground));
            pointer-events: none;
          }
        `}</style>
      )}
      <div ref={editorRef} className='relative w-full min-h-[100px] max-h-[300px] overflow-y-auto no-scrollbar scroll-smooth text-sm' />
      {showMentionDropdown && (
        <MentionDropdown
          ref={dropdownRef}
          suggestions={dropdownItems}
          anchor={dropdownAnchor}
          onSelect={insertMention}
          onClose={() => {
            const view = viewRef.current;
            if (view) {
              view.dispatch(view.state.tr.setMeta(mentionPluginKey, { active: false, query: '', range: null }));
              view.focus();
            }
          }}
        />
      )}
    </div>
  );
};

export default ProseMirrorEditor;
